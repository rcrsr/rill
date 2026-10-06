/**
 * Parser Extension: Pipe Targets
 * Pipe-target parsing and the postfix dispatch helpers it shares
 */

import { Parser } from './parser.js';
import type {
  AnnotationAccessNode,
  DoWhileLoopNode,
  WhileLoopNode,
  HostCallNode,
  HostRefNode,
  IndexAccessNode,
  MethodCallNode,
  PassBlockNode,
  TimeoutBlockNode,
  DictNode,
  ExistenceCheck,
  PipeTargetNode,
  PostfixExprNode,
  RillTypeName,
  ListLiteralNode,
  SourceLocation,
  SourceSpan,
  TypeConstructorNode,
  TypeNameExprNode,
  VariableNode,
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
} from './state.js';
import {
  isHostCall,
  isClosureCallWithAccess,
  canStartPipeInvoke,
  isAnnotationAccess,
  isMethodCall,
  isClosureStart,
  parseBareHostCall,
  VALID_TYPE_NAMES,
  describeToken,
} from './helpers.js';
import { parseTypeRef } from './parser-types.js';
import { isTypeConstructorName } from './parser-shape.js';
import { ERROR_IDS } from '../error-registry.js';
import {
  postfixDispatchTable,
  type PostfixLoopState,
} from './parser-primary.js';

/**
 * Builds a phantom `$` pipe-variable primary node, used as the receiver when
 * wrapping a chain of methods (`-> .a.b`, `-> .a?`, `-> .a ?? default`) that
 * has no explicit primary of its own.
 */
function makePipeVarPrimary(span: SourceSpan): VariableNode {
  return {
    type: 'Variable',
    name: null,
    isPipeVar: true,
    accessChain: [],
    defaultValue: null,
    existenceCheck: null,
    span,
  };
}

// Declaration merging to add methods to Parser interface
declare module './parser.js' {
  interface Parser {
    parsePipeTarget(): PipeTargetNode;
    parsePipeTargetDot(): PipeTargetNode;
    parsePipeTargetBracket(): PipeTargetNode;
    parsePipeTargetDictLiteral(): PipeTargetNode;
  }
}

// ============================================================
// PIPE TARGET DISPATCH TABLE AND HANDLERS
// ============================================================

// Handler: -> .method(...) or -> .^annotation  (possibly chained)
Parser.prototype.parsePipeTargetDot = function (this: Parser): PipeTargetNode {
  const methods: (MethodCallNode | AnnotationAccessNode | IndexAccessNode)[] =
    [];
  const start = current(this.state).span.start;

  // Collect all chained method calls, annotation accesses, and bracket
  // indexes. A newline is only skipped when the next real token is a dot,
  // so the chain can continue on the next line (`-> .trim\n  .upper`)
  // without consuming newlines that belong to a following statement.
  skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.DOT);
  while (
    check(this.state, TOKEN_TYPES.DOT) ||
    check(this.state, TOKEN_TYPES.LBRACKET)
  ) {
    if (check(this.state, TOKEN_TYPES.LBRACKET)) {
      const openBracket = advance(this.state); // consume [
      const index = this.parsePipeChain();
      const closeBracket = expect(
        this.state,
        TOKEN_TYPES.RBRACKET,
        'Expected ] after index expression',
        ERROR_IDS.RILL_P005
      );
      methods.push({
        type: 'IndexAccess',
        index,
        span: makeSpan(openBracket.span.start, closeBracket.span.end),
      });
    } else if (isAnnotationAccess(this.state)) {
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
      methods.push({
        type: 'AnnotationAccess',
        key: nameToken.value,
        span: makeSpan(dotStart, nameToken.span.end),
      });
    } else {
      methods.push(this.parseMethodCall(null));
    }
    skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.DOT);
  }

  if (check(this.state, TOKEN_TYPES.QUESTION)) {
    const postfixExpr: PostfixExprNode = {
      type: 'PostfixExpr',
      primary: makePipeVarPrimary(methods[0]!.span),
      methods,
      defaultValue: null,
      span: makeSpan(start, previous(this.state).span.end),
    };
    return this.parseConditionalWithCondition(postfixExpr);
  }

  if (check(this.state, TOKEN_TYPES.NULLISH_COALESCE)) {
    advance(this.state);
    const defaultValue = this.parseDefaultValue();
    return {
      type: 'PostfixExpr',
      primary: makePipeVarPrimary(methods[0]!.span),
      methods,
      defaultValue,
      span: makeSpan(start, defaultValue.span.end),
    } as PostfixExprNode;
  }

  // Single method: return as-is. The first entry is always a MethodCallNode
  // or AnnotationAccessNode — dispatch into this function only happens on a
  // leading DOT token, so an IndexAccessNode (which can only follow a
  // preceding method/annotation) can never be the sole entry.
  if (methods.length === 1 && methods[0]!.type !== 'IndexAccess') {
    return methods[0]!;
  }

  // Multiple methods: wrap in PostfixExpr with $ as primary
  return {
    type: 'PostfixExpr',
    primary: makePipeVarPrimary(methods[0]!.span),
    methods,
    defaultValue: null,
    span: makeSpan(start, previous(this.state).span.end),
  } as PostfixExprNode;
};

// Handler: -> [...] — bare bracket literal (tuple or dict) with optional nullish coalesce
Parser.prototype.parsePipeTargetBracket = function (
  this: Parser
): PipeTargetNode {
  const literal = this.parseTupleOrDict();
  if (check(this.state, TOKEN_TYPES.NULLISH_COALESCE)) {
    advance(this.state);
    const defaultValue = this.parseDefaultValue();
    return { ...literal, defaultValue };
  }
  return literal;
};

// Handler: -> dict[...] — keyword-prefixed dict literal with optional nullish coalesce
Parser.prototype.parsePipeTargetDictLiteral = function (
  this: Parser
): PipeTargetNode {
  const start = current(this.state).span.start;
  advance(this.state); // consume dict[
  skipNewlines(this.state);

  // Handle empty dict: dict[]
  if (check(this.state, TOKEN_TYPES.RBRACKET)) {
    const rbracket = advance(this.state); // consume ]
    let defaultValue = null;
    if (check(this.state, TOKEN_TYPES.NULLISH_COALESCE)) {
      advance(this.state);
      defaultValue = this.parseDefaultValue();
    }
    return {
      type: 'Dict',
      entries: [],
      defaultValue,
      span: makeSpan(start, rbracket.span.end),
    };
  }

  const dict = this.parseDict(start);
  if (check(this.state, TOKEN_TYPES.NULLISH_COALESCE)) {
    advance(this.state);
    const defaultValue = this.parseDefaultValue();
    return { ...dict, defaultValue };
  }
  return dict;
};

// Dispatch table for parsePipeTarget. Single-token forms only.
// Inline guards handle multi-token conditions before this table is checked.
// Not exported — file-local.
const pipeTargetDispatchTable: Record<
  string,
  (this: Parser) => PipeTargetNode
> = {
  [TOKEN_TYPES.ASSERT]: function (this: Parser) {
    return this.parseAssert();
  },
  [TOKEN_TYPES.ERROR]: function (this: Parser) {
    return this.parseError();
  },
  [TOKEN_TYPES.COLON]: function (this: Parser) {
    return this.parseTypeOperation();
  },
  [TOKEN_TYPES.DESTRUCT_LANGLE]: function (this: Parser) {
    return this.parseDestructTarget();
  },
  [TOKEN_TYPES.SLICE_LANGLE]: function (this: Parser) {
    return this.parseSlice();
  },
  [TOKEN_TYPES.USE_LANGLE]: function (this: Parser) {
    return this.parseUseExpr();
  },
  [TOKEN_TYPES.PASS_LANGLE]: function (this: Parser) {
    return attachPipeTargetPostfixChain.call(this, this.parsePassBlock());
  },
  [TOKEN_TYPES.TIMEOUT_LANGLE]: function (this: Parser) {
    return attachPipeTargetPostfixChain.call(this, this.parseTimeoutBlock());
  },
  [TOKEN_TYPES.PASS]: function (this: Parser) {
    const token = advance(this.state);
    // Bracketless body form: -> pass { body }
    if (check(this.state, TOKEN_TYPES.LBRACE)) {
      const emptyOptions: DictNode = {
        type: 'Dict',
        entries: [],
        defaultValue: null,
        span: makeSpan(token.span.end, token.span.end),
      };
      const body = this.parseBlock(true);
      const passBlock: PassBlockNode = {
        type: 'PassBlock',
        options: emptyOptions,
        body,
        span: makeSpan(token.span.start, body.span.end),
      };
      return attachPipeTargetPostfixChain.call(this, passBlock);
    }
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      "'pass' as a pipe target requires a body block; use 'pass { body }' or 'pass<on_error: #IGNORE> { body }'",
      token.span.start
    );
  },
  [TOKEN_TYPES.DOT]: Parser.prototype.parsePipeTargetDot,
  // Bare presence probe on the piped value: `$value -> .?`. Mirrors the
  // postfix DOT_QUESTION handling in runPostfixDispatchLoop, but here the
  // receiver is the implicit pipe var rather than an accumulated primary.
  // A field/key may still follow (`-> .?field`); only the fieldless form is
  // handled inline since a following field turns this into a two-token
  // chain identical to parsePipeTargetDot's shape.
  [TOKEN_TYPES.DOT_QUESTION]: function (this: Parser): PipeTargetNode {
    const dotToken = advance(this.state);
    const finalAccess = this.parseFieldAccessElement(true, dotToken.span.start);
    if (!finalAccess) {
      if (!check(this.state, TOKEN_TYPES.NEWLINE) && !isAtEnd(this.state)) {
        throw new ParseError(
          ERROR_IDS.RILL_P006,
          "Expected field name after '.?'",
          dotToken.span.start
        );
      }
    }
    let typeRef: ExistenceCheck['typeRef'] = null;
    if (check(this.state, TOKEN_TYPES.AMPERSAND)) {
      advance(this.state);
      typeRef = parseTypeRef(this.state);
    }
    const span = makeSpan(dotToken.span.start, previous(this.state).span.end);
    return {
      type: 'PostfixExpr',
      primary: makePipeVarPrimary(span),
      methods: [],
      defaultValue: null,
      existenceCheck: { finalAccess, typeRef },
      span,
    } satisfies PostfixExprNode;
  },
  [TOKEN_TYPES.STRING]: function (this: Parser) {
    return this.parseString();
  },
  [TOKEN_TYPES.LBRACKET]: Parser.prototype.parsePipeTargetBracket,
  [TOKEN_TYPES.LIST_LBRACKET]: function (this: Parser): PipeTargetNode {
    const listStart = current(this.state).span.start;
    advance(this.state); // consume list[
    const listLiteral = this.parseCollectionLiteral('list') as ListLiteralNode;
    if (check(this.state, TOKEN_TYPES.NULLISH_COALESCE)) {
      advance(this.state);
      const defaultValue = this.parseDefaultValue();
      return {
        ...listLiteral,
        defaultValue,
        span: makeSpan(listStart, defaultValue.span.end),
      };
    }
    return listLiteral;
  },
  [TOKEN_TYPES.DICT_LBRACKET]: Parser.prototype.parsePipeTargetDictLiteral,
};

// ============================================================
// PIPE TARGET PARSING
// ============================================================

/**
 * Attaches a trailing `[i]` bracket index (or chain of them) to a pipe
 * target that has no `.method` chain of its own — a bare/namespaced host
 * call, a parameterized type constructor, or a bare type-keyword target.
 * `list[3,1,2] -> sort[0]` yields `1`. Only same-line brackets are
 * collected; a newline before `[` starts a new statement instead, matching
 * parsePipeTargetDot's dot-chain rule.
 */
function attachPipeTargetIndex(
  this: Parser,
  primary: HostCallNode | HostRefNode | TypeConstructorNode | TypeNameExprNode
): PipeTargetNode {
  if (!check(this.state, TOKEN_TYPES.LBRACKET)) {
    return primary;
  }
  const methods: IndexAccessNode[] = [];
  while (check(this.state, TOKEN_TYPES.LBRACKET)) {
    const openBracket = advance(this.state); // consume [
    const index = this.parsePipeChain();
    const closeBracket = expect(
      this.state,
      TOKEN_TYPES.RBRACKET,
      'Expected ] after index expression',
      ERROR_IDS.RILL_P005
    );
    methods.push({
      type: 'IndexAccess',
      index,
      span: makeSpan(openBracket.span.start, closeBracket.span.end),
    });
  }
  return {
    type: 'PostfixExpr',
    primary,
    methods,
    defaultValue: null,
    span: makeSpan(primary.span.start, methods[methods.length - 1]!.span.end),
  } satisfies PostfixExprNode;
}

// Runs the same postfix dispatch loop parsePostfixExprBase uses, but over a
// caller-supplied loopState instead of one seeded by parsePrimary(). Lets a
// value produced outside the primary/postfix pipeline (a pipe-target pass
// block, or a seeded loop result wrapped by wrapLoopInPostfixExpr) still
// pick up trailing `.method`, `[index]`, `(...)`, `:type`, `.^key`, and
// `.!` the same way a primary-position expression does. Reuses
// postfixDispatchTable directly rather than re-deriving dispatch rules.
export function runPostfixDispatchLoop(
  this: Parser,
  loopState: PostfixLoopState,
  start: SourceLocation
): void {
  skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.DOT);
  skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.COLON);

  while (
    isAnnotationAccess(this.state) ||
    isMethodCall(this.state) ||
    check(this.state, TOKEN_TYPES.LPAREN) ||
    check(this.state, TOKEN_TYPES.DOT_BANG) ||
    check(this.state, TOKEN_TYPES.LBRACKET) ||
    check(this.state, TOKEN_TYPES.COLON)
  ) {
    if (isAnnotationAccess(this.state)) {
      const dotStart = current(this.state).span.start;
      advance(this.state); // consume .
      advance(this.state); // consume ^
      skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.IDENTIFIER);
      const nameToken = expect(
        this.state,
        TOKEN_TYPES.IDENTIFIER,
        'Expected annotation key after .^'
      );
      loopState.methods.push({
        type: 'AnnotationAccess',
        key: nameToken.value,
        span: makeSpan(dotStart, nameToken.span.end),
      });
      loopState.receiverEnd = nameToken.span.end;
    } else if (isMethodCall(this.state)) {
      const receiverSpan = makeSpan(start, loopState.receiverEnd);
      const method = this.parseMethodCall(receiverSpan);
      loopState.methods.push(method);
      loopState.receiverEnd = current(this.state).span.start;
    } else {
      const tokenType = current(this.state).type;
      const tableHandler = postfixDispatchTable[tokenType];
      if (tableHandler === undefined) {
        throw new Error(
          `Internal parser error: missing postfix handler for token type '${tokenType}'`
        );
      }
      tableHandler.call(this, loopState, start);
    }
    skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.DOT);
    skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.COLON);
  }
}

// Feeds an already-parsed pipe-target primary (pass block, timeout block,
// while/do loop) through runPostfixDispatchLoop so `-> pass { } .upper` and
// `-> do { } while (cond) [0]` chain the same way a primary-position
// expression does.
function attachPipeTargetPostfixChain(
  this: Parser,
  primary: PassBlockNode | TimeoutBlockNode | WhileLoopNode | DoWhileLoopNode
): PipeTargetNode {
  const start = primary.span.start;
  const loopState: PostfixLoopState = {
    primary,
    methods: [],
    receiverEnd: primary.span.end,
  };

  runPostfixDispatchLoop.call(this, loopState, start);

  if (loopState.methods.length === 0) {
    return primary;
  }

  return {
    type: 'PostfixExpr',
    primary: loopState.primary,
    methods: loopState.methods,
    defaultValue: null,
    span: makeSpan(start, loopState.receiverEnd),
  } satisfies PostfixExprNode;
}

Parser.prototype.parsePipeTarget = function (this: Parser): PipeTargetNode {
  // Legacy convert operator: -> :>type (retired; emit migration error RILL-R078)
  // Must precede the COLON entry in pipeTargetDispatchTable.
  if (
    check(this.state, TOKEN_TYPES.COLON) &&
    peek(this.state, 1).type === TOKEN_TYPES.GT
  ) {
    throw new ParseError(
      ERROR_IDS.RILL_R078,
      "Legacy ':>' conversion syntax removed; use '-> type' instead",
      current(this.state).span.start
    );
  }

  // Inline closure: -> |x| { body }
  if (isClosureStart(this.state)) {
    return this.parseClosure();
  }

  // Closure call as pipe target (supports property access: $math.double())
  if (isClosureCallWithAccess(this.state)) {
    return this.parseClosureCall();
  }

  // Pipe invoke: -> $() or -> $(args)
  if (canStartPipeInvoke(this.state)) {
    return this.parsePipeInvoke();
  }

  // Bare variable as pipe target: -> $var or -> $ or -> $.field
  if (
    check(this.state, TOKEN_TYPES.DOLLAR) ||
    check(this.state, TOKEN_TYPES.PIPE_VAR)
  ) {
    const varNode = this.parseVariable();
    return { ...varNode, isPipeTarget: true };
  }

  // Table dispatch: single-token forms (ASSERT/ERROR precede isHostCall check)
  const tokenType = current(this.state).type;
  const tableHandler = pipeTargetDispatchTable[tokenType];
  if (tableHandler !== undefined) {
    return tableHandler.call(this);
  }

  // Residual fallthrough for IDENTIFIER-based forms

  // Parameterized type constructor as pipe target:
  //   -> list(...), -> dict(...), -> tuple(...), -> ordered(...), -> stream(...)
  // Mirrors the primary-expression dispatch in parsePrimary (see parseTypeConstructor).
  if (
    check(this.state, TOKEN_TYPES.IDENTIFIER) &&
    isTypeConstructorName(current(this.state).value) &&
    this.state.tokens[this.state.pos + 1]?.type === TOKEN_TYPES.LPAREN
  ) {
    const name = current(this.state).value;
    return attachPipeTargetIndex.call(this, this.parseTypeConstructor(name));
  }

  // Bare type keyword as pipe target: -> string, -> number, -> bool, ...
  // Produces TypeNameExprNode (mirrors parseBareHostCall's dispatch location
  // but routes type keywords through the TypeNameExpr node rather than HostCall).
  // Type keywords are reserved; no ambiguity with host/closure names.
  if (
    check(this.state, TOKEN_TYPES.IDENTIFIER) &&
    VALID_TYPE_NAMES.includes(current(this.state).value as RillTypeName) &&
    this.state.tokens[this.state.pos + 1]?.type !== TOKEN_TYPES.LPAREN
  ) {
    const token = advance(this.state);
    const typeNameExpr: TypeNameExprNode = {
      type: 'TypeNameExpr',
      typeName: token.value as RillTypeName,
      span: token.span,
    };
    return attachPipeTargetIndex.call(this, typeNameExpr);
  }

  // Function call with parens
  if (isHostCall(this.state)) {
    return attachPipeTargetIndex.call(this, this.parseHostCall());
  }

  // Bare function name: "-> greet" or "-> ns::func"
  if (check(this.state, TOKEN_TYPES.IDENTIFIER)) {
    return attachPipeTargetIndex.call(this, parseBareHostCall(this.state));
  }

  // Common constructs
  const common = this.parseCommonConstruct();
  if (common) {
    if (check(this.state, TOKEN_TYPES.COLON)) {
      const operand: PostfixExprNode = {
        type: 'PostfixExpr',
        primary: common,
        methods: [],
        defaultValue: null,
        existenceCheck: null,
        span: common.span,
      };
      return this.parsePostfixTypeOperation(operand);
    }
    // A while/do loop result is itself postfix-chainable:
    // `-> do { } while (cond) . upper`.
    if (common.type === 'WhileLoop' || common.type === 'DoWhileLoop') {
      return attachPipeTargetPostfixChain.call(this, common);
    }
    return common;
  }

  throw new ParseError(
    ERROR_IDS.RILL_P001,
    `Expected pipe target, got: ${describeToken(current(this.state))}`,
    current(this.state).span.start
  );
};
