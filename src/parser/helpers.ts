/**
 * Parser Helpers
 * Lookahead predicates and utility parsing functions
 * @internal This module contains internal parser utilities
 */

import type { BlockNode, HostCallNode, SourceSpan } from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import { type ParserState, check, peek, expect, current } from './state.js';

// ============================================================
// VALID TYPE NAMES
// ============================================================

/** @internal */
export const VALID_TYPE_NAMES = [
  'string',
  'number',
  'bool',
  'closure',
  'list',
  'dict',
  'tuple',
] as const;

/** @internal */
export const FUNC_PARAM_TYPES = ['string', 'number', 'bool'] as const;

// ============================================================
// LOOKAHEAD PREDICATES
// ============================================================

/**
 * Check if token can be used as an identifier in function names
 * (identifiers or keywords)
 * @internal
 */
function isIdentifierOrKeyword(token: { type: string }): boolean {
  return (
    token.type === TOKEN_TYPES.IDENTIFIER ||
    token.type === TOKEN_TYPES.TRUE ||
    token.type === TOKEN_TYPES.FALSE ||
    token.type === TOKEN_TYPES.BREAK ||
    token.type === TOKEN_TYPES.RETURN ||
    token.type === TOKEN_TYPES.ASSERT ||
    token.type === TOKEN_TYPES.ERROR ||
    token.type === TOKEN_TYPES.EACH ||
    token.type === TOKEN_TYPES.MAP ||
    token.type === TOKEN_TYPES.FOLD ||
    token.type === TOKEN_TYPES.FILTER ||
    token.type === TOKEN_TYPES.PASS
  );
}

/**
 * Check for function call: identifier( or namespace::func(
 * Supports: func(), ns::func(), ns::sub::func()
 * Keywords can be used as function names when followed by parentheses.
 * @internal
 */
export function isHostCall(state: ParserState): boolean {
  const currentToken = state.tokens[state.pos];
  if (!currentToken || !isIdentifierOrKeyword(currentToken)) {
    return false;
  }

  // Simple case: identifier(
  if (peek(state, 1).type === TOKEN_TYPES.LPAREN) {
    return true;
  }

  // Namespaced case: identifier::identifier(
  // Scan ahead for pattern: IDENT (:: IDENT)* (
  let offset = 1;
  while (peek(state, offset).type === TOKEN_TYPES.DOUBLE_COLON) {
    offset++; // skip ::
    const nextToken = peek(state, offset);
    if (!isIdentifierOrKeyword(nextToken)) {
      return false; // :: must be followed by identifier or keyword
    }
    offset++; // skip identifier/keyword
  }

  // If we consumed at least one ::, check for (
  return offset > 1 && peek(state, offset).type === TOKEN_TYPES.LPAREN;
}

/**
 * Check for simple closure call: $name(
 * Used in expression context where $var.method() should be parsed as Variable + MethodCall
 * @internal
 */
export function isClosureCall(state: ParserState): boolean {
  return (
    check(state, TOKEN_TYPES.DOLLAR) &&
    peek(state, 1).type === TOKEN_TYPES.IDENTIFIER &&
    peek(state, 2).type === TOKEN_TYPES.LPAREN
  );
}

/**
 * Check for closure call with property access: $name( or $name.prop...(
 * Used in pipe target context where $dict.closure() should invoke the closure
 * @internal
 */
export function isClosureCallWithAccess(state: ParserState): boolean {
  if (!check(state, TOKEN_TYPES.DOLLAR)) return false;
  if (peek(state, 1).type !== TOKEN_TYPES.IDENTIFIER) return false;

  // Scan through .identifier chains to find terminal (
  let offset = 2;
  while (peek(state, offset).type === TOKEN_TYPES.DOT) {
    offset++; // skip .
    if (peek(state, offset).type !== TOKEN_TYPES.IDENTIFIER) return false;
    offset++; // skip identifier
  }

  return peek(state, offset).type === TOKEN_TYPES.LPAREN;
}

/**
 * Check for pipe invoke: $( (invoke pipe value as closure)
 * @internal
 */
export function canStartPipeInvoke(state: ParserState): boolean {
  return (
    check(state, TOKEN_TYPES.PIPE_VAR) &&
    peek(state, 1).type === TOKEN_TYPES.LPAREN
  );
}

/**
 * Check for method call: .identifier
 * @internal
 */
export function isMethodCall(state: ParserState): boolean {
  return (
    check(state, TOKEN_TYPES.DOT) &&
    peek(state, 1).type === TOKEN_TYPES.IDENTIFIER
  );
}

/**
 * Check for sequential spread target: @$ or @[ (not @{ which is for-loop)
 * @internal
 */
export function isClosureChainTarget(state: ParserState): boolean {
  return (
    check(state, TOKEN_TYPES.AT) &&
    (peek(state, 1).type === TOKEN_TYPES.DOLLAR ||
      peek(state, 1).type === TOKEN_TYPES.LBRACKET)
  );
}

/**
 * Check for negative number: -42
 * @internal
 */
export function isNegativeNumber(state: ParserState): boolean {
  return (
    check(state, TOKEN_TYPES.MINUS) &&
    peek(state, 1).type === TOKEN_TYPES.NUMBER
  );
}

/**
 * Check for dict start: identifier followed by colon OR list literal followed by colon
 * @internal
 */
export function isDictStart(state: ParserState): boolean {
  // Dict can start with identifier followed by colon: [key: value]
  if (
    check(state, TOKEN_TYPES.IDENTIFIER) &&
    peek(state, 1).type === TOKEN_TYPES.COLON
  ) {
    return true;
  }

  // Dict can start with string literal followed by colon: ["key": value]
  if (
    check(state, TOKEN_TYPES.STRING) &&
    peek(state, 1).type === TOKEN_TYPES.COLON
  ) {
    return true;
  }

  // Dict can start with number followed by colon: [42: value]
  if (
    check(state, TOKEN_TYPES.NUMBER) &&
    peek(state, 1).type === TOKEN_TYPES.COLON
  ) {
    return true;
  }

  // Dict can start with boolean followed by colon: [true: value] or [false: value]
  if (
    (check(state, TOKEN_TYPES.TRUE) || check(state, TOKEN_TYPES.FALSE)) &&
    peek(state, 1).type === TOKEN_TYPES.COLON
  ) {
    return true;
  }

  // Dict can start with negative number followed by colon: [-42: value]
  if (
    check(state, TOKEN_TYPES.MINUS) &&
    peek(state, 1).type === TOKEN_TYPES.NUMBER &&
    peek(state, 2).type === TOKEN_TYPES.COLON
  ) {
    return true;
  }

  // Dict can also start with list literal (multi-key): [["a", "b"]: value]
  // Look for pattern: [ [ ... ] : value
  if (check(state, TOKEN_TYPES.LBRACKET)) {
    // Scan ahead to find matching closing bracket
    let depth = 0;
    let pos = state.pos;

    while (pos < state.tokens.length) {
      const token = state.tokens[pos];
      if (token?.type === TOKEN_TYPES.LBRACKET) {
        depth++;
      } else if (token?.type === TOKEN_TYPES.RBRACKET) {
        depth--;
        if (depth === 0) {
          // Found matching closing bracket, check next token
          const nextToken = state.tokens[pos + 1];
          return nextToken?.type === TOKEN_TYPES.COLON;
        }
      }
      pos++;
    }
  }

  return false;
}

/**
 * Check for method call with args (for field access termination): .identifier(
 * @internal
 */
export function isMethodCallWithArgs(state: ParserState): boolean {
  return (
    peek(state, 1).type === TOKEN_TYPES.IDENTIFIER &&
    peek(state, 2).type === TOKEN_TYPES.LPAREN
  );
}

/**
 * Check for literal start (not LPAREN - that's now grouping)
 * @internal
 */
export function isLiteralStart(state: ParserState): boolean {
  return check(
    state,
    TOKEN_TYPES.STRING,
    TOKEN_TYPES.NUMBER,
    TOKEN_TYPES.TRUE,
    TOKEN_TYPES.FALSE,
    TOKEN_TYPES.LBRACKET
  );
}

/**
 * Check if current token can start an expression (for bare spread detection)
 * @internal
 */
export function canStartExpression(state: ParserState): boolean {
  return (
    isLiteralStart(state) ||
    isClosureStart(state) ||
    check(
      state,
      TOKEN_TYPES.DOLLAR,
      TOKEN_TYPES.PIPE_VAR,
      TOKEN_TYPES.IDENTIFIER,
      TOKEN_TYPES.DOT,
      TOKEN_TYPES.LPAREN,
      TOKEN_TYPES.LBRACE,
      TOKEN_TYPES.AT,
      TOKEN_TYPES.QUESTION,
      TOKEN_TYPES.BANG,
      TOKEN_TYPES.STAR,
      TOKEN_TYPES.MINUS
    )
  );
}

/**
 * Check for closure start: | or ||
 * - |params| body
 * - || body (no-param closure)
 * @internal
 */
export function isClosureStart(state: ParserState): boolean {
  return check(state, TOKEN_TYPES.PIPE_BAR, TOKEN_TYPES.OR);
}

// ============================================================
// UTILITY PARSING FUNCTIONS
// ============================================================

/**
 * Parse and validate a type name from an identifier token.
 * Throws ParseError if the type is not in the allowed list.
 * @internal
 */
export function parseTypeName<T extends string>(
  state: ParserState,
  validTypes: readonly T[]
): T {
  const typeToken = expect(state, TOKEN_TYPES.IDENTIFIER, 'Expected type name');
  if (!validTypes.includes(typeToken.value as T)) {
    throw new ParseError(
      'RILL-P003',
      `Invalid type: ${typeToken.value} (expected: ${validTypes.join(', ')})`,
      typeToken.span.start
    );
  }
  return typeToken.value as T;
}

/**
 * Create a block containing a single boolean literal statement
 * @internal
 */
export function makeBoolLiteralBlock(
  value: boolean,
  span: SourceSpan
): BlockNode {
  return {
    type: 'Block',
    statements: [
      {
        type: 'Statement',
        expression: {
          type: 'PipeChain',
          head: {
            type: 'PostfixExpr',
            primary: { type: 'BoolLiteral', value, span },
            methods: [],
            defaultValue: null,
            span,
          },
          pipes: [],
          terminator: null,
          span,
        },
        span,
      },
    ],
    span,
  };
}

// Note: parseArgumentList is defined in expressions.ts to avoid circular dependencies
// since it depends on parseExpression

// ============================================================
// BARE HOST CALL PARSING
// ============================================================

/**
 * Parse a bare function name (no parens): `func` or `ns::func` or `ns::sub::func`
 * Returns a HostCallNode with empty args.
 * @internal
 */
export function parseBareHostCall(state: ParserState): HostCallNode {
  const start = state.tokens[state.pos]!.span.start;
  let name = expect(state, TOKEN_TYPES.IDENTIFIER, 'Expected identifier').value;

  // Collect namespaced name: ident::ident::...
  while (check(state, TOKEN_TYPES.DOUBLE_COLON)) {
    state.pos++; // consume ::

    // After ::, accept identifier or keyword
    const token = current(state);

    if (!isIdentifierOrKeyword(token)) {
      throw new ParseError(
        'RILL-P005',
        'Expected identifier or keyword after ::',
        token.span.start
      );
    }

    name += '::' + token.value;
    state.pos++; // consume the identifier or keyword
  }

  return {
    type: 'HostCall',
    name,
    args: [],
    span: { start, end: state.tokens[state.pos - 1]!.span.end },
  };
}
