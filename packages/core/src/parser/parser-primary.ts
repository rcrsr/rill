/**
 * Parser Extension: Primary and Postfix Expressions
 * Postfix chain, invocation, and primary expression parsing
 */

import { Parser } from './parser.js';
import type {
  AnnotatedExprNode,
  AnnotationAccessNode,
  ExpressionNode,
  IndexAccessNode,
  InvokeNode,
  MethodCallNode,
  PassBlockNode,
  DictNode,
  ExistenceCheck,
  PipeChainNode,
  PostfixExprNode,
  PrimaryNode,
  RillTypeName,
  SourceLocation,
  SpreadArgNode,
  StatusProbeNode,
  TypeNameExprNode,
} from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import {
  check,
  advance,
  expect,
  current,
  previous,
  isAtEnd,
  makeSpan,
  peek,
  skipNewlines,
  skipNewlinesIfFollowedBy,
  withRecursionDepth,
} from './state.js';
import {
  isHostCall,
  isClosureCall,
  isAnnotationAccess,
  isMethodCall,
  isNegativeNumber,
  isLiteralStart,
  isClosureStart,
  parseBareHostCall,
  VALID_TYPE_NAMES,
  describeToken,
} from './helpers.js';
import { parseTypeRef } from './parser-types.js';
import { isTypeConstructorName } from './parser-shape.js';
import { parseSpreadOrArg } from './parser-functions.js';
import { ERROR_IDS } from '../error-registry.js';

/**
 * Mutable state shared between parsePostfixExprBase and its dispatch handlers.
 * Handlers mutate this object in place (void return).
 */
export interface PostfixLoopState {
  primary: PrimaryNode;
  methods: (
    | MethodCallNode
    | InvokeNode
    | AnnotationAccessNode
    | IndexAccessNode
  )[];
  receiverEnd: SourceLocation;
}

// Declaration merging to add methods to Parser interface
declare module './parser.js' {
  interface Parser {
    parsePostfixExpr(): PostfixExprNode;
    parsePostfixExprBase(): PostfixExprNode;
    parsePrimary(): PrimaryNode;
    parseInvoke(): InvokeNode;
    parsePostfixDotBang(
      loopState: PostfixLoopState,
      start: SourceLocation
    ): void;
    parsePostfixColon(loopState: PostfixLoopState, start: SourceLocation): void;
  }
}

Parser.prototype.parsePostfixExpr = function (this: Parser): PostfixExprNode {
  const postfixExpr = this.parsePostfixExprBase();

  // Site 3: Add newline lookahead before ? check
  if (skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.QUESTION)) {
    const conditional = this.parseConditionalWithCondition(postfixExpr);
    const span = makeSpan(
      postfixExpr.span.start,
      previous(this.state).span.end
    );
    return this.wrapConditionalInPostfixExpr(conditional, span);
  }

  return postfixExpr;
};

// ============================================================
// POSTFIX DISPATCH TABLE AND HANDLERS
// ============================================================

// Handler: .! (bare) or .!field — status probe
// Wraps accumulated primary+methods as probe target; resets methods array.
Parser.prototype.parsePostfixDotBang = function (
  this: Parser,
  loopState: PostfixLoopState,
  start: SourceLocation
): void {
  const probeToken = advance(this.state);
  let field: string | undefined = undefined;
  let probeEnd = probeToken.span.end;
  // A trailing `.!` at end of line continues onto an optional field name on
  // the next line, mirroring the same-line `.!field` spacing tolerance.
  skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.IDENTIFIER);
  if (check(this.state, TOKEN_TYPES.IDENTIFIER)) {
    const fieldToken = advance(this.state);
    field = fieldToken.value;
    probeEnd = fieldToken.span.end;
  }
  // Wrap the current primary+methods so far as the probe target.
  const targetSpan = makeSpan(start, loopState.receiverEnd);
  const targetPipeChain: PipeChainNode = {
    type: 'PipeChain',
    head: {
      type: 'PostfixExpr',
      primary: loopState.primary,
      methods: [...loopState.methods],
      defaultValue: null,
      span: targetSpan,
    },
    pipes: [],
    terminator: null,
    span: targetSpan,
  };
  const probeNode: StatusProbeNode = {
    type: 'StatusProbe',
    target: targetPipeChain,
    field,
    span: makeSpan(start, probeEnd),
  };
  // The probe becomes the new primary; clear collected methods.
  loopState.primary = probeNode;
  loopState.methods.length = 0;
  loopState.receiverEnd = probeEnd;
};

// Handler: :type / :?type — postfix type assertion or type check.
// Wraps accumulated primary+methods so far as the operand; resets methods
// array. Mirrors parsePostfixDotBang's probe-reset pattern so a trailing
// `.method` chain continues on the TypeAssertion/TypeCheck result
// (`$x:number.foo`) and a leading index/method chain is captured as the
// operand (`list[1,2,3][0]:number`).
Parser.prototype.parsePostfixColon = function (
  this: Parser,
  loopState: PostfixLoopState,
  start: SourceLocation
): void {
  const operand: PostfixExprNode = {
    type: 'PostfixExpr',
    primary: loopState.primary,
    methods: [...loopState.methods],
    defaultValue: null,
    span: makeSpan(start, loopState.receiverEnd),
  };
  const typeOp = this.parsePostfixTypeOperation(operand);
  loopState.primary = typeOp;
  loopState.methods.length = 0;
  loopState.receiverEnd = typeOp.span.end;
};

// Handler: (...) — invoke expression
// Dispatch table for the postfix loop inside parsePostfixExprBase.
// Multi-token guards (isAnnotationAccess, isMethodCall) are evaluated before this table.
// Exported for parser-pipe-target.ts.
export const postfixDispatchTable: Record<
  string,
  (this: Parser, loopState: PostfixLoopState, start: SourceLocation) => void
> = {
  [TOKEN_TYPES.DOT_BANG]: Parser.prototype.parsePostfixDotBang,
  [TOKEN_TYPES.COLON]: Parser.prototype.parsePostfixColon,
  [TOKEN_TYPES.LPAREN]: function (
    this: Parser,
    loopState: PostfixLoopState
  ): void {
    const invoke = this.parseInvoke();
    loopState.methods.push(invoke);
    loopState.receiverEnd = invoke.span.end;
  },
  [TOKEN_TYPES.LBRACKET]: function (
    this: Parser,
    loopState: PostfixLoopState
  ): void {
    const openBracket = advance(this.state); // consume [
    const index = this.parsePipeChain();
    const closeBracket = expect(
      this.state,
      TOKEN_TYPES.RBRACKET,
      'Expected ] after index expression',
      ERROR_IDS.RILL_P005
    );
    const indexAccess: IndexAccessNode = {
      type: 'IndexAccess',
      index,
      span: makeSpan(openBracket.span.start, closeBracket.span.end),
    };
    loopState.methods.push(indexAccess);
    loopState.receiverEnd = closeBracket.span.end;
  },
};

Parser.prototype.parsePostfixExprBase = function (
  this: Parser
): PostfixExprNode {
  const start = current(this.state).span.start;
  const primary: PrimaryNode = this.parsePrimary();

  const methods: (
    | MethodCallNode
    | InvokeNode
    | AnnotationAccessNode
    | IndexAccessNode
  )[] = [];

  // Track the end of the receiver for method calls
  let receiverEnd = primary.span.end;

  // Check if primary is a conditional that should stop postfix parsing.
  // Two cases:
  // 1. Block then-branch: `(cond) ? { ... }` - closing `}` is a statement boundary
  // 2. PipeChain with terminator: `(cond) ? break` - terminator prevents invocation
  const shouldStopPostfix =
    primary.type === 'Conditional' &&
    (primary.thenBranch?.type === 'Block' ||
      (primary.thenBranch?.type === 'PipeChain' &&
        primary.thenBranch.terminator !== null));

  // A closure literal primary never gets the newline-skip below: `|x| { ... }`
  // followed by a newline then `.method` must remain two statements, not a
  // continuation of the closure body into a method chain. Same-line
  // invocation (`|x| { ... }()`) is unaffected since it never hits a newline.
  const isClosurePrimary = primary.type === 'Closure';

  // Mutable state object shared with dispatch handlers.
  const loopState: PostfixLoopState = { primary, methods, receiverEnd };

  // Only skip newlines when the next real token is a dot: this lets a method
  // chain continue on the next line (`expr\n.method`) without letting a
  // newline before `(` be consumed, which would misparse a new statement as
  // an invocation of the previous line's expression.
  if (!shouldStopPostfix && !isClosurePrimary) {
    skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.DOT);
    skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.COLON);
  }

  while (
    !shouldStopPostfix &&
    (isAnnotationAccess(this.state) ||
      isMethodCall(this.state) ||
      check(this.state, TOKEN_TYPES.LPAREN) ||
      check(this.state, TOKEN_TYPES.DOT_BANG) ||
      check(this.state, TOKEN_TYPES.LBRACKET) ||
      check(this.state, TOKEN_TYPES.COLON) ||
      check(this.state, TOKEN_TYPES.DOT_QUESTION))
  ) {
    if (check(this.state, TOKEN_TYPES.DOT_QUESTION)) {
      // .?field (optionally & typeRef), mirroring parseAccessChain's
      // DOT_QUESTION handling. A field/key element may be absent: bare
      // `.?` at end of statement (nothing but a newline or EOF follows) is
      // the valid existence/bool probe on the receiver itself and still
      // ends the postfix chain without wrapping. Anything else following
      // `.?` that isn't a recognized field-access element (not an
      // identifier, `$var`, `^annotation`, `(...)`, or `{...}`) is a parse
      // error naming the missing field name, rather than silently ending
      // the statement.
      const dotToken = advance(this.state);
      const finalAccess = this.parseFieldAccessElement(
        true,
        dotToken.span.start
      );
      if (!finalAccess) {
        if (!check(this.state, TOKEN_TYPES.NEWLINE) && !isAtEnd(this.state)) {
          throw new ParseError(
            ERROR_IDS.RILL_P006,
            "Expected field name after '.?'",
            dotToken.span.start
          );
        }
        break;
      }
      let typeRef: ExistenceCheck['typeRef'] = null;
      if (check(this.state, TOKEN_TYPES.AMPERSAND)) {
        advance(this.state);
        typeRef = parseTypeRef(this.state);
      }
      // Wrap accumulated primary+methods plus the existence check as a
      // grouped sub-expression and make it the new primary; resets methods.
      // Mirrors parsePostfixDotBang's and parsePostfixColon's probe-reset
      // pattern so a trailing `.method` chain continues on the boolean
      // probe result (`$x.?field.upper`) instead of ending the chain here.
      const probeSpan = makeSpan(start, previous(this.state).span.end);
      const probeExpr: PostfixExprNode = {
        type: 'PostfixExpr',
        primary: loopState.primary,
        methods: [...loopState.methods],
        defaultValue: null,
        existenceCheck: { finalAccess, typeRef },
        span: probeSpan,
      };
      const probeChain: PipeChainNode = {
        type: 'PipeChain',
        head: probeExpr,
        pipes: [],
        terminator: null,
        span: probeSpan,
      };
      loopState.primary = {
        type: 'GroupedExpr',
        expression: probeChain,
        span: probeSpan,
      };
      loopState.methods.length = 0;
      loopState.receiverEnd = probeSpan.end;
      if (!isClosurePrimary) {
        skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.DOT);
        skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.COLON);
      }
      continue;
    }
    if (isAnnotationAccess(this.state)) {
      const dotStart = current(this.state).span.start;
      advance(this.state); // consume .
      advance(this.state); // consume ^
      // A trailing `^` at end of line continues onto the annotation key on
      // the next line.
      skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.IDENTIFIER);
      const nameToken = expect(
        this.state,
        TOKEN_TYPES.IDENTIFIER,
        'Expected annotation key after .^'
      );
      const annotationAccess: AnnotationAccessNode = {
        type: 'AnnotationAccess',
        key: nameToken.value,
        span: makeSpan(dotStart, nameToken.span.end),
      };
      loopState.methods.push(annotationAccess);
      loopState.receiverEnd = nameToken.span.end;
    } else if (isMethodCall(this.state)) {
      // Capture receiver span: from start to current receiver end
      const receiverSpan = makeSpan(start, loopState.receiverEnd);
      const method = this.parseMethodCall(receiverSpan);
      loopState.methods.push(method);
      // Update receiver end: position before the next dot (= current token start)
      // After parsing .trim, current token is the dot before .upper
      // We want receiverEnd to be just before that dot (= after 'trim')
      loopState.receiverEnd = current(this.state).span.start;
    } else {
      const tokenType = current(this.state).type;
      const tableHandler = postfixDispatchTable[tokenType];
      if (tableHandler !== undefined) {
        tableHandler.call(this, loopState, start);
      } else {
        throw new Error(
          `Internal parser error: missing postfix handler for token type '${tokenType}'`
        );
      }
    }
    if (!isClosurePrimary) {
      skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.DOT);
      skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.COLON);
    }
  }

  // An existence check (.?field) is now wrapped as a GroupedExpr primary
  // (see the DOT_QUESTION branch above), so loopState.primary/methods
  // already reflect its span; no separate terminal existenceCheck case is
  // needed here.
  const endLocation = (
    loopState.methods.length > 0
      ? loopState.methods[loopState.methods.length - 1]!
      : loopState.primary
  ).span.end;

  return {
    type: 'PostfixExpr',
    primary: loopState.primary,
    methods: loopState.methods,
    defaultValue: null,
    existenceCheck: null,
    span: makeSpan(start, endLocation),
  };
};

Parser.prototype.parseInvoke = function (this: Parser): InvokeNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.LPAREN, 'Expected (');
  skipNewlines(this.state);

  const args: (ExpressionNode | SpreadArgNode)[] = [];
  let hasSpread = false;
  if (!check(this.state, TOKEN_TYPES.RPAREN)) {
    args.push(parseSpreadOrArg(this, { allowSpread: true, hasSpread }));
    if (args[args.length - 1]!.type === 'SpreadArg') hasSpread = true;
    while (check(this.state, TOKEN_TYPES.COMMA)) {
      advance(this.state);
      skipNewlines(this.state);
      args.push(parseSpreadOrArg(this, { allowSpread: true, hasSpread }));
      if (args[args.length - 1]!.type === 'SpreadArg') hasSpread = true;
    }
  }
  skipNewlines(this.state);

  const rparen = expect(
    this.state,
    TOKEN_TYPES.RPAREN,
    'Expected )',
    ERROR_IDS.RILL_P005
  );

  return {
    type: 'Invoke',
    args,
    span: makeSpan(start, rparen.span.end),
  };
};

// ============================================================
// CLOSURE SIG LITERAL HELPERS
// ============================================================

/**
 * Lookahead: PIPE_BAR ... PIPE_BAR COLON → closure sig literal.
 * A closure literal has `| param |` followed by a body (`{` or expression).
 * A closure sig literal has `| name: typeExpr, ... | :returnType`.
 * The distinguishing pattern is PIPE_BAR at pos+0, IDENTIFIER at pos+1, COLON at pos+2,
 * AND the matching closing PIPE_BAR is followed by COLON (:).
 * This avoids misidentifying typed closures |x: T| { body } as sig literals
 * because those have `{` after the closing `|`, not `:`.
 *
 * This lookahead only decides which parse path to take; it does not
 * guarantee the sig-literal path can fully parse the input. A union type
 * in the param position (e.g. `|x: string | number|: bool`) is correctly
 * routed to `parseClosureSigLiteral` by this scan, but that function's
 * param-type parser (`this.parseExpression()`) has no union-type support
 * and will still throw. Fixing that is a separate, unrelated change.
 */
function isClosureSigLiteralStart(state: {
  tokens: { type: string; value: string }[];
  pos: number;
}): boolean {
  const t0 = state.tokens[state.pos];
  const t1 = state.tokens[state.pos + 1];
  const t2 = state.tokens[state.pos + 2];
  if (!t0 || !t1) return false;
  // `||:ret` — empty param list closure sig literal.
  if (t0.type === TOKEN_TYPES.OR && t1.type === TOKEN_TYPES.COLON) {
    return true;
  }
  if (!t2) return false;
  const isAnnotatedFirstParam =
    t0.type === TOKEN_TYPES.PIPE_BAR && t1.type === TOKEN_TYPES.CARET;
  if (
    !isAnnotatedFirstParam &&
    (t0.type !== TOKEN_TYPES.PIPE_BAR ||
      t1.type !== TOKEN_TYPES.IDENTIFIER ||
      t2.type !== TOKEN_TYPES.COLON)
  ) {
    return false;
  }
  // Scan forward until we find a PIPE_BAR immediately followed by COLON.
  // A PIPE_BAR not followed by COLON is only a union type separator (e.g.
  // `|x: string | number|: bool`) when the token after it starts a type
  // (a valid type name or `$variable`); otherwise it's the closing `|` of
  // an ordinary closure param list (e.g. `|x: number| { body }`) and the
  // scan must stop there rather than searching unboundedly into later
  // statements for an unrelated `|...|:` pair.
  let i = state.pos + 1;
  while (i < state.tokens.length) {
    const tok = state.tokens[i]!;
    if (tok.type === TOKEN_TYPES.PIPE_BAR) {
      const afterClose = state.tokens[i + 1];
      if (afterClose?.type === TOKEN_TYPES.COLON) return true;
      const afterCloseIsDollar = afterClose?.type === TOKEN_TYPES.DOLLAR;
      const afterCloseIsTypeName =
        afterClose?.type === TOKEN_TYPES.IDENTIFIER &&
        (VALID_TYPE_NAMES as readonly string[]).includes(afterClose.value);
      if (!afterCloseIsDollar && !afterCloseIsTypeName) return false;
    }
    i += 1;
  }
  return false;
}

// ============================================================
// PRIMARY PARSING
// ============================================================

Parser.prototype.parsePrimary = function (this: Parser): PrimaryNode {
  return withRecursionDepth(
    this.state,
    () => current(this.state).span.start,
    () => parsePrimaryImpl.call(this)
  );
};

function parsePrimaryImpl(this: Parser): PrimaryNode {
  // Legacy bare ^ (CARET) loop annotation: ^(limit: N) { body } → RILL-R081
  if (
    check(this.state, TOKEN_TYPES.CARET) &&
    peek(this.state, 1).type === TOKEN_TYPES.LPAREN &&
    peek(this.state, 2).type === TOKEN_TYPES.IDENTIFIER &&
    peek(this.state, 2).value === 'limit'
  ) {
    throw new ParseError(
      ERROR_IDS.RILL_R081,
      'Migration error: use `do<limit: N> { body }`',
      current(this.state).span.start
    );
  }

  // Expression-position annotation: ^(...) expression
  if (
    check(this.state, TOKEN_TYPES.CARET) &&
    peek(this.state, 1).type === TOKEN_TYPES.LPAREN
  ) {
    const start = current(this.state).span.start;
    advance(this.state); // consume ^
    advance(this.state); // consume (
    const annotations = this.parseAnnotationArgs();
    expect(this.state, TOKEN_TYPES.RPAREN, 'Expected )', ERROR_IDS.RILL_P005);
    const expression = this.parsePrimary();
    return {
      type: 'AnnotatedExpr',
      annotations,
      expression,
      span: makeSpan(start, previous(this.state).span.end),
    } satisfies AnnotatedExprNode;
  }

  // Pass block: pass< options > { body }
  if (check(this.state, TOKEN_TYPES.PASS_LANGLE)) {
    return this.parsePassBlock();
  }

  // Timeout block: timeout< options > { body }
  if (check(this.state, TOKEN_TYPES.TIMEOUT_LANGLE)) {
    return this.parseTimeoutBlock();
  }

  // Pass keyword: pass
  if (check(this.state, TOKEN_TYPES.PASS)) {
    const token = advance(this.state);

    // Bracketless body form: pass { body }
    if (check(this.state, TOKEN_TYPES.LBRACE)) {
      const emptyOptions: DictNode = {
        type: 'Dict',
        entries: [],
        defaultValue: null,
        span: makeSpan(token.span.end, token.span.end),
      };
      const body = this.parseBlock(true);
      return {
        type: 'PassBlock',
        options: emptyOptions,
        body,
        span: makeSpan(token.span.start, body.span.end),
      } satisfies PassBlockNode;
    }

    return {
      type: 'Pass',
      span: token.span,
    };
  }

  // Unary minus for negative numbers: -42
  if (isNegativeNumber(this.state)) {
    const start = current(this.state).span.start;
    advance(this.state);
    const numToken = advance(this.state);
    return {
      type: 'NumberLiteral' as const,
      value: -parseFloat(numToken.value),
      span: makeSpan(start, numToken.span.end),
    };
  }

  // Closure sig literal: |param: T, ...|: R
  // Lookahead: PIPE_BAR IDENTIFIER COLON -> sig literal (not a closure body)
  if (isClosureSigLiteralStart(this.state)) {
    return this.parseClosureSigLiteral();
  }

  // Closure: |params| body or || body
  if (isClosureStart(this.state)) {
    return this.parseClosure();
  }

  // Whitespace adjacency error: collection keyword followed by bracket with whitespace (RILL-P007)
  // e.g. `list [` or `ordered [` — the lexer only emits compound tokens (LIST_LBRACKET etc.)
  // when there is NO whitespace. If whitespace separates them, we get IDENTIFIER + LBRACKET/LT.
  const COMPOUND_KEYWORDS_WITH_BRACKET = ['list', 'dict', 'tuple', 'ordered'];
  const COMPOUND_KEYWORDS_WITH_ANGLE = ['destruct', 'slice', 'use'];
  if (check(this.state, TOKEN_TYPES.IDENTIFIER)) {
    const identValue = current(this.state).value;
    const nextTokType = peek(this.state, 1).type;
    if (
      COMPOUND_KEYWORDS_WITH_BRACKET.includes(identValue) &&
      nextTokType === TOKEN_TYPES.LBRACKET
    ) {
      throw new ParseError(
        ERROR_IDS.RILL_P007,
        "keyword and bracket must be adjacent; found whitespace before '['",
        current(this.state).span.start
      );
    }
    if (
      COMPOUND_KEYWORDS_WITH_ANGLE.includes(identValue) &&
      nextTokType === TOKEN_TYPES.LT
    ) {
      throw new ParseError(
        ERROR_IDS.RILL_P007,
        "keyword and bracket must be adjacent; found whitespace before '<'",
        current(this.state).span.start
      );
    }
  }

  // Removed sigil forms: *[, *<, /<, @$fn (RILL-P009)
  // Note: @[ is handled by AT in parseCommonConstruct as a loop — covered separately below.
  if (check(this.state, TOKEN_TYPES.STAR)) {
    const nextTokType = peek(this.state, 1).type;
    if (nextTokType === TOKEN_TYPES.LBRACKET) {
      throw new ParseError(
        ERROR_IDS.RILL_P009,
        'Sigil syntax *[ was removed; use tuple[...] or ordered[...]',
        current(this.state).span.start
      );
    }
    if (nextTokType === TOKEN_TYPES.LT) {
      throw new ParseError(
        ERROR_IDS.RILL_P009,
        'Sigil syntax *< was removed; use destruct<...>',
        current(this.state).span.start
      );
    }
  }
  if (check(this.state, TOKEN_TYPES.SLASH)) {
    const nextTokType = peek(this.state, 1).type;
    if (nextTokType === TOKEN_TYPES.LT) {
      throw new ParseError(
        ERROR_IDS.RILL_P009,
        'Sigil syntax /< was removed; use slice<...>',
        current(this.state).span.start
      );
    }
  }

  // Compound-token guard: GUARD_LBRACE → guard{ body } (no angle bracket).
  if (check(this.state, TOKEN_TYPES.GUARD_LBRACE)) {
    return this.parseGuardBlock();
  }

  // Compound-token retry: RETRY_LANGLE → retry<limit: N> { body }.
  if (check(this.state, TOKEN_TYPES.RETRY_LANGLE)) {
    return this.parseRetryBlock();
  }

  // Atom literal: #NAME (always expression-position primary)
  if (check(this.state, TOKEN_TYPES.ATOM)) {
    return this.parseAtomLiteral();
  }

  const tokenType = current(this.state).type;
  const tableHandler = primaryDispatchTable[tokenType];
  if (tableHandler !== undefined) {
    return tableHandler.call(this);
  }

  // Residual fallthrough

  // Literal
  if (isLiteralStart(this.state)) {
    return this.parseLiteral();
  }

  // Closure call: $fn(args)
  if (isClosureCall(this.state)) {
    return this.parseClosureCall();
  }

  // Variable
  if (check(this.state, TOKEN_TYPES.DOLLAR, TOKEN_TYPES.PIPE_VAR)) {
    return this.parseVariable();
  }

  // Bare method call: .method
  if (isMethodCall(this.state)) {
    return this.parseMethodCall(null);
  }

  // Type constructor: list(...), dict(...), tuple(...), ordered(...), stream(...)
  if (
    check(this.state, TOKEN_TYPES.IDENTIFIER) &&
    isTypeConstructorName(current(this.state).value) &&
    this.state.tokens[this.state.pos + 1]?.type === TOKEN_TYPES.LPAREN
  ) {
    const name = current(this.state).value;
    return this.parseTypeConstructor(name);
  }

  // Type name expression: bare type name in expression position (e.g. `number`, `string`)
  // Invalid type names fall through to the host call path.
  if (
    check(this.state, TOKEN_TYPES.IDENTIFIER) &&
    VALID_TYPE_NAMES.includes(current(this.state).value as RillTypeName) &&
    this.state.tokens[this.state.pos + 1]?.type !== TOKEN_TYPES.LPAREN
  ) {
    const token = advance(this.state);
    return {
      type: 'TypeNameExpr',
      typeName: token.value as RillTypeName,
      span: token.span,
    } satisfies TypeNameExprNode;
  }

  // Function call with parens
  if (isHostCall(this.state)) {
    return this.parseHostCall();
  }

  // Bare function name: "greet" or "ns::func" (no parens)
  if (check(this.state, TOKEN_TYPES.IDENTIFIER)) {
    return parseBareHostCall(this.state);
  }

  // Use expression: use<identifier>
  if (check(this.state, TOKEN_TYPES.USE_LANGLE)) {
    return this.parseUseExpr();
  }

  // Common constructs
  const common = this.parseCommonConstruct();
  if (common) return common;

  // Yield keyword in expression position (not valid as identifier)
  if (check(this.state, TOKEN_TYPES.YIELD)) {
    throw new ParseError(
      ERROR_IDS.RILL_P001,
      "Unexpected keyword 'yield'",
      current(this.state).span.start
    );
  }

  // Detect heredoc syntax (removed feature)
  const token = current(this.state);
  if (
    token.type === TOKEN_TYPES.LT &&
    peek(this.state, 1).type === TOKEN_TYPES.LT
  ) {
    throw new ParseError(
      ERROR_IDS.RILL_P001,
      `Unexpected token: ${describeToken(token)}. Hint: Heredoc syntax (<<EOF) was removed, use triple-quote strings (""") instead`,
      token.span.start
    );
  }

  throw new ParseError(
    ERROR_IDS.RILL_P001,
    `Unexpected token: ${describeToken(token)}`,
    token.span.start
  );
}

// ============================================================
// PRIMARY DISPATCH TABLE
// ============================================================

const primaryDispatchTable: Record<string, (this: Parser) => PrimaryNode> = {
  [TOKEN_TYPES.LIST_LBRACKET]: function (this: Parser): PrimaryNode {
    advance(this.state); // consume LIST_LBRACKET
    return this.parseCollectionLiteral('list');
  },
  [TOKEN_TYPES.TUPLE_LBRACKET]: function (this: Parser): PrimaryNode {
    advance(this.state); // consume TUPLE_LBRACKET
    return this.parseCollectionLiteral('tuple');
  },
  [TOKEN_TYPES.ORDERED_LBRACKET]: function (this: Parser): PrimaryNode {
    advance(this.state); // consume ORDERED_LBRACKET
    return this.parseCollectionLiteral('ordered');
  },
  [TOKEN_TYPES.DICT_LBRACKET]: function (this: Parser): PrimaryNode {
    const start = current(this.state).span.start;
    advance(this.state); // consume DICT_LBRACKET
    skipNewlines(this.state);
    if (check(this.state, TOKEN_TYPES.RBRACKET)) {
      const rbracket = advance(this.state); // consume ]
      return {
        type: 'Dict',
        entries: [],
        defaultValue: null,
        span: makeSpan(start, rbracket.span.end),
      };
    }
    return this.parseDict(start);
  },
  [TOKEN_TYPES.LBRACKET]: function (this: Parser): PrimaryNode {
    return this.parseTupleOrDict();
  },
  [TOKEN_TYPES.GUARD]: function (this: Parser): PrimaryNode {
    return this.parseGuardBlock();
  },
  [TOKEN_TYPES.RETRY]: function (this: Parser): PrimaryNode {
    return this.parseRetryBlock();
  },
};
