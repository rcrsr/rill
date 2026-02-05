/**
 * Parser State
 * Core state management and token navigation utilities
 */

import type { SourceLocation, SourceSpan, Token } from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';

// ============================================================
// PARSER STATE
// ============================================================

export interface ParserState {
  readonly tokens: Token[];
  pos: number;
  /** Recovery mode: collect errors instead of throwing */
  readonly recoveryMode: boolean;
  /** Errors collected during recovery mode parsing */
  readonly errors: ParseError[];
  /** Original source text (for error recovery) */
  readonly source: string;
}

export interface ParserStateOptions {
  /** Enable recovery mode for IDE/tooling scenarios */
  recoveryMode?: boolean;
  /** Original source text (required for recovery mode) */
  source?: string;
}

export function createParserState(
  tokens: Token[],
  options: ParserStateOptions = {}
): ParserState {
  return {
    tokens,
    pos: 0,
    recoveryMode: options.recoveryMode ?? false,
    errors: [],
    source: options.source ?? '',
  };
}

// ============================================================
// TOKEN NAVIGATION
// ============================================================

/** @internal */
export function current(state: ParserState): Token {
  const token = state.tokens[state.pos];
  if (token) return token;
  const last = state.tokens[state.tokens.length - 1];
  if (last) return last;
  throw new Error('No tokens available');
}

/** @internal */
export function peek(state: ParserState, offset = 0): Token {
  const idx = state.pos + offset;
  const token = state.tokens[idx];
  if (token) return token;
  const last = state.tokens[state.tokens.length - 1];
  if (last) return last;
  throw new Error('No tokens available');
}

/** @internal */
export function isAtEnd(state: ParserState): boolean {
  return current(state).type === TOKEN_TYPES.EOF;
}

/** @internal */
export function check(state: ParserState, ...types: string[]): boolean {
  return types.includes(current(state).type);
}

/** @internal */
export function advance(state: ParserState): Token {
  const token = current(state);
  if (!isAtEnd(state)) state.pos++;
  return token;
}

/** @internal */
export function expect(
  state: ParserState,
  type: string,
  message: string
): Token {
  if (check(state, type)) return advance(state);
  const token = current(state);
  const hint = generateHint(type, token);
  const fullMessage = hint ? `${message}. ${hint}` : message;
  throw new ParseError('RILL-P005', fullMessage, token.span.start);
}

/** @internal */
export function skipNewlines(state: ParserState): void {
  while (check(state, TOKEN_TYPES.NEWLINE)) advance(state);
}

// ============================================================
// ERROR HINTS
// ============================================================

/**
 * Generate contextual hints for common parse errors.
 * @internal
 */
function generateHint(expectedType: string, actualToken: Token): string | null {
  const actual = actualToken.type;
  const value = actualToken.value;

  // Hint for unclosed brackets/braces/parens
  if (expectedType === TOKEN_TYPES.RPAREN && actual === TOKEN_TYPES.EOF) {
    return 'Hint: Check for unclosed parenthesis';
  }
  if (expectedType === TOKEN_TYPES.RBRACE && actual === TOKEN_TYPES.EOF) {
    return 'Hint: Check for unclosed brace';
  }
  if (expectedType === TOKEN_TYPES.RBRACKET && actual === TOKEN_TYPES.EOF) {
    return 'Hint: Check for unclosed bracket';
  }

  // Hint for keyword typos
  if (actual === TOKEN_TYPES.IDENTIFIER) {
    const typoHints: Record<string, string> = {
      tru: 'true',
      fals: 'false',
      flase: 'false',
      ture: 'true',
      retrn: 'return',
      retrun: 'return',
      brek: 'break',
      braek: 'break',
      eahc: 'each',
      ech: 'each',
      fitler: 'filter',
      fliter: 'filter',
      fild: 'fold',
      mp: 'map',
    };
    const suggestion = typoHints[value.toLowerCase()];
    if (suggestion) {
      return `Hint: Did you mean '${suggestion}'?`;
    }
  }

  // Hint for missing arrow
  if (
    expectedType === TOKEN_TYPES.ARROW &&
    (actual === TOKEN_TYPES.IDENTIFIER || actual === TOKEN_TYPES.DOLLAR)
  ) {
    return "Hint: Missing '->' before pipe target";
  }

  // Hint for using = instead of ->
  if (expectedType === TOKEN_TYPES.ARROW && actual === TOKEN_TYPES.ASSIGN) {
    return "Hint: Use '->' for assignment, not '='";
  }

  return null;
}

// ============================================================
// SPAN UTILITIES
// ============================================================

/** @internal */
export function makeSpan(
  start: SourceLocation,
  end: SourceLocation
): SourceSpan {
  return { start, end };
}
