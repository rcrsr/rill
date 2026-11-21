/**
 * Parser Helper: Control Statement Options
 *
 * Shared by `guard`, `retry`, `timeout`, `pass`, and the loop keyword `do`.
 * A control statement takes its options as a dict written in parentheses
 * after the keyword: `retry(attempts: 3, on: #TIMEOUT) { body }`. The parser
 * checks only what the source text alone decides; the options type (unknown,
 * missing, or wrong-typed fields) is checked when the statement runs.
 */

import type { Parser } from './parser.js';
import type {
  DictEntryNode,
  DictNode,
  ExpressionNode,
  PrimaryNode,
  RecoveryErrorNode,
  SourceLocation,
} from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import {
  check,
  advance,
  expect,
  current,
  previous,
  peek,
  makeSpan,
  reportError,
  skipNewlines,
  type ParserState,
} from './state.js';
import {
  parseDictEntryOrSpread,
  rejectDuplicateKey,
  rejectTrailingComma,
} from './parser-literals.js';
import { ERROR_IDS } from '../error-registry.js';
import { ERROR_CODE_NAMES } from '../constants.js';

/** Keywords whose options are written as a parenthesized dict. */
export type OptionKeyword = 'guard' | 'retry' | 'timeout' | 'pass' | 'do';

const ANGLE_HINTS: Readonly<Record<OptionKeyword, string>> = {
  guard: 'write guard(on: #CODE) { body }',
  retry:
    "write retry(attempts: N, on: #CODE) { body }; the bound 'limit' is now 'attempts'",
  timeout: 'write timeout(total: duration, idle: duration) { body }',
  pass: "write pass(async: true) { body } or pass(ignore_halts: true) { body }; the option that took #IGNORE is now 'ignore_halts: true'",
  do: 'write do(limit: N) { body }',
};

// ============================================================
// DETECTION
// ============================================================

/**
 * True when the cursor holds a contextual keyword, one that is also an
 * ordinary name (`timeout`, `pass`), and an option list follows it. The list
 * opens at `(` when it starts with a `key:` entry, or when its matching `)` is
 * followed on the same line by `{`. A `<` touching the keyword also counts, so
 * the angle-bracket form is reported, not read as a comparison.
 */
export function atContextualOptions(state: ParserState): boolean {
  const keyword = current(state);
  const next = peek(state, 1);
  if (next.type === TOKEN_TYPES.LT) {
    return next.span.start.offset === keyword.span.end.offset;
  }
  if (next.type !== TOKEN_TYPES.LPAREN) return false;
  if (peek(state, 3).type === TOKEN_TYPES.COLON) return true;
  return parenCloseFollowedByBrace(state);
}

/**
 * True when the cursor holds the identifier `timeout` that opens a timeout
 * block. `timeout` is no reserved word, so a host function may carry the name.
 */
export function atTimeoutBlock(state: ParserState): boolean {
  const token = current(state);
  return (
    token.type === TOKEN_TYPES.IDENTIFIER &&
    token.value === 'timeout' &&
    atContextualOptions(state)
  );
}

/** True when the `(` one token ahead closes at a `)` directly followed by `{`. */
function parenCloseFollowedByBrace(state: ParserState): boolean {
  let depth = 0;
  for (let offset = 1; ; offset++) {
    const type = peek(state, offset).type;
    if (type === TOKEN_TYPES.EOF) return false;
    if (type === TOKEN_TYPES.LPAREN) depth++;
    if (type === TOKEN_TYPES.RPAREN) {
      depth--;
      if (depth === 0) {
        return peek(state, offset + 1).type === TOKEN_TYPES.LBRACE;
      }
    }
  }
}

// ============================================================
// ANGLE-BRACKET FORM
// ============================================================

/**
 * Raise RILL-P025 when the cursor, just after a keyword, holds `<`: the
 * removed angle-bracket option list. `pass` and `timeout` also precede a
 * comparison, so for them only a `<` touching the keyword counts.
 */
function rejectAngleOptions(state: ParserState, keyword: OptionKeyword): void {
  if (!check(state, TOKEN_TYPES.LT)) return;
  const angle = current(state);
  const touches = previous(state).span.end.offset === angle.span.start.offset;
  if ((keyword === 'pass' || keyword === 'timeout') && !touches) return;
  throw new ParseError(
    ERROR_IDS.RILL_P025,
    `Options of '${keyword}' go in parentheses, not angle brackets: ${ANGLE_HINTS[keyword]}`,
    angle.span.start
  );
}

// ============================================================
// PARENTHESIZED OPTIONS
// ============================================================

/**
 * Parse the options of a control statement. The keyword is already consumed.
 *
 * Returns null when the cursor holds no `(`. Otherwise consumes
 * `( entry, ... )` and returns the entries as a DictNode. An entry is
 * `key: expression` or `...expression`, as in a dict literal, in any order.
 * An empty `()` is legal and yields an empty dict. A written key that repeats
 * halts with RILL-P027. A `<` where the options belong halts with RILL-P025.
 *
 * `retry` and `do` also require their bound to be a written literal
 * (RILL-P004).
 *
 * @param parser - Parser positioned just after the keyword
 * @param keyword - Keyword whose options are parsed
 */
export function parseParenOptions(
  parser: Parser,
  keyword: OptionKeyword
): DictNode | null {
  const state = parser.state;
  rejectAngleOptions(state, keyword);
  if (!check(state, TOKEN_TYPES.LPAREN)) return null;

  const open = advance(state);
  const entries: DictEntryNode[] = [];
  const seenKeys = new Set<string>();
  const collection = `${keyword}() options`;

  skipNewlines(state);
  while (!check(state, TOKEN_TYPES.RPAREN)) {
    const entry = parseDictEntryOrSpread(parser);
    rejectDuplicateKey(seenKeys, entry, collection);
    entries.push(entry);
    skipNewlines(state);
    if (!check(state, TOKEN_TYPES.COMMA)) break;
    const comma = advance(state);
    skipNewlines(state);
    rejectTrailingComma(state, comma, collection, TOKEN_TYPES.RPAREN);
  }
  const close = expect(
    state,
    TOKEN_TYPES.RPAREN,
    `Expected ')' to close '${keyword}(...)'`,
    ERROR_IDS.RILL_P005
  );

  const options: DictNode = {
    type: 'Dict',
    entries,
    defaultValue: null,
    span: makeSpan(open.span.start, close.span.end),
  };
  if (keyword === 'retry' || keyword === 'do') {
    requireLiteralBound(keyword, options);
  }
  return options;
}

// ============================================================
// WRITTEN-OPTION CHECKS
// ============================================================

/** True for a `...expression` entry, which carries no key form. */
function isSpreadEntry(entry: DictEntryNode): boolean {
  return entry.key === '...' && entry.keyForm === undefined;
}

/**
 * The single primary a value is written as, or undefined when the value is
 * anything richer: a pipe, a method, a default, or a type suffix.
 */
function writtenPrimary(value: ExpressionNode): PrimaryNode | undefined {
  if (value.type !== 'PipeChain') return undefined;
  if (value.pipes.length > 0 || value.terminator !== null) return undefined;
  const head = value.head;
  if (head.type !== 'PostfixExpr') return undefined;
  if (head.methods.length > 0 || head.defaultValue !== null) return undefined;
  if (head.existenceCheck !== null && head.existenceCheck !== undefined) {
    return undefined;
  }
  return head.primary;
}

/**
 * Raise RILL-P004 unless the loop or retry bound is a written positive
 * integer literal. A bound the script computes is no bound, so the options of
 * `retry` and `do` accept no spread, no variable, computed, or multi-key
 * entry, and no non-literal bound.
 */
function requireLiteralBound(keyword: 'retry' | 'do', options: DictNode): void {
  const bound = keyword === 'retry' ? 'attempts' : 'limit';
  for (const entry of options.entries) {
    if (isSpreadEntry(entry)) {
      throw new ParseError(
        ERROR_IDS.RILL_P004,
        `'${keyword}' options cannot be spread; write '${bound}' as a literal`,
        entry.span.start
      );
    }
    if (typeof entry.key !== 'string') {
      throw new ParseError(
        ERROR_IDS.RILL_P004,
        `Option names of '${keyword}' must be written names, not variable, computed, or multi-key entries`,
        entry.span.start
      );
    }
    if (entry.key !== bound) continue;
    const primary = writtenPrimary(entry.value);
    if (
      primary?.type !== 'NumberLiteral' ||
      !Number.isInteger(primary.value) ||
      primary.value < 1
    ) {
      throw new ParseError(
        ERROR_IDS.RILL_P004,
        `'${bound}' in '${keyword}' must be a positive integer written as a literal`,
        entry.value.span.start
      );
    }
  }
}

/**
 * Report RILL-P004 for a written `on` option that cannot select a halt: an
 * atom outside the core error set, or an empty list. A computed `on` is
 * checked when the statement runs.
 *
 * A strict parse throws. In recovery mode the error is collected, the body
 * that follows the options is consumed so the stream stays in step, and the
 * returned RecoveryErrorNode stands in for the whole statement. Returns null
 * when `on` is acceptable.
 *
 * @param parser - Parser positioned just after the options
 * @param options - Options of a `guard` or `retry`, or null when none were written
 * @param start - Start of the statement
 */
export function checkWrittenOn(
  parser: Parser,
  options: DictNode | null,
  start: SourceLocation
): RecoveryErrorNode | null {
  const message = invalidOnMessage(options);
  if (message === undefined) return null;
  const state = parser.state;
  reportError(state, ERROR_IDS.RILL_P004, message, start);
  if (check(state, TOKEN_TYPES.LBRACE)) parser.parseBlock(true);
  const end = previous(state).span.end;
  return {
    type: 'RecoveryError',
    message,
    text: state.source.slice(start.offset, end.offset),
    span: makeSpan(start, end),
  };
}

/** The first problem in a written `on` option, or undefined when it has none. */
function invalidOnMessage(options: DictNode | null): string | undefined {
  for (const entry of options?.entries ?? []) {
    if (entry.key !== 'on' || isSpreadEntry(entry)) continue;
    const primary = writtenPrimary(entry.value);
    if (primary?.type === 'AtomLiteral') {
      return coreCodeMessage(primary.name);
    }
    if (primary?.type !== 'ListLiteral') continue;
    if (primary.elements.length === 0) {
      return "'on: list[]' is empty; write the statement without 'on' to catch every catchable halt";
    }
    for (const element of primary.elements) {
      if (element.type === 'ListSpread') continue;
      const written = writtenPrimary(element);
      if (written?.type !== 'AtomLiteral') continue;
      const message = coreCodeMessage(written.name);
      if (message !== undefined) return message;
    }
  }
  return undefined;
}

function coreCodeMessage(name: string): string | undefined {
  return ERROR_CODE_NAMES.includes(name)
    ? undefined
    : `'#${name}' is not a core error code`;
}
