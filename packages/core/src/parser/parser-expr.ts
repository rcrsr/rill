/**
 * Parser Extension: Expression Parsing
 * Expressions, precedence chain, and pipe chains
 */

import { Parser } from './parser.js';
import type {
  AnnotationArg,
  ArithHead,
  BinaryOp,
  BlockNode,
  CaptureNode,
  ChainTerminator,
  ClosureSigLiteralNode,
  ConditionalNode,
  DoWhileLoopNode,
  ExpressionNode,
  WhileLoopNode,
  GroupedExprNode,
  PassBlockNode,
  TimeoutBlockNode,
  DictNode,
  DictEntryNode,
  PipeChainNode,
  PipeTargetNode,
  PostfixExprNode,
  SourceLocation,
  SourceSpan,
  UnaryExprNode,
  UseExprNode,
  VariableNode,
} from '../types.js';
import {
  type TokenType,
  BINARY_OPS,
  ParseError,
  TOKEN_TYPES,
} from '../types.js';
import {
  check,
  advance,
  expect,
  current,
  previous,
  makeSpan,
  peek,
  skipNewlines,
  skipNewlinesIfFollowedBy,
  withRecursionDepth,
} from './state.js';
import {
  makeBoolLiteralBlock,
  describeToken,
  expectVariableName,
} from './helpers.js';
import { parseTypeRef } from './parser-types.js';
import { ERROR_IDS } from '../error-registry.js';
import { runPostfixDispatchLoop } from './parser-pipe-target.js';
import type { PostfixLoopState } from './parser-primary.js';

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
    parseCapture(): CaptureNode;
    parseGrouped(): GroupedExprNode;
    parseCommonConstruct(): CommonConstruct | null;
    parseLogicalOr(): ArithHead;
    parseLogicalAnd(): ArithHead;
    parseComparison(): ArithHead;
    parseAdditive(): ArithHead;
    parseMultiplicative(): ArithHead;
    parseUnary(): UnaryExprNode | PostfixExprNode;
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
    parseUseExpr(): UseExprNode;
    parseBinaryExprChain(
      nextParser: (this: Parser) => ArithHead,
      opTokens: TokenType[],
      opMap: Map<TokenType, BinaryOp>,
      maxChain?: number
    ): ArithHead;
    parsePassBlock(): PassBlockNode;
    parseTimeoutBlock(): TimeoutBlockNode;
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
        ERROR_IDS.RILL_P004,
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

  // Loop dispatch: WHILE / DO / DO_LANGLE → new keyword forms.
  // Guard: @[ and @$fn are not valid expression forms (RILL-P010).
  // Bare AT at expression head → legacy post-loop form (RILL-R080).
  if (check(this.state, TOKEN_TYPES.AT)) {
    const nextType = peek(this.state, 1).type;
    if (nextType === TOKEN_TYPES.LBRACKET || nextType === TOKEN_TYPES.DOLLAR) {
      throw new ParseError(
        ERROR_IDS.RILL_P010,
        `'@${nextType === TOKEN_TYPES.LBRACKET ? '[' : '$'}...' is not a valid expression; use chain(...) to chain collections`,
        current(this.state).span.start
      );
    }
    // Legacy bounded post-loop: @ ^(limit: N) { body } ? (cond) — RILL-R080
    if (peek(this.state, 1).type === TOKEN_TYPES.CARET) {
      throw new ParseError(
        ERROR_IDS.RILL_R080,
        'Migration error: use `do<limit: N> { body } while (cond)`',
        current(this.state).span.start
      );
    }
    // Legacy post-loop: @ { body } ? (cond) — RILL-R080 at @
    throw new ParseError(
      ERROR_IDS.RILL_R080,
      'Migration error: use `do { body } while (cond)`',
      current(this.state).span.start
    );
  }

  // New keyword-headed loop forms at expression head.
  if (check(this.state, TOKEN_TYPES.WHILE)) {
    return this.parseWhileLoop();
  }
  if (
    check(this.state, TOKEN_TYPES.DO) ||
    check(this.state, TOKEN_TYPES.DO_LANGLE)
  ) {
    return this.parseLoop();
  }

  // Block (may be followed by loop keyword or ? for conditional)
  if (check(this.state, TOKEN_TYPES.LBRACE)) {
    const block = this.parseBlock();
    if (check(this.state, TOKEN_TYPES.AT)) {
      // Legacy post-loop: { body } @ ? (cond) — RILL-R080 at @
      throw new ParseError(
        ERROR_IDS.RILL_R080,
        'Migration error: use `do { body } while (cond)`',
        current(this.state).span.start
      );
    }
    if (
      check(this.state, TOKEN_TYPES.WHILE) ||
      check(this.state, TOKEN_TYPES.DO) ||
      check(this.state, TOKEN_TYPES.DO_LANGLE)
    ) {
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
      // Legacy pre-loop: (cond) @ { body } — RILL-R079 at @
      throw new ParseError(
        ERROR_IDS.RILL_R079,
        'Migration error: use `while (cond) do { body }`',
        current(this.state).span.start
      );
    }
    if (
      check(this.state, TOKEN_TYPES.WHILE) ||
      check(this.state, TOKEN_TYPES.DO) ||
      check(this.state, TOKEN_TYPES.DO_LANGLE)
    ) {
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

  // Handle bare yield: "yield" ≡ "$ -> yield"
  if (check(this.state, TOKEN_TYPES.YIELD)) {
    if (this.closureDepth === 0) {
      throw new ParseError(
        ERROR_IDS.RILL_P006,
        "'yield' is only valid inside a stream closure",
        current(this.state).span.start
      );
    }
    const token = advance(this.state);
    return {
      type: 'PipeChain',
      head: this.implicitPipeVar(token.span),
      pipes: [],
      terminator: { type: 'Yield', span: token.span },
      span: token.span,
    };
  }

  // Parse expression head with full precedence chain
  let head = this.parseLogicalOr();

  // Null-coalesce operator `??` at general-expression precedence (task 1.4).
  // Sits below the pipe/ternary/@ loop tier and above arithmetic/logical.
  // When head is already a PostfixExprNode, update its `defaultValue` so
  // existing evaluator paths (RILL-R007 default handling) still apply.
  // For arithmetic heads (Binary/UnaryExprNode), wrap in a GroupedExpr to
  // produce a PrimaryNode-compatible container.
  if (check(this.state, TOKEN_TYPES.NULLISH_COALESCE)) {
    advance(this.state);
    const defaultValue = this.parseDefaultValue();
    const span = makeSpan(head.span.start, defaultValue.span.end);
    if (head.type === 'PostfixExpr') {
      head = { ...head, defaultValue, span };
    } else {
      const innerChain: PipeChainNode = {
        type: 'PipeChain',
        head,
        pipes: [],
        terminator: null,
        span: head.span,
      };
      const grouped: GroupedExprNode = {
        type: 'GroupedExpr',
        expression: innerChain,
        span: head.span,
      };
      head = {
        type: 'PostfixExpr',
        primary: grouped,
        methods: [],
        defaultValue,
        span,
      };
    }
  }

  // Check for loop: expr while/do/do< body (new syntax) or expr @ (legacy RILL-R080)
  if (check(this.state, TOKEN_TYPES.AT)) {
    // Legacy seeded loop: expr @ { body } ? (cond) — RILL-R080 at @
    throw new ParseError(
      ERROR_IDS.RILL_R080,
      'Migration error: use `do { body } while (cond)`',
      current(this.state).span.start
    );
  }
  if (
    check(this.state, TOKEN_TYPES.WHILE) ||
    check(this.state, TOKEN_TYPES.DO) ||
    check(this.state, TOKEN_TYPES.DO_LANGLE)
  ) {
    const headAsPipeChain: PipeChainNode = {
      type: 'PipeChain',
      head,
      pipes: [],
      terminator: null,
      span: head.span,
    };
    const loop = this.parseLoopWithInput(headAsPipeChain);
    const span = makeSpan(head.span.start, previous(this.state).span.end);
    const wrapped = this.wrapLoopInPostfixExpr(loop, span);
    // The loop result is itself postfix-chainable: `5 do { } while (...) .upper`.
    const loopLoopState: PostfixLoopState = {
      primary: wrapped.primary,
      methods: [...wrapped.methods],
      receiverEnd: wrapped.span.end,
    };
    runPostfixDispatchLoop.call(this, loopLoopState, wrapped.span.start);
    head = {
      type: 'PostfixExpr',
      primary: loopLoopState.primary,
      methods: loopLoopState.methods,
      defaultValue: null,
      span: makeSpan(wrapped.span.start, loopLoopState.receiverEnd),
    };
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
    const span = makeSpan(head.span.start, previous(this.state).span.end);
    head = this.wrapConditionalInPostfixExpr(conditional, span);
  }

  const pipes: (PipeTargetNode | CaptureNode)[] = [];
  let terminator: ChainTerminator | null = null;

  // Helper: check for -> or => possibly after newlines (line continuation).
  // Reuses skipNewlinesIfFollowedBy so a leading -> / => on the next line is
  // treated identically whether it follows a newline or not.
  const checkChainContinuation = (): boolean =>
    skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.ARROW) ||
    skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.CAPTURE_ARROW);

  while (checkChainContinuation()) {
    const isCapture = check(this.state, TOKEN_TYPES.CAPTURE_ARROW);
    advance(this.state);
    // A trailing -> / => at end of line continues onto the next line: skip
    // the newlines the operator leaves behind before parsing its target.
    skipNewlines(this.state);

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

    // Check for yield terminator: -> yield
    if (check(this.state, TOKEN_TYPES.YIELD)) {
      if (this.closureDepth === 0) {
        throw new ParseError(
          ERROR_IDS.RILL_P006,
          "'yield' is only valid inside a stream closure",
          current(this.state).span.start
        );
      }
      const token = advance(this.state);
      terminator = { type: 'Yield', span: token.span };
      break;
    }

    // Guard against removed -> export syntax
    if (
      check(this.state, TOKEN_TYPES.IDENTIFIER) &&
      current(this.state).value === 'export'
    ) {
      throw new ParseError(
        ERROR_IDS.RILL_P012,
        'Syntax removed: -> export syntax removed; use last-expression result instead',
        current(this.state).span.start
      );
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
    const span = makeSpan(start, previous(this.state).span.end);
    const chainAsCondition: PipeChainNode = {
      type: 'PipeChain',
      head,
      pipes,
      terminator: null,
      span,
    };
    const conditional = this.parseConditionalWithCondition(chainAsCondition);
    const resultSpan = makeSpan(start, previous(this.state).span.end);
    return {
      type: 'PipeChain',
      head: this.wrapConditionalInPostfixExpr(conditional, resultSpan),
      pipes: [],
      terminator: null,
      span: resultSpan,
    };
  }

  const chainEnd = terminator
    ? terminator.span.end
    : pipes.length > 0
      ? pipes[pipes.length - 1]!.span.end
      : head.span.end;

  return {
    type: 'PipeChain',
    head,
    pipes,
    terminator,
    span: makeSpan(start, chainEnd),
  };
};

// ============================================================
// CAPTURE PARSING
// ============================================================

Parser.prototype.parseCapture = function (this: Parser): CaptureNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.DOLLAR, 'Expected $');
  const nameToken = expectVariableName(this.state, 'Expected variable name');

  let typeRef: CaptureNode['typeRef'] = null;
  let end = nameToken.span.end;
  if (check(this.state, TOKEN_TYPES.COLON)) {
    advance(this.state);
    skipNewlines(this.state);
    typeRef = parseTypeRef(this.state);
    end = peek(this.state, -1).span.end;
  }

  // A capture target is `$name` or `$name:type` only (no postfix access) --
  // feed it through the same token set the postfix loop dispatches on so a
  // stray `$a[0]`, `$a.field`, or `$a()` right after a capture is rejected
  // here instead of silently starting a new, unrelated statement.
  if (
    check(this.state, TOKEN_TYPES.LBRACKET) ||
    check(this.state, TOKEN_TYPES.LPAREN) ||
    check(this.state, TOKEN_TYPES.DOT) ||
    check(this.state, TOKEN_TYPES.DOT_BANG) ||
    check(this.state, TOKEN_TYPES.DOT_QUESTION)
  ) {
    throw new ParseError(
      ERROR_IDS.RILL_P001,
      `Unexpected token ${describeToken(current(this.state))}: capture target only accepts \`$name\` or \`$name:type\`, not postfix access`,
      current(this.state).span.start
    );
  }

  return {
    type: 'Capture',
    name: nameToken.value,
    typeRef,
    inlineShape: null,
    span: makeSpan(start, end),
  };
};

// ============================================================
// GROUPED EXPRESSION
// ============================================================

Parser.prototype.parseGrouped = function (this: Parser): GroupedExprNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.LPAREN, 'Expected (');
  skipNewlines(this.state);
  const expression = this.parsePipeChain();
  skipNewlines(this.state);
  const rparen = expect(
    this.state,
    TOKEN_TYPES.RPAREN,
    'Expected )',
    ERROR_IDS.RILL_P005
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
      return BINARY_OPS.EQ;
    case TOKEN_TYPES.NE:
      return BINARY_OPS.NE;
    case TOKEN_TYPES.LT:
      return BINARY_OPS.LT;
    case TOKEN_TYPES.GT:
      return BINARY_OPS.GT;
    case TOKEN_TYPES.LE:
      return BINARY_OPS.LE;
    default:
      return BINARY_OPS.GE;
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

Parser.prototype.parseBinaryExprChain = function (
  this: Parser,
  nextParser: (this: Parser) => ArithHead,
  opTokens: TokenType[],
  opMap: Map<TokenType, BinaryOp>,
  maxChain?: number
): ArithHead {
  const start = current(this.state).span.start;
  let left = nextParser.call(this);

  const limit = maxChain ?? Number.POSITIVE_INFINITY;
  let applied = 0;
  while (applied < limit && check(this.state, ...opTokens)) {
    const opToken = advance(this.state);
    skipNewlines(this.state);
    const op = opMap.get(opToken.type);
    if (op === undefined) {
      const _exhaustive: never = opToken.type as never;
      throw new Error(
        `parseBinaryExprChain: no opMap entry for token '${_exhaustive}'`
      );
    }
    const right = nextParser.call(this);
    left = {
      type: 'BinaryExpr',
      op,
      left,
      right,
      span: makeSpan(start, right.span.end),
    };
    applied++;
  }

  return left;
};

const LOGICAL_OR_OP_TOKENS: TokenType[] = [TOKEN_TYPES.OR];
const LOGICAL_OR_OP_MAP = new Map<TokenType, BinaryOp>([
  [TOKEN_TYPES.OR, BINARY_OPS.OR],
]);

Parser.prototype.parseLogicalOr = function (this: Parser): ArithHead {
  return this.parseBinaryExprChain(
    (this as Parser).parseLogicalAnd,
    LOGICAL_OR_OP_TOKENS,
    LOGICAL_OR_OP_MAP
  );
};

const LOGICAL_AND_OP_TOKENS: TokenType[] = [TOKEN_TYPES.AND];
const LOGICAL_AND_OP_MAP = new Map<TokenType, BinaryOp>([
  [TOKEN_TYPES.AND, BINARY_OPS.AND],
]);

Parser.prototype.parseLogicalAnd = function (this: Parser): ArithHead {
  return this.parseBinaryExprChain(
    (this as Parser).parseComparison,
    LOGICAL_AND_OP_TOKENS,
    LOGICAL_AND_OP_MAP
  );
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
      span: makeSpan(start, right.span.end),
    };
  }

  return left;
};

const ADDITIVE_OP_TOKENS: TokenType[] = [TOKEN_TYPES.PLUS, TOKEN_TYPES.MINUS];
const ADDITIVE_OP_MAP = new Map<TokenType, BinaryOp>([
  [TOKEN_TYPES.PLUS, BINARY_OPS.ADD],
  [TOKEN_TYPES.MINUS, BINARY_OPS.SUB],
]);

Parser.prototype.parseAdditive = function (this: Parser): ArithHead {
  return this.parseBinaryExprChain(
    (this as Parser).parseMultiplicative,
    ADDITIVE_OP_TOKENS,
    ADDITIVE_OP_MAP
  );
};

const MULTIPLICATIVE_OP_TOKENS: TokenType[] = [
  TOKEN_TYPES.STAR,
  TOKEN_TYPES.SLASH,
  TOKEN_TYPES.PERCENT,
];
const MULTIPLICATIVE_OP_MAP = new Map<TokenType, BinaryOp>([
  [TOKEN_TYPES.STAR, BINARY_OPS.MUL],
  [TOKEN_TYPES.SLASH, BINARY_OPS.DIV],
  [TOKEN_TYPES.PERCENT, BINARY_OPS.MOD],
]);

Parser.prototype.parseMultiplicative = function (this: Parser): ArithHead {
  return this.parseBinaryExprChain(
    (this as Parser).parseUnary,
    MULTIPLICATIVE_OP_TOKENS,
    MULTIPLICATIVE_OP_MAP
  );
};

Parser.prototype.parseUnary = function (
  this: Parser
): UnaryExprNode | PostfixExprNode {
  return withRecursionDepth(
    this.state,
    () => current(this.state).span.start,
    () => parseUnaryImpl.call(this)
  );
};

function parseUnaryImpl(this: Parser): UnaryExprNode | PostfixExprNode {
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
}

// ============================================================
// CLOSURE SIG LITERAL PARSING
// ============================================================

Parser.prototype.parseClosureSigLiteral = function (
  this: Parser
): ClosureSigLiteralNode {
  const start = current(this.state).span.start;

  const params: {
    name: string;
    typeExpr: ExpressionNode;
    annotations?: AnnotationArg[];
  }[] = [];

  if (check(this.state, TOKEN_TYPES.OR)) {
    // `||:ret` — empty param list.
    advance(this.state);
    skipNewlines(this.state);
  } else {
    // Consume opening |
    expect(this.state, TOKEN_TYPES.PIPE_BAR, 'Expected |');
    skipNewlines(this.state);

    // Parse param-type-list: [^(annots)] name: typeExpr [, [^(annots)] name: typeExpr]*
    while (!check(this.state, TOKEN_TYPES.PIPE_BAR)) {
      let annotations: AnnotationArg[] | undefined;
      while (check(this.state, TOKEN_TYPES.CARET)) {
        advance(this.state); // consume ^
        expect(this.state, TOKEN_TYPES.LPAREN, 'Expected ( after ^');
        const block = this.parseAnnotationArgs();
        expect(
          this.state,
          TOKEN_TYPES.RPAREN,
          'Expected )',
          ERROR_IDS.RILL_P005
        );
        skipNewlines(this.state);

        annotations = annotations ? annotations.concat(block) : block;

        // Guard: annotation must be followed by a field
        if (check(this.state, TOKEN_TYPES.PIPE_BAR)) {
          throw new ParseError(
            ERROR_IDS.RILL_P014,
            'Expected field after annotation',
            current(this.state).span.start
          );
        }
      }

      const nameToken = expect(
        this.state,
        TOKEN_TYPES.IDENTIFIER,
        'Expected parameter name'
      );
      expect(this.state, TOKEN_TYPES.COLON, 'Expected : after parameter name');
      skipNewlines(this.state);
      const typeExpr = this.parseExpression();
      const param: {
        name: string;
        typeExpr: ExpressionNode;
        annotations?: AnnotationArg[];
      } = { name: nameToken.value, typeExpr };
      if (annotations) {
        param.annotations = annotations;
      }
      params.push(param);
      skipNewlines(this.state);
      if (check(this.state, TOKEN_TYPES.COMMA)) {
        advance(this.state);
        skipNewlines(this.state);
      }
    }

    // Consume closing |
    expect(this.state, TOKEN_TYPES.PIPE_BAR, 'Expected |', ERROR_IDS.RILL_P005);
  }

  // Consume : before return type
  expect(
    this.state,
    TOKEN_TYPES.COLON,
    'Expected : before return type in closure sig literal'
  );
  skipNewlines(this.state);

  const returnType = this.parsePostfixExpr();

  return {
    type: 'ClosureSigLiteral',
    params,
    returnType,
    span: makeSpan(start, previous(this.state).span.end),
  };
};

// ============================================================
// PASS BLOCK PARSER
// ============================================================

/**
 * Parse a pass block: `pass<on_error: #IGNORE> { body }`.
 *
 * Enters with current token being PASS_LANGLE (compound `pass<`).
 * Parses key:value pairs separated by commas until `>`, then parses
 * a block body. The options are synthesised into a DictNode so the
 * evaluator can use the standard dict evaluation path to read them.
 */
Parser.prototype.parsePassBlock = function (this: Parser): PassBlockNode {
  const start = current(this.state).span.start;
  advance(this.state); // consume pass<

  const dictStart = current(this.state).span.start;
  const entries: DictEntryNode[] = [];

  skipNewlines(this.state);

  while (
    !check(this.state, TOKEN_TYPES.GT) &&
    !check(this.state, TOKEN_TYPES.EOF)
  ) {
    const entryStart = current(this.state).span.start;

    if (!check(this.state, TOKEN_TYPES.IDENTIFIER)) {
      throw new ParseError(
        ERROR_IDS.RILL_P004,
        "Expected option key (identifier) inside 'pass<...>'",
        current(this.state).span.start
      );
    }
    const keyToken = advance(this.state);

    if (keyToken.value !== 'on_error' && keyToken.value !== 'async') {
      throw new ParseError(
        ERROR_IDS.RILL_P004,
        `Unknown option '${keyToken.value}' inside 'pass<...>'; recognized options are 'on_error' and 'async'`,
        keyToken.span.start
      );
    }

    expect(
      this.state,
      TOKEN_TYPES.COLON,
      "Expected ':' after option key inside 'pass<...>'",
      ERROR_IDS.RILL_P004
    );
    skipNewlines(this.state);

    // Parse only a primary expression (atom literal, string, number, etc.)
    // so that `>` after the value is not consumed as a comparison operator.
    // Wrap in PostfixExprNode + PipeChainNode to satisfy ExpressionNode type.
    const primaryNode = this.parsePrimary();

    if (keyToken.value === 'on_error') {
      if (primaryNode.type !== 'AtomLiteral' || primaryNode.name !== 'IGNORE') {
        throw new ParseError(
          ERROR_IDS.RILL_P004,
          "'on_error' option requires value '#IGNORE'",
          primaryNode.span.start
        );
      }
    } else {
      // async key: requires a boolean literal (true or false)
      if (primaryNode.type !== 'BoolLiteral') {
        throw new ParseError(
          ERROR_IDS.RILL_P004,
          "'async' option requires a boolean literal ('true' or 'false')",
          primaryNode.span.start
        );
      }
    }

    const primarySpan = primaryNode.span;
    const postfixNode: PostfixExprNode = {
      type: 'PostfixExpr',
      primary: primaryNode,
      methods: [],
      defaultValue: null,
      span: primarySpan,
    };
    const value: PipeChainNode = {
      type: 'PipeChain',
      head: postfixNode,
      pipes: [],
      terminator: null,
      span: primarySpan,
    };

    entries.push({
      type: 'DictEntry',
      key: keyToken.value,
      keyForm: 'identifier',
      value,
      span: makeSpan(entryStart, previous(this.state).span.end),
    } satisfies DictEntryNode);

    skipNewlines(this.state);
    if (check(this.state, TOKEN_TYPES.COMMA)) {
      advance(this.state);
      skipNewlines(this.state);
    }
  }

  if (entries.length === 0) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      "'pass<>' requires at least one option (use 'pass { body }' for the no-options form, 'pass<on_error: #IGNORE> { body }' for suppression, or 'pass<async: true> { body }' for async execution)",
      dictStart
    );
  }

  const gt = expect(
    this.state,
    TOKEN_TYPES.GT,
    "Expected '>' to close 'pass<...>'",
    ERROR_IDS.RILL_P005
  );

  const options: DictNode = {
    type: 'Dict',
    entries,
    defaultValue: null,
    span: makeSpan(dictStart, gt.span.end),
  };

  skipNewlines(this.state);

  if (!check(this.state, TOKEN_TYPES.LBRACE)) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      "Expected '{ body }' after 'pass<...>'",
      current(this.state).span.start
    );
  }

  const body = this.parseBlock(true);

  return {
    type: 'PassBlock',
    options,
    body,
    span: makeSpan(start, body.span.end),
  } satisfies PassBlockNode;
};
