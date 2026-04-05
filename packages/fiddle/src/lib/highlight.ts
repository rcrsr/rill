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
  TOKEN_TYPES,
  type Token,
  type SourceLocation,
} from '@rcrsr/rill';

// ============================================================
// HIGHLIGHT CATEGORY TO TAG MAPPING
// ============================================================

/**
 * Maps HighlightCategory to @lezer/highlight Tag.
 * Typed as ReadonlyMap<string, Tag> to accommodate 'typeName' and 'functionName'
 * which are not part of the HighlightCategory union exported by core.
 */
const CATEGORY_TAG_MAP: ReadonlyMap<string, Tag> = new Map([
  ['keyword', tags.keyword],
  ['operator', tags.operator],
  ['string', tags.string],
  ['number', tags.number],
  ['bool', tags.bool],
  ['comment', tags.comment],
  ['variableName', tags.variableName],
  ['functionName', tags.function(tags.variableName)],
  ['typeName', tags.typeName],
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
  /** True when inside a multi-line triple-quote string that started on a previous line */
  inTripleQuoteString: boolean;
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Rill built-in type name literals.
 *
 * These tokens arrive as IDENTIFIER from the lexer. Value-based detection
 * intercepts them in getTokenTag() to return 'typeName' instead of
 * 'variableName', producing purple highlight rather than blue.
 *
 * Source: VALID_TYPE_NAMES in core constants.ts (not exported publicly).
 */
const TYPE_NAME_VALUES: ReadonlySet<string> = new Set([
  'string',
  'number',
  'bool',
  'closure',
  'list',
  'dict',
  'tuple',
  'ordered',
  'vector',
  'any',
  'type',
  'iterator',
  'stream',
  'datetime',
  'duration',
]);

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
  // Value-based detection: IDENTIFIER tokens whose value is a built-in type
  // name highlight as 'typeName' (purple) instead of 'variableName' (blue).
  if (token.type === 'IDENTIFIER' && TYPE_NAME_VALUES.has(token.value)) {
    return 'typeName';
  }

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

/**
 * Build a synthetic Token with 1-based column spans.
 *
 * @param type - TOKEN_TYPES value
 * @param value - Source text for this token
 * @param startCol - 1-based start column in the line
 * @param endCol - 1-based end column in the line (exclusive)
 * @param line - 1-based line number
 */
function makeSyntheticToken(
  type: Token['type'],
  value: string,
  startCol: number,
  endCol: number,
  line: number
): Token {
  return {
    type,
    value,
    span: {
      start: { line, column: startCol, offset: 0 },
      end: { line, column: endCol, offset: 0 },
    },
  };
}

/**
 * Check whether raw string source text contains an unescaped interpolation `{`.
 *
 * For single-line strings the text includes surrounding quotes.
 * For triple-quote continuation lines the text is raw line content.
 *
 * Escape rules:
 * - Single-line: `\X` skips the next char; any lone `{` starts interpolation.
 * - Triple-quote: `{{` is an escaped brace; any lone `{` starts interpolation.
 *
 * @param text - Source text to scan
 * @param isTriple - True when using triple-quote escape rules
 */
function containsInterpolation(text: string, isTriple: boolean): boolean {
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (!isTriple && ch === '\\') {
      // Single-line: backslash escapes next char
      i += 2;
      continue;
    }
    if (isTriple && ch === '{' && text[i + 1] === '{') {
      // Triple-quote: {{ is escaped
      i += 2;
      continue;
    }
    if (isTriple && ch === '}' && text[i + 1] === '}') {
      // Triple-quote: }} is escaped
      i += 2;
      continue;
    }
    if (ch === '{') {
      return true;
    }
    i++;
  }
  return false;
}

/**
 * Tokenize an interpolation expression and offset column positions.
 *
 * Calls tokenize() on just the expression text and shifts all token columns
 * by (exprAbsoluteStartCol - 1) so they align with the line position.
 * Filters out EOF and NEWLINE tokens. Falls back to a single IDENTIFIER
 * token covering the whole expression if tokenize throws.
 *
 * @param exprText - Expression source text (without braces)
 * @param exprAbsoluteStartCol - 1-based column of the first char of exprText in the line
 * @param line - 1-based line number for span metadata
 */
function tokenizeExpression(
  exprText: string,
  exprAbsoluteStartCol: number,
  line: number
): Token[] {
  const baseLocation: SourceLocation = {
    line,
    column: exprAbsoluteStartCol,
    offset: 0,
  };

  try {
    const raw = tokenize(exprText, baseLocation, { includeComments: true });
    return raw.filter(
      (t) => t.type !== TOKEN_TYPES.EOF && t.type !== TOKEN_TYPES.NEWLINE
    );
  } catch {
    // Fall back to one IDENTIFIER token spanning the expression
    return [
      makeSyntheticToken(
        TOKEN_TYPES.IDENTIFIER,
        exprText,
        exprAbsoluteStartCol,
        exprAbsoluteStartCol + exprText.length,
        line
      ),
    ];
  }
}

/**
 * Split a STRING token that contains `{expr}` interpolations into sub-tokens.
 *
 * Produces a flat array of synthetic tokens:
 * - String content segments → STRING tokens
 * - `{` → LBRACE token
 * - Expression content → tokens from tokenizeExpression()
 * - `}` → RBRACE token
 *
 * If a `{` has no matching `}` on the same line the remainder is emitted
 * as a single STRING token (fall-back).
 *
 * @param token - Original STRING token from getTokensForLine()
 * @param lineText - Full line source text
 * @param isTriple - True when triple-quote escape rules apply
 */
function splitStringToken(
  token: Token,
  lineText: string,
  isTriple: boolean
): Token[] {
  // Span uses 1-based columns; slice uses 0-based indices.
  const absStart = token.span.start.column - 1; // 0-based index in lineText
  const absEnd = token.span.end.column - 1;
  const src = lineText.slice(absStart, absEnd);
  const line = token.span.start.line;

  const result: Token[] = [];
  let i = 0; // position within src
  let segStart = 0; // start of current string content segment within src

  const flushStringSeg = (end: number): void => {
    if (end > segStart) {
      const segValue = src.slice(segStart, end);
      result.push(
        makeSyntheticToken(
          TOKEN_TYPES.STRING,
          segValue,
          absStart + segStart + 1, // convert to 1-based
          absStart + end + 1,
          line
        )
      );
    }
  };

  while (i < src.length) {
    const ch = src[i];

    if (!isTriple && ch === '\\') {
      // Single-line escape: skip backslash and next char
      i += 2;
      continue;
    }

    if (isTriple && ch === '{' && src[i + 1] === '{') {
      // Triple-quote escaped brace
      i += 2;
      continue;
    }

    if (isTriple && ch === '}' && src[i + 1] === '}') {
      // Triple-quote escaped closing brace
      i += 2;
      continue;
    }

    if (ch === '{') {
      // Flush string content before the brace
      flushStringSeg(i);

      // Emit LBRACE at this position (1-based)
      const lbraceCol = absStart + i + 1;
      result.push(
        makeSyntheticToken(
          TOKEN_TYPES.LBRACE,
          '{',
          lbraceCol,
          lbraceCol + 1,
          line
        )
      );
      i++; // move past '{'

      // Find matching '}' with brace depth tracking
      let depth = 1;
      let j = i;
      while (j < src.length && depth > 0) {
        const c = src[j];
        if (!isTriple && c === '\\') {
          j += 2;
          continue;
        }
        if (c === '{') {
          depth++;
        } else if (c === '}') {
          depth--;
        }
        if (depth > 0) j++;
        else break;
      }

      if (depth !== 0) {
        // No matching '}' on this line — emit rest as STRING and stop
        const restValue = src.slice(i);
        if (restValue.length > 0) {
          result.push(
            makeSyntheticToken(
              TOKEN_TYPES.STRING,
              restValue,
              absStart + i + 1,
              absStart + src.length + 1,
              line
            )
          );
        }
        return result;
      }

      // Tokenize the expression between braces
      const exprText = src.slice(i, j);
      const exprAbsoluteStartCol = absStart + i + 1; // 1-based
      const exprTokens = tokenizeExpression(
        exprText,
        exprAbsoluteStartCol,
        line
      );
      result.push(...exprTokens);

      // Emit RBRACE
      const rbraceCol = absStart + j + 1;
      result.push(
        makeSyntheticToken(
          TOKEN_TYPES.RBRACE,
          '}',
          rbraceCol,
          rbraceCol + 1,
          line
        )
      );

      i = j + 1; // move past '}'
      segStart = i;
      continue;
    }

    i++;
  }

  // Flush any remaining string content
  flushStringSeg(src.length);

  return result;
}

/**
 * Expand STRING tokens that contain interpolations into sub-token sequences.
 *
 * Non-STRING tokens and STRING tokens without interpolation pass through
 * unchanged.
 *
 * @param tokens - Token array from getTokensForLine()
 * @param lineText - Full line source text
 */
function expandStringInterpolations(
  tokens: Token[],
  lineText: string
): Token[] {
  const result: Token[] = [];
  for (const token of tokens) {
    if (token.type !== TOKEN_TYPES.STRING) {
      result.push(token);
      continue;
    }

    // Detect whether this is a triple-quote string
    const absStart = token.span.start.column - 1;
    const src = lineText.slice(absStart, token.span.end.column - 1);
    const isTriple = src.startsWith('"""');

    if (!containsInterpolation(src, isTriple)) {
      result.push(token);
      continue;
    }

    result.push(...splitStringToken(token, lineText, isTriple));
  }
  return result;
}

/**
 * Scan a raw triple-quote continuation line for interpolations and return
 * synthetic tokens. The line has no surrounding quotes — triple-quote escape
 * rules apply throughout.
 *
 * Returns null when no interpolation is found so the caller can fall back to
 * the existing skipToEnd() path.
 *
 * @param lineText - Raw line content (not including quotes)
 * @param lineNumber - 1-based line number for span metadata
 */
function expandTripleContinuationLine(
  lineText: string,
  lineNumber: number
): Token[] | null {
  if (!containsInterpolation(lineText, true)) {
    return null;
  }

  // Wrap the whole line as a virtual STRING token then split it.
  // Column span covers columns 1..(length+1) so 0-based slice is [0, length].
  const virtualToken: Token = makeSyntheticToken(
    TOKEN_TYPES.STRING,
    lineText,
    1,
    lineText.length + 1,
    lineNumber
  );

  return splitStringToken(virtualToken, lineText, true);
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
      inTripleQuoteString: false,
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
    // At start of line, handle multi-line triple-quote string or tokenize normally
    if (stream.sol()) {
      if (state.inTripleQuoteString) {
        // Inside a multi-line triple-quote string from a previous line.
        // Check for closing """ first.
        if (stream.string.includes('"""')) {
          state.inTripleQuoteString = false;
          // Fall through to skipToEnd — closing line is all string content.
          stream.skipToEnd();
          if (!state.lineComplete) {
            state.lineNumber++;
            state.lineComplete = true;
          }
          return 'string';
        }

        // Try to split the raw line for interpolation sub-highlighting.
        const continuationTokens = expandTripleContinuationLine(
          stream.string,
          state.lineNumber + 1
        );

        if (continuationTokens !== null) {
          state.lineTokens = continuationTokens;
          state.tokenIndex = 0;
          state.lineComplete = false;
          // Fall through to normal token-matching below.
        } else {
          stream.skipToEnd();
          if (!state.lineComplete) {
            state.lineNumber++;
            state.lineComplete = true;
          }
          return 'string';
        }
      } else {
        state.lineTokens = expandStringInterpolations(
          getTokensForLine(stream.string),
          stream.string
        );
        state.tokenIndex = 0;
        state.lineComplete = false;

        // Opening """ without a closing """ on the same line causes tokenize to throw
        // (RILL-L004 unterminated string), returning []. Enter multi-line string mode.
        if (state.lineTokens.length === 0 && stream.string.includes('"""')) {
          state.inTripleQuoteString = true;
          stream.skipToEnd();
          if (!state.lineComplete) {
            state.lineNumber++;
            state.lineComplete = true;
          }
          return 'string';
        }
      }
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
      inTripleQuoteString: state.inTripleQuoteString,
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
