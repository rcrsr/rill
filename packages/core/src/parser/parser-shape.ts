/**
 * Parser Extension: Shape Literal Parsing
 * shape(...) literals with fields, nested shapes, groups, and spreads
 */

import { Parser } from './parser.js';
import type {
  AnnotationArg,
  ExpressionNode,
  RillTypeName,
  ShapeFieldNode,
  ShapeLiteralNode,
  SourceLocation,
} from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import {
  check,
  advance,
  expect,
  current,
  skipNewlines,
  makeSpan,
} from './state.js';
import { VALID_TYPE_NAMES } from './helpers.js';

// Declaration merging to add methods to Parser interface
declare module './parser.js' {
  interface Parser {
    parseShapeLiteral(): ShapeLiteralNode;
    parseShapeField(): ShapeFieldNode;
    parseShapeType(): RillTypeName | ShapeLiteralNode;
    parseShapeGroup(start: SourceLocation): ShapeLiteralNode;
  }
}

// ============================================================
// SHAPE LITERAL PARSING
// ============================================================

/**
 * Parse shape(...) literal.
 * Called when current token is identifier "shape" and next token is "(".
 * Produces ShapeLiteralNode.
 */
Parser.prototype.parseShapeLiteral = function (this: Parser): ShapeLiteralNode {
  const start = current(this.state).span.start;

  // Consume the "shape" identifier token
  advance(this.state);
  expect(this.state, TOKEN_TYPES.LPAREN, 'Expected (');
  skipNewlines(this.state);

  const fields: ShapeFieldNode[] = [];
  const spreads: ExpressionNode[] = [];

  if (!check(this.state, TOKEN_TYPES.RPAREN)) {
    // Parse first field or spread
    if (check(this.state, TOKEN_TYPES.ELLIPSIS)) {
      advance(this.state); // consume ...
      spreads.push(this.parseExpression());
    } else {
      fields.push(this.parseShapeField());
    }

    skipNewlines(this.state);

    while (check(this.state, TOKEN_TYPES.COMMA)) {
      advance(this.state);
      skipNewlines(this.state);
      if (check(this.state, TOKEN_TYPES.RPAREN)) break; // trailing comma
      if (check(this.state, TOKEN_TYPES.ELLIPSIS)) {
        advance(this.state); // consume ...
        spreads.push(this.parseExpression());
      } else {
        fields.push(this.parseShapeField());
      }
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
    type: 'ShapeLiteral',
    fields,
    spreads,
    span: makeSpan(start, rparen.span.end),
  };
};

// ============================================================
// SHAPE FIELD PARSING
// ============================================================

/**
 * Parse a single shape field: [^(annotations)] identifier : shape-type
 * Produces ShapeFieldNode.
 */
Parser.prototype.parseShapeField = function (this: Parser): ShapeFieldNode {
  const start = current(this.state).span.start;

  let annotations: AnnotationArg[] | undefined = undefined;

  // Parse optional field annotations: ^(annots) identifier : type
  if (check(this.state, TOKEN_TYPES.CARET)) {
    advance(this.state); // consume ^
    expect(this.state, TOKEN_TYPES.LPAREN, 'Expected ( after ^');
    annotations = this.parseAnnotationArgs();
    expect(this.state, TOKEN_TYPES.RPAREN, 'Expected )', 'RILL-P005');
  }

  const nameToken = expect(
    this.state,
    TOKEN_TYPES.IDENTIFIER,
    'Expected field name'
  );

  expect(this.state, TOKEN_TYPES.COLON, 'Expected :');

  const fieldType = this.parseShapeType();

  // Optional marker: name: type? — the ? follows the type, not the field name.
  // parseShapeType does NOT consume the ? so it lands here for parseShapeField.
  const optional = check(this.state, TOKEN_TYPES.QUESTION);
  if (optional) {
    advance(this.state); // consume ?
  }

  return {
    type: 'ShapeField',
    name: nameToken.value,
    fieldType,
    optional,
    annotations,
    span: makeSpan(start, current(this.state).span.end),
  };
};

// ============================================================
// SHAPE TYPE PARSING
// ============================================================

/**
 * Parse a shape type (the right-hand side of a field declaration).
 * Handles: type-name | shape-literal | shape-group
 * Does NOT consume the optional ? — that is handled by parseShapeField.
 */
Parser.prototype.parseShapeType = function (
  this: Parser
): RillTypeName | ShapeLiteralNode {
  // Nested shape literal: shape(...)
  if (
    check(this.state, TOKEN_TYPES.IDENTIFIER) &&
    current(this.state).value === 'shape' &&
    this.state.tokens[this.state.pos + 1]?.type === TOKEN_TYPES.LPAREN
  ) {
    return this.parseShapeLiteral();
  }

  // Shape group shorthand: (field, ...)  → desugars to ShapeLiteralNode
  if (check(this.state, TOKEN_TYPES.LPAREN)) {
    const start = current(this.state).span.start;
    return this.parseShapeGroup(start);
  }

  // Plain type name: string, number, bool, etc.
  const typeToken = expect(
    this.state,
    TOKEN_TYPES.IDENTIFIER,
    'Expected type name'
  );

  if (!VALID_TYPE_NAMES.includes(typeToken.value as RillTypeName)) {
    throw new ParseError(
      'RILL-P003',
      `Invalid type: ${typeToken.value} (expected: ${VALID_TYPE_NAMES.join(', ')})`,
      typeToken.span.start
    );
  }

  return typeToken.value as RillTypeName;
};

// ============================================================
// SHAPE GROUP PARSING
// ============================================================

/**
 * Parse a shape group shorthand: (field, field, ...)
 * Desugars to ShapeLiteralNode at parse time.
 * Called when current token is LPAREN inside a shape type position.
 */
Parser.prototype.parseShapeGroup = function (
  this: Parser,
  start: SourceLocation
): ShapeLiteralNode {
  expect(this.state, TOKEN_TYPES.LPAREN, 'Expected (');
  skipNewlines(this.state);

  const fields: ShapeFieldNode[] = [];

  // Shape group must have at least one field (per spec grammar)
  fields.push(this.parseShapeField());
  skipNewlines(this.state);

  while (check(this.state, TOKEN_TYPES.COMMA)) {
    advance(this.state);
    skipNewlines(this.state);
    if (check(this.state, TOKEN_TYPES.RPAREN)) break; // trailing comma
    fields.push(this.parseShapeField());
    skipNewlines(this.state);
  }

  const rparen = expect(
    this.state,
    TOKEN_TYPES.RPAREN,
    'Expected )',
    'RILL-P005'
  );

  return {
    type: 'ShapeLiteral',
    fields,
    spreads: [],
    span: makeSpan(start, rparen.span.end),
  };
};
