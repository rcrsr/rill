/**
 * Parser Extension: Expression Parsing
 * Expressions, precedence chain, pipe chains, and pipe targets
 */

import { Parser } from './parser.js';
import type {
  ArithHead,
  BinaryOp,
  BlockNode,
  CaptureNode,
  ChainTerminator,
  ConditionalNode,
  DoWhileLoopNode,
  ExpressionNode,
  ForLoopNode,
  GroupedExprNode,
  InvokeNode,
  MethodCallNode,
  PipeChainNode,
  PipeTargetNode,
  PostfixExprNode,
  PrimaryNode,
  SourceLocation,
  SourceSpan,
  UnaryExprNode,
  VariableNode,
} from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import { check, advance, expect, current, makeSpan } from './state.js';
import {
  isHostCall,
  isClosureCall,
  canStartPipeInvoke,
  isMethodCall,
  isTypedCaptureWithArrow,
  isInlineCaptureWithArrow,
  isClosureChainTarget,
  isNegativeNumber,
  isLiteralStart,
  isClosureStart,
  makeBoolLiteralBlock,
  VALID_TYPE_NAMES,
  parseTypeName,
} from './helpers.js';

/** Constructs valid as both primary expressions and pipe targets */
type CommonConstruct =
  | ConditionalNode
  | ForLoopNode
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
      loop: ForLoopNode | DoWhileLoopNode,
      span: SourceSpan
    ): PostfixExprNode;
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
  if (check(this.state, TOKEN_TYPES.AT)) {
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
  if (check(this.state, TOKEN_TYPES.QUESTION)) {
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

  while (check(this.state, TOKEN_TYPES.ARROW)) {
    advance(this.state);

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

    // Check for capture vs ClosureCall: $identifier
    if (check(this.state, TOKEN_TYPES.DOLLAR)) {
      if (isClosureCall(this.state)) {
        pipes.push(this.parsePipeTarget());
        continue;
      }
      if (isInlineCaptureWithArrow(this.state)) {
        pipes.push(this.parseCapture());
        continue;
      }
      if (isTypedCaptureWithArrow(this.state)) {
        pipes.push(this.parseCapture());
        continue;
      }
      terminator = this.parseCapture();
      break;
    }

    pipes.push(this.parsePipeTarget());
  }

  // Check for conditional after pipe chain
  if (check(this.state, TOKEN_TYPES.QUESTION) && pipes.length > 0) {
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

  if (check(this.state, TOKEN_TYPES.QUESTION)) {
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
  if (check(this.state, TOKEN_TYPES.COLON)) {
    primary = this.parsePostfixTypeOperation(primary, start);
  }

  const methods: (MethodCallNode | InvokeNode)[] = [];

  while (isMethodCall(this.state) || check(this.state, TOKEN_TYPES.LPAREN)) {
    if (isMethodCall(this.state)) {
      methods.push(this.parseMethodCall());
    } else {
      methods.push(this.parseInvoke());
    }
  }

  return {
    type: 'PostfixExpr',
    primary,
    methods,
    span: makeSpan(start, current(this.state).span.end),
  };
};

Parser.prototype.parseInvoke = function (this: Parser): InvokeNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.LPAREN, 'Expected (');

  const args: ExpressionNode[] = [];
  if (!check(this.state, TOKEN_TYPES.RPAREN)) {
    args.push(this.parsePipeChain());
    while (check(this.state, TOKEN_TYPES.COMMA)) {
      advance(this.state);
      args.push(this.parsePipeChain());
    }
  }

  expect(this.state, TOKEN_TYPES.RPAREN, 'Expected )');

  return {
    type: 'Invoke',
    args,
    span: makeSpan(start, current(this.state).span.end),
  };
};

// ============================================================
// PRIMARY PARSING
// ============================================================

Parser.prototype.parsePrimary = function (this: Parser): PrimaryNode {
  // Spread operator: *expr
  if (check(this.state, TOKEN_TYPES.STAR)) {
    return this.parseSpread();
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

  // Closure: |params| body or || body
  if (isClosureStart(this.state)) {
    return this.parseClosure();
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
    return this.parseMethodCall();
  }

  // Function call
  if (isHostCall(this.state)) {
    return this.parseHostCall();
  }

  // Common constructs
  const common = this.parseCommonConstruct();
  if (common) return common;

  throw new ParseError(
    `Unexpected token: ${current(this.state).value}`,
    current(this.state).span.start
  );
};

// ============================================================
// PIPE TARGET PARSING
// ============================================================

Parser.prototype.parsePipeTarget = function (this: Parser): PipeTargetNode {
  // Type operations: -> :type or -> :?type
  if (check(this.state, TOKEN_TYPES.COLON)) {
    return this.parseTypeOperation();
  }

  // Spread as pipe target: -> *
  if (check(this.state, TOKEN_TYPES.STAR)) {
    return this.parseSpreadTarget();
  }

  // Extraction operators
  if (check(this.state, TOKEN_TYPES.STAR_LT)) {
    return this.parseDestructure();
  }
  if (check(this.state, TOKEN_TYPES.SLASH_LT)) {
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

  // Method call
  if (check(this.state, TOKEN_TYPES.DOT)) {
    const methodCall = this.parseMethodCall();

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
          span: methodCall.span,
        },
        methods: [methodCall],
        span: methodCall.span,
      };
      return this.parseConditionalWithCondition(postfixExpr);
    }

    return methodCall;
  }

  // Closure call as pipe target
  if (isClosureCall(this.state)) {
    return this.parseClosureCall();
  }

  // Sequential spread: -> @$var or -> @[closures]
  if (isClosureChainTarget(this.state)) {
    return this.parseClosureChain();
  }

  // Pipe invoke: -> $() or -> $(args)
  if (canStartPipeInvoke(this.state)) {
    return this.parsePipeInvoke();
  }

  // String literal
  if (check(this.state, TOKEN_TYPES.STRING)) {
    return this.parseString();
  }

  // Function call with parens
  if (isHostCall(this.state)) {
    return this.parseHostCall();
  }

  // Bare function name: "-> greet" or "-> ns::func"
  if (check(this.state, TOKEN_TYPES.IDENTIFIER)) {
    const start = current(this.state).span.start;
    let name = advance(this.state).value;

    // Collect namespaced name: ident::ident::...
    while (check(this.state, TOKEN_TYPES.DOUBLE_COLON)) {
      advance(this.state); // consume ::
      const next = expect(
        this.state,
        TOKEN_TYPES.IDENTIFIER,
        'Expected identifier after ::'
      );
      name += '::' + next.value;
    }

    return {
      type: 'HostCall',
      name,
      args: [],
      span: makeSpan(start, current(this.state).span.end),
    };
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

  let typeName: CaptureNode['typeName'] = null;
  if (check(this.state, TOKEN_TYPES.COLON)) {
    advance(this.state);
    typeName = parseTypeName(this.state, VALID_TYPE_NAMES);
  }

  return {
    type: 'Capture',
    name: nameToken.value,
    typeName,
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
  expect(this.state, TOKEN_TYPES.RPAREN, 'Expected )');
  return {
    type: 'GroupedExpr',
    expression,
    span: makeSpan(start, current(this.state).span.end),
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
    span,
  };
};

Parser.prototype.wrapLoopInPostfixExpr = function (
  this: Parser,
  loop: ForLoopNode | DoWhileLoopNode,
  span: SourceSpan
): PostfixExprNode {
  return {
    type: 'PostfixExpr',
    primary: loop,
    methods: [],
    span,
  };
};

Parser.prototype.parseLogicalOr = function (this: Parser): ArithHead {
  const start = current(this.state).span.start;
  let left = this.parseLogicalAnd();

  while (check(this.state, TOKEN_TYPES.OR)) {
    advance(this.state);
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
