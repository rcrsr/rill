/**
 * Break-Rejection at Non-Loop-Consuming Reject Sites
 *
 * `break` is control-flow syntax meaningful only inside constructs that
 * consume it (`seq`, `acc`, `while`, `for`). A `break` inside a body that
 * a construct does NOT loop-consume — a parallel body (`fan`, `filter`,
 * `sort`), a `retry` body, or a bare top-level `break` — must not escape
 * as a raw `BreakSignal`. `rejectBreakAsHalt` (runtime/core/types/halt.ts)
 * converts it into a coded, non-catchable RuntimeError instead.
 *
 * Regression coverage confirms `seq` and `while` still consume their OWN
 * break correctly (partial results / early exit), unaffected by this fix.
 */

import { describe, expect, it } from 'vitest';
import { BreakSignal, RuntimeError } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

/** Asserts `source` rejects with a coded, non-catchable RuntimeError (RILL-R002),
 * never with a raw BreakSignal. */
async function expectRejectedBreak(source: string): Promise<void> {
  const err = await run(source).catch((e: unknown) => e);
  expect(err).not.toBeInstanceOf(BreakSignal);
  expect(err).toBeInstanceOf(RuntimeError);
  expect((err as RuntimeError).errorId).toBe('RILL-R002');
}

describe('break inside fan halts as a coded RuntimeError', () => {
  it('rejects a break inside the fan body', async () => {
    await expectRejectedBreak(
      'list[1, 2, 3] -> fan({ ($ == 2) ? ($ -> break) ! $ })'
    );
  });

  it('a guard wrapping fan does not swallow the halt', async () => {
    await expectRejectedBreak(
      'guard { list[1, 2, 3] -> fan({ ($ == 2) ? ($ -> break) ! $ }) }'
    );
  });
});

describe('break inside filter halts as a coded RuntimeError', () => {
  it('rejects a break inside the filter predicate', async () => {
    await expectRejectedBreak(
      'list[1, 2, 3] -> filter({ ($ == 2) ? ($ -> break) ! ($ > 0) })'
    );
  });

  it('a guard wrapping filter does not swallow the halt', async () => {
    await expectRejectedBreak(
      'guard { list[1, 2, 3] -> filter({ ($ == 2) ? ($ -> break) ! ($ > 0) }) }'
    );
  });
});

describe('break inside fold halts as a coded RuntimeError', () => {
  it('rejects a break inside the fold body', async () => {
    await expectRejectedBreak(
      'list[1, 2, 3] -> fold(0, { ($ == 2) ? ($ -> break) ! ($@ + $) })'
    );
  });

  it('a guard wrapping fold does not swallow the halt', async () => {
    await expectRejectedBreak(
      'guard { list[1, 2, 3] -> fold(0, { ($ == 2) ? ($ -> break) ! ($@ + $) }) }'
    );
  });
});

describe('break inside sort key extractor halts as a coded RuntimeError', () => {
  it('rejects a break inside the sort key_fn', async () => {
    await expectRejectedBreak(
      'list[3, 1, 2] -> sort({ ($ == 2) ? ($ -> break) ! $ })'
    );
  });

  it('a guard wrapping sort does not swallow the halt', async () => {
    await expectRejectedBreak(
      'guard { list[3, 1, 2] -> sort({ ($ == 2) ? ($ -> break) ! $ }) }'
    );
  });
});

describe('break inside a retry body halts as a coded RuntimeError', () => {
  it('rejects a break inside the retry body', async () => {
    await expectRejectedBreak('retry<limit: 3> { 1 -> break }');
  });

  it('a guard wrapping retry does not swallow the halt', async () => {
    await expectRejectedBreak('guard { retry<limit: 3> { 1 -> break } }');
  });
});

describe('a bare top-level break halts as a coded RuntimeError', () => {
  it('rejects a break with no enclosing break-accepting construct', async () => {
    await expectRejectedBreak('1 -> break');
  });

  it('a guard wrapping the bare break does not swallow the halt', async () => {
    await expectRejectedBreak('guard { 1 -> break }');
  });
});

describe('regression: seq and while still consume their OWN break unchanged', () => {
  it('seq({ break }) returns partial results, not a halt', async () => {
    const result = await run(
      'list[1, 2, 3, 4, 5] -> seq({ ($ == 3) ? break\n$ })'
    );
    expect(result).toEqual([1, 2]);
  });

  it('while with break exits normally with the break value', async () => {
    const result = await run(`
      0 -> while ($ < 100) do {
        ($ + 1) -> ($ >= 5) ? break ! $
      }
    `);
    expect(result).toBe(5);
  });
});
