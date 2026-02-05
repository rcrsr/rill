/**
 * Lexer State
 * Tracks position in source text during tokenization
 */

import type { SourceLocation } from '../types.js';

export interface LexerState {
  readonly source: string;
  pos: number;
  line: number;
  column: number;
  baseOffset: number;
  inFrontmatter: boolean;
}

export function createLexerState(
  source: string,
  baseLocation?: SourceLocation
): LexerState {
  return {
    source,
    pos: 0,
    line: baseLocation?.line ?? 1,
    column: baseLocation?.column ?? 1,
    baseOffset: baseLocation?.offset ?? 0,
    inFrontmatter: false,
  };
}

export function currentLocation(state: LexerState): SourceLocation {
  return {
    line: state.line,
    column: state.column,
    offset: state.pos + state.baseOffset,
  };
}

export function peek(state: LexerState, offset = 0): string {
  return state.source[state.pos + offset] ?? '';
}

export function peekString(state: LexerState, length: number): string {
  return state.source.slice(state.pos, state.pos + length);
}

export function advance(state: LexerState): string {
  const ch = state.source[state.pos] ?? '';
  state.pos++;
  if (ch === '\n') {
    state.line++;
    state.column = 1;
  } else {
    state.column++;
  }
  return ch;
}

export function isAtEnd(state: LexerState): boolean {
  return state.pos >= state.source.length;
}
