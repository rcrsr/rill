/**
 * Round-trip tests for quoteRillString (format-string.ts).
 *
 * quoteRillString renders a string as a rill string literal (used when a string
 * is nested inside a list/dict/tuple and formatted). To round-trip, it must
 * escape every character the lexer treats as an escape sequence. The lexer
 * (readers.ts `processEscape`) recognizes exactly five: `\\`, `\"`, `\n`, `\r`,
 * and `\t`. Emitting any of these raw breaks re-parsing: a raw newline is an
 * unterminated-string error, and a raw tab/CR is silently altered.
 *
 * Each case starts from a rill string literal (parsed by the trusted lexer),
 * wraps it in a list, formats that list to a rill-literal string via `string`,
 * then re-parses and executes the formatted output and asserts the recovered
 * element is identical to the original value.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('quoteRillString round-trip', () => {
  // Each entry is a rill string-literal body (escaped source the lexer accepts).
  const literals: Array<[string, string]> = [
    ['newline', '"a\\nb"'],
    ['tab', '"a\\tb"'],
    ['carriage return', '"a\\rb"'],
    ['backslash', '"a\\\\b"'],
    ['double quote', '"a\\"b"'],
    ['all escapes', '"a\\nb\\tc\\rd\\\\e\\"f"'],
    ['leading newline', '"\\nabc"'],
    ['plain', '"hello world"'],
  ];

  for (const [name, lit] of literals) {
    it(`formats and re-parses ${name} to the identical string`, async () => {
      // The value the lexer produces for this literal — the source of truth.
      const expected = await run(lit);
      // Format list[<value>] to its rill-literal form, e.g. list["a\nb"].
      const formatted = (await run(`list[${lit}] -> string`)) as string;
      // The formatted output must itself be valid rill; re-parse it, capture
      // the list, and read the single element back out by index.
      const recovered = await run(`${formatted} => $x\n$x[0]`);
      expect(recovered).toBe(expected);
    });
  }

  it('emits an escaped newline inside a list, preserving length (issue #287 repro)', async () => {
    // Rill source list["a\nb"] holds a 3-char string ("a", newline, "b").
    const formatted = (await run('list["a\\nb"] -> string')) as string;
    // Output must contain the escaped sequence \n (backslash + n), not a raw
    // newline. Escaped form is list["a\nb"] = 12 chars.
    expect(formatted).toBe('list["a\\nb"]');
    expect(formatted).toHaveLength(12);
    expect(formatted).not.toContain('\n');
  });
});
