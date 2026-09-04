/**
 * Lexer State
 * Tracks position in source text during tokenization
 */

import type { SourceLocation, TokenType } from '../types.js';

export interface LexerState {
  readonly source: string;
  pos: number;
  line: number;
  column: number;
  baseOffset: number;
  inFrontmatter: boolean;
  /**
   * Type of the token emitted immediately before the one being read, or
   * undefined at the start of input. Maintained by the `tokenize()` loop so
   * readers can branch on the preceding token exactly, rather than
   * re-deriving it from raw characters.
   */
  prevTokenType: TokenType | undefined;
  /**
   * Value of that same token. Needed because DOLLAR is emitted for both the
   * `$` that prefixes a variable name and the self-contained accumulator
   * `$@`, which the type alone cannot tell apart.
   */
  prevTokenValue: string | undefined;
  /**
   * True once the first non-whitespace character has been consumed. Used to
   * detect frontmatter delimiters at actual file start while tolerating
   * leading blank lines, without re-scanning consumed source on every `---`
   * match (see tokenizer.ts).
   */
  sawNonWhitespace: boolean;
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
    prevTokenType: undefined,
    prevTokenValue: undefined,
    sawNonWhitespace: false,
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
    if (
      !state.sawNonWhitespace &&
      ch !== '' &&
      ch !== ' ' &&
      ch !== '\t' &&
      ch !== '\r'
    ) {
      state.sawNonWhitespace = true;
    }
  }
  return ch;
}

export function isAtEnd(state: LexerState): boolean {
  return state.pos >= state.source.length;
}
