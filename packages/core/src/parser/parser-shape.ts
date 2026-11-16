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
import {
  advance,
  check,
  expect,
  current,
  makeSpan,
  peek,
  previous,
  type ParserState,
} from './state.js';
import {
  parseFieldArgList,
  atOuterType,
  parseOuterType,
  parseUnionMembers,
} from './parser-types.js';
import { ERROR_IDS } from '../error-registry.js';

// Declaration merging to add methods to Parser interface
declare module './parser.js' {
  interface Parser {
    parseTypeConstructor(constructorName: string): TypeConstructorNode;
  }
}

// ============================================================
// TYPE CONSTRUCTOR PARSING
// ============================================================

type TypeConstructorName = TypeConstructorNode['constructorName'];

/** Canonical list of type-constructor identifiers recognized by the parser. */
const TYPE_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set<string>([
  'list',
  'dict',
  'tuple',
  'ordered',
  'stream',
  'union',
]);

function isTypeConstructorName(name: string): name is TypeConstructorName {
  return TYPE_CONSTRUCTOR_NAMES.has(name);
}

/**
 * True when the cursor starts a type constructor in expression position:
 * a constructor name followed by `(`, or a bare constructor name followed by
 * an outer type (`stream:number`). A bare `union` is left to the bare-union
 * error.
 * @internal
 */
export function atTypeConstructor(state: ParserState): boolean {
  const tok = current(state);
  if (tok.type !== TOKEN_TYPES.IDENTIFIER) return false;
  if (!isTypeConstructorName(tok.value)) return false;
  if (peek(state, 1).type === TOKEN_TYPES.LPAREN) return true;
  return tok.value !== 'union' && atOuterType(state, 1);
}

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
  if (!isTypeConstructorName(constructorName)) {
    throw new ParseError(
      ERROR_IDS.RILL_P001,
      `Expected type constructor name (list, dict, tuple, ordered, stream, union), got: ${constructorName}`,
      current(this.state).span.start
    );
  }

  const start = current(this.state).span.start;

  // Consume the constructor name identifier token
  advance(this.state);

  // A bare constructor name with an outer: stream:R is stream(any):R, and
  // any other constructor rejects the outer.
  if (!check(this.state, TOKEN_TYPES.LPAREN)) {
    const bareArgs: FieldArg[] = [];
    parseOuterType(this.state, constructorName, bareArgs);
    return {
      type: 'TypeConstructor',
      constructorName,
      args: bareArgs,
      span: makeSpan(start, previous(this.state).span.end),
    };
  }
  expect(this.state, TOKEN_TYPES.LPAREN, 'Expected (');

  const parseLiteral = () => this.parseLiteral();
  const opts: {
    parseLiteral: () => LiteralNode;
    parseAnnotations?: () => AnnotationArg[];
  } = { parseLiteral };
  if (constructorName !== 'list' && constructorName !== 'union') {
    opts.parseAnnotations = () => this.parseAnnotationArgs();
  }
  const args: FieldArg[] =
    constructorName === 'union'
      ? parseUnionMembers(this.state, opts).map((value) => ({ value }))
      : parseFieldArgList(this.state, opts);

  const rparen = expect(
    this.state,
    TOKEN_TYPES.RPAREN,
    'Expected )',
    ERROR_IDS.RILL_P005
  );

  // An outer type after the parentheses: stream(T):R keeps it, any other
  // constructor rejects it. A `:$t` assertion is not an outer.
  if (parseOuterType(this.state, constructorName, args, opts)) {
    return {
      type: 'TypeConstructor',
      constructorName,
      args,
      span: makeSpan(start, previous(this.state).span.end),
    };
  }

  return {
    type: 'TypeConstructor',
    constructorName: constructorName,
    args,
    span: makeSpan(start, rparen.span.end),
  };
};
