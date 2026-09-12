/**
 * Parser Helpers
 * Lookahead predicates and utility parsing functions
 * @internal This module contains internal parser utilities
 */

import type {
  BlockNode,
  HostCallNode,
  HostRefNode,
  SourceSpan,
} from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import {
  type ParserState,
  check,
  peek,
  expect,
  current,
  advance,
} from './state.js';
import { VALID_TYPE_NAMES } from '../constants.js';
import { ERROR_IDS } from '../error-registry.js';
import type { Token } from '../types.js';

// ============================================================
// VALID TYPE NAMES
// ============================================================

/** @internal */
export { VALID_TYPE_NAMES };

/**
 * Strict atom-name shape: uppercase leading letter, then uppercase letters, digits, underscores.
 * Shared by parser-literals (`#NAME`) and parser-control (`guard<on: list[#NAME]>`).
 * Registry enforces 64-char max; parser enforces shape only.
 * @internal
 */
export const ATOM_NAME_SHAPE = /^[A-Z][A-Z0-9_]*$/;

// ============================================================
// LOOKAHEAD PREDICATES
// ============================================================

/**
 * Value-context keyword token types that may also serve as a variable or
 * closure-parameter name. These are the same keywords the lexer already
 * retokenizes to METHOD_NAME after a dot in method-call position; here the
 * `$` sigil (variables) and the parameter position (closure params) are
 * equally unambiguous, so the parser accepts either token type directly
 * instead of adding a lexer retokenization pass.
 * @internal
 */
const VALUE_CONTEXT_KEYWORD_TYPES: readonly string[] = [
  TOKEN_TYPES.TRUE,
  TOKEN_TYPES.FALSE,
  TOKEN_TYPES.BREAK,
  TOKEN_TYPES.RETURN,
  TOKEN_TYPES.YIELD,
  TOKEN_TYPES.PASS,
  TOKEN_TYPES.ASSERT,
  TOKEN_TYPES.ERROR,
  TOKEN_TYPES.GUARD,
  TOKEN_TYPES.RETRY,
  TOKEN_TYPES.WHILE,
  TOKEN_TYPES.DO,
];

/**
 * Expect a variable or closure-parameter name: an IDENTIFIER, or any
 * value-context keyword token (true, false, break, return, yield, pass,
 * assert, error, guard, retry, while, do). Keywords are valid names in
 * these positions because there is no ambiguity with their keyword usage.
 * @internal
 */
export function expectVariableName(state: ParserState, message: string): Token {
  const token = current(state);
  if (
    token.type === TOKEN_TYPES.IDENTIFIER ||
    VALUE_CONTEXT_KEYWORD_TYPES.includes(token.type)
  ) {
    return advance(state);
  }
  return expect(state, TOKEN_TYPES.IDENTIFIER, message);
}

/**
 * Check if token can be used as an identifier in function names
 * (identifiers or keywords)
 * @internal Exported for parser-functions.ts reuse.
 */
export function isIdentifierOrKeyword(token: { type: string }): boolean {
  return (
    token.type === TOKEN_TYPES.IDENTIFIER ||
    token.type === TOKEN_TYPES.TRUE ||
    token.type === TOKEN_TYPES.FALSE ||
    token.type === TOKEN_TYPES.BREAK ||
    token.type === TOKEN_TYPES.RETURN ||
    token.type === TOKEN_TYPES.YIELD ||
    token.type === TOKEN_TYPES.ASSERT ||
    token.type === TOKEN_TYPES.ERROR ||
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
  if (offset > 1) {
    return peek(state, offset).type === TOKEN_TYPES.LPAREN;
  }

  return false;
}

/**
 * Check for simple closure call: $name(
 * Used in expression context where $var.method() should be parsed as Variable + MethodCall
 * @internal
 */
export function isClosureCall(state: ParserState): boolean {
  if (!check(state, TOKEN_TYPES.DOLLAR)) return false;
  if (peek(state, 1).type !== TOKEN_TYPES.IDENTIFIER) return false;
  return peek(state, 2).type === TOKEN_TYPES.LPAREN;
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
    const t = peek(state, offset).type;
    if (t !== TOKEN_TYPES.IDENTIFIER && t !== TOKEN_TYPES.METHOD_NAME)
      return false;
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
 * Check for method call: .identifier or .METHOD_NAME
 * @internal
 */
export function isMethodCall(state: ParserState): boolean {
  const nextType = peek(state, 1).type;
  return (
    check(state, TOKEN_TYPES.DOT) &&
    (nextType === TOKEN_TYPES.IDENTIFIER ||
      nextType === TOKEN_TYPES.METHOD_NAME)
  );
}

/**
 * Check for annotation access: .^identifier
 * @internal
 */
export function isAnnotationAccess(state: ParserState): boolean {
  return (
    check(state, TOKEN_TYPES.DOT) && peek(state, 1).type === TOKEN_TYPES.CARET
  );
}

/**
 * Describe a token for "got: <token>" style parse error messages.
 * NEWLINE and EOF tokens carry non-printable/empty `.value`s, so they get
 * human-readable labels instead of being interpolated raw.
 * @internal
 */
export function describeToken(token: Token): string {
  if (token.type === TOKEN_TYPES.NEWLINE) return 'newline';
  if (token.type === TOKEN_TYPES.EOF) return 'end of input';
  return token.value;
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
 * Check if current token is one of the given types and followed by colon
 * @internal
 */
function isKeyValueStart(state: ParserState, tokenTypes: string[]): boolean {
  return (
    tokenTypes.some((type) => check(state, type)) &&
    peek(state, 1).type === TOKEN_TYPES.COLON
  );
}

/**
 * Compound bracket opener tokens the lexer emits for `dict[`, `list[`, `tuple[`,
 * `ordered[`, plus the plain `[`. All five close with a single RBRACKET.
 * @internal
 */
const BRACKET_OPENERS: string[] = [
  TOKEN_TYPES.LBRACKET,
  TOKEN_TYPES.LIST_LBRACKET,
  TOKEN_TYPES.DICT_LBRACKET,
  TOKEN_TYPES.TUPLE_LBRACKET,
  TOKEN_TYPES.ORDERED_LBRACKET,
];

/**
 * Check for dict start: identifier followed by colon OR list literal followed by colon
 * @internal
 */
export function isDictStart(state: ParserState): boolean {
  // Dict can start with simple key-value pairs: [key: value]
  if (
    isKeyValueStart(state, [
      TOKEN_TYPES.IDENTIFIER,
      TOKEN_TYPES.STRING,
      TOKEN_TYPES.NUMBER,
      TOKEN_TYPES.TRUE,
      TOKEN_TYPES.FALSE,
    ])
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
      if (token && BRACKET_OPENERS.includes(token.type)) {
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
  const nextType = peek(state, 1).type;
  return (
    (nextType === TOKEN_TYPES.IDENTIFIER ||
      nextType === TOKEN_TYPES.METHOD_NAME) &&
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
    ...BRACKET_OPENERS
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
      ERROR_IDS.RILL_P003,
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
// BARE HOST CALL / REF PARSING
// ============================================================

/**
 * Parse a bare function name (no parens): `func` or `ns::func` or `ns::sub::func`
 * Returns a HostRefNode for namespaced names (ns::name) and a HostCallNode
 * with empty args for simple bare identifiers (no ::).
 * @internal
 */
export function parseBareHostCall(
  state: ParserState
): HostCallNode | HostRefNode {
  const start = state.tokens[state.pos]!.span.start;
  let name = expect(state, TOKEN_TYPES.IDENTIFIER, 'Expected identifier').value;
  let hasNamespace = false;

  // Collect namespaced name: ident::ident::...
  while (check(state, TOKEN_TYPES.DOUBLE_COLON)) {
    state.pos++; // consume ::
    hasNamespace = true;

    // After ::, accept identifier or keyword
    const token = current(state);

    if (!isIdentifierOrKeyword(token)) {
      throw new ParseError(
        ERROR_IDS.RILL_P001,
        'Expected identifier or keyword after ::',
        token.span.start
      );
    }

    name += '::' + token.value;
    state.pos++; // consume the identifier or keyword
  }

  const span = { start, end: state.tokens[state.pos - 1]!.span.end };

  // Namespaced bare identifier → host function reference
  if (hasNamespace) {
    return {
      type: 'HostRef',
      name,
      span,
    };
  }

  return {
    type: 'HostCall',
    name,
    args: [],
    span,
  };
}
