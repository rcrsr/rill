/**
 * String Literal Formatting
 *
 * The string-quoting primitive shared by formatRillLiteral (operations.ts) and
 * formatNested (protocols/shared.ts).
 *
 * Import constraints:
 * - No imports. This module is a leaf so that protocols/shared.ts can quote
 *   strings without reaching operations.ts, which imports registrations.ts and
 *   would reintroduce the import cycle this split exists to avoid.
 */

/**
 * Escape a raw string into the body of a rill double-quoted string literal so
 * the output re-parses to the identical string.
 *
 * The lexer (see readers.ts `processEscape`) recognizes exactly five escapes:
 * `\\`, `\"`, `\n`, `\r`, and `\t`. Emitting a raw newline, carriage return, or
 * tab breaks round-tripping — a raw newline is an unterminated-string error, and
 * a raw tab survives but is indistinguishable from an intended escape. Escape
 * precisely those five, backslash first so already-escaped output is not
 * doubled.
 *
 * `{` and `}` are not lexer escapes, but the lexer treats a single `{` inside
 * a string as the start of an interpolation expression (see readers.ts) and
 * unescapes a doubled `{{`/`}}` to a literal brace. Emitting a raw, un-doubled
 * brace would make the output re-parse as interpolation (or fail to parse at
 * all) instead of the identical string, so brace doubling is part of the same
 * round-tripping contract as the five backslash escapes above.
 */
export function escapeRillStringBody(raw: string): string {
  return raw
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/{/g, '{{')
    .replace(/}/g, '}}');
}

/**
 * Render a string as a rill string literal: wrap in double quotes and escape
 * its body via `escapeRillStringBody` so the output re-parses to the
 * identical string.
 */
export function quoteRillString(value: string): string {
  return `"${escapeRillStringBody(value)}"`;
}
