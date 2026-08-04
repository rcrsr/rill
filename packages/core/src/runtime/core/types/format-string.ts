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
 * backslashes and embedded double quotes.
 */
export function quoteRillString(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}
