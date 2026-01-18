/**
 * Parser Extension: Collection Operator Parsing
 * each, map, fold, filter
 */

import { Parser } from './parser.js';
import type {
  EachExprNode,
  FilterExprNode,
  FoldExprNode,
  IteratorBody,
  MapExprNode,
} from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import { check, expect, current, makeSpan, peek } from './state.js';
import { isClosureStart } from './helpers.js';

// Declaration merging to add methods to Parser interface
declare module './parser.js' {
  interface Parser {
    parseIteratorBody(): IteratorBody;
    hasAccumulatorPrefix(): boolean;
    parseEachExpr(): EachExprNode;
    parseMapExpr(): MapExprNode;
    parseFoldExpr(): FoldExprNode;
    parseFilterExpr(): FilterExprNode;
  }
}

// ============================================================
// COLLECTION OPERATOR BODY
// ============================================================

Parser.prototype.parseIteratorBody = function (this: Parser): IteratorBody {
  if (isClosureStart(this.state)) {
    return this.parseClosure();
  }

  if (check(this.state, TOKEN_TYPES.LBRACE)) {
    return this.parseBlock();
  }

  if (check(this.state, TOKEN_TYPES.LPAREN)) {
    return this.parseGrouped();
  }

  if (
    check(this.state, TOKEN_TYPES.DOLLAR) ||
    check(this.state, TOKEN_TYPES.PIPE_VAR)
  ) {
    return this.parseVariable();
  }

  if (check(this.state, TOKEN_TYPES.STAR)) {
    return this.parseSpread();
  }

  throw new ParseError(
    `Expected collection body (closure, block, grouped, variable, or spread), got: ${current(this.state).value}`,
    current(this.state).span.start
  );
};

Parser.prototype.hasAccumulatorPrefix = function (this: Parser): boolean {
  if (!check(this.state, TOKEN_TYPES.LPAREN)) {
    return false;
  }

  let depth = 1;
  let i = 1;
  while (depth > 0) {
    const token = peek(this.state, i);
    if (!token) return false;
    if (token.type === TOKEN_TYPES.LPAREN) depth++;
    else if (token.type === TOKEN_TYPES.RPAREN) depth--;
    i++;
  }

  const afterParen = peek(this.state, i);
  if (!afterParen) return false;

  return (
    afterParen.type === TOKEN_TYPES.LBRACE ||
    afterParen.type === TOKEN_TYPES.PIPE_BAR ||
    afterParen.type === TOKEN_TYPES.OR ||
    afterParen.type === TOKEN_TYPES.LPAREN
  );
};

// ============================================================
// EACH
// ============================================================

Parser.prototype.parseEachExpr = function (this: Parser): EachExprNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.EACH, 'Expected each');

  let accumulator: EachExprNode['accumulator'] = null;

  if (this.hasAccumulatorPrefix()) {
    accumulator = this.parseGrouped().expression;
  }

  const body = this.parseIteratorBody();

  return {
    type: 'EachExpr',
    body,
    accumulator,
    span: makeSpan(start, current(this.state).span.end),
  };
};

// ============================================================
// MAP
// ============================================================

Parser.prototype.parseMapExpr = function (this: Parser): MapExprNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.MAP, 'Expected map');

  const body = this.parseIteratorBody();

  return {
    type: 'MapExpr',
    body,
    span: makeSpan(start, current(this.state).span.end),
  };
};

// ============================================================
// FOLD
// ============================================================

Parser.prototype.parseFoldExpr = function (this: Parser): FoldExprNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.FOLD, 'Expected fold');

  let accumulator: FoldExprNode['accumulator'] = null;

  if (this.hasAccumulatorPrefix()) {
    accumulator = this.parseGrouped().expression;
  }

  const body = this.parseIteratorBody();

  return {
    type: 'FoldExpr',
    body,
    accumulator,
    span: makeSpan(start, current(this.state).span.end),
  };
};

// ============================================================
// FILTER
// ============================================================

Parser.prototype.parseFilterExpr = function (this: Parser): FilterExprNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.FILTER, 'Expected filter');

  const body = this.parseIteratorBody();

  return {
    type: 'FilterExpr',
    body,
    span: makeSpan(start, current(this.state).span.end),
  };
};
