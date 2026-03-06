/**
 * Parser Extension: Expression Parsing
 * Expressions, precedence chain, pipe chains, and pipe targets
 */

import { Parser } from './parser.js';
import type {
  AnnotatedExprNode,
  AnnotationAccessNode,
  ArithHead,
  BinaryOp,
  BlockNode,
  BodyNode,
  CaptureNode,
  ChainTerminator,
  ClosureSigLiteralNode,
  ConditionalNode,
  ConvertNode,
  DoWhileLoopNode,
  ExpressionNode,
  WhileLoopNode,
  GroupedExprNode,
  InvokeNode,
  MethodCallNode,
  PipeChainNode,
  PipeTargetNode,
  PostfixExprNode,
  PrimaryNode,
  RillTypeName,
  ListLiteralNode,
  SourceLocation,
  SourceSpan,
  SpreadArgNode,
  TypeConstructorNode,
  TypeNameExprNode,
  UnaryExprNode,
  VariableNode,
} from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import {
  check,
  advance,
  expect,
  current,
  makeSpan,
  peek,
  skipNewlines,
  skipNewlinesIfFollowedBy,
} from './state.js';
import {
  isHostCall,
  isClosureCall,
  isClosureCallWithAccess,
  canStartPipeInvoke,
  isAnnotationAccess,
  isMethodCall,
  isNegativeNumber,
  isLiteralStart,
  isClosureStart,
  makeBoolLiteralBlock,
  parseBareHostCall,
  VALID_TYPE_NAMES,
} from './helpers.js';
import { parseTypeRef } from './parser-types.js';

/** Constructs valid as both primary expressions and pipe targets */
type CommonConstruct =
  | ConditionalNode
  | WhileLoopNode
  | DoWhileLoopNode
  | BlockNode
  | GroupedExprNode;

// Declaration merging to add methods to Parser interface
declare module './parser.js' {
  interface Parser {
    parseExpression(): ExpressionNode;
    parsePipeChain(): PipeChainNode;
    parsePostfixExpr(): PostfixExprNode;
    parsePostfixExprBase(): PostfixExprNode;
    parsePrimary(): PrimaryNode;
    parsePipeTarget(): PipeTargetNode;
    parseCapture(): CaptureNode;
    parseGrouped(): GroupedExprNode;
    parseCommonConstruct(): CommonConstruct | null;
    parseLogicalOr(): ArithHead;
    parseLogicalAnd(): ArithHead;
    parseComparison(): ArithHead;
    parseAdditive(): ArithHead;
    parseMultiplicative(): ArithHead;
    parseUnary(): UnaryExprNode | PostfixExprNode;
    parseInvoke(): InvokeNode;
    implicitPipeVar(span: {
      start: SourceLocation;
      end: SourceLocation;
    }): PostfixExprNode;
    isComparisonOp(): boolean;
    tokenToComparisonOp(
      tokenType: string
    ): '==' | '!=' | '<' | '>' | '<=' | '>=';
    wrapConditionalInPostfixExpr(
      conditional: ConditionalNode,
      span: SourceSpan
    ): PostfixExprNode;
    wrapLoopInPostfixExpr(
      loop: WhileLoopNode | DoWhileLoopNode,
      span: SourceSpan
    ): PostfixExprNode;
    parseClosureSigLiteral(): ClosureSigLiteralNode;
    parseConvert(): ConvertNode;
  }
}

// ============================================================
// COMMON CONSTRUCT PARSER
// ============================================================

Parser.prototype.parseCommonConstruct = function (
  this: Parser
): CommonConstruct | null {
  // Boolean negation: !expr (for filter predicates like !.empty in pipes)
  if (check(this.state, TOKEN_TYPES.BANG)) {
    const start = current(this.state).span.start;
    advance(this.state); // consume !

    // Check for bare negation without operand (EOF, newline, or closing paren)
    if (
      check(
        this.state,
        TOKEN_TYPES.EOF,
        TOKEN_TYPES.NEWLINE,
        TOKEN_TYPES.RPAREN
      )
    ) {
      throw new ParseError(
        'RILL-P004',
        'Negation operator requires an operand. Use prefix syntax: !expr or (!expr)',
        start
      );
    }

    const operand = this.parsePostfixExprBase();
    const span = makeSpan(start, operand.span.end);

    const unaryExpr: UnaryExprNode = {
      type: 'UnaryExpr',
      op: '!',
      operand,
      span,
    };

    const negationCondition: GroupedExprNode = {
      type: 'GroupedExpr',
      expression: {
        type: 'PipeChain',
        head: unaryExpr,
        pipes: [],
        terminator: null,
        span,
      },
      span,
    };

    // Check for conditional: !expr ? then ! else
    if (check(this.state, TOKEN_TYPES.QUESTION)) {
      advance(this.state); // consume ?
      return this.parseConditionalRest(negationCondition, start);
    }

    // Standalone negation: evaluates to true/false
    return {
      type: 'Conditional',
      input: null,
      condition: negationCondition,
      thenBranch: makeBoolLiteralBlock(true, operand.span),
      elseBranch: makeBoolLiteralBlock(false, operand.span),
      span,
    };
  }

  // Piped conditional: bare `?` uses $ as condition
  if (check(this.state, TOKEN_TYPES.QUESTION)) {
    return this.parsePipedConditional();
  }

  // Loop: @ body [? cond]
  // Guard: @[ and @$fn are not valid expression forms (RILL-P010)
  // @ is only valid as a do-while terminator inside a loop body.
  if (check(this.state, TOKEN_TYPES.AT)) {
    const nextType = peek(this.state, 1).type;
    if (nextType === TOKEN_TYPES.LBRACKET || nextType === TOKEN_TYPES.DOLLAR) {
      throw new ParseError(
        'RILL-P010',
        `'@${nextType === TOKEN_TYPES.LBRACKET ? '[' : '$'}...' is not a valid expression; use chain(...) to chain collections`,
        current(this.state).span.start
      );
    }
    return this.parseLoop(null);
  }

  // Block (may be followed by @ for loop with input, or ? for conditional)
  if (check(this.state, TOKEN_TYPES.LBRACE)) {
    const block = this.parseBlock();
    if (check(this.state, TOKEN_TYPES.AT)) {
      return this.parseLoopWithInput(block);
    }
    if (check(this.state, TOKEN_TYPES.QUESTION)) {
      return this.parseConditionalWithCondition(block);
    }
    return block;
  }

  // Grouped expression: ( inner-expr )
  if (check(this.state, TOKEN_TYPES.LPAREN)) {
    const grouped = this.parseGrouped();
    if (check(this.state, TOKEN_TYPES.AT)) {
      return this.parseLoopWithInput(grouped);
    }
    if (check(this.state, TOKEN_TYPES.QUESTION)) {
      return this.parseConditionalWithCondition(grouped);
    }
    return grouped;
  }

  return null;
};

// ============================================================
// EXPRESSION PARSING
// ============================================================

Parser.prototype.parseExpression = function (this: Parser): ExpressionNode {
  return this.parsePipeChain();
};

Parser.prototype.implicitPipeVar = function (
  this: Parser,
  span: { start: SourceLocation; end: SourceLocation }
): PostfixExprNode {
  const varNode: VariableNode = {
    type: 'Variable',
    name: null,
    isPipeVar: true,
    accessChain: [],
    defaultValue: null,
    existenceCheck: null,
    span,
  };
  return {
    type: 'PostfixExpr',
    primary: varNode,
    methods: [],
    defaultValue: null,
    span,
  };
};

Parser.prototype.parsePipeChain = function (this: Parser): PipeChainNode {
  const start = current(this.state).span.start;

  // Handle bare break: "break" ≡ "$ -> break"
  if (check(this.state, TOKEN_TYPES.BREAK)) {
    const token = advance(this.state);
    return {
      type: 'PipeChain',
      head: this.implicitPipeVar(token.span),
      pipes: [],
      terminator: { type: 'Break', span: token.span },
      span: token.span,
    };
  }

  // Handle bare return: "return" ≡ "$ -> return"
  if (check(this.state, TOKEN_TYPES.RETURN)) {
    const token = advance(this.state);
    return {
      type: 'PipeChain',
      head: this.implicitPipeVar(token.span),
      pipes: [],
      terminator: { type: 'Return', span: token.span },
      span: token.span,
    };
  }

  // Parse expression head with full precedence chain
  let head = this.parseLogicalOr();

  // Check for loop: expr @ body
  if (check(this.state, TOKEN_TYPES.AT)) {
    const headAsPipeChain: PipeChainNode = {
      type: 'PipeChain',
      head,
      pipes: [],
      terminator: null,
      span: head.span,
    };
    const loop = this.parseLoopWithInput(headAsPipeChain);
    const span = makeSpan(head.span.start, current(this.state).span.end);
    head = this.wrapLoopInPostfixExpr(loop, span);
  }

  // Check for conditional: expr ? then ! else
  // Site 1: Add newline lookahead before ? check
  if (skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.QUESTION)) {
    const headAsPipeChain: PipeChainNode = {
      type: 'PipeChain',
      head,
      pipes: [],
      terminator: null,
      span: head.span,
    };
    const conditional = this.parseConditionalWithCondition(headAsPipeChain);
    const span = makeSpan(head.span.start, current(this.state).span.end);
    head = this.wrapConditionalInPostfixExpr(conditional, span);
  }

  const pipes: (PipeTargetNode | CaptureNode)[] = [];
  let terminator: ChainTerminator | null = null;

  // Helper: check for -> or => possibly after newlines (line continuation)
  const checkChainContinuation = (): boolean => {
    if (
      check(this.state, TOKEN_TYPES.ARROW) ||
      check(this.state, TOKEN_TYPES.CAPTURE_ARROW)
    ) {
      return true;
    }
    // Check for line continuation: newlines followed by -> or =>
    if (check(this.state, TOKEN_TYPES.NEWLINE)) {
      let lookahead = 1;
      while (peek(this.state, lookahead).type === TOKEN_TYPES.NEWLINE) {
        lookahead++;
      }
      const nextToken = peek(this.state, lookahead);

      if (
        nextToken.type === TOKEN_TYPES.ARROW ||
        nextToken.type === TOKEN_TYPES.CAPTURE_ARROW
      ) {
        // Skip newlines to reach the arrow
        while (check(this.state, TOKEN_TYPES.NEWLINE)) advance(this.state);
        return true;
      }
    }
    return false;
  };

  while (checkChainContinuation()) {
    const isCapture = check(this.state, TOKEN_TYPES.CAPTURE_ARROW);
    advance(this.state);

    if (isCapture) {
      // => always followed by $name, always inline (continues chain)
      pipes.push(this.parseCapture());
      continue;
    }

    // -> handling (existing logic)

    // Check for break terminator: -> break
    if (check(this.state, TOKEN_TYPES.BREAK)) {
      const token = advance(this.state);
      terminator = { type: 'Break', span: token.span };
      break;
    }

    // Check for return terminator: -> return
    if (check(this.state, TOKEN_TYPES.RETURN)) {
      const token = advance(this.state);
      terminator = { type: 'Return', span: token.span };
      break;
    }

    // -> always pipes/invokes, never captures
    // Use => for captures: "hello" => $var
    // parsePipeTarget handles all cases including bare $var (closure invoke)
    pipes.push(this.parsePipeTarget());
  }

  // Check for conditional after pipe chain
  // Site 2: Add newline lookahead before ? check
  if (
    skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.QUESTION) &&
    pipes.length > 0
  ) {
    const span = makeSpan(start, current(this.state).span.end);
    const chainAsCondition: PipeChainNode = {
      type: 'PipeChain',
      head,
      pipes,
      terminator: null,
      span,
    };
    const conditional = this.parseConditionalWithCondition(chainAsCondition);
    const resultSpan = makeSpan(start, current(this.state).span.end);
    return {
      type: 'PipeChain',
      head: this.wrapConditionalInPostfixExpr(conditional, resultSpan),
      pipes: [],
      terminator: null,
      span: resultSpan,
    };
  }

  return {
    type: 'PipeChain',
    head,
    pipes,
    terminator,
    span: makeSpan(start, current(this.state).span.end),
  };
};

Parser.prototype.parsePostfixExpr = function (this: Parser): PostfixExprNode {
  const postfixExpr = this.parsePostfixExprBase();

  // Site 3: Add newline lookahead before ? check
  if (skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.QUESTION)) {
    const conditional = this.parseConditionalWithCondition(postfixExpr);
    const span = makeSpan(postfixExpr.span.start, current(this.state).span.end);
    return this.wrapConditionalInPostfixExpr(conditional, span);
  }

  return postfixExpr;
};

Parser.prototype.parsePostfixExprBase = function (
  this: Parser
): PostfixExprNode {
  const start = current(this.state).span.start;
  let primary: PrimaryNode = this.parsePrimary();

  // Check for postfix type assertion: expr:type or expr:?type
  if (skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.COLON)) {
    primary = this.parsePostfixTypeOperation(primary, start);
  }

  const methods: (MethodCallNode | InvokeNode | AnnotationAccessNode)[] = [];

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

  while (
    !shouldStopPostfix &&
    (isAnnotationAccess(this.state) ||
      isMethodCall(this.state) ||
      check(this.state, TOKEN_TYPES.LPAREN))
  ) {
    if (isAnnotationAccess(this.state)) {
      const dotStart = current(this.state).span.start;
      advance(this.state); // consume .
      advance(this.state); // consume ^
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
      methods.push(annotationAccess);
      receiverEnd = nameToken.span.end;
    } else if (isMethodCall(this.state)) {
      // Capture receiver span: from start to current receiver end
      const receiverSpan = makeSpan(start, receiverEnd);
      const method = this.parseMethodCall(receiverSpan);
      methods.push(method);
      // Update receiver end: position before the next dot (= current token start)
      // After parsing .trim, current token is the dot before .upper
      // We want receiverEnd to be just before that dot (= after 'trim')
      receiverEnd = current(this.state).span.start;
    } else {
      const invoke = this.parseInvoke();
      methods.push(invoke);
      // Update receiver end for potential method after invoke
      receiverEnd = invoke.span.end;
    }
  }

  // Check for default value operator: ?? expr
  let defaultValue: BodyNode | null = null;
  if (check(this.state, TOKEN_TYPES.NULLISH_COALESCE)) {
    advance(this.state);
    defaultValue = this.parseDefaultValue();
  }

  return {
    type: 'PostfixExpr',
    primary,
    methods,
    defaultValue,
    span: makeSpan(start, current(this.state).span.end),
  };
};

Parser.prototype.parseInvoke = function (this: Parser): InvokeNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.LPAREN, 'Expected (');
  skipNewlines(this.state);

  const args: (ExpressionNode | SpreadArgNode)[] = [];
  let hasSpread = false;
  if (!check(this.state, TOKEN_TYPES.RPAREN)) {
    args.push(parseInvokeArg(this, hasSpread));
    if (args[args.length - 1]!.type === 'SpreadArg') hasSpread = true;
    while (check(this.state, TOKEN_TYPES.COMMA)) {
      advance(this.state);
      skipNewlines(this.state);
      args.push(parseInvokeArg(this, hasSpread));
      if (args[args.length - 1]!.type === 'SpreadArg') hasSpread = true;
    }
  }
  skipNewlines(this.state);

  const rparen = expect(
    this.state,
    TOKEN_TYPES.RPAREN,
    'Expected )',
    'RILL-P005'
  );

  return {
    type: 'Invoke',
    args,
    span: makeSpan(start, rparen.span.end),
  };
};

/**
 * Parse one argument inside parseInvoke, with spread support.
 * Bare `...` synthesizes VariableNode for `$`. Max one spread per list.
 */
function parseInvokeArg(
  parser: Parser,
  hasSpread: boolean
): ExpressionNode | SpreadArgNode {
  if (check(parser.state, TOKEN_TYPES.ELLIPSIS)) {
    if (hasSpread) {
      throw new ParseError(
        'RILL-P007',
        'Only one spread argument (...) is allowed per argument list',
        current(parser.state).span.start
      );
    }
    const start = current(parser.state).span.start;
    advance(parser.state); // consume ...

    // Bare `...` before `)` or `,` → synthesize VariableNode for `$`
    if (
      check(parser.state, TOKEN_TYPES.RPAREN) ||
      check(parser.state, TOKEN_TYPES.COMMA)
    ) {
      const spreadSpan = makeSpan(start, current(parser.state).span.start);
      const varNode: VariableNode = {
        type: 'Variable',
        name: null,
        isPipeVar: true,
        accessChain: [],
        defaultValue: null,
        existenceCheck: null,
        span: spreadSpan,
      };
      const postfixNode: PostfixExprNode = {
        type: 'PostfixExpr',
        primary: varNode,
        methods: [],
        defaultValue: null,
        span: spreadSpan,
      };
      const pipeChainNode: PipeChainNode = {
        type: 'PipeChain',
        head: postfixNode,
        pipes: [],
        terminator: null,
        span: spreadSpan,
      };
      return {
        type: 'SpreadArg',
        expression: pipeChainNode,
        span: spreadSpan,
      } satisfies SpreadArgNode;
    }

    const expression = parser.parsePipeChain();
    return {
      type: 'SpreadArg',
      expression,
      span: makeSpan(start, current(parser.state).span.end),
    } satisfies SpreadArgNode;
  }

  return parser.parsePipeChain();
}

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
 */
function isClosureSigLiteralStart(state: {
  tokens: { type: string }[];
  pos: number;
}): boolean {
  const t0 = state.tokens[state.pos];
  const t1 = state.tokens[state.pos + 1];
  const t2 = state.tokens[state.pos + 2];
  if (!t0 || !t1 || !t2) return false;
  if (
    t0.type !== TOKEN_TYPES.PIPE_BAR ||
    t1.type !== TOKEN_TYPES.IDENTIFIER ||
    t2.type !== TOKEN_TYPES.COLON
  ) {
    return false;
  }
  // Scan forward to find the matching closing PIPE_BAR, then check for COLON.
  // Track nested pipe bars (|| is OR, not PIPE_BAR so we only count PIPE_BAR).
  let depth = 1;
  let i = state.pos + 1;
  while (i < state.tokens.length) {
    const tok = state.tokens[i]!;
    if (tok.type === TOKEN_TYPES.PIPE_BAR) {
      depth -= 1;
      if (depth === 0) {
        const afterClose = state.tokens[i + 1];
        return afterClose?.type === TOKEN_TYPES.COLON;
      }
    }
    i += 1;
  }
  return false;
}

// ============================================================
// PRIMARY PARSING
// ============================================================

Parser.prototype.parsePrimary = function (this: Parser): PrimaryNode {
  // Expression-position annotation: ^(...) expression (IR-5)
  if (
    check(this.state, TOKEN_TYPES.CARET) &&
    peek(this.state, 1).type === TOKEN_TYPES.LPAREN
  ) {
    const start = current(this.state).span.start;
    advance(this.state); // consume ^
    advance(this.state); // consume (
    const annotations = this.parseAnnotationArgs();
    expect(this.state, TOKEN_TYPES.RPAREN, 'Expected )', 'RILL-P005');
    const expression = this.parsePrimary();
    return {
      type: 'AnnotatedExpr',
      annotations,
      expression,
      span: makeSpan(start, current(this.state).span.end),
    } satisfies AnnotatedExprNode;
  }

  // Pass keyword: pass
  if (check(this.state, TOKEN_TYPES.PASS)) {
    const token = advance(this.state);
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
  const COMPOUND_KEYWORDS_WITH_ANGLE = ['destruct', 'slice'];
  if (check(this.state, TOKEN_TYPES.IDENTIFIER)) {
    const identValue = current(this.state).value;
    const nextTokType = peek(this.state, 1).type;
    if (
      COMPOUND_KEYWORDS_WITH_BRACKET.includes(identValue) &&
      nextTokType === TOKEN_TYPES.LBRACKET
    ) {
      throw new ParseError(
        'RILL-P007',
        "keyword and bracket must be adjacent; found whitespace before '['",
        current(this.state).span.start
      );
    }
    if (
      COMPOUND_KEYWORDS_WITH_ANGLE.includes(identValue) &&
      nextTokType === TOKEN_TYPES.LT
    ) {
      throw new ParseError(
        'RILL-P007',
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
        'RILL-P009',
        'Sigil syntax *[ was removed; use tuple[...] or ordered[...]',
        current(this.state).span.start
      );
    }
    if (nextTokType === TOKEN_TYPES.LT) {
      throw new ParseError(
        'RILL-P009',
        'Sigil syntax *< was removed; use destruct<...>',
        current(this.state).span.start
      );
    }
  }
  if (check(this.state, TOKEN_TYPES.SLASH)) {
    const nextTokType = peek(this.state, 1).type;
    if (nextTokType === TOKEN_TYPES.LT) {
      throw new ParseError(
        'RILL-P009',
        'Sigil syntax /< was removed; use slice<...>',
        current(this.state).span.start
      );
    }
  }

  // Keyword-prefixed collection literals: list[...], tuple[...], ordered[...]
  // Note: dict[...] is handled below — it produces a DictNode (same as bare [key:val])
  if (
    check(
      this.state,
      TOKEN_TYPES.LIST_LBRACKET,
      TOKEN_TYPES.TUPLE_LBRACKET,
      TOKEN_TYPES.ORDERED_LBRACKET
    )
  ) {
    const token = advance(this.state);
    const collectionTypeMap: Record<string, 'list' | 'tuple' | 'ordered'> = {
      [TOKEN_TYPES.LIST_LBRACKET]: 'list',
      [TOKEN_TYPES.TUPLE_LBRACKET]: 'tuple',
      [TOKEN_TYPES.ORDERED_LBRACKET]: 'ordered',
    };
    const collectionType = collectionTypeMap[token.type]!;
    return this.parseCollectionLiteral(collectionType);
  }

  // dict[...] in expression context: same semantics as bare [key: val] (DictNode)
  if (check(this.state, TOKEN_TYPES.DICT_LBRACKET)) {
    const start = current(this.state).span.start;
    advance(this.state); // consume dict[
    skipNewlines(this.state);

    // Handle empty dict: dict[]
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
  }

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

  // Type constructor: list(...), dict(...), tuple(...), ordered(...)
  const TYPE_CONSTRUCTORS = ['list', 'dict', 'tuple', 'ordered'] as const;
  if (
    check(this.state, TOKEN_TYPES.IDENTIFIER) &&
    TYPE_CONSTRUCTORS.includes(
      current(this.state).value as (typeof TYPE_CONSTRUCTORS)[number]
    ) &&
    this.state.tokens[this.state.pos + 1]?.type === TOKEN_TYPES.LPAREN
  ) {
    const name = current(this.state).value;
    return this.parseTypeConstructor(name);
  }

  // Type name expression: bare type name in expression position (e.g. `number`, `string`)
  // Invalid type names fall through to the host call path (EC-6).
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

  if (check(this.state, TOKEN_TYPES.LBRACKET)) {
    return this.parseTupleOrDict();
  }

  // Common constructs
  const common = this.parseCommonConstruct();
  if (common) return common;

  // Detect heredoc syntax (removed feature)
  const token = current(this.state);
  if (
    token.type === TOKEN_TYPES.LT &&
    peek(this.state, 1).type === TOKEN_TYPES.LT
  ) {
    throw new ParseError(
      'RILL-P001',
      `Unexpected token: ${token.value}. Hint: Heredoc syntax (<<EOF) was removed, use triple-quote strings (""") instead`,
      token.span.start
    );
  }

  throw new ParseError(
    'RILL-P001',
    `Unexpected token: ${token.value}`,
    token.span.start
  );
};

// ============================================================
// PIPE TARGET PARSING
// ============================================================

Parser.prototype.parsePipeTarget = function (this: Parser): PipeTargetNode {
  // Assert: -> assert
  if (check(this.state, TOKEN_TYPES.ASSERT)) {
    return this.parseAssert();
  }

  // Error: -> error
  if (check(this.state, TOKEN_TYPES.ERROR)) {
    return this.parseError();
  }

  // Convert operator: -> :>type or -> :>$var or -> :>ordered(...)
  if (
    check(this.state, TOKEN_TYPES.COLON) &&
    peek(this.state, 1).type === TOKEN_TYPES.GT
  ) {
    return this.parseConvert();
  }

  // Type operations: -> :type or -> :?type
  if (check(this.state, TOKEN_TYPES.COLON)) {
    return this.parseTypeOperation();
  }

  // Extraction operators
  if (check(this.state, TOKEN_TYPES.DESTRUCT_LANGLE)) {
    return this.parseDestructTarget();
  }
  if (check(this.state, TOKEN_TYPES.SLICE_LANGLE)) {
    return this.parseSlice();
  }

  // Collection operators
  if (check(this.state, TOKEN_TYPES.EACH)) {
    return this.parseEachExpr();
  }
  if (check(this.state, TOKEN_TYPES.MAP)) {
    return this.parseMapExpr();
  }
  if (check(this.state, TOKEN_TYPES.FOLD)) {
    return this.parseFoldExpr();
  }
  if (check(this.state, TOKEN_TYPES.FILTER)) {
    return this.parseFilterExpr();
  }

  // Inline closure: -> |x| { body }
  if (isClosureStart(this.state)) {
    return this.parseClosure();
  }

  // Method call or annotation access (possibly chained: .a.b.c or .^type)
  if (check(this.state, TOKEN_TYPES.DOT)) {
    const methods: (MethodCallNode | AnnotationAccessNode)[] = [];
    const start = current(this.state).span.start;

    // Collect all chained method calls and annotation accesses
    while (check(this.state, TOKEN_TYPES.DOT)) {
      if (isAnnotationAccess(this.state)) {
        const dotStart = current(this.state).span.start;
        advance(this.state); // consume .
        advance(this.state); // consume ^
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
    }

    if (check(this.state, TOKEN_TYPES.QUESTION)) {
      const postfixExpr: PostfixExprNode = {
        type: 'PostfixExpr',
        primary: {
          type: 'Variable',
          name: null,
          isPipeVar: true,
          accessChain: [],
          defaultValue: null,
          existenceCheck: null,
          span: methods[0]!.span,
        },
        methods,
        defaultValue: null,
        span: makeSpan(start, current(this.state).span.end),
      };
      return this.parseConditionalWithCondition(postfixExpr);
    }

    // Single method: return as-is
    if (methods.length === 1) {
      return methods[0]!;
    }

    // Multiple methods: wrap in PostfixExpr with $ as primary
    return {
      type: 'PostfixExpr',
      primary: {
        type: 'Variable',
        name: null,
        isPipeVar: true,
        accessChain: [],
        defaultValue: null,
        existenceCheck: null,
        span: methods[0]!.span,
      },
      methods,
      defaultValue: null,
      span: makeSpan(start, current(this.state).span.end),
    } as PostfixExprNode;
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
    return this.parseVariable();
  }

  // String literal
  if (check(this.state, TOKEN_TYPES.STRING)) {
    return this.parseString();
  }

  // Bare bracket literal as dispatch target: ["a", "b"] or [a: 1]
  if (check(this.state, TOKEN_TYPES.LBRACKET)) {
    const literal = this.parseTupleOrDict();
    if (check(this.state, TOKEN_TYPES.NULLISH_COALESCE)) {
      advance(this.state);
      const defaultValue = this.parseDefaultValue();
      return { ...literal, defaultValue };
    }
    return literal;
  }

  // Keyword list literal as dispatch target: list["a", "b"]
  if (check(this.state, TOKEN_TYPES.LIST_LBRACKET)) {
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
      } satisfies ListLiteralNode;
    }
    return listLiteral;
  }

  // Keyword dict literal as dispatch target: dict[key: val, ...]
  if (check(this.state, TOKEN_TYPES.DICT_LBRACKET)) {
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
  }

  // Function call with parens
  if (isHostCall(this.state)) {
    return this.parseHostCall();
  }

  // Bare function name: "-> greet" or "-> ns::func"
  if (check(this.state, TOKEN_TYPES.IDENTIFIER)) {
    return parseBareHostCall(this.state);
  }

  // Common constructs
  const common = this.parseCommonConstruct();
  if (common) {
    if (check(this.state, TOKEN_TYPES.COLON)) {
      return this.parsePostfixTypeOperation(common, common.span.start);
    }
    return common;
  }

  throw new ParseError(
    'RILL-P001',
    `Expected pipe target, got: ${current(this.state).value}`,
    current(this.state).span.start
  );
};

// ============================================================
// CAPTURE PARSING
// ============================================================

Parser.prototype.parseCapture = function (this: Parser): CaptureNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.DOLLAR, 'Expected $');
  const nameToken = expect(
    this.state,
    TOKEN_TYPES.IDENTIFIER,
    'Expected variable name'
  );

  let typeRef: CaptureNode['typeRef'] = null;
  if (check(this.state, TOKEN_TYPES.COLON)) {
    advance(this.state);
    typeRef = parseTypeRef(this.state);
  }

  return {
    type: 'Capture',
    name: nameToken.value,
    typeRef,
    inlineShape: null,
    span: makeSpan(start, current(this.state).span.end),
  };
};

// ============================================================
// GROUPED EXPRESSION
// ============================================================

Parser.prototype.parseGrouped = function (this: Parser): GroupedExprNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.LPAREN, 'Expected (');
  const expression = this.parsePipeChain();
  const rparen = expect(
    this.state,
    TOKEN_TYPES.RPAREN,
    'Expected )',
    'RILL-P005'
  );
  return {
    type: 'GroupedExpr',
    expression,
    span: makeSpan(start, rparen.span.end),
  };
};

// ============================================================
// EXPRESSION PRECEDENCE CHAIN
// ============================================================

Parser.prototype.isComparisonOp = function (this: Parser): boolean {
  return check(
    this.state,
    TOKEN_TYPES.EQ,
    TOKEN_TYPES.NE,
    TOKEN_TYPES.LT,
    TOKEN_TYPES.GT,
    TOKEN_TYPES.LE,
    TOKEN_TYPES.GE
  );
};

Parser.prototype.tokenToComparisonOp = function (
  this: Parser,
  tokenType: string
): '==' | '!=' | '<' | '>' | '<=' | '>=' {
  switch (tokenType) {
    case TOKEN_TYPES.EQ:
      return '==';
    case TOKEN_TYPES.NE:
      return '!=';
    case TOKEN_TYPES.LT:
      return '<';
    case TOKEN_TYPES.GT:
      return '>';
    case TOKEN_TYPES.LE:
      return '<=';
    default:
      return '>=';
  }
};

Parser.prototype.wrapConditionalInPostfixExpr = function (
  this: Parser,
  conditional: ConditionalNode,
  span: SourceSpan
): PostfixExprNode {
  return {
    type: 'PostfixExpr',
    primary: conditional,
    methods: [],
    defaultValue: null,
    span,
  };
};

Parser.prototype.wrapLoopInPostfixExpr = function (
  this: Parser,
  loop: WhileLoopNode | DoWhileLoopNode,
  span: SourceSpan
): PostfixExprNode {
  return {
    type: 'PostfixExpr',
    primary: loop,
    methods: [],
    defaultValue: null,
    span,
  };
};

Parser.prototype.parseLogicalOr = function (this: Parser): ArithHead {
  const start = current(this.state).span.start;
  let left = this.parseLogicalAnd();

  while (check(this.state, TOKEN_TYPES.OR)) {
    advance(this.state);
    skipNewlines(this.state);
    const right = this.parseLogicalAnd();
    left = {
      type: 'BinaryExpr',
      op: '||',
      left,
      right,
      span: makeSpan(start, current(this.state).span.end),
    };
  }

  return left;
};

Parser.prototype.parseLogicalAnd = function (this: Parser): ArithHead {
  const start = current(this.state).span.start;
  let left = this.parseComparison();

  while (check(this.state, TOKEN_TYPES.AND)) {
    advance(this.state);
    skipNewlines(this.state);
    const right = this.parseComparison();
    left = {
      type: 'BinaryExpr',
      op: '&&',
      left,
      right,
      span: makeSpan(start, current(this.state).span.end),
    };
  }

  return left;
};

Parser.prototype.parseComparison = function (this: Parser): ArithHead {
  const start = current(this.state).span.start;
  let left = this.parseAdditive();

  if (this.isComparisonOp()) {
    const opToken = advance(this.state);
    skipNewlines(this.state);
    const op = this.tokenToComparisonOp(opToken.type);
    const right = this.parseAdditive();
    left = {
      type: 'BinaryExpr',
      op,
      left,
      right,
      span: makeSpan(start, current(this.state).span.end),
    };
  }

  return left;
};

Parser.prototype.parseAdditive = function (this: Parser): ArithHead {
  const start = current(this.state).span.start;
  let left = this.parseMultiplicative();

  while (check(this.state, TOKEN_TYPES.PLUS, TOKEN_TYPES.MINUS)) {
    const opToken = advance(this.state);
    skipNewlines(this.state);
    const op: BinaryOp = opToken.type === TOKEN_TYPES.PLUS ? '+' : '-';
    const right = this.parseMultiplicative();
    left = {
      type: 'BinaryExpr',
      op,
      left,
      right,
      span: makeSpan(start, current(this.state).span.end),
    };
  }

  return left;
};

Parser.prototype.parseMultiplicative = function (this: Parser): ArithHead {
  const start = current(this.state).span.start;
  let left: ArithHead = this.parseUnary();

  while (
    check(this.state, TOKEN_TYPES.STAR, TOKEN_TYPES.SLASH, TOKEN_TYPES.PERCENT)
  ) {
    const opToken = advance(this.state);
    skipNewlines(this.state);
    const op: BinaryOp =
      opToken.type === TOKEN_TYPES.STAR
        ? '*'
        : opToken.type === TOKEN_TYPES.SLASH
          ? '/'
          : '%';
    const right = this.parseUnary();
    left = {
      type: 'BinaryExpr',
      op,
      left,
      right,
      span: makeSpan(start, current(this.state).span.end),
    };
  }

  return left;
};

Parser.prototype.parseUnary = function (
  this: Parser
): UnaryExprNode | PostfixExprNode {
  if (check(this.state, TOKEN_TYPES.MINUS)) {
    const start = current(this.state).span.start;
    advance(this.state);
    const operand = this.parseUnary();
    return {
      type: 'UnaryExpr',
      op: '-',
      operand,
      span: makeSpan(start, operand.span.end),
    };
  }
  if (check(this.state, TOKEN_TYPES.BANG)) {
    const start = current(this.state).span.start;
    advance(this.state);
    const operand = this.parseUnary();
    return {
      type: 'UnaryExpr',
      op: '!',
      operand,
      span: makeSpan(start, operand.span.end),
    };
  }
  return this.parsePostfixExpr();
};

// ============================================================
// CLOSURE SIG LITERAL PARSING
// ============================================================

Parser.prototype.parseClosureSigLiteral = function (
  this: Parser
): ClosureSigLiteralNode {
  const start = current(this.state).span.start;

  // Consume opening |
  expect(this.state, TOKEN_TYPES.PIPE_BAR, 'Expected |');
  skipNewlines(this.state);

  const params: { name: string; typeExpr: ExpressionNode }[] = [];

  // Parse param-type-list: name: typeExpr [, name: typeExpr]*
  while (!check(this.state, TOKEN_TYPES.PIPE_BAR)) {
    const nameToken = expect(
      this.state,
      TOKEN_TYPES.IDENTIFIER,
      'Expected parameter name'
    );
    expect(this.state, TOKEN_TYPES.COLON, 'Expected : after parameter name');
    skipNewlines(this.state);
    const typeExpr = this.parseExpression();
    params.push({ name: nameToken.value, typeExpr });
    skipNewlines(this.state);
    if (check(this.state, TOKEN_TYPES.COMMA)) {
      advance(this.state);
      skipNewlines(this.state);
    }
  }

  // Consume closing |
  expect(this.state, TOKEN_TYPES.PIPE_BAR, 'Expected |', 'RILL-P005');

  // Consume : before return type
  expect(
    this.state,
    TOKEN_TYPES.COLON,
    'Expected : before return type in closure sig literal'
  );
  skipNewlines(this.state);

  const returnType = this.parseExpression();

  return {
    type: 'ClosureSigLiteral',
    params,
    returnType,
    span: makeSpan(start, current(this.state).span.end),
  };
};

// ============================================================
// CONVERT PARSING
// ============================================================

/**
 * Parse the convert operator: :>type, :>$var, or :>ordered(field: type, ...)
 *
 * Called when current token is COLON and next is GT (i.e. `:>`).
 * Consumes COLON and GT, then parses:
 *   - structural: ordered(field: type, ...) → TypeConstructorNode
 *   - dynamic:    $varName                  → TypeRef { kind: 'dynamic' }
 *   - static:     list | dict | tuple | ...  → TypeRef { kind: 'static' }
 */
Parser.prototype.parseConvert = function (this: Parser): ConvertNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.COLON, 'Expected :');
  expect(this.state, TOKEN_TYPES.GT, 'Expected >');

  // Structural convert: :>ordered(field: type, ...)
  const TYPE_CONSTRUCTORS = ['list', 'dict', 'tuple', 'ordered'] as const;
  if (
    check(this.state, TOKEN_TYPES.IDENTIFIER) &&
    TYPE_CONSTRUCTORS.includes(
      current(this.state).value as (typeof TYPE_CONSTRUCTORS)[number]
    ) &&
    this.state.tokens[this.state.pos + 1]?.type === TOKEN_TYPES.LPAREN
  ) {
    const constructorName = current(this.state).value;
    const typeRef: TypeConstructorNode =
      this.parseTypeConstructor(constructorName);
    return {
      type: 'Convert',
      typeRef,
      span: makeSpan(start, current(this.state).span.end),
    };
  }

  // Dynamic or static type reference
  const typeRef = parseTypeRef(this.state);
  return {
    type: 'Convert',
    typeRef,
    span: makeSpan(start, current(this.state).span.end),
  };
};
