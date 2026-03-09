/**
 * Parser Extension: Use Expression Parsing
 * Parses use<> expressions for module/resource resolution.
 */

import { Parser } from './parser.js';
import type { UseExprNode, UseIdentifier, TypeRef } from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import { check, advance, expect, current, makeSpan } from './state.js';
import { parseTypeRef } from './parser-types.js';

// Declaration merging to add methods to Parser interface
declare module './parser.js' {
  interface Parser {
    parseUseExpr(): UseExprNode;
  }
}

// ============================================================
// USE EXPRESSION
// ============================================================

/**
 * Parse a use<> expression.
 * Consumes USE_LANGLE, identifier form, >, optional :typeRef.
 * Compound keyword: no whitespace between 'use' and '<'.
 */
Parser.prototype.parseUseExpr = function (this: Parser): UseExprNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.USE_LANGLE, 'Expected use<');

  let identifier: UseIdentifier;

  if (check(this.state, TOKEN_TYPES.DOLLAR)) {
    // Variable form: $varName
    advance(this.state); // consume $
    const nameToken = expect(
      this.state,
      TOKEN_TYPES.IDENTIFIER,
      'Expected variable name after $'
    );
    identifier = { kind: 'variable', name: nameToken.value };
  } else if (check(this.state, TOKEN_TYPES.LPAREN)) {
    // Computed form: (expression)
    advance(this.state); // consume (
    const expression = this.parseExpression();
    expect(
      this.state,
      TOKEN_TYPES.RPAREN,
      'Expected ) to close computed use<>'
    );
    identifier = { kind: 'computed', expression };
  } else {
    // Static form: scheme:seg1.seg2...
    // Lexer emits IDENTIFIER(scheme) COLON IDENTIFIER(seg1) [DOT IDENTIFIER(seg2)]*
    const schemeToken = expect(
      this.state,
      TOKEN_TYPES.IDENTIFIER,
      'Expected identifier in use<>'
    );
    const scheme = schemeToken.value;

    if (!check(this.state, TOKEN_TYPES.COLON)) {
      throw new ParseError(
        'RILL-P020',
        "Expected ':' after scheme in use<>",
        current(this.state).span.start
      );
    }
    advance(this.state); // consume COLON

    if (!check(this.state, TOKEN_TYPES.IDENTIFIER)) {
      throw new ParseError(
        'RILL-P021',
        "Expected resource identifier after ':' in use<>",
        current(this.state).span.start
      );
    }
    const firstSegToken = advance(this.state);
    const segments: string[] = [firstSegToken.value];

    while (check(this.state, TOKEN_TYPES.DOT)) {
      advance(this.state); // consume DOT
      const segToken = expect(
        this.state,
        TOKEN_TYPES.IDENTIFIER,
        'Expected identifier after . in use<>'
      );
      segments.push(segToken.value);
    }

    identifier = { kind: 'static', scheme, segments };
  }

  expect(
    this.state,
    TOKEN_TYPES.GT,
    "Expected '>' to close use<>",
    'RILL-P022'
  );

  let typeRef: TypeRef | null = null;
  if (check(this.state, TOKEN_TYPES.COLON)) {
    advance(this.state);
    typeRef = parseTypeRef(this.state);
  }

  return {
    type: 'UseExpr',
    identifier,
    typeRef,
    span: makeSpan(start, current(this.state).span.end),
  };
};
