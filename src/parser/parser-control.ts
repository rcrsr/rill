/**
 * Parser Extension: Control Flow Parsing
 * Conditionals, loops, and blocks
 */

import { Parser } from './parser.js';
import type {
  AnnotatedStatementNode,
  BlockNode,
  ConditionalNode,
  DoWhileLoopNode,
  ExpressionNode,
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
    throw new ParseError('Empty blocks are not allowed', start);
  }

  expect(this.state, TOKEN_TYPES.RBRACE, 'Expected }');

  return {
    type: 'Block',
    statements,
    span: makeSpan(start, current(this.state).span.end),
  };
};
