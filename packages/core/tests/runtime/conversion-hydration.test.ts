/**
 * Rill Runtime Tests: nested structural conversion hydration
 *
 * Pins the intentional divergence between conversion's structural
 * hydration and argument marshaling's field-default hydration, both now
 * served by the single hydrateStructure walker in runtime/core/callable.ts.
 * Conversion drops extras beyond the declared shape (marshaling keeps
 * them) and halts immediately with RILL-R044 on a missing required nested
 * field (marshaling leaves the field absent for the type-check stage).
 * The marshaling side is covered in marshal-args.test.ts.
 */

import { describe, expect, it } from 'vitest';

import { isTuple } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

function isOrdered(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rill_ordered' in value &&
    (value as Record<string, unknown>).__rill_ordered === true
  );
}

function orderedEntries(value: unknown): [string, unknown][] {
  if (!isOrdered(value)) throw new Error('Not an ordered value');
  return (value as { entries: [string, unknown][] }).entries;
}

describe('Rill Runtime: nested structural conversion drops extras', () => {
  it('nested dict with extra keys drops the extras', async () => {
    const result = await run(
      '[outer: [x: 1, y: 2, extra: 99]] -> dict(outer: dict(x: number, y: number))'
    );
    expect(result).toEqual({ outer: { x: 1, y: 2 } });
  });

  it('nested ordered with extra keys drops the extras', async () => {
    const result = await run(
      '[outer: [x: 1, y: 2, extra: 99]] -> ordered(outer: ordered(x: number, y: number))'
    );
    expect(isOrdered(result)).toBe(true);
    const entries = orderedEntries(result);
    expect(entries).toHaveLength(1);
    const [outerKey, outerValue] = entries[0]!;
    expect(outerKey).toBe('outer');
    expect(isOrdered(outerValue)).toBe(true);
    expect(orderedEntries(outerValue)).toEqual([
      ['x', 1],
      ['y', 2],
    ]);
  });

  it('nested tuple with extra elements drops the extras', async () => {
    const result = await run(
      '[outer: tuple[1, 2, 99]] -> dict(outer: tuple(number, number))'
    );
    const resultDict = result as { outer: { entries: unknown[] } };
    expect(isTuple(resultDict.outer)).toBe(true);
    expect(resultDict.outer.entries).toEqual([1, 2]);
  });
});

describe('Rill Runtime: nested structural conversion halts on missing required field', () => {
  it('nested dict missing required field throws RILL-R044', async () => {
    await expect(
      run('[outer: [x: 1]] -> dict(outer: dict(x: number, y: number))')
    ).rejects.toThrow(/missing required field 'y'/);
  });

  it('nested ordered missing required field throws RILL-R044', async () => {
    await expect(
      run('[outer: [x: 1]] -> ordered(outer: ordered(x: number, y: number))')
    ).rejects.toThrow(/missing required field 'y'/);
  });

  it('nested tuple missing required element throws RILL-R044', async () => {
    await expect(
      run('[outer: tuple[1]] -> dict(outer: tuple(number, number))')
    ).rejects.toThrow(/missing required element at position 1/);
  });
});
