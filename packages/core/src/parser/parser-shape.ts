/**
 * Parser Extension: Type Constructor Parsing
 * type-constructor = ("list" | "dict" | "tuple" | "ordered") "(" [type-arg-list] ")" ;
 * type-arg-list    = field-arg ("," field-arg)* [","] ;
 * field-arg        = identifier ":" type-ref | type-ref ;
 */

import { Parser } from './parser.js';
import type {
  TypeConstructorNode,
  FieldArg,
  LiteralNode,
  AnnotationArg,
} from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import { advance, expect, current, makeSpan } from './state.js';
import { parseFieldArgList } from './parser-types.js';

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
  const validNames = ['list', 'dict', 'tuple', 'ordered', 'stream'] as const;
  if (!validNames.includes(constructorName as (typeof validNames)[number])) {
    throw new ParseError(
      'RILL-P001',
      `Expected type constructor name (list, dict, tuple, ordered, stream), got: ${constructorName}`,
      current(this.state).span.start
    );
  }

  const start = current(this.state).span.start;

  // Consume the constructor name identifier token
  advance(this.state);
  expect(this.state, TOKEN_TYPES.LPAREN, 'Expected (');

  const parseLiteral = () => this.parseLiteral();
  const opts: {
    parseLiteral: () => LiteralNode;
    parseAnnotations?: () => AnnotationArg[];
  } = { parseLiteral };
  if (constructorName !== 'list') {
    opts.parseAnnotations = () => this.parseAnnotationArgs();
  }
  const args: FieldArg[] = parseFieldArgList(this.state, opts);

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
