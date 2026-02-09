/**
 * Syntax Highlighter Module
 *
 * Implements StreamParser for rill syntax highlighting in CodeMirror.
 * Uses @rcrsr/rill tokenize() function and TOKEN_HIGHLIGHT_MAP to map
 * token types to highlight tags.
 *
 * This module is framework-agnostic and contains no React dependencies.
 */

import { type StreamParser } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { Tag } from '@lezer/highlight';
import {
  tokenize,
  TOKEN_HIGHLIGHT_MAP,
  type HighlightCategory,
  type Token,
} from '@rcrsr/rill';

// ============================================================
// HIGHLIGHT CATEGORY TO TAG MAPPING
// ============================================================

/**
 * Maps HighlightCategory to @lezer/highlight Tag
 */
const CATEGORY_TAG_MAP: ReadonlyMap<HighlightCategory, Tag> = new Map([
  ['keyword', tags.keyword],
  ['operator', tags.operator],
  ['string', tags.string],
  ['number', tags.number],
  ['bool', tags.bool],
  ['comment', tags.comment],
  ['variableName', tags.variableName],
  ['punctuation', tags.punctuation],
  ['bracket', tags.bracket],
  ['meta', tags.meta],
]);

// ============================================================
// STREAM PARSER STATE
// ============================================================

/**
 * StreamParser state for rill highlighter
 *
 * Tracks current line number for token lookup.
 * Note: StreamParser doesn't provide full document access,
 * so we tokenize line-by-line which may not handle multi-line
 * constructs correctly. This is acceptable per spec.
 */
export interface RillHighlightState {
  /** Current line number (0-based, incremented after each line completes) */
  lineNumber: number;
  /** Tokens for current line */
  lineTokens: Token[];
  /** Current token index in lineTokens */
  tokenIndex: number;
  /** Flag to track if line number was incremented for current line */
  lineComplete: boolean;
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Get tokens for a single line with error handling
 *
 * Tokenizes just the provided line text. Multi-line constructs
 * (like triple-quote strings) may not highlight correctly.
 *
 * @param lineText - Line text to tokenize
 * @returns Token array, or empty array on error
 */
function getTokensForLine(lineText: string): Token[] {
  try {
    // Tokenize single line with comments included for syntax highlighting
    // AC-24: Handle tokenize errors by returning empty array
    return tokenize(lineText, undefined, { includeComments: true });
  } catch {
    // EC-3: Tokenize throws error - return empty array
    return [];
  }
}

/**
 * Get highlight tag for token
 *
 * @param token - Token from tokenize
 * @returns Tag string for CodeMirror, or null if no highlight
 */
function getTokenTag(token: Token): string | null {
  // EC-4: TOKEN_HIGHLIGHT_MAP missing category - return undefined
  const category = TOKEN_HIGHLIGHT_MAP.get(token.type);
  if (category === undefined) {
    return null;
  }

  const tag = CATEGORY_TAG_MAP.get(category);
  if (tag === undefined) {
    return null;
  }

  // Return tag name for CodeMirror (e.g., "keyword", "operator")
  return category;
}

// ============================================================
// STREAM PARSER IMPLEMENTATION
// ============================================================

/**
 * StreamParser for rill syntax highlighting
 *
 * Implements CodeMirror StreamParser interface using rill's tokenize() function.
 * Tokenizes full source on every keystroke and maps TokenType to HighlightCategory
 * to @lezer/highlight tags.
 *
 * Usage:
 * ```typescript
 * import { StreamLanguage } from '@codemirror/language';
 * import { rillHighlighter } from './lib/highlight.js';
 *
 * const rillLanguage = StreamLanguage.define(rillHighlighter);
 * ```
 */
export const rillHighlighter: StreamParser<RillHighlightState> = {
  name: 'rill',

  /**
   * Initialize parser state for a new document
   *
   * @param _indentUnit - Indent unit size (not used by rill highlighter)
   */
  startState(_indentUnit: number): RillHighlightState {
    return {
      lineNumber: 0,
      lineTokens: [],
      tokenIndex: 0,
      lineComplete: false,
    };
  },

  /**
   * Tokenize one line and return highlight tag
   *
   * Called by CodeMirror for each line of text. Updates StringStream position
   * and returns tag string for the consumed token.
   *
   * @param stream - StringStream for current line
   * @param state - Parser state
   * @returns Tag string or null
   */
  token(stream, state): string | null {
    // At start of line, tokenize the line and reset line complete flag
    if (stream.sol()) {
      state.lineTokens = getTokensForLine(stream.string);
      state.tokenIndex = 0;
      state.lineComplete = false;
    }

    // End of line - increment line number once per line
    if (stream.eol()) {
      if (!state.lineComplete) {
        state.lineNumber++;
        state.lineComplete = true;
      }
      return null;
    }

    // Find token at current position
    const currentPos = stream.pos;
    let matchedToken: Token | undefined;

    for (const token of state.lineTokens) {
      const tokenStart = token.span.start.column - 1; // Convert 1-based to 0-based
      const tokenEnd = token.span.end.column - 1;

      if (currentPos >= tokenStart && currentPos < tokenEnd) {
        matchedToken = token;
        break;
      }
    }

    if (matchedToken) {
      // Advance stream to end of token
      const tokenEnd = matchedToken.span.end.column - 1;
      const charsToAdvance = tokenEnd - currentPos;

      if (charsToAdvance > 0) {
        for (let i = 0; i < charsToAdvance; i++) {
          stream.next();
        }
      } else {
        // Safety: advance at least one character to prevent infinite loop
        stream.next();
      }

      // Check if we just reached end of line after advancing
      if (stream.eol() && !state.lineComplete) {
        state.lineNumber++;
        state.lineComplete = true;
      }

      return getTokenTag(matchedToken);
    }

    // No token found - advance one character
    stream.next();

    // Check if we just reached end of line
    if (stream.eol() && !state.lineComplete) {
      state.lineNumber++;
      state.lineComplete = true;
    }

    return null;
  },

  /**
   * Copy state for incremental parsing
   */
  copyState(state): RillHighlightState {
    return {
      lineNumber: state.lineNumber,
      lineTokens: [...state.lineTokens],
      tokenIndex: state.tokenIndex,
      lineComplete: state.lineComplete,
    };
  },

  /**
   * Handle blank lines
   *
   * @param state - Parser state
   * @param _indentUnit - Indent unit size (not used)
   */
  blankLine(state, _indentUnit: number): void {
    state.lineNumber++;
  },
};
