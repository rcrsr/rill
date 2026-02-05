/**
 * Token Readers
 * Functions to read specific token types from source
 */

import type { Token } from '../types.js';
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
        'RILL-L005',
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
      throw new LexerError('RILL-L001', 'Unterminated string literal', start);
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
            'RILL-L005',
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
  throw new LexerError('RILL-L004', 'Unterminated string', start);
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
  let value = '';

  while (!isAtEnd(state) && isIdentifierChar(peek(state))) {
    value += advance(state);
  }

  const type = KEYWORDS[value] ?? TOKEN_TYPES.IDENTIFIER;
  return makeToken(type, value, start, currentLocation(state));
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
