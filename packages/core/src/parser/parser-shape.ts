/**
 * Parser Extension: Type Constructor Parsing
 * type-constructor = ("list" | "dict" | "tuple" | "ordered") "(" [type-arg-list] ")" ;
 * type-arg-list    = type-arg ("," type-arg)* [","] ;
 * type-arg         = identifier ":" expression | expression ;
 */

import { Parser } from './parser.js';
import type {
  ExpressionNode,
  TypeConstructorNode,
  TypeConstructorArg,
} from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import {
  check,
  advance,
  expect,
  current,
  skipNewlines,
  makeSpan,
  peek,
} from './state.js';

// Declaration merging to add methods to Parser interface
declare module './parser.js' {
  interface Parser {
    parseTypeConstructor(constructorName: string): TypeConstructorNode;
  }
}

// ============================================================
// TYPE CONSTRUCTOR PARSING
// ============================================================

/**
 * Parse a type constructor: list(args), dict(k: T, ...), tuple(T...), ordered(k: T, ...).
 * Called when current identifier is in ['list', 'dict', 'tuple', 'ordered'] and next token is LPAREN.
 * Consumes: constructorName "(" [type-arg-list] ")"
 * Produces TypeConstructorNode.
 */
Parser.prototype.parseTypeConstructor = function (
  this: Parser,
  constructorName: string
): TypeConstructorNode {
  const validNames = ['list', 'dict', 'tuple', 'ordered'] as const;
  if (!validNames.includes(constructorName as (typeof validNames)[number])) {
    throw new ParseError(
      'RILL-P001',
      `Expected type constructor name (list, dict, tuple, ordered), got: ${constructorName}`,
      current(this.state).span.start
    );
  }

  const start = current(this.state).span.start;

  // Consume the constructor name identifier token
  advance(this.state);
  expect(this.state, TOKEN_TYPES.LPAREN, 'Expected (');
  skipNewlines(this.state);

  const args: TypeConstructorArg[] = [];

  if (!check(this.state, TOKEN_TYPES.RPAREN)) {
    args.push(parseTypeArg(this));
    skipNewlines(this.state);

    while (check(this.state, TOKEN_TYPES.COMMA)) {
      advance(this.state);
      skipNewlines(this.state);
      if (check(this.state, TOKEN_TYPES.RPAREN)) break; // trailing comma
      args.push(parseTypeArg(this));
      skipNewlines(this.state);
    }
  }

  const rparen = expect(
    this.state,
    TOKEN_TYPES.RPAREN,
    'Expected )',
    'RILL-P005'
  );

  return {
    type: 'TypeConstructor',
    constructorName: constructorName as TypeConstructorNode['constructorName'],
    args,
    span: makeSpan(start, rparen.span.end),
  };
};

// ============================================================
// TYPE ARG PARSING (internal)
// ============================================================

/**
 * Parse a single type argument: `identifier ":" expression` (named) or `expression` (positional).
 * Lookahead: if current is IDENTIFIER and next is COLON, parse as named arg.
 * Otherwise parse as positional.
 */
function parseTypeArg(parser: Parser): TypeConstructorArg {
  // Named arg: identifier ":" expression
  if (
    check(parser.state, TOKEN_TYPES.IDENTIFIER) &&
    peek(parser.state, 1).type === TOKEN_TYPES.COLON
  ) {
    const nameToken = advance(parser.state); // consume identifier
    advance(parser.state); // consume ':'
    skipNewlines(parser.state);
    const value: ExpressionNode = parser.parseExpression();
    return { kind: 'named', name: nameToken.value, value };
  }

  // Positional arg: expression
  const value: ExpressionNode = parser.parseExpression();
  return { kind: 'positional', value };
}
