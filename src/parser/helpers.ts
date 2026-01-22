/**
 * Parser Helpers
 * Lookahead predicates and utility parsing functions
 * @internal This module contains internal parser utilities
 */

import type { BlockNode, HostCallNode, SourceSpan } from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import { type ParserState, check, peek, expect } from './state.js';

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
 * Check for function call: identifier( or namespace::func(
 * Supports: func(), ns::func(), ns::sub::func()
 * @internal
 */
export function isHostCall(state: ParserState): boolean {
  if (!check(state, TOKEN_TYPES.IDENTIFIER)) {
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
    if (peek(state, offset).type !== TOKEN_TYPES.IDENTIFIER) {
      return false; // :: must be followed by identifier
    }
    offset++; // skip identifier
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
 * Check for dict start: identifier followed by colon
 * @internal
 */
export function isDictStart(state: ParserState): boolean {
  return (
    check(state, TOKEN_TYPES.IDENTIFIER) &&
    peek(state, 1).type === TOKEN_TYPES.COLON
  );
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
    const next = expect(
      state,
      TOKEN_TYPES.IDENTIFIER,
      'Expected identifier after ::'
    );
    name += '::' + next.value;
  }

  return {
    type: 'HostCall',
    name,
    args: [],
    span: { start, end: state.tokens[state.pos - 1]!.span.end },
  };
}
