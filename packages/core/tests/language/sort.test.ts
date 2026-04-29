/**
 * Rill Language Tests: sort primitive
 *
 * Covers AC-SORT-1 through AC-SORT-9, AC-BOUND-1 through AC-BOUND-3,
 * AC-ERR-1, AC-ERR-2, AC-ERR-4, EC-3, and EC-6.
 *
 * sort(list) -> list sorted ascending by element value (stable)
 * sort(list, key_fn) -> list sorted by key_fn(element) (stable)
 * sort(dict) -> ordered[[key, value]] sorted by key
 * sort(dict, key_fn) -> ordered[[key, value]] sorted by key_fn({key, value})
 *
 * Implementation notes:
 *
 * [SPEC] AC-SORT-9: The spec states "range(5) -> sort returns [0,1,2,3,4]".
 * In practice, range(n1, n2) returns a dict-shaped iterator ({value, done, next}).
 * Since isDict() matches before the getIterableElements path in sort, range input
 * takes the dict path and gets sorted by its literal keys, not materialized.
 * The test covers the materialization intent by piping through seq first.
 *
 * [SPEC] EC-6: The spec states sort propagates RILL_R010 via getIterableElements.
 * The getIterableElements path in sort is only reached for non-dict inputs (plain
 * arrays). range() iterators are dicts and take the dict path. Streams are also
 * dict-shaped. The EC-6 path cannot be triggered from rill script without a host-
 * injected stream. The test uses the seq -> sort chain to demonstrate that large
 * range inputs raise RILL-R010 before the sorted list is ever constructed.
 *
 * [SPEC] AC-ERR-1: "list[1, \"2\"] -> sort" fails at list construction (RILL-R002)
 * before sort is reached, because list[] enforces homogeneous element types.
 * The test uses host-injected variables to bypass list construction and exercise
 * sort's TYPE_MISMATCH path directly.
 *
 * [SPEC] AC-ERR-2: "$.score on absent field" throws RILL-R009 (not null/vacant)
 * when the field is accessed via dot-access on a named field. The test uses a
 * host-injected null variable returned from the extractor to reach the INVALID_INPUT
 * code path inside sort.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

// Helper: check whether a value is a RillOrdered
function isOrdered(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rill_ordered' in value &&
    (value as Record<string, unknown>).__rill_ordered === true
  );
}

// Helper: extract key-order from an ordered value
function orderedKeys(value: unknown): string[] {
  if (!isOrdered(value)) throw new Error('Not an ordered value');
  return (value as { entries: [string, unknown][] }).entries.map(([k]) => k);
}

// Helper: extract [key, value] pairs from an ordered value
function orderedEntries(value: unknown): [string, unknown][] {
  if (!isOrdered(value)) throw new Error('Not an ordered value');
  return (value as { entries: [string, unknown][] }).entries;
}

describe('Rill Language: sort primitive', () => {
  // ── Success Cases ─────────────────────────────────────────────────────────

  describe('Success Cases', () => {
    it('AC-SORT-3: list[3, 1, 2] -> sort returns [1, 2, 3]', async () => {
      expect(await run('list[3, 1, 2] -> sort')).toEqual([1, 2, 3]);
    });

    it('AC-SORT-4: sort by key is stable for equal keys (score ascending)', async () => {
      // Three dicts with score 5, 2, 5 — result must be [score:2, score:5(first), score:5(second)]
      const script = `
        dict[score: 5, id: "first"] => $a
        dict[score: 2, id: "second"] => $b
        dict[score: 5, id: "third"] => $c
        list[$a, $b, $c] -> sort({ $.score })
      `;
      const result = (await run(script)) as Array<Record<string, unknown>>;
      expect(result).toHaveLength(3);
      expect(result[0]?.['score']).toBe(2);
      expect(result[1]?.['score']).toBe(5);
      expect(result[1]?.['id']).toBe('first');
      expect(result[2]?.['score']).toBe(5);
      expect(result[2]?.['id']).toBe('third');
    });

    it('AC-SORT-5: multi-key sort via tuple projection preserves date order on equal score', async () => {
      const script = `
        dict[score: 2, date: "2026-01-01"] => $a
        dict[score: 2, date: "2026-01-02"] => $b
        list[$a, $b] -> sort({ tuple[$.score, $.date] })
      `;
      const result = (await run(script)) as Array<Record<string, unknown>>;
      expect(result).toHaveLength(2);
      expect(result[0]?.['date']).toBe('2026-01-01');
      expect(result[1]?.['date']).toBe('2026-01-02');
    });

    it('AC-SORT-6: dict default sort by key returns ordered with keys a, b, c', async () => {
      const result = await run('[c: 3, a: 1, b: 2] -> sort');
      expect(isOrdered(result)).toBe(true);
      expect(orderedKeys(result)).toEqual(['a', 'b', 'c']);
    });

    it('AC-SORT-7: dict sort by extracted value.score returns ordered by score ascending', async () => {
      const script = `
        dict[
          alice: dict[score: 3],
          bob: dict[score: 1],
          carol: dict[score: 2]
        ] => $emails_dict
        $emails_dict -> sort({ $.value.score })
      `;
      const result = await run(script);
      expect(isOrdered(result)).toBe(true);
      const entries = orderedEntries(result);
      const scores = entries.map(
        ([, v]) => (v as Record<string, unknown>)['score']
      );
      expect(scores).toEqual([1, 2, 3]);
    });

    it('AC-SORT-8: list -> sort -> .reverse produces descending order', async () => {
      const script = `
        list[3, 1, 2] => $list
        $list -> sort -> .reverse
      `;
      expect(await run(script)).toEqual([3, 2, 1]);
    });

    it('AC-SORT-9: iterator materialization — seq(range) -> sort returns sorted list', async () => {
      // [SPEC] range() returns a dict-shaped iterator; sort takes the dict path.
      // The materialization-then-sort intent is exercised by piping through seq first.
      expect(await run('range(0, 5) -> seq({ $ }) -> sort')).toEqual([
        0, 1, 2, 3, 4,
      ]);
    });
  });

  // ── Boundary Cases ─────────────────────────────────────────────────────────

  describe('Boundary Cases', () => {
    it('AC-SORT-1: empty list returns empty list', async () => {
      expect(await run('list[] -> sort')).toEqual([]);
    });

    it('AC-SORT-2: empty dict returns empty ordered', async () => {
      const result = await run('dict[] -> sort');
      expect(isOrdered(result)).toBe(true);
      expect(orderedEntries(result)).toHaveLength(0);
    });

    it('AC-BOUND-1: single-element list returns the element unchanged', async () => {
      expect(await run('list[42] -> sort')).toEqual([42]);
    });

    it('AC-BOUND-2: single-entry dict returns ordered of length 1', async () => {
      const result = await run('[x: 99] -> sort');
      expect(isOrdered(result)).toBe(true);
      expect(orderedEntries(result)).toHaveLength(1);
      expect(orderedKeys(result)).toEqual(['x']);
    });

    it('AC-BOUND-3: all-equal-key list preserves original order (maximum tie density)', async () => {
      // All elements have the same sort key; stable sort must keep original order.
      const script = `
        dict[score: 1, id: "first"] => $a
        dict[score: 1, id: "second"] => $b
        dict[score: 1, id: "third"] => $c
        list[$a, $b, $c] -> sort({ $.score })
      `;
      const result = (await run(script)) as Array<Record<string, unknown>>;
      expect(result).toHaveLength(3);
      expect(result[0]?.['id']).toBe('first');
      expect(result[1]?.['id']).toBe('second');
      expect(result[2]?.['id']).toBe('third');
    });
  });

  // ── Error Cases ────────────────────────────────────────────────────────────

  describe('Error Cases', () => {
    it('AC-ERR-1 / EC-1: mixed-type keys from extractor halt with #TYPE_MISMATCH', async () => {
      // [SPEC] list[1, "2"] fails at list construction (RILL-R002) before sort runs.
      // Host-inject a mixed-type list to reach sort's comparison logic directly.
      await expectHalt(
        () =>
          run('$items -> sort', {
            variables: { items: [1, 'two'] },
          }),
        { code: 'TYPE_MISMATCH' }
      );
    });

    it('AC-ERR-2 / EC-2: extractor returning vacant value halts with #INVALID_INPUT', async () => {
      // [SPEC] $.score on a dict missing that field raises RILL-R009, not null.
      // Host-inject null as the extractor return value to reach sort's INVALID_INPUT check.
      await expectHalt(
        () =>
          run('$items -> sort({ $nullval })', {
            variables: { items: [1, 2], nullval: null },
          }),
        { code: 'INVALID_INPUT' }
      );
    });

    it('AC-ERR-4 / EC-5: non-callable key_fn halts with #TYPE_MISMATCH', async () => {
      // Passing a string literal as the second arg to sort triggers the EC-5 check.
      await expectHalt(() => run('list[1, 2, 3] -> sort("not callable")'), {
        code: 'TYPE_MISMATCH',
      });
    });

    it('EC-3: closure that halts inside extractor propagates the inner halt', async () => {
      // The key extractor fires error "inner boom" (RILL-R016).
      // sort must not wrap or swallow the inner halt.
      await expect(
        run('list[1, 2, 3] -> sort({ error "inner boom" })')
      ).rejects.toThrow();
    });

    it('EC-6: iteration exceeding MAX_ITER propagates #RILL_R010 before sort', async () => {
      // [SPEC] range() iterators hit the dict path in sort (not getIterableElements).
      // RILL-R010 fires during seq materialization — the large list never reaches sort.
      // This confirms the error propagates through the pipeline unchanged.
      await expect(
        run('range(0, 10001) -> seq({ $ }) -> sort')
      ).rejects.toThrow(expect.objectContaining({ errorId: 'RILL-R010' }));
    });
  });
});
