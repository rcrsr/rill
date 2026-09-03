/**
 * Rill Runtime Tests: iteration-ceiling boundary (issue #297)
 *
 * The materialising expanders (expandIterator / expandStream) stop iterating
 * once `count` reaches MAX_ITER (10,000). The overrun halt (RILL-R010) must
 * fire only when elements remain past the ceiling — i.e. the (limit+1)th
 * element — not when exactly 10,000 elements fully drain the iterator.
 *
 * Regression guard for the off-by-one that rejected exactly-10,000-element
 * sequences.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('iteration ceiling boundary (issue #297)', () => {
  it('range of exactly 10000 elements expands without halting', async () => {
    const result = (await run(
      'range(0, 10000) -> seq({ $ }) -> .len'
    )) as number;
    expect(result).toBe(10000);
  });

  it('repeat of exactly 10000 elements folds without halting', async () => {
    const result = (await run(
      'repeat(1, 10000) -> fold(0, { $@ + $ })'
    )) as number;
    expect(result).toBe(10000);
  });

  it('range of 9999 elements still expands (below the ceiling)', async () => {
    const result = (await run(
      'range(0, 9999) -> seq({ $ }) -> .len'
    )) as number;
    expect(result).toBe(9999);
  });

  it('range of 10001 elements halts with RILL-R010', async () => {
    await expect(run('range(0, 10001) -> seq({ $ })')).rejects.toThrow(
      expect.objectContaining({ errorId: 'RILL-R010' })
    );
  });
});
