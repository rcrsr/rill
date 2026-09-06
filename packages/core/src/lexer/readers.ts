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
 * - `{` brace-body: block heads (guard)
 *
 * The brace-body flavor is a parallel addition alongside the other two, not a
 * replacement. It reuses the same dispatch table so the lexer emits a single
 * compound token without leaking opener discrimination into the parser.
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

/**
 * Skips a `"`-delimited nested string literal encountered while scanning an
 * interpolation's brace depth, honoring `\"` escapes, and returns the
 * consumed text (both delimiters included). Assumes the current character
 * is the opening `"` and it is not the start of a triple-quote sequence.
 *
 * Interpolation text can itself contain string literals (e.g.
 * `{$x.eq("}")}`), and those literals may contain brace characters that
 * must not be mistaken for the interpolation's own `{`/`}`. Skipping the
 * whole nested literal as a unit keeps brace-depth counting in sync with
 * the actual interpolation boundaries.
 */
function skipNestedDoubleQuotedString(state: LexerState): string {
  let text = advance(state); // consume opening "
  while (!isAtEnd(state) && peek(state) !== '"') {
    if (peek(state) === '\\') {
      text += advance(state); // consume backslash
      if (!isAtEnd(state)) {
        text += advance(state); // consume escaped character
      }
    } else {
      text += advance(state);
    }
  }
  if (!isAtEnd(state)) {
    text += advance(state); // consume closing "
  }
  return text;
}

/**
 * Skips a `"""`-delimited nested triple-quote string literal encountered
 * while scanning an interpolation's brace depth, and returns the consumed
 * text (both delimiters included). Assumes the current character is the
 * first `"` of the opening triple-quote sequence. Triple-quote strings do
 * not process backslash escapes, so this only has to search for the
 * matching closing `"""`.
 */
function skipNestedTripleQuotedString(state: LexerState): string {
  let text = advance(state) + advance(state) + advance(state); // consume opening """
  while (
    !isAtEnd(state) &&
    !(peek(state) === '"' && peek(state, 1) === '"' && peek(state, 2) === '"')
  ) {
    text += advance(state);
  }
  if (!isAtEnd(state)) {
    text += advance(state) + advance(state) + advance(state); // consume closing """
  }
  return text;
}

/**
 * Skips a nested string literal (single- or triple-quoted) encountered
 * while scanning an interpolation's brace depth from within a
 * single-quoted outer string. Dispatches to the triple-quote form when the
 * current position starts a `"""` sequence, otherwise the plain form.
 */
function skipNestedStringInInterpolation(state: LexerState): string {
  if (peek(state) === '"' && peek(state, 1) === '"' && peek(state, 2) === '"') {
    return skipNestedTripleQuotedString(state);
  }
  return skipNestedDoubleQuotedString(state);
}

export function readString(state: LexerState): Token {
  const start = currentLocation(state);
  advance(state); // consume opening "

  let value = '';
  // Every decoded escape (\n, \r, \t, \\, \") shrinks a 2-character raw
  // sequence into a single decoded character, so an index into `value`
  // undercounts the matching offset in the raw source by one per escape
  // that precedes it. Record the decoded length immediately after each
  // escape is appended so a decoded-string index can later be translated
  // back to its true source offset (see parser-literals.ts's
  // mapDecodedIndexToSourceOffset). Escape decoding is suspended once an
  // interpolation's braceDepth > 0 (below), so breakpoints only ever land
  // in the literal segments of the string, which is exactly where the
  // parser needs to translate positions.
  const escapeBreakpoints: number[] = [];
  while (!isAtEnd(state) && peek(state) !== '"') {
    if (peek(state) === '\\') {
      advance(state); // consume backslash
      value += processEscape(state);
      escapeBreakpoints.push(value.length);
    } else if (peek(state) === '{') {
      // Check for brace escaping ({{) outside interpolation
      if (peek(state, 1) === '{') {
        value += advance(state); // consume first {
        value += advance(state); // consume second {
        continue;
      }

      // Interpolation: include {expr} literally, parser handles expression
      // parsing. Escape decoding is suspended while braceDepth > 0 so the
      // interpolation text reaches the parser raw, matching
      // readTripleQuoteString's handling.
      value += advance(state); // consume {
      // Brace-escaping ({{, }}) does not apply inside interpolation: every
      // { and } here is real rill code (nested blocks, dicts, closures) that
      // the parser will re-tokenize, so each brace must be counted, not
      // speculatively swallowed as a literal pair. Swallowing a pair whose
      // first brace actually closes a nested construct desyncs braceDepth
      // and runs the scanner past the end of the string.
      let braceDepth = 1;
      while (!isAtEnd(state) && braceDepth > 0) {
        if (peek(state) === '"') {
          // A nested string literal's own braces don't belong to the
          // interpolation's depth count, so skip the whole literal.
          value += skipNestedStringInInterpolation(state);
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
    const token: Token & { escapeBreakpoints?: readonly number[] } = {
      ...makeToken(TOKEN_TYPES.STRING, value, start, currentLocation(state)),
      ...(escapeBreakpoints.length > 0 ? { escapeBreakpoints } : {}),
    };
    return token;
  }

  // If we reach here, EOF was reached before closing "
  throw new LexerError(
    ERROR_IDS.RILL_L001,
    'Unterminated string literal',
    start
  );
}

export function readTripleQuoteString(state: LexerState): Token {
  const start = currentLocation(state);
  advance(state); // consume first "
  advance(state); // consume second "
  advance(state); // consume third "

  // Skip opening newline if present (Python-style). A CRLF pair must be
  // consumed as a unit so the carriage return doesn't leak into the string
  // value.
  if (peek(state) === '\r' && peek(state, 1) === '\n') {
    advance(state);
    advance(state);
  } else if (peek(state) === '\n') {
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

      // Interpolation: include {expr} literally, parser handles expression
      // parsing. Brace-escaping ({{, }}) does not apply inside interpolation:
      // every { and } here is real rill code (nested blocks, dicts,
      // closures) that the parser will re-tokenize, so each brace must be
      // counted, not speculatively swallowed as a literal pair. Swallowing a
      // pair whose first brace actually closes a nested construct desyncs
      // braceDepth and runs the scanner past the end of the string.
      value += advance(state); // consume {
      let braceDepth = 1;
      while (!isAtEnd(state) && braceDepth > 0) {
        // Check for """ inside interpolation. Unlike the single-quote outer
        // string, a nested triple-quote is never skipped here: it stays a
        // hard error rather than a valid nested literal.
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

        if (peek(state) === '"') {
          // A nested (non-triple) string literal's own braces don't belong
          // to the interpolation's depth count, so skip the whole literal.
          value += skipNestedDoubleQuotedString(state);
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

  const trailing = peek(state);
  if (trailing === '_') {
    throw new LexerError(
      ERROR_IDS.RILL_L003,
      'digit separators are not supported',
      currentLocation(state)
    );
  }
  if (isIdentifierStart(trailing)) {
    throw new LexerError(
      ERROR_IDS.RILL_L003,
      `malformed number literal: unexpected '${trailing}' after number`,
      currentLocation(state)
    );
  }

  return makeToken(TOKEN_TYPES.NUMBER, value, start, currentLocation(state));
}

export function readIdentifier(state: LexerState): Token {
  const start = currentLocation(state);

  // Check for compound keyword (e.g. list[, dict[, destruct<) before consuming
  // any characters, so we can emit a single compound token when the bracket
  // immediately follows the keyword with zero whitespace.
  //
  // Guard 1: skip compound check when this identifier is a variable's name,
  // i.e. it follows the `$` sigil (e.g. `$list[0]` is subscript access, not a
  // list literal). readVariable() emits a bare DOLLAR and leaves the name to
  // this function. The value test is load-bearing: readVariable also emits
  // DOLLAR for the accumulator `$@`, which is a complete variable carrying
  // its own name, so type alone would wrongly suppress the compound check on
  // whatever follows it.
  //
  // Guard 2: skip compound check when this identifier follows a DOT or
  // DOT_QUESTION token (member access). A dot is never followed by a
  // collection literal, angle-delimited head, or block head, so every entry
  // in COMPOUND_KEYWORD_MAP is member-access text in that position (e.g.
  // `$d.retry<10` is a member named `retry` followed by `<`, not a
  // `retry<...>` block). Suppressing uniformly, rather than special-casing
  // only the reserved-word entries, keeps the rule simple and correct for
  // the non-reserved-word entries too (`list`, `dict`, `tuple`, `ordered`,
  // `destruct`, `slice`, `use`, `timeout`).
  //
  // Both guards test the preceding TOKEN, not the preceding characters. A
  // character-level test has to special-case the `...` spread operator,
  // which also ends in `.` (`...ordered[a: 1]` is a spread, not member
  // access), and would need further patching for any future operator
  // ending in `.` or `?`. Reading the token type is exact, and matches the
  // DOT/DOT_QUESTION test the post-tokenize METHOD_NAME rewrite in
  // ./tokenizer.ts already uses, so the two cannot disagree.
  const prev = state.prevTokenType;
  const suppressCompound =
    (prev === TOKEN_TYPES.DOLLAR && state.prevTokenValue === '$') ||
    prev === TOKEN_TYPES.DOT ||
    prev === TOKEN_TYPES.DOT_QUESTION;
  if (!suppressCompound) {
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

  const type = Object.hasOwn(KEYWORDS, value)
    ? (KEYWORDS[value] as TokenType)
    : TOKEN_TYPES.IDENTIFIER;
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

  if (isDigit(peek(state))) {
    throw new LexerError(
      ERROR_IDS.RILL_L003,
      'Invalid variable name: $ must be followed by a letter or _',
      currentLocation(state)
    );
  }

  // Lone $ is the pipe variable (current item in iteration)
  return makeToken(TOKEN_TYPES.PIPE_VAR, '$', start, currentLocation(state));
}
