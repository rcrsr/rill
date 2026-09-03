/**
 * Regression tests for out-of-range datetime formatting (#284).
 *
 * A datetime whose `unix` value falls outside the ECMAScript
 * representable range (±8.64e15 ms) previously let
 * `new Date(unix).toISOString()` throw a raw JS `RangeError` from the
 * format/serialize paths. Being a plain JS error rather than a rill
 * halt, it crossed `guard`/`retry` and crashed the host.
 *
 * The format and serialize protocol methods now raise a catchable
 * `#INVALID_INPUT` halt instead, so `guard` recovers it and `.!` is true.
 */

import { describe, expect, it } from 'vitest';
import { run } from '../helpers/runtime.js';

const OUT_OF_RANGE = '8640000000000001'; // one ms past the +limit

describe('out-of-range datetime formatting (#284)', () => {
  it('interpolating an out-of-range datetime halts catchably (guard catches it)', async () => {
    const result = await run(
      `datetime(...dict[unix: ${OUT_OF_RANGE}]) => $d\n` +
        `guard { "{$d}" } => $r\n` +
        `$r.!`
    );
    // guard recovered the halt into an invalid; $r.! is true
    expect(result).toBe(true);
  });

  it('does not escape guard as a raw RangeError', async () => {
    // If the halt were a raw RangeError it would reject here instead of
    // resolving through guard.
    await expect(
      run(
        `datetime(...dict[unix: ${OUT_OF_RANGE}]) => $d\n` +
          `guard { "{$d}" } => $r\n` +
          `$r.!message`
      )
    ).resolves.toContain('representable range');
  });

  it('a negative out-of-range datetime also halts catchably', async () => {
    const result = await run(
      `datetime(...dict[unix: -8640000000000001]) => $d\n` +
        `guard { "{$d}" } => $r\n` +
        `$r.!`
    );
    expect(result).toBe(true);
  });

  it('a normal datetime still formats correctly', async () => {
    const result = await run('"{datetime("2026-03-13T08:00:00Z")}"');
    expect(result).toBe('2026-03-13T08:00:00.000Z');
  });

  it('the representable boundary still formats', async () => {
    const result = await run(
      'datetime(...dict[unix: 8640000000000000]) => $d\n"{$d}"'
    );
    expect(result).toBe('+275760-09-13T00:00:00.000Z');
  });
});
