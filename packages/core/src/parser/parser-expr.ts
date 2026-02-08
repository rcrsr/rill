/**
 * Parser Extension: Expression Parsing
 * Expressions, precedence chain, pipe chains, and pipe targets
 */

import { Parser } from './parser.js';
import type {
  ArithHead,
  BinaryOp,
  BlockNode,
  BodyNode,
  CaptureNode,
  ChainTerminator,
  ConditionalNode,
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
  SourceLocation,
  SourceSpan,
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
  isMethodCall,
  isClosureChainTarget,
  isNegativeNumber,
  isLiteralStart,
  isClosureStart,
  makeBoolLiteralBlock,
  parseBareHostCall,
  isDictStart,
  VALID_TYPE_NAMES,
  parseTypeName,
} from './helpers.js';

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
    // Detect deprecated :> syntax (COLON followed by GT)
    if (check(this.state, TOKEN_TYPES.COLON)) {
      const nextToken = peek(this.state, 1);
      if (nextToken.type === TOKEN_TYPES.GT) {
        throw new ParseError(
          'RILL-P006',
          'The capture arrow syntax changed from :> to =>',
          current(this.state).span.start
        );
      }
    }

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

      // Detect deprecated :> after newlines
      if (nextToken.type === TOKEN_TYPES.COLON) {
        const tokenAfterColon = peek(this.state, lookahead + 1);
        if (tokenAfterColon.type === TOKEN_TYPES.GT) {
          // Skip newlines to reach the colon for accurate error location
          while (check(this.state, TOKEN_TYPES.NEWLINE)) advance(this.state);
          throw new ParseError(
            'RILL-P006',
            'The capture arrow syntax changed from :> to =>',
            current(this.state).span.start
          );
        }
      }

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
  if (check(this.state, TOKEN_TYPES.COLON)) {
    // Detect deprecated :> syntax before type operation
    const nextToken = peek(this.state, 1);
    if (nextToken.type === TOKEN_TYPES.GT) {
      throw new ParseError(
        'RILL-P006',
        'The capture arrow syntax changed from :> to =>',
        current(this.state).span.start
      );
    }
    primary = this.parsePostfixTypeOperation(primary, start);
  }

  const methods: (MethodCallNode | InvokeNode)[] = [];

  // Track the end of the receiver for method calls
  let receiverEnd = primary.span.end;

  // Check if primary is a conditional with terminator - if so, stop parsing
  // This prevents ($ == 2) ? break\n($ == 5) from being parsed as invocation
  const hasTerminator =
    primary.type === 'Conditional' &&
    primary.thenBranch?.type === 'PipeChain' &&
    primary.thenBranch.terminator !== null;

  while (
    !hasTerminator &&
    (isMethodCall(this.state) || check(this.state, TOKEN_TYPES.LPAREN))
  ) {
    if (isMethodCall(this.state)) {
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

  const args: ExpressionNode[] = [];
  if (!check(this.state, TOKEN_TYPES.RPAREN)) {
    args.push(this.parsePipeChain());
    while (check(this.state, TOKEN_TYPES.COMMA)) {
      advance(this.state);
      args.push(this.parsePipeChain());
    }
  }

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

// ============================================================
// PRIMARY PARSING
// ============================================================

Parser.prototype.parsePrimary = function (this: Parser): PrimaryNode {
  // Pass keyword: pass
  if (check(this.state, TOKEN_TYPES.PASS)) {
    const token = advance(this.state);
    return {
      type: 'Pass',
      span: token.span,
    };
  }

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
    return this.parseMethodCall(null);
  }

  // Function call with parens
  if (isHostCall(this.state)) {
    return this.parseHostCall();
  }

  // Bare function name: "greet" or "ns::func" (no parens)
  if (check(this.state, TOKEN_TYPES.IDENTIFIER)) {
    return parseBareHostCall(this.state);
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

  // Inline closure: -> |x| { body }
  if (isClosureStart(this.state)) {
    return this.parseClosure();
  }

  // Method call (possibly chained: .a.b.c)
  if (check(this.state, TOKEN_TYPES.DOT)) {
    const methods: MethodCallNode[] = [];
    const start = current(this.state).span.start;

    // Collect all chained method calls
    while (check(this.state, TOKEN_TYPES.DOT)) {
      methods.push(this.parseMethodCall(null));
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

  // Sequential spread: -> @$var or -> @[closures]
  if (isClosureChainTarget(this.state)) {
    return this.parseClosureChain();
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

  // Dict or list literal for dispatch
  if (check(this.state, TOKEN_TYPES.LBRACKET)) {
    const start = current(this.state).span.start;
    advance(this.state); // consume [
    skipNewlines(this.state);

    // Handle empty brackets: [] or [:]
    if (check(this.state, TOKEN_TYPES.RBRACKET)) {
      advance(this.state); // consume ]

      // Check for ?? default value
      let defaultValue = null;
      if (check(this.state, TOKEN_TYPES.NULLISH_COALESCE)) {
        advance(this.state);
        defaultValue = this.parseDefaultValue();
      }

      // Empty brackets [] = empty tuple
      return {
        type: 'Tuple',
        elements: [],
        defaultValue,
        span: makeSpan(start, current(this.state).span.end),
      };
    }

    // Handle empty dict: [:]
    if (
      check(this.state, TOKEN_TYPES.COLON) &&
      this.state.tokens[this.state.pos + 1]?.type === TOKEN_TYPES.RBRACKET
    ) {
      advance(this.state); // consume :
      advance(this.state); // consume ]

      // Check for ?? default value
      let defaultValue = null;
      if (check(this.state, TOKEN_TYPES.NULLISH_COALESCE)) {
        advance(this.state);
        defaultValue = this.parseDefaultValue();
      }

      return {
        type: 'Dict',
        entries: [],
        defaultValue,
        span: makeSpan(start, current(this.state).span.end),
      };
    }

    // Distinguish dict from tuple using isDictStart helper
    if (isDictStart(this.state)) {
      const dict = this.parseDict(start);

      // Check for ?? default value after dict
      if (check(this.state, TOKEN_TYPES.NULLISH_COALESCE)) {
        advance(this.state);
        const defaultValue = this.parseDefaultValue();

        return {
          ...dict,
          defaultValue,
        };
      }

      return dict;
    } else {
      // Parse as tuple (list literal)
      const tuple = this.parseTuple(start);

      // Check for ?? default value after tuple
      if (check(this.state, TOKEN_TYPES.NULLISH_COALESCE)) {
        advance(this.state);
        const defaultValue = this.parseDefaultValue();

        return {
          ...tuple,
          defaultValue,
        };
      }

      return tuple;
    }
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
