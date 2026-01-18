/**
 * Tokenizer
 * Main tokenization logic
 */

import type { Token } from '../types.js';
import { TOKEN_TYPES } from '../types.js';
import { LexerError } from './errors.js';
import {
  advanceAndMakeToken,
  isDigit,
  isIdentifierStart,
  isWhitespace,
  makeToken,
} from './helpers.js';
import { SINGLE_CHAR_OPERATORS, TWO_CHAR_OPERATORS } from './operators.js';
import {
  readHeredoc,
  readIdentifier,
  readNumber,
  readString,
  readVariable,
} from './readers.js';
import {
  advance,
  createLexerState,
  currentLocation,
  isAtEnd,
  type LexerState,
  peek,
  peekString,
} from './state.js';

function skipWhitespace(state: LexerState): void {
  while (!isAtEnd(state) && isWhitespace(peek(state))) {
    advance(state);
  }
}

function skipComment(state: LexerState): void {
  if (peek(state) === '#') {
    while (!isAtEnd(state) && peek(state) !== '\n') {
      advance(state);
    }
  }
}

export function nextToken(state: LexerState): Token {
  skipWhitespace(state);
  skipComment(state);
  skipWhitespace(state);

  if (isAtEnd(state)) {
    const loc = currentLocation(state);
    return makeToken(TOKEN_TYPES.EOF, '', loc, loc);
  }

  const start = currentLocation(state);
  const ch = peek(state);

  // Newline
  if (ch === '\n') {
    advance(state);
    return makeToken(TOKEN_TYPES.NEWLINE, '\n', start, currentLocation(state));
  }

  // String
  if (ch === '"') {
    return readString(state);
  }

  // Heredoc
  if (ch === '<' && peek(state, 1) === '<') {
    return readHeredoc(state);
  }

  // Number (positive only - unary minus handled by parser)
  if (isDigit(ch)) {
    return readNumber(state);
  }

  // Identifier or keyword
  if (isIdentifierStart(ch)) {
    return readIdentifier(state);
  }

  // Variable
  if (ch === '$') {
    return readVariable(state);
  }

  // Three-character operators
  const threeChar = peekString(state, 3);
  if (threeChar === '---') {
    return advanceAndMakeToken(
      state,
      3,
      TOKEN_TYPES.FRONTMATTER_DELIM,
      '---',
      start
    );
  }

  // Two-character operators (lookup table)
  const twoChar = peekString(state, 2);
  const twoCharType = TWO_CHAR_OPERATORS[twoChar];
  if (twoCharType) {
    return advanceAndMakeToken(state, 2, twoCharType, twoChar, start);
  }

  // Single-character operators (lookup table)
  const singleCharType = SINGLE_CHAR_OPERATORS[ch];
  if (singleCharType) {
    return advanceAndMakeToken(state, 1, singleCharType, ch, start);
  }

  throw new LexerError(`Unexpected character: ${ch}`, start);
}

export function tokenize(source: string): Token[] {
  const state = createLexerState(source);
  const tokens: Token[] = [];
  let token: Token;

  do {
    token = nextToken(state);
    tokens.push(token);
  } while (token.type !== TOKEN_TYPES.EOF);

  return tokens;
}
