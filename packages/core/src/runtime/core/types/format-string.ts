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
 * Render a string as a rill string literal: wrap in double quotes and escape
 * the characters the lexer treats as escape sequences so the output re-parses
 * to the identical string.
 *
 * The lexer (see readers.ts `processEscape`) recognizes exactly five escapes:
 * `\\`, `\"`, `\n`, `\r`, and `\t`. Emitting a raw newline, carriage return, or
 * tab breaks round-tripping — a raw newline is an unterminated-string error, and
 * a raw tab survives but is indistinguishable from an intended escape. Escape
 * precisely those five, backslash first so already-escaped output is not
 * doubled. Braces are left untouched: the lexer has no `\{` escape (it would be
 * an invalid escape sequence), so brace/interpolation handling is out of scope
 * here.
 */
export function quoteRillString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}
