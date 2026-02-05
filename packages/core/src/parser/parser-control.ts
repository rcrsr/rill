/**
 * Parser Extension: Control Flow Parsing
 * Conditionals, loops, and blocks
 */

import { Parser } from './parser.js';
import type {
  AnnotatedStatementNode,
  AssertNode,
  BlockNode,
  ConditionalNode,
  DoWhileLoopNode,
  ErrorNode,
  ExpressionNode,
  StringLiteralNode,
  WhileLoopNode,
  BodyNode,
  StatementNode,
} from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import {
  check,
  advance,
  expect,
  current,
  isAtEnd,
  skipNewlines,
  makeSpan,
} from './state.js';

// Declaration merging to add methods to Parser interface
declare module './parser.js' {
  interface Parser {
    parsePipedConditional(): ConditionalNode;
    parseConditionalWithCondition(conditionBody: BodyNode): ConditionalNode;
    parseConditionalRest(
      condition: BodyNode | null,
      start: { line: number; column: number; offset: number }
    ): ConditionalNode;
    parseLoop(
      condition: ExpressionNode | null
    ): WhileLoopNode | DoWhileLoopNode;
    parseLoopWithInput(condition: BodyNode): WhileLoopNode | DoWhileLoopNode;
    parseBlock(): BlockNode;
    parseAssert(): AssertNode;
    parseError(requireMessage?: boolean): ErrorNode;
  }
}

// ============================================================
// CONDITIONALS
// ============================================================

Parser.prototype.parsePipedConditional = function (
  this: Parser
): ConditionalNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.QUESTION, 'Expected ?');

  return this.parseConditionalRest(null, start);
};

Parser.prototype.parseConditionalWithCondition = function (
  this: Parser,
  conditionBody: BodyNode
): ConditionalNode {
  const start = conditionBody.span.start;
  expect(this.state, TOKEN_TYPES.QUESTION, 'Expected ?');

  return this.parseConditionalRest(conditionBody, start);
};

Parser.prototype.parseConditionalRest = function (
  this: Parser,
  condition: BodyNode | null,
  start: { line: number; column: number; offset: number }
): ConditionalNode {
  const thenBranch = this.parseBody();

  let elseBranch: BodyNode | ConditionalNode | null = null;
  if (check(this.state, TOKEN_TYPES.BANG)) {
    advance(this.state);

    const elseBody = this.parseBody();

    if (check(this.state, TOKEN_TYPES.QUESTION)) {
      elseBranch = this.parseConditionalWithCondition(elseBody);
    } else {
      elseBranch = elseBody;
    }
  }

  return {
    type: 'Conditional',
    input: null,
    condition,
    thenBranch,
    elseBranch,
    span: makeSpan(start, current(this.state).span.end),
  };
};

// ============================================================
// LOOPS
// ============================================================

Parser.prototype.parseLoop = function (
  this: Parser,
  condition: ExpressionNode | null
): WhileLoopNode | DoWhileLoopNode {
  const start = condition
    ? condition.span.start
    : current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.AT, 'Expected @');

  const body = this.parseBody();

  // Check for do-while: @ body ? cond
  if (check(this.state, TOKEN_TYPES.QUESTION)) {
    advance(this.state);
    const doWhileCondition = this.parseBody();

    return {
      type: 'DoWhileLoop',
      input: condition,
      body,
      condition: doWhileCondition,
      span: makeSpan(start, current(this.state).span.end),
    };
  }

  // While loop: cond @ body - condition is required
  if (!condition) {
    throw new ParseError(
      'RILL-P004',
      "Bare '@' requires trailing condition: @ body ? cond (do-while)",
      start
    );
  }

  return {
    type: 'WhileLoop',
    condition,
    body,
    span: makeSpan(start, current(this.state).span.end),
  };
};

Parser.prototype.parseLoopWithInput = function (
  this: Parser,
  condition: BodyNode
): WhileLoopNode | DoWhileLoopNode {
  let conditionExpr: ExpressionNode;
  if (condition.type === 'PipeChain') {
    conditionExpr = condition;
  } else {
    conditionExpr = {
      type: 'PipeChain',
      head:
        condition.type === 'PostfixExpr'
          ? condition
          : {
              type: 'PostfixExpr',
              primary: condition,
              methods: [],
              defaultValue: null,
              span: condition.span,
            },
      pipes: [],
      terminator: null,
      span: condition.span,
    };
  }

  return this.parseLoop(conditionExpr);
};

// ============================================================
// BLOCKS
// ============================================================

Parser.prototype.parseBlock = function (this: Parser): BlockNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.LBRACE, 'Expected {');
  skipNewlines(this.state);

  const statements: (StatementNode | AnnotatedStatementNode)[] = [];
  while (!check(this.state, TOKEN_TYPES.RBRACE) && !isAtEnd(this.state)) {
    statements.push(this.parseStatement());
    skipNewlines(this.state);
  }

  if (statements.length === 0) {
    throw new ParseError('RILL-P004', 'Empty blocks are not allowed', start);
  }

  const rbrace = expect(this.state, TOKEN_TYPES.RBRACE, 'Expected }');

  return {
    type: 'Block',
    statements,
    span: makeSpan(start, rbrace.span.end),
  };
};

// ============================================================
// ASSERT
// ============================================================

Parser.prototype.parseAssert = function (this: Parser): AssertNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.ASSERT, 'Expected assert');

  // Parse condition as a body (block, grouped expr, or pipe chain)
  // For grouped expressions, this stops at the closing paren
  // For other expressions, parse the full pipe chain
  let condition: ExpressionNode;
  if (
    check(this.state, TOKEN_TYPES.LPAREN) ||
    check(this.state, TOKEN_TYPES.LBRACE)
  ) {
    // For grouped expr or block, parseBody stops at the delimiter
    const body = this.parseBody();
    if (body.type === 'PipeChain') {
      condition = body;
    } else if (body.type === 'PostfixExpr') {
      // Already a PostfixExpr, wrap in PipeChain
      condition = {
        type: 'PipeChain',
        head: body,
        pipes: [],
        terminator: null,
        span: body.span,
      };
    } else {
      // Wrap Block/GroupedExpr in a PipeChain
      condition = {
        type: 'PipeChain',
        head: {
          type: 'PostfixExpr',
          primary: body,
          methods: [],
          defaultValue: null,
          span: body.span,
        },
        pipes: [],
        terminator: null,
        span: body.span,
      };
    }
  } else {
    // For non-delimited expressions, parse the full expression
    condition = this.parseExpression();
  }

  let message: StringLiteralNode | null = null;
  if (check(this.state, TOKEN_TYPES.STRING)) {
    message = this.parseString();
  }

  return {
    type: 'Assert',
    condition,
    message,
    span: makeSpan(start, current(this.state).span.end),
  };
};

// ============================================================
// ERROR
// ============================================================

Parser.prototype.parseError = function (
  this: Parser,
  requireMessage = false
): ErrorNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.ERROR, 'Expected error');

  // Message is optional when used as pipe target: "msg" -> error
  // Required when used as direct statement: error "msg"
  let message: StringLiteralNode | null = null;

  if (check(this.state, TOKEN_TYPES.STRING)) {
    // String literal provided - parse it
    message = this.parseString();
  } else {
    // No string literal after error keyword
    const atBoundary =
      isAtEnd(this.state) ||
      check(this.state, TOKEN_TYPES.NEWLINE) ||
      check(this.state, TOKEN_TYPES.RBRACE) ||
      check(this.state, TOKEN_TYPES.RPAREN);

    if (!atBoundary) {
      // Non-string, non-delimiter token after error - invalid token type
      throw new ParseError(
        'RILL-P004',
        'error statement requires string message',
        current(this.state).span.start
      );
    } else if (requireMessage) {
      // At boundary but message required (statement form, not pipe target)
      throw new ParseError(
        'RILL-P002',
        'Unexpected end of input, expected string',
        start
      );
    }
    // else: at statement boundary without message (valid pipe target form)
  }

  return {
    type: 'Error',
    message,
    span: makeSpan(start, current(this.state).span.end),
  };
};
