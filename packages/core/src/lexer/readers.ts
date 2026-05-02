/**
 * Token Readers
 * Functions to read specific token types from source
 */

import type { Token, TokenType } from '../types.js';
import { TOKEN_TYPES } from '../types.js';
import { LexerError } from './errors.js';
import {
  isDigit,
  isIdentifierChar,
  isIdentifierStart,
  makeToken,
} from './helpers.js';
import { KEYWORDS } from './operators.js';
import {
  advance,
  currentLocation,
  isAtEnd,
  type LexerState,
  peek,
} from './state.js';
import { ERROR_IDS } from '../error-registry.js';

// ============================================================
// COMPOUND KEYWORD TOKENIZATION
// ============================================================

/** Named shape returned by tokenizeCompoundKeyword. */
type CompoundToken = {
  keyword: string;
  bracket: string;
  tokenType: TokenType;
};

/**
 * Mapping from keyword to its expected opener character
 * and the compound token type emitted when the opener immediately follows.
 *
 * Three opener flavors:
 * - `[` bracket-body: collection literals (list, dict, tuple, ordered)
 * - `<` langle-body: angle-delimited heads (destruct, slice, use, retry, do)
 * - `{` brace-body: block heads (guard) — DEC-3 parallel path
 *
 * The brace-body flavor is a parallel addition per DEC-3 in the error-handling
 * plan. It reuses the same dispatch table so the lexer emits a single compound
 * token without leaking opener discrimination into the parser.
 */
const COMPOUND_KEYWORD_MAP: Record<
  string,
  { bracket: string; tokenType: TokenType }
> = {
  list: { bracket: '[', tokenType: TOKEN_TYPES.LIST_LBRACKET },
  dict: { bracket: '[', tokenType: TOKEN_TYPES.DICT_LBRACKET },
  tuple: { bracket: '[', tokenType: TOKEN_TYPES.TUPLE_LBRACKET },
  ordered: { bracket: '[', tokenType: TOKEN_TYPES.ORDERED_LBRACKET },
  destruct: { bracket: '<', tokenType: TOKEN_TYPES.DESTRUCT_LANGLE },
  slice: { bracket: '<', tokenType: TOKEN_TYPES.SLICE_LANGLE },
  use: { bracket: '<', tokenType: TOKEN_TYPES.USE_LANGLE },
  retry: { bracket: '<', tokenType: TOKEN_TYPES.RETRY_LANGLE },
  do: { bracket: '<', tokenType: TOKEN_TYPES.DO_LANGLE },
  pass: { bracket: '<', tokenType: TOKEN_TYPES.PASS_LANGLE },
  timeout: { bracket: '<', tokenType: TOKEN_TYPES.TIMEOUT_LANGLE },
  guard: { bracket: '{', tokenType: TOKEN_TYPES.GUARD_LBRACE },
};

/**
 * Attempts to recognize a compound token at the given position in source.
 * Checks whether the character sequence starting at `position` is a collection
 * keyword immediately (zero whitespace) followed by its bracket character.
 * Returns null when the condition is not met.
 *
 * This function is informational: the caller must consume the characters.
 */
function tokenizeCompoundKeyword(
  source: string,
  position: number
): CompoundToken | null {
  for (const [keyword, { bracket, tokenType }] of Object.entries(
    COMPOUND_KEYWORD_MAP
  )) {
    const end = position + keyword.length;
    if (source.slice(position, end) === keyword) {
      // The character immediately after the keyword must be the bracket (no whitespace).
      if (source[end] === bracket) {
        return { keyword, bracket, tokenType };
      }
    }
  }
  return null;
}

/** Process escape sequence and return the unescaped character */
function processEscape(state: LexerState): string {
  const escaped = advance(state);
  switch (escaped) {
    case 'n':
      return '\n';
    case 'r':
      return '\r';
    case 't':
      return '\t';
    case '\\':
      return '\\';
    case '"':
      return '"';
    default:
      throw new LexerError(
        ERROR_IDS.RILL_L005,
        `Invalid escape sequence: \\${escaped}`,
        currentLocation(state)
      );
  }
}

export function readString(state: LexerState): Token {
  const start = currentLocation(state);
  advance(state); // consume opening "

  let value = '';
  while (!isAtEnd(state) && peek(state) !== '"') {
    if (peek(state) === '\\') {
      advance(state); // consume backslash
      value += processEscape(state);
    } else if (peek(state) === '{') {
      // Interpolation: include {expr} literally, parser handles expression parsing
      value += advance(state); // consume {
      let braceDepth = 1;
      while (!isAtEnd(state) && braceDepth > 0) {
        if (peek(state) === '\\') {
          advance(state); // consume backslash
          value += processEscape(state);
        } else {
          const ch = advance(state);
          value += ch;
          if (ch === '{') braceDepth++;
          if (ch === '}') braceDepth--;
        }
      }
    } else if (peek(state) === '\n') {
      throw new LexerError(
        ERROR_IDS.RILL_L001,
        'Unterminated string literal',
        start
      );
    } else {
      value += advance(state);
    }
  }

  if (peek(state) === '"') {
    advance(state); // consume closing "
  }

  return makeToken(TOKEN_TYPES.STRING, value, start, currentLocation(state));
}

export function readTripleQuoteString(state: LexerState): Token {
  const start = currentLocation(state);
  advance(state); // consume first "
  advance(state); // consume second "
  advance(state); // consume third "

  // Skip opening newline if present (Python-style)
  if (peek(state) === '\n') {
    advance(state);
  }

  let value = '';
  while (!isAtEnd(state)) {
    // Check for closing triple-quote
    if (
      peek(state) === '"' &&
      peek(state, 1) === '"' &&
      peek(state, 2) === '"'
    ) {
      advance(state); // consume first "
      advance(state); // consume second "
      advance(state); // consume third "
      return makeToken(
        TOKEN_TYPES.STRING,
        value,
        start,
        currentLocation(state)
      );
    }

    if (peek(state) === '{') {
      // Check for brace escaping ({{ or }})
      if (peek(state, 1) === '{') {
        value += advance(state); // consume first {
        value += advance(state); // consume second {
        continue;
      }

      // Interpolation: include {expr} literally, parser handles expression parsing
      value += advance(state); // consume {
      let braceDepth = 1;
      while (!isAtEnd(state) && braceDepth > 0) {
        // Check for """ inside interpolation
        if (
          peek(state) === '"' &&
          peek(state, 1) === '"' &&
          peek(state, 2) === '"'
        ) {
          throw new LexerError(
            ERROR_IDS.RILL_L005,
            'Triple-quotes not allowed in interpolation',
            currentLocation(state)
          );
        }

        // Check for brace escaping inside interpolation
        if (peek(state) === '{' && peek(state, 1) === '{') {
          value += advance(state); // consume first {
          value += advance(state); // consume second {
          continue;
        }
        if (peek(state) === '}' && peek(state, 1) === '}') {
          value += advance(state); // consume first }
          value += advance(state); // consume second }
          continue;
        }

        const ch = advance(state);
        value += ch;
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }
    } else if (peek(state) === '}' && peek(state, 1) === '}') {
      // Handle }} escaping outside interpolation
      value += advance(state); // consume first }
      value += advance(state); // consume second }
    } else {
      value += advance(state);
    }
  }

  // If we reach here, EOF was reached before closing """
  throw new LexerError(ERROR_IDS.RILL_L004, 'Unterminated string', start);
}

export function readNumber(state: LexerState): Token {
  const start = currentLocation(state);
  let value = '';

  while (!isAtEnd(state) && isDigit(peek(state))) {
    value += advance(state);
  }

  if (peek(state) === '.' && isDigit(peek(state, 1))) {
    value += advance(state); // consume .
    while (!isAtEnd(state) && isDigit(peek(state))) {
      value += advance(state);
    }
  }

  return makeToken(TOKEN_TYPES.NUMBER, value, start, currentLocation(state));
}

export function readIdentifier(state: LexerState): Token {
  const start = currentLocation(state);

  // Check for compound keyword (e.g. list[, dict[, destruct<) before consuming
  // any characters, so we can emit a single compound token when the bracket
  // immediately follows the keyword with zero whitespace.
  //
  // Guard: skip compound check when the character immediately before this
  // identifier is '$'. That handles variable names that happen to match a
  // collection keyword (e.g. `$list[0]` is subscript access, not a list literal).
  const prevChar = state.pos > 0 ? state.source[state.pos - 1] : '';
  if (prevChar !== '$') {
    const compound = tokenizeCompoundKeyword(state.source, state.pos);
    if (compound !== null) {
      // Consume keyword + bracket character (keyword.length + 1)
      const totalLen = compound.keyword.length + 1;
      for (let i = 0; i < totalLen; i++) advance(state);
      const value = compound.keyword + compound.bracket;
      return makeToken(
        compound.tokenType,
        value,
        start,
        currentLocation(state)
      );
    }
  }

  let value = '';

  while (!isAtEnd(state) && isIdentifierChar(peek(state))) {
    value += advance(state);
  }

  const type = KEYWORDS[value] ?? TOKEN_TYPES.IDENTIFIER;
  return makeToken(type, value, start, currentLocation(state));
}

/**
 * Read an atom literal: #NAME
 * Called when the current character is `#` and the next character is an
 * uppercase ASCII letter. Consumes the `#` plus the trailing identifier
 * characters and emits an ATOM token whose value is the name WITHOUT the
 * leading `#` sigil.
 *
 * The lexer performs only light shape checks (`[A-Z][A-Z0-9_]*`-ish by virtue
 * of starting on an uppercase letter and continuing on identifier chars). The
 * atom registry enforces strict validation at parse/resolution time.
 */
export function readAtom(state: LexerState): Token {
  const start = currentLocation(state);
  advance(state); // consume #

  let value = '';
  while (!isAtEnd(state) && isIdentifierChar(peek(state))) {
    value += advance(state);
  }

  return makeToken(TOKEN_TYPES.ATOM, value, start, currentLocation(state));
}

export function readVariable(state: LexerState): Token {
  const start = currentLocation(state);
  advance(state); // consume $

  // Check for accumulator variable: $@
  if (peek(state) === '@') {
    advance(state); // consume @
    return makeToken(TOKEN_TYPES.DOLLAR, '$@', start, currentLocation(state));
  }

  // Check if followed by identifier (named variable like $foo)
  if (isIdentifierStart(peek(state))) {
    return makeToken(TOKEN_TYPES.DOLLAR, '$', start, currentLocation(state));
  }

  // Lone $ is the pipe variable (current item in iteration)
  return makeToken(TOKEN_TYPES.PIPE_VAR, '$', start, currentLocation(state));
}
