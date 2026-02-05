/**
 * Lexer Helper Functions
 * Character classification and token construction
 */

import type { SourceLocation, Token, TokenType } from '../types.js';
import { advance, currentLocation, type LexerState } from './state.js';

export function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isLetter(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

export function isIdentifierStart(ch: string): boolean {
  return isLetter(ch) || ch === '_';
}

export function isIdentifierChar(ch: string): boolean {
  return isIdentifierStart(ch) || isDigit(ch);
}

export function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\r';
}

export function makeToken(
  type: TokenType,
  value: string,
  start: SourceLocation,
  end: SourceLocation
): Token {
  return { type, value, span: { start, end } };
}

/** Advance n times and return a token */
export function advanceAndMakeToken(
  state: LexerState,
  n: number,
  type: TokenType,
  value: string,
  start: SourceLocation
): Token {
  for (let i = 0; i < n; i++) advance(state);
  return makeToken(type, value, start, currentLocation(state));
}
