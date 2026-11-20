/**
 * Parser Extension: Declarations
 * A written type followed on the same line by the literal it describes
 * (`atom #wired`, `list(number) list[1, 2]`, `string() "a"`).
 */

import { Parser } from './parser.js';
import type {
  DeclarationNode,
  DeclarationValueNode,
  TypeNameExprNode,
} from '../types.js';
import { ParseError, TOKEN_TYPES, isRillTypeName } from '../types.js';
import { advance, check, current, makeSpan, peek, previous } from './state.js';
import { isDeclarationValueStart } from './helpers.js';
import { ERROR_IDS } from '../error-registry.js';

type DeclarationTypeExpr = DeclarationNode['typeExpr'];

// Declaration merging to add methods to Parser interface
declare module './parser.js' {
  interface Parser {
    parseDeclarationTail<T extends DeclarationTypeExpr>(
      typeExpr: T
    ): T | DeclarationNode;
    parseLeafCallDeclaration(): DeclarationNode | null;
  }
}

/** Constructors after which a plain `[` opens that collection's literal. */
const BRACKET_LITERAL_CONSTRUCTORS = ['list', 'dict', 'tuple', 'ordered'];

/** Type names whose `name()` form is not an empty-paren leaf type. */
const NON_LEAF_TYPE_NAMES = [
  'list',
  'dict',
  'tuple',
  'ordered',
  'stream',
  'union',
  'fn',
  'datetime',
  'duration',
];

/**
 * Parse the literal that follows a written type, after the literal's opener
 * (a keyword opener, or a plain `[` when `bracketKind` names the collection).
 */
function parseDeclarationValue(
  parser: Parser,
  bracketKind?: string
): DeclarationValueNode {
  const start = current(parser.state).span.start;
  const type = current(parser.state).type;
  if (type === TOKEN_TYPES.LBRACKET) {
    advance(parser.state); // consume [
    switch (bracketKind) {
      case 'dict':
        return parser.parseKeywordCollectionBody(start);
      case 'tuple':
        return parser.parseCollectionLiteral('tuple');
      case 'ordered':
        return parser.parseCollectionLiteral('ordered');
      default:
        return parser.parseCollectionLiteral('list');
    }
  }
  if (type === TOKEN_TYPES.DICT_LBRACKET) {
    advance(parser.state); // consume dict[
    return parser.parseKeywordCollectionBody(start);
  }
  const literal = parser.parseLiteral();
  switch (literal.type) {
    case 'StringLiteral':
    case 'NumberLiteral':
    case 'BoolLiteral':
    case 'AtomLiteral':
    case 'ListLiteral':
    case 'TupleLiteral':
    case 'OrderedLiteral':
      return literal;
    default:
      throw new ParseError(
        ERROR_IDS.RILL_P001,
        `Unexpected ${literal.type} after a written type`,
        start
      );
  }
}

// An ungrouped written type followed by a same-line literal, atom, or
// negative number becomes a Declaration; otherwise the type is returned as is.
Parser.prototype.parseDeclarationTail = function <
  T extends DeclarationTypeExpr,
>(this: Parser, typeExpr: T): T | DeclarationNode {
  const bracketKind =
    typeExpr.type === 'TypeConstructor' &&
    BRACKET_LITERAL_CONSTRUCTORS.includes(typeExpr.constructorName)
      ? typeExpr.constructorName
      : undefined;
  if (!isDeclarationValueStart(this.state, bracketKind !== undefined)) {
    return typeExpr;
  }
  const value = parseDeclarationValue(this, bracketKind);
  return {
    type: 'Declaration',
    typeExpr,
    value,
    span: makeSpan(typeExpr.span.start, previous(this.state).span.end),
  };
};

// Lookahead form `leaf-type ( ) literal-on-same-line`: consumes it into a
// Declaration over a TypeNameExpr, or returns null with nothing consumed.
Parser.prototype.parseLeafCallDeclaration = function (
  this: Parser
): DeclarationNode | null {
  const name = current(this.state).value;
  if (
    !check(this.state, TOKEN_TYPES.IDENTIFIER) ||
    !isRillTypeName(name) ||
    NON_LEAF_TYPE_NAMES.includes(name) ||
    peek(this.state, 1).type !== TOKEN_TYPES.LPAREN ||
    peek(this.state, 2).type !== TOKEN_TYPES.RPAREN
  ) {
    return null;
  }
  const saved = this.state.pos;
  const nameToken = advance(this.state);
  advance(this.state); // consume (
  const rparen = advance(this.state); // consume )
  if (!isDeclarationValueStart(this.state, false)) {
    this.state.pos = saved;
    return null;
  }
  const typeExpr: TypeNameExprNode = {
    type: 'TypeNameExpr',
    typeName: name,
    span: makeSpan(nameToken.span.start, rparen.span.end),
  };
  const value = parseDeclarationValue(this);
  return {
    type: 'Declaration',
    typeExpr,
    value,
    span: makeSpan(typeExpr.span.start, previous(this.state).span.end),
  };
};
