/**
 * Parser Helpers
 * Lookahead predicates and utility parsing functions
 * @internal This module contains internal parser utilities
 */

import type {
  BlockNode,
  HostCallNode,
  SourceLocation,
  SourceSpan,
} from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import {
  type ParserState,
  check,
  peek,
  expect,
  current,
  previous,
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
 * True when the token can serve as a variable or closure-parameter name: an
 * IDENTIFIER, or any value-context keyword token (true, false, break, return,
 * yield, pass, assert, error, guard, retry, while, do). Keywords are valid
 * names in these positions because there is no ambiguity with their keyword
 * usage.
 * @internal
 */
export function isVariableNameToken(token: { type: string }): boolean {
  return (
    token.type === TOKEN_TYPES.IDENTIFIER ||
    VALUE_CONTEXT_KEYWORD_TYPES.includes(token.type)
  );
}

/**
 * Expect a variable or closure-parameter name (see isVariableNameToken).
 * @internal
 */
export function expectVariableName(state: ParserState, message: string): Token {
  if (isVariableNameToken(current(state))) {
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
 * Check for function call: identifier(
 * Keywords can be used as function names when followed by parentheses.
 * @internal
 */
export function isHostCall(state: ParserState): boolean {
  const currentToken = state.tokens[state.pos];
  if (!currentToken || !isIdentifierOrKeyword(currentToken)) {
    return false;
  }

  return peek(state, 1).type === TOKEN_TYPES.LPAREN;
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
 * True when the cursor holds a minus whose end touches the next token and that
 * token is a number: `-42`. A spaced `- 42` is not a negative literal.
 * @internal
 */
export function isNegativeNumber(state: ParserState): boolean {
  if (!check(state, TOKEN_TYPES.MINUS)) return false;
  const next = peek(state, 1);
  return (
    next.type === TOKEN_TYPES.NUMBER &&
    current(state).span.end.offset === next.span.start.offset
  );
}

/**
 * Reserved-keyword token types that spell an identifier-form key.
 * @internal
 */
const KEYWORD_KEY_TYPES: readonly string[] = [
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
 * Token count of a static dict or type key at the cursor, or 0 when the
 * cursor does not start one. Static keys are a string, a number, a negative
 * number (two tokens), true, false, an identifier, or a reserved keyword.
 * @internal
 */
export function staticKeyWidth(state: ParserState): number {
  if (isNegativeNumber(state)) return 2;
  const type = current(state).type;
  if (
    type === TOKEN_TYPES.STRING ||
    type === TOKEN_TYPES.NUMBER ||
    type === TOKEN_TYPES.TRUE ||
    type === TOKEN_TYPES.FALSE ||
    type === TOKEN_TYPES.IDENTIFIER ||
    KEYWORD_KEY_TYPES.includes(type)
  ) {
    return 1;
  }
  return 0;
}

/**
 * Unescape `{{` and `}}` in a string literal body to `{` and `}`.
 * @internal
 */
export function unescapeBraces(raw: string): string {
  return raw.replaceAll('{{', '{').replaceAll('}}', '}');
}

/**
 * Read a static key, consuming its tokens, and return its string spelling
 * with the form it was written in. Returns undefined, consuming nothing, when
 * the cursor does not start a static key.
 * @internal
 */
export function readStaticKey(
  state: ParserState
):
  | { key: string; keyForm: 'identifier' | 'string' | 'number' | 'bool' }
  | undefined {
  if (isNegativeNumber(state)) {
    advance(state); // consume MINUS
    return { key: `-${advance(state).value}`, keyForm: 'number' };
  }
  const type = current(state).type;
  if (type === TOKEN_TYPES.STRING) {
    const raw = advance(state).value;
    return {
      key: unescapeBraces(raw),
      keyForm: 'string',
    };
  }
  if (type === TOKEN_TYPES.NUMBER) {
    return { key: advance(state).value, keyForm: 'number' };
  }
  if (type === TOKEN_TYPES.TRUE || type === TOKEN_TYPES.FALSE) {
    advance(state);
    return {
      key: type === TOKEN_TYPES.TRUE ? 'true' : 'false',
      keyForm: 'bool',
    };
  }
  if (type === TOKEN_TYPES.IDENTIFIER || KEYWORD_KEY_TYPES.includes(type)) {
    return { key: advance(state).value, keyForm: 'identifier' };
  }
  return undefined;
}

/**
 * Record a static key in `seen`, or raise RILL-P027 when it was already seen.
 * @throws ParseError RILL-P027
 * @internal
 */
export function rejectRepeatedKey(
  seen: Set<string>,
  key: string,
  at: SourceLocation,
  collection: string
): void {
  if (seen.has(key)) {
    throw new ParseError(
      ERROR_IDS.RILL_P027,
      `Duplicate key '${key}' in ${collection}`,
      at
    );
  }
  seen.add(key);
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
  if (isNegativeNumber(state) && peek(state, 2).type === TOKEN_TYPES.COLON) {
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
 * Token index just past the dict entry key at `pos`, or -1 when no key starts
 * there. Covers every key `parseDictEntry` reads: identifier, keyword,
 * string, number, negative number, bool, `$name`, parenthesized computed
 * expression, and a bracketed multi-key list.
 * @internal
 */
function skipDictKey(state: ParserState, pos: number): number {
  const token = state.tokens[pos];
  if (token === undefined) return -1;
  const type = token.type;
  if (
    type === TOKEN_TYPES.IDENTIFIER ||
    type === TOKEN_TYPES.STRING ||
    type === TOKEN_TYPES.NUMBER ||
    type === TOKEN_TYPES.TRUE ||
    type === TOKEN_TYPES.FALSE ||
    KEYWORD_KEY_TYPES.includes(type)
  ) {
    return pos + 1;
  }
  if (type === TOKEN_TYPES.MINUS) {
    const digit = state.tokens[pos + 1];
    return digit?.type === TOKEN_TYPES.NUMBER &&
      token.span.end.offset === digit.span.start.offset
      ? pos + 2
      : -1;
  }
  if (type === TOKEN_TYPES.DOLLAR) {
    const name = state.tokens[pos + 1];
    return name !== undefined && isVariableNameToken(name) ? pos + 2 : -1;
  }
  const isParen = type === TOKEN_TYPES.LPAREN;
  if (!isParen && !BRACKET_OPENERS.includes(type)) return -1;
  const closer = isParen ? TOKEN_TYPES.RPAREN : TOKEN_TYPES.RBRACKET;
  const opens = (t: string): boolean =>
    isParen ? t === TOKEN_TYPES.LPAREN : BRACKET_OPENERS.includes(t);
  let depth = 0;
  for (let i = pos; i < state.tokens.length; i++) {
    const t = state.tokens[i]?.type;
    if (t === undefined || t === TOKEN_TYPES.EOF) return -1;
    if (opens(t)) depth++;
    else if (t === closer && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * Check whether a dict entry (`key: value`) starts at the cursor: any key
 * `dict[...]` accepts, followed by a colon. Does not consume tokens.
 * @internal
 */
export function isDictEntryStart(state: ParserState): boolean {
  const after = skipDictKey(state, state.pos);
  return after >= 0 && state.tokens[after]?.type === TOKEN_TYPES.COLON;
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
 * True when a literal, atom, or negative number starts on the same line as
 * the token just consumed, so it reads as the value of a written type
 * (`atom #wired`, `list(number) list[1]`). A plain `[` counts only when
 * `plainBracket` is set, because after a type it otherwise opens an index.
 * @internal
 */
export function isDeclarationValueStart(
  state: ParserState,
  plainBracket: boolean
): boolean {
  if (current(state).span.start.line !== previous(state).span.end.line) {
    return false;
  }
  if (isNegativeNumber(state)) return true;
  if (check(state, TOKEN_TYPES.ATOM)) return true;
  if (check(state, TOKEN_TYPES.LBRACKET)) return plainBracket;
  return isLiteralStart(state);
}

/**
 * Raise RILL-P012 when the cursor sits on the removed closure literal opener
 * `|` or `||`, naming the fn form that replaces it.
 * @internal
 */
export function rejectRemovedClosureLiteral(state: ParserState): void {
  if (check(state, TOKEN_TYPES.OR)) {
    throw new ParseError(
      ERROR_IDS.RILL_P012,
      "Syntax removed: the '||' closure literal was removed; write fn() { ... }",
      current(state).span.start
    );
  }
  if (check(state, TOKEN_TYPES.PIPE_BAR)) {
    throw new ParseError(
      ERROR_IDS.RILL_P012,
      "Syntax removed: the '|params|' closure literal was removed; write fn(params) { ... }",
      current(state).span.start
    );
  }
}

/**
 * Check for the `fn` keyword starting an fn literal or fn type value.
 * @internal
 */
export function isFnStart(state: ParserState): boolean {
  const tok = current(state);
  return tok.type === TOKEN_TYPES.IDENTIFIER && tok.value === 'fn';
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
  const found = validTypes.find((t) => t === typeToken.value);
  if (found === undefined) {
    throw new ParseError(
      ERROR_IDS.RILL_P003,
      `Invalid type: ${typeToken.value} (expected: ${validTypes.join(', ')})`,
      typeToken.span.start
    );
  }
  return found;
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
 * Parse a bare function name (no parens): `func`.
 * Returns a HostCallNode with empty args. A `::` after the identifier is the
 * removed namespaced host-call form and raises RILL-P012.
 * @internal
 */
export function parseBareHostCall(state: ParserState): HostCallNode {
  const start = current(state).span.start;
  const first = expect(state, TOKEN_TYPES.IDENTIFIER, 'Expected identifier');

  if (check(state, TOKEN_TYPES.DOUBLE_COLON)) {
    const chain: string[] = [first.value];
    while (check(state, TOKEN_TYPES.DOUBLE_COLON)) {
      state.pos++; // consume ::
      const token = current(state);
      if (isIdentifierOrKeyword(token)) {
        chain.push(token.value);
        state.pos++;
      } else {
        chain.push('fn');
        break;
      }
    }
    const [ext = first.value, ...members] = chain;
    const shown = chain.join('::');
    const hintMembers = members.join('.');
    throw new ParseError(
      ERROR_IDS.RILL_P012,
      `Syntax removed: ${shown} namespaced host call removed; use use<ext:${ext}> => $${ext}, then $${ext}.${hintMembers}()`,
      first.span.start
    );
  }

  return {
    type: 'HostCall',
    name: first.value,
    args: [],
    span: { start, end: previous(state).span.end },
  };
}
