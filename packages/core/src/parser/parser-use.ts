/**
 * Parser Extension: Use Expression Parsing
 * Parses use<> expressions for module/resource resolution.
 */

import { Parser } from './parser.js';
import type {
  UseExprNode,
  UseIdentifier,
  TypeRef,
  LiteralNode,
} from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import { check, advance, expect, current, makeSpan, peek } from './state.js';
import { parseTypeRef } from './parser-types.js';
import { ERROR_IDS } from '../error-registry.js';

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
        ERROR_IDS.RILL_P020,
        "Expected ':' after scheme in use<>",
        current(this.state).span.start
      );
    }
    advance(this.state); // consume COLON

    if (!check(this.state, TOKEN_TYPES.IDENTIFIER)) {
      throw new ParseError(
        ERROR_IDS.RILL_P021,
        "Expected resource identifier after ':' in use<>",
        current(this.state).span.start
      );
    }
    const firstSegToken = advance(this.state);
    const segments: string[] = [firstSegToken.value];

    while (check(this.state, TOKEN_TYPES.DOT)) {
      advance(this.state); // consume DOT
      if (!check(this.state, TOKEN_TYPES.IDENTIFIER, TOKEN_TYPES.METHOD_NAME)) {
        const token = current(this.state);
        throw new ParseError(
          ERROR_IDS.RILL_P001,
          'Expected identifier after . in use<>',
          token.span.start
        );
      }
      segments.push(advance(this.state).value);
    }

    identifier = { kind: 'static', scheme, segments };
  }

  expect(
    this.state,
    TOKEN_TYPES.GT,
    "Expected '>' to close use<>",
    ERROR_IDS.RILL_P022
  );

  let typeRef: TypeRef | null = null;
  let closureAnnotation: Array<{
    name: string;
    typeRef: TypeRef;
    defaultValue?: LiteralNode;
  }> | null = null;
  const parseLiteral = () => this.parseLiteral();

  if (check(this.state, TOKEN_TYPES.COLON)) {
    if (peek(this.state, 1).type === TOKEN_TYPES.OR) {
      // Zero-param closure annotation: :||
      advance(this.state); // consume :
      advance(this.state); // consume || (OR token)
      closureAnnotation = [];
      // Optional return type after :||
      if (check(this.state, TOKEN_TYPES.COLON)) {
        advance(this.state); // consume :
        typeRef = parseTypeRef(this.state, { parseLiteral });
      }
    } else if (peek(this.state, 1).type === TOKEN_TYPES.PIPE_BAR) {
      // Closure annotation: :|param: type, ...|
      advance(this.state); // consume :
      advance(this.state); // consume opening |
      closureAnnotation = [];
      while (!check(this.state, TOKEN_TYPES.PIPE_BAR)) {
        const nameToken = expect(
          this.state,
          TOKEN_TYPES.IDENTIFIER,
          'Expected parameter name in closure annotation'
        );
        expect(
          this.state,
          TOKEN_TYPES.COLON,
          'Expected : after parameter name in closure annotation'
        );
        const paramTypeRef = parseTypeRef(this.state, {
          allowTrailingPipe: true,
          parseLiteral,
        });
        const entry: {
          name: string;
          typeRef: TypeRef;
          defaultValue?: LiteralNode;
        } = {
          name: nameToken.value,
          typeRef: paramTypeRef,
        };
        if (check(this.state, TOKEN_TYPES.ASSIGN)) {
          advance(this.state); // consume =
          entry.defaultValue = parseLiteral();
        }
        closureAnnotation.push(entry);
        if (check(this.state, TOKEN_TYPES.COMMA)) {
          advance(this.state); // consume ,
        } else if (!check(this.state, TOKEN_TYPES.PIPE_BAR)) {
          throw new ParseError(
            ERROR_IDS.RILL_P001,
            'Expected , or | after parameter type in closure annotation',
            current(this.state).span.start
          );
        }
      }
      advance(this.state); // consume closing |
      // Optional return type after :|params|
      if (check(this.state, TOKEN_TYPES.COLON)) {
        advance(this.state); // consume :
        typeRef = parseTypeRef(this.state, { parseLiteral });
      }
    } else {
      advance(this.state); // consume :
      typeRef = parseTypeRef(this.state);
    }
  }

  return {
    type: 'UseExpr',
    identifier,
    typeRef,
    closureAnnotation,
    span: makeSpan(start, current(this.state).span.end),
  };
};
