/**
 * Rill Language Tests: Collection Operators — new callable syntax
 *
 * Tests for seq (sequential map), fan (parallel map), fold (reduction),
 * filter (predicate filtering), and acc (scan/running accumulator).
 *
 * AC-17: Release coordination — core, fiddle, and docs ship together in this
 * branch. Legacy keyword forms (each/map/fold/filter as keywords) are removed.
 * All tests below use the new callable-function syntax only.
 */

import type { RillValue } from '@rcrsr/rill';
import {
  anyTypeValue,
  createRillStream,
  createVector,
  parse,
  RuntimeHaltSignal,
  TOKEN_TYPES,
  type RillStream,
  type TypeStructure,
} from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

import { expectHalt } from '../helpers/halt.js';
import { run } from '../helpers/runtime.js';

// Helper: host function returning a RillStream over provided values
function makeStreamFn(chunks: RillValue[], resolution: RillValue = null) {
  return {
    params: [] as { name: string; type: TypeStructure }[],
    returnType: anyTypeValue,
    fn: (): RillStream =>
      createRillStream({
        chunks: (async function* () {
          for (const v of chunks) yield v;
        })(),
        resolve: async () => resolution,
      }),
  };
}

// Helper: host function wrapping a numeric doubling operation
const double = {
  params: [
    {
      name: 'x',
      type: { kind: 'number' },
      defaultValue: undefined,
      annotations: {},
    },
  ],
  fn: (args: Record<string, RillValue>): number => {
    const x = args['x'];
    return typeof x === 'number' ? x * 2 : 0;
  },
};

describe('Rill Language: Collection Operators — new callable syntax', () => {
  // ── Success Cases ────────────────────────────────────────────────────────

  describe('Success Cases', () => {
    it('AC-1: seq maps list elements sequentially', async () => {
      expect(await run('list[1, 2, 3] -> seq({ $ * 2 })')).toEqual([2, 4, 6]);
    });

    it('AC-2: fan maps list elements in parallel', async () => {
      expect(await run('list[1, 2, 3] -> fan({ $ * 2 })')).toEqual([2, 4, 6]);
    });

    it('AC-3: fold reduces list to final accumulator value', async () => {
      expect(await run('list[1, 2, 3] -> fold(0, { $@ + $ })')).toBe(6);
    });

    it('AC-4: acc builds running total (scan pattern)', async () => {
      expect(await run('list[1, 2, 3] -> acc(0, { $@ + $ })')).toEqual([
        1, 3, 6,
      ]);
    });

    it('AC-5: filter keeps elements where predicate is true', async () => {
      expect(await run('list[1, 2, 3, 4] -> filter({ ($ % 2) == 0 })')).toEqual(
        [2, 4]
      );
    });

    it('AC-6: fan with method-call body', async () => {
      expect(await run('list["a", "b"] -> fan({ $.upper() })')).toEqual([
        'A',
        'B',
      ]);
    });

    it('AC-7: seq with variable-bound callable', async () => {
      const script = `
        |x| ($x * 10) => $fn
        list[1, 2] -> seq($fn)
      `;
      expect(await run(script)).toEqual([10, 20]);
    });

    it('AC-8: fold with single named-param closure referencing $@ accumulator', async () => {
      // Named param |item| binds element; $@ binds accumulator from fold context.
      expect(await run('list[1, 2, 3] -> fold(0, |item|($@ + $item))')).toBe(6);
    });

    it('AC-9 (acc): two-type anonymous closure parses and binds in acc', async () => {
      expect(
        await run('list[1, 2, 3] -> acc(0, |number, number|{ $@ + $ })')
      ).toEqual([1, 3, 6]);
    });

    it('AC-9 (fold): two-type anonymous closure parses and binds in fold', async () => {
      expect(
        await run('list[1, 2, 3] -> fold(0, |number, number|{ $@ + $ })')
      ).toBe(6);
    });

    it('AC-10: fan with concurrency cap processes all elements in order', async () => {
      const items = Array.from({ length: 20 }, (_, i) => i + 1);
      const script = `list[${items.join(', ')}] -> fan({ $ * 2 }, [concurrency: 8])`;
      const result = (await run(script)) as number[];
      expect(result).toHaveLength(20);
      expect(result[0]).toBe(2);
      expect(result[19]).toBe(40);
    });

    it('AC-11: seq body break returns partial results', async () => {
      const script = `
        list[1, 2, 3, 4, 5] -> seq({
          ($ == 3) ? break
          $ * 2
        })
      `;
      expect(await run(script)).toEqual([2, 4]);
    });

    it('AC-12: acc body break returns partial intermediate list', async () => {
      const script = `
        list[1, 2, 3, 4, 5] -> acc(0, {
          ($ == 3) ? break
          $@ + $
        })
      `;
      expect(await run(script)).toEqual([1, 3]);
    });

    it('fold produces only final result, not intermediate values', async () => {
      expect(await run('list[1, 2, 3] -> fold(0, { $@ + $ })')).toBe(6);
    });

    it('fold string concatenation reduces to joined string', async () => {
      expect(await run('list["a", "b", "c"] -> fold("", { "{$@}{$}" })')).toBe(
        'abc'
      );
    });

    it('fold product reduction', async () => {
      expect(await run('list[1, 2, 3, 4] -> fold(1, { $@ * $ })')).toBe(24);
    });

    it('fold max reduction', async () => {
      expect(
        await run('list[3, 1, 4, 1, 5, 9] -> fold(0, { ($@ > $) ? $@ ! $ })')
      ).toBe(9);
    });

    it('filter preserves all elements when predicate always true', async () => {
      expect(await run('list[1, 2, 3] -> filter({ $ > 0 })')).toEqual([
        1, 2, 3,
      ]);
    });

    it('filter returns empty list when predicate always false', async () => {
      expect(await run('list[1, 2, 3] -> filter({ $ > 10 })')).toEqual([]);
    });

    it('seq and fan produce same results for pure transformations', async () => {
      const seqResult = await run('list[1, 2, 3] -> seq({ $ * 2 })');
      const fanResult = await run('list[1, 2, 3] -> fan({ $ * 2 })');
      expect(seqResult).toEqual(fanResult);
    });

    it('chaining: seq then fold', async () => {
      expect(
        await run('list[1, 2, 3] -> seq({ $ * 2 }) -> fold(0, { $@ + $ })')
      ).toBe(12);
    });

    it('chaining: seq then filter', async () => {
      expect(
        await run('list[1, 2, 3, 4] -> seq({ $ * 2 }) -> filter({ $ > 4 })')
      ).toEqual([6, 8]);
    });

    it('seq with host function call in body', async () => {
      expect(
        await run('list[1, 2, 3] -> seq({ $ -> double })', {
          functions: { double },
        })
      ).toEqual([2, 4, 6]);
    });

    it('seq with nested collection inside body', async () => {
      const script =
        'list[list[1, 2], list[3, 4]] -> seq({ $ -> seq({ $ * 2 }) })';
      expect(await run(script)).toEqual([
        [2, 4],
        [6, 8],
      ]);
    });
  });

  // ── Boundary Conditions ──────────────────────────────────────────────────

  describe('Boundary Conditions', () => {
    it('AC-27/BC-1: empty list through seq returns empty list', async () => {
      expect(await run('list[] -> seq({ $ * 2 })')).toEqual([]);
    });

    it('BC-2: empty list through fan returns empty list', async () => {
      expect(await run('list[] -> fan({ $ * 2 })')).toEqual([]);
    });

    it('BC-3: empty list through filter returns empty list', async () => {
      expect(await run('list[] -> filter({ $ > 0 })')).toEqual([]);
    });

    it('AC-28/BC-NOD-2: empty list through fold returns seed unchanged', async () => {
      expect(await run('list[] -> fold(10, { $@ + $ })')).toBe(10);
    });

    it('AC-29/BC-NOD-3: empty list through acc returns empty list', async () => {
      expect(await run('list[] -> acc(10, { $@ + $ })')).toEqual([]);
    });

    it('AC-30/BC-4: string input through seq returns list of processed characters', async () => {
      expect(await run('"abc" -> seq({ $.upper })')).toEqual(['A', 'B', 'C']);
    });

    it('AC-31/BC-5: dict input through fan returns list of values', async () => {
      const result = (await run(
        '[a: 1, b: 2] -> fan({ $.value })'
      )) as RillValue[];
      expect(result).toHaveLength(2);
      expect(result).toContain(1);
      expect(result).toContain(2);
    });

    it('AC-32/BC-6: iterator (range) input through seq', async () => {
      expect(await run('range(0, 3) -> seq({ $ * 10 })')).toEqual([0, 10, 20]);
    });

    it('AC-33/BC-7: stream input through fan dispatches parallel', async () => {
      const script = `
        make_stream() => $s
        $s -> fan({ $ * 2 })
      `;
      expect(
        await run(script, {
          functions: { make_stream: makeStreamFn([1, 2, 3]) },
        })
      ).toEqual([2, 4, 6]);
    });

    it('AC-34/BC-8: iteration count > 10000 raises RILL-R010', async () => {
      await expect(run('range(0, 10001) -> seq({ $ })')).rejects.toThrow(
        expect.objectContaining({ errorId: 'RILL-R010' })
      );
    });

    it('AC-35/BC-9: fan with concurrency > element count completes without error', async () => {
      expect(
        await run('list[1, 2] -> fan({ $ * 2 }, [concurrency: 100])')
      ).toEqual([2, 4]);
    });

    it('AC-36/BC-10: seq called with extra dict arg raises arity error', async () => {
      await expect(
        run('list[1, 2, 3] -> seq({ $ * 2 }, [concurrency: 8])')
      ).rejects.toThrow();
    });

    it('single element collection through seq', async () => {
      expect(await run('list[42] -> seq({ $ * 2 })')).toEqual([84]);
    });

    it('single element collection through fold', async () => {
      expect(await run('list[42] -> fold(0, { $@ + $ })')).toBe(42);
    });

    it('single element collection through filter (match)', async () => {
      expect(await run('list[42] -> filter({ $ > 0 })')).toEqual([42]);
    });

    it('single element collection through filter (no match)', async () => {
      expect(await run('list[42] -> filter({ $ > 100 })')).toEqual([]);
    });
  });

  // ── Error Cases ──────────────────────────────────────────────────────────

  describe('Error Cases', () => {
    it('AC-18/EC-1 (seq): non-callable body raises RILL-R040', async () => {
      await expect(run('list[1] -> seq(42)')).rejects.toThrow(
        expect.objectContaining({ errorId: 'RILL-R040' })
      );
    });

    it('EC-1 (fold): non-callable body raises RILL-R040', async () => {
      await expect(run('list[1] -> fold(0, 42)')).rejects.toThrow(
        expect.objectContaining({ errorId: 'RILL-R040' })
      );
    });

    it('EC-1 (filter): non-callable body raises RILL-R040', async () => {
      await expect(run('list[1] -> filter(42)')).rejects.toThrow(
        expect.objectContaining({ errorId: 'RILL-R040' })
      );
    });

    it('AC-19/EC-2 (fold): 3-parameter named closure raises arity mismatch', async () => {
      await expect(
        run('list[1, 2, 3] -> fold(0, |a, b, c|($a + $b + $c))')
      ).rejects.toThrow();
    });

    it('EC-2 (seq): 2-arg named closure raises arity error', async () => {
      await expect(
        run('list[1, 2, 3] -> seq(|a, b| ($a + $b))')
      ).rejects.toThrow();
    });

    it('AC-20/EC-NOD-3: named param mixed with bare $ raises undefined-variable error', async () => {
      await expect(run('list[1] -> fan(|x|{ $ + 1 })')).rejects.toThrow(
        expect.objectContaining({ errorId: 'RILL-R005' })
      );
    });

    it('AC-21/EC-3: seq body references $@ raises undefined-variable error', async () => {
      await expect(run('list[1, 2] -> seq({ $@ + 1 })')).rejects.toThrow();
    });

    it('AC-22/EC-10 (fan): negative concurrency raises RILL-R001', async () => {
      await expect(
        run('list[1, 2, 3] -> fan({ $ * 2 }, [concurrency: -1])')
      ).rejects.toThrow(expect.objectContaining({ errorId: 'RILL-R001' }));
    });

    it('AC-23/EC-9 (filter): non-number concurrency raises RILL-R001', async () => {
      await expect(
        run('list[1, 2] -> filter({ $ > 0 }, [concurrency: "8"])')
      ).rejects.toThrow(expect.objectContaining({ errorId: 'RILL-R001' }));
    });

    it('AC-24/EC-5: non-iterable input to seq raises error', async () => {
      await expect(run('42 -> seq({ $ })')).rejects.toThrow(
        'Collection operators require'
      );
    });

    it('AC-25/EC-NOD-8: legacy `each` syntax fails with unknown-function error (RILL-R006)', async () => {
      // `each` is now an identifier; it resolves to unknown function at runtime.
      await expect(run('list[1] -> each { $ }')).rejects.toThrow(
        expect.objectContaining({ errorId: 'RILL-R006' })
      );
    });

    it('AC-26/EC-11 (fold): typed closure with mismatched element type raises RILL-R001', async () => {
      // |string, number| declares $ as string, but list has numbers.
      await expect(
        run('list[1, 2, 3] -> fold(0, |string, number|{ $@ + $ })')
      ).rejects.toThrow(expect.objectContaining({ errorId: 'RILL-R001' }));
    });

    it('EC-4: bare $ reference at module scope without pipe provider raises error', async () => {
      await expect(run('$ + 1')).rejects.toThrow();
    });

    it('EC-6: vector input to seq raises error', async () => {
      const vec = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
      await expect(
        run('$v -> seq({ $ })', { variables: { v: vec } })
      ).rejects.toThrow('Collection operators require');
    });

    it('EC-8 (filter): options not a dict raises RILL-R001', async () => {
      await expect(run('list[1] -> filter({ $ > 0 }, 42)')).rejects.toThrow(
        expect.objectContaining({ errorId: 'RILL-R001' })
      );
    });

    it('EC-10 (filter): negative concurrency raises RILL-R001', async () => {
      await expect(
        run('list[1, 2] -> filter({ $ > 0 }, [concurrency: -1])')
      ).rejects.toThrow(expect.objectContaining({ errorId: 'RILL-R001' }));
    });
  });

  // ── Context Isolation ─────────────────────────────────────────────────────

  describe('Context Isolation', () => {
    it('seq nested inside acc cannot access outer $@ accumulator', async () => {
      // seq creates its own child context and does not bind @.
      // Referencing $@ inside the seq body must raise an undefined-variable error.
      const script = `
        list[1, 2] -> acc(0, {
          list[10, 20] -> seq({ $@ + $ })
        })
      `;
      await expect(run(script)).rejects.toThrow();
    });

    it('seq nested inside acc can still access $ (the current seq element)', async () => {
      // seq isolates @ but still binds $ for each element it processes.
      // The inner seq should double its own elements independently per outer iteration.
      const script = `
        list[1, 2] -> acc(list[], {
          list[10, 20] -> seq({ $ * 2 })
        })
      `;
      expect(await run(script)).toEqual([
        [20, 40],
        [20, 40],
      ]);
    });
  });

  // ── Explicit list param — three-forms equivalence (IR-3..IR-7) ──────────

  describe('Explicit list param — three-forms equivalence (IR-3..IR-7)', () => {
    it('AC-COL-1: seq — auto-prepend, explicit $, and direct-call produce identical results', async () => {
      const autoPrepend = await run('list[1, 2, 3] -> seq({ $ * 2 })');
      const explicitDollar = await run(
        'list[1, 2, 3] => $xs\n$xs -> seq($, { $ * 2 })'
      );
      const directCall = await run('seq(list[1, 2, 3], { $ * 2 })');
      expect(autoPrepend).toEqual([2, 4, 6]);
      expect(explicitDollar).toEqual([2, 4, 6]);
      expect(directCall).toEqual([2, 4, 6]);
    });

    it('AC-COL-2: fan — auto-prepend, explicit $, and direct-call produce identical results', async () => {
      const autoPrepend = await run('list[1, 2] -> fan({ [$, $] })');
      const explicitDollar = await run(
        'list[1, 2] => $xs\n$xs -> fan($, { [$, $] })'
      );
      const directCall = await run('fan(list[1, 2], { [$, $] })');
      expect(autoPrepend).toEqual(explicitDollar);
      expect(directCall).toEqual(explicitDollar);
    });

    it('AC-COL-3: filter — auto-prepend, explicit $, and direct-call produce identical results', async () => {
      const autoPrepend = await run('list[1, 2, 3, 4] -> filter({ $ > 2 })');
      const explicitDollar = await run(
        'list[1, 2, 3, 4] => $xs\n$xs -> filter($, { $ > 2 })'
      );
      const directCall = await run('filter(list[1, 2, 3, 4], { $ > 2 })');
      expect(autoPrepend).toEqual([3, 4]);
      expect(explicitDollar).toEqual([3, 4]);
      expect(directCall).toEqual([3, 4]);
    });

    it('AC-COL-4: fold — auto-prepend, explicit $, and direct-call produce identical results', async () => {
      const autoPrepend = await run('list[1, 2, 3] -> fold(0, { $@ + $ })');
      const explicitDollar = await run(
        'list[1, 2, 3] => $xs\n$xs -> fold($, 0, { $@ + $ })'
      );
      const directCall = await run('fold(list[1, 2, 3], 0, { $@ + $ })');
      expect(autoPrepend).toBe(6);
      expect(explicitDollar).toBe(6);
      expect(directCall).toBe(6);
    });

    it('AC-COL-5: acc — auto-prepend, explicit $, and direct-call produce identical results', async () => {
      const autoPrepend = await run('list[1, 2, 3] -> acc(0, { $@ + $ })');
      const explicitDollar = await run(
        'list[1, 2, 3] => $xs\n$xs -> acc($, 0, { $@ + $ })'
      );
      const directCall = await run('acc(list[1, 2, 3], 0, { $@ + $ })');
      expect(autoPrepend).toEqual([1, 3, 6]);
      expect(explicitDollar).toEqual([1, 3, 6]);
      expect(directCall).toEqual([1, 3, 6]);
    });

    it('AC-COL-6: direct-call without pipe reads args[list] (spot-check no ctx.pipeValue dependency)', async () => {
      // Called with no piped value at all — operator must read from args['list']
      const result = await run('seq(list[10, 20, 30], { $ * 3 })');
      expect(result).toEqual([30, 60, 90]);
    });

    it('AC-COL-7: explicit $ targets the list slot — $xs -> seq($, body) equals $xs -> seq(body)', async () => {
      const withExplicitDollar = await run(
        'list[5, 6, 7] => $xs\n$xs -> seq($, { $ + 1 })'
      );
      const withAutoPrepend = await run(
        'list[5, 6, 7] => $xs\n$xs -> seq({ $ + 1 })'
      );
      expect(withExplicitDollar).toEqual(withAutoPrepend);
      expect(withExplicitDollar).toEqual([6, 7, 8]);
    });

    it('AC-COL-8: take — auto-prepend, explicit $, and direct-call produce identical results', async () => {
      const autoPrepend = await run('list[1, 2, 3, 4, 5] -> take(3)');
      const explicitDollar = await run(
        'list[1, 2, 3, 4, 5] => $xs\n$xs -> take($, 3)'
      );
      const directCall = await run('take(list[1, 2, 3, 4, 5], 3)');
      expect(autoPrepend).toEqual([1, 2, 3]);
      expect(explicitDollar).toEqual([1, 2, 3]);
      expect(directCall).toEqual([1, 2, 3]);
    });

    it('AC-COL-9: skip — auto-prepend, explicit $, and direct-call produce identical results', async () => {
      const autoPrepend = await run('list[1, 2, 3, 4, 5] -> skip(2)');
      const explicitDollar = await run(
        'list[1, 2, 3, 4, 5] => $xs\n$xs -> skip($, 2)'
      );
      const directCall = await run('skip(list[1, 2, 3, 4, 5], 2)');
      expect(autoPrepend).toEqual([3, 4, 5]);
      expect(explicitDollar).toEqual([3, 4, 5]);
      expect(directCall).toEqual([3, 4, 5]);
    });

    it('AC-COL-10: cycle — auto-prepend, explicit $, and direct-call produce identical results', async () => {
      const autoPrepend = await run('list[1, 2] -> cycle() -> take(4)');
      const explicitDollar = await run(
        'list[1, 2] => $xs\n$xs -> cycle($) -> take(4)'
      );
      const directCall = await run('cycle(list[1, 2]) -> take(4)');
      expect(autoPrepend).toEqual([1, 2, 1, 2]);
      expect(explicitDollar).toEqual([1, 2, 1, 2]);
      expect(directCall).toEqual([1, 2, 1, 2]);
    });

    it('AC-COL-11: batch — auto-prepend, explicit $, and direct-call produce identical results', async () => {
      const autoPrepend = await run('list[1, 2, 3, 4, 5] -> batch(2)');
      const explicitDollar = await run(
        'list[1, 2, 3, 4, 5] => $xs\n$xs -> batch($, 2)'
      );
      const directCall = await run('batch(list[1, 2, 3, 4, 5], 2)');
      expect(autoPrepend).toEqual([[1, 2], [3, 4], [5]]);
      expect(explicitDollar).toEqual([[1, 2], [3, 4], [5]]);
      expect(directCall).toEqual([[1, 2], [3, 4], [5]]);
    });

    it('AC-COL-12: window — auto-prepend, explicit $, and direct-call produce identical results', async () => {
      const autoPrepend = await run('list[1, 2, 3, 4, 5] -> window(3)');
      const explicitDollar = await run(
        'list[1, 2, 3, 4, 5] => $xs\n$xs -> window($, 3)'
      );
      const directCall = await run('window(list[1, 2, 3, 4, 5], 3)');
      expect(autoPrepend).toEqual([
        [1, 2, 3],
        [4, 5],
      ]);
      expect(explicitDollar).toEqual([
        [1, 2, 3],
        [4, 5],
      ]);
      expect(directCall).toEqual([
        [1, 2, 3],
        [4, 5],
      ]);
    });

    it('AC-COL-13: start_when — auto-prepend, explicit $, and direct-call produce identical results', async () => {
      const autoPrepend = await run(
        'list[1, 2, 3, 4, 5] -> start_when({ $ -> .eq(3) })'
      );
      const explicitDollar = await run(
        'list[1, 2, 3, 4, 5] => $xs\n$xs -> start_when($, { $ -> .eq(3) })'
      );
      const directCall = await run(
        'start_when(list[1, 2, 3, 4, 5], { $ -> .eq(3) })'
      );
      expect(autoPrepend).toEqual([3, 4, 5]);
      expect(explicitDollar).toEqual([3, 4, 5]);
      expect(directCall).toEqual([3, 4, 5]);
    });

    it('AC-COL-14: stop_when — auto-prepend, explicit $, and direct-call produce identical results', async () => {
      const autoPrepend = await run(
        'list[1, 2, 3, 4, 5] -> stop_when({ $ -> .eq(3) })'
      );
      const explicitDollar = await run(
        'list[1, 2, 3, 4, 5] => $xs\n$xs -> stop_when($, { $ -> .eq(3) })'
      );
      const directCall = await run(
        'stop_when(list[1, 2, 3, 4, 5], { $ -> .eq(3) })'
      );
      expect(autoPrepend).toEqual([1, 2, 3]);
      expect(explicitDollar).toEqual([1, 2, 3]);
      expect(directCall).toEqual([1, 2, 3]);
    });
  });

  // ── Phase 1: take, skip, cycle, pass<> ───────────────────────────────────

  describe('Phase 1 slicing operators and pass<> body', () => {
    // ── take ────────────────────────────────────────────────────────────────

    it('AC-TAKE-1: range(1,101) -> take(5) yields [1,2,3,4,5]', async () => {
      expect(await run('range(1, 101) -> take(5)')).toEqual([1, 2, 3, 4, 5]);
    });

    it('AC-TAKE-2: list[1,2,3] -> take(5) yields [1,2,3] (n > length)', async () => {
      expect(await run('list[1, 2, 3] -> take(5)')).toEqual([1, 2, 3]);
    });

    it('AC-TAKE-3: list[1,2,3] -> take(0) yields [] (list input -> empty list)', async () => {
      expect(await run('list[1, 2, 3] -> take(0)')).toEqual([]);
    });

    it('AC-TAKE-4: stream input take(0) yields [] (materialized as empty list)', async () => {
      // Convention: collection operators materialise stream inputs to lists.
      const result = await run('make_stream() -> take(0)', {
        functions: { make_stream: makeStreamFn([1, 2, 3]) },
      });
      expect(result).toEqual([]);
    });

    // ── skip ────────────────────────────────────────────────────────────────

    it('AC-SKIP-1: range(1,11) -> skip(3) yields [4,5,6,7,8,9,10]', async () => {
      expect(await run('range(1, 11) -> skip(3)')).toEqual([
        4, 5, 6, 7, 8, 9, 10,
      ]);
    });

    it('AC-SKIP-2: list[1,2,3] -> skip(0) yields [1,2,3]', async () => {
      expect(await run('list[1, 2, 3] -> skip(0)')).toEqual([1, 2, 3]);
    });

    it('AC-SKIP-3: list[1,2,3] -> skip(5) yields [] (n > length)', async () => {
      expect(await run('list[1, 2, 3] -> skip(5)')).toEqual([]);
    });

    // ── cycle ───────────────────────────────────────────────────────────────

    it('AC-CYCLE-1: list[1,2,3] -> cycle -> take(6) yields [1,2,3,1,2,3]', async () => {
      expect(await run('list[1, 2, 3] -> cycle -> take(6)')).toEqual([
        1, 2, 3, 1, 2, 3,
      ]);
    });

    it('AC-CYCLE-2: list[] -> cycle -> take(5) yields []', async () => {
      expect(await run('list[] -> cycle -> take(5)')).toEqual([]);
    });

    // ── pass<> body ──────────────────────────────────────────────────────────

    it('AC-PASSBODY-1: pass<on_error: #IGNORE> body executes; pipe value unchanged', async () => {
      // Inject a log function that captures its argument. The pass<> body
      // invokes log($) (host call), which records the pipe value, then the
      // pipe value (5) is returned unchanged by pass<>.
      const captured: RillValue[] = [];
      const log_fn = {
        params: [
          {
            name: 'value',
            type: { kind: 'any' as const },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        returnType: anyTypeValue,
        fn: (args: Record<string, RillValue>): null => {
          captured.push(args['value'] ?? null);
          return null;
        },
      };
      const result = await run('5 -> pass<on_error: #IGNORE> { log($) }', {
        functions: { log: log_fn },
      });
      expect(result).toBe(5);
      expect(captured).toEqual([5]);
    });

    // ── Error cases ─────────────────────────────────────────────────────────

    it('AC-ERR-1: take(-1) raises #INVALID_INPUT', async () => {
      await expectHalt(() => run('list[1, 2, 3] -> take(-1)'), {
        code: 'INVALID_INPUT',
      });
    });

    it('AC-ERR-2: skip(-1) raises #INVALID_INPUT', async () => {
      await expectHalt(() => run('list[1, 2, 3] -> skip(-1)'), {
        code: 'INVALID_INPUT',
      });
    });

    it('AC-ERR-10: pass<on_error: #IGNORE> suppresses catchable halt; pipe value preserved', async () => {
      // A type assertion failure (e.g. :number on a string) produces a
      // catchable RuntimeHaltSignal. With on_error: #IGNORE the halt is
      // swallowed and the pipe value before the block (5) is returned.
      const result = await run(
        '5 -> pass<on_error: #IGNORE> { "not_a_number":number }'
      );
      expect(result).toBe(5);
    });

    // ── Boundary cases ──────────────────────────────────────────────────────

    it('AC-BND-1: take(n) on empty stream yields []', async () => {
      const result = await run('make_stream() -> take(3)', {
        functions: { make_stream: makeStreamFn([]) },
      });
      expect(result).toEqual([]);
    });

    it('AC-BND-2: skip(n) on empty stream yields []', async () => {
      const result = await run('make_stream() -> skip(3)', {
        functions: { make_stream: makeStreamFn([]) },
      });
      expect(result).toEqual([]);
    });

    it('AC-BND-5: take(n) with n > MAX_ITER clamps to 10000', async () => {
      // Host-inject a list of 15000 items to bypass getIterableElements limits.
      // take(20000) clamps to MAX_ITER (10000) and slices the list.
      const bigList: number[] = Array.from({ length: 15000 }, (_, i) => i + 1);
      const result = (await run('$big -> take(20000)', {
        variables: { big: bigList },
      })) as number[];
      expect(result).toHaveLength(10000);
      expect(result[0]).toBe(1);
      expect(result[9999]).toBe(10000);
    });

    it('AC-BND-6: pass<on_error: #IGNORE> re-throws non-catchable halt', async () => {
      // A host function that throws a RuntimeHaltSignal with catchable:false
      // simulates a #DISPOSED-style non-catchable halt. The pass<> block must
      // not suppress it even when on_error: #IGNORE is set.
      const throw_noncatchable = {
        params: [] as { name: string; type: TypeStructure }[],
        returnType: anyTypeValue,
        fn: (): never => {
          throw new RuntimeHaltSignal(null, false);
        },
      };
      await expect(
        run('5 -> pass<on_error: #IGNORE> { throw_noncatchable() }', {
          functions: { throw_noncatchable },
        })
      ).rejects.toBeInstanceOf(RuntimeHaltSignal);
    });

    it('AC-BND-7: bare pass keyword in conditional position parses to PassNode unchanged', async () => {
      // Bare `pass` (no `<` after) must parse to PassNode and return the
      // pipe value unchanged. Rill ternary requires a parenthesised pipe
      // expression as the condition: ($ < 0) ? then ! else
      // First case: condition is false, else branch (pass) returns pipe value 42.
      expect(await run('42 -> ($ < 0) ? "wrong" ! pass')).toBe(42);
      // Second case: condition is true, then branch (pass) returns pipe value 42.
      expect(await run('42 -> ($ > 0) ? pass ! "wrong"')).toBe(42);
    });
  });

  // ── Phase 2: batch, window, start_when, stop_when ───────────────────────

  describe('Phase 2 slicing operators: batch, window, start_when, stop_when', () => {
    // ── batch ────────────────────────────────────────────────────────────────

    it('AC-BATCH-1: range(1,11) -> batch(3) yields four chunks including trailing partial', async () => {
      expect(await run('range(1, 11) -> batch(3)')).toEqual([
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
        [10],
      ]);
    });

    it('AC-BATCH-2: batch(3, dict[drop_partial: true]) drops the trailing partial chunk', async () => {
      expect(
        await run('range(1, 11) -> batch(3, dict[drop_partial: true])')
      ).toEqual([
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ]);
    });

    it('AC-ERR-3: batch(0) raises #INVALID_INPUT', async () => {
      await expectHalt(() => run('list[1, 2, 3] -> batch(0)'), {
        code: 'INVALID_INPUT',
      });
    });

    it('AC-ERR-4: batch(-1) raises #INVALID_INPUT', async () => {
      await expectHalt(() => run('list[1, 2, 3] -> batch(-1)'), {
        code: 'INVALID_INPUT',
      });
    });

    it('AC-BND-3: batch(n) on empty stream yields empty list', async () => {
      const result = await run('make_stream() -> batch(3)', {
        functions: { make_stream: makeStreamFn([]) },
      });
      expect(result).toEqual([]);
    });

    // ── window ───────────────────────────────────────────────────────────────

    it('AC-WINDOW-1: range(1,7) -> window(3) yields non-overlapping windows of 3', async () => {
      expect(await run('range(1, 7) -> window(3)')).toEqual([
        [1, 2, 3],
        [4, 5, 6],
      ]);
    });

    it('AC-WINDOW-2: range(1,7) -> window(3, 2) yields overlapping windows with partial tail', async () => {
      expect(await run('range(1, 7) -> window(3, 2)')).toEqual([
        [1, 2, 3],
        [3, 4, 5],
        [5, 6],
      ]);
    });

    it('AC-ERR-5: window(0) raises #INVALID_INPUT', async () => {
      await expectHalt(() => run('list[1, 2, 3] -> window(0)'), {
        code: 'INVALID_INPUT',
      });
    });

    it('AC-ERR-6: window(3, -1) raises #INVALID_INPUT', async () => {
      await expectHalt(() => run('list[1, 2, 3] -> window(3, -1)'), {
        code: 'INVALID_INPUT',
      });
    });

    it('AC-ERR-7: window(3, 0) raises #INVALID_INPUT', async () => {
      await expectHalt(() => run('list[1, 2, 3] -> window(3, 0)'), {
        code: 'INVALID_INPUT',
      });
    });

    it('AC-BND-4: window(2, 4) on range(1,7) produces gap between windows (step > n)', async () => {
      // step=4 > n=2: windows at indices 0 and 4, leaving items 3-4 in the gap.
      expect(await run('range(1, 7) -> window(2, 4)')).toEqual([
        [1, 2],
        [5, 6],
      ]);
    });

    // ── start_when ───────────────────────────────────────────────────────────

    it('AC-STARTWHEN-1: start_when matching item 3 yields items 3-5 inclusive', async () => {
      expect(
        await run('list[1, 2, 3, 4, 5] -> start_when({ $ -> .eq(3) })')
      ).toEqual([3, 4, 5]);
    });

    it('AC-ERR-8: start_when predicate returning non-bool raises #TYPE_MISMATCH', async () => {
      await expectHalt(() => run('list[1, 2, 3] -> start_when({ "string" })'), {
        code: 'TYPE_MISMATCH',
      });
    });

    it('AC-ERR-11: start_when(42) with non-callable predicate raises #RILL_R040', async () => {
      await expectHalt(() => run('list[1, 2, 3] -> start_when(42)'), {
        code: 'RILL_R040',
      });
    });

    // ── stop_when ────────────────────────────────────────────────────────────

    it('AC-STOPWHEN-1: stop_when matching item 3 yields items 1-3 inclusive', async () => {
      expect(
        await run('list[1, 2, 3, 4, 5] -> stop_when({ $ -> .eq(3) })')
      ).toEqual([1, 2, 3]);
    });

    it('AC-ERR-9: stop_when predicate returning non-bool raises #TYPE_MISMATCH', async () => {
      await expectHalt(() => run('list[1, 2, 3] -> stop_when({ 42 })'), {
        code: 'TYPE_MISMATCH',
      });
    });
  });

  // ── Infrastructure Assertions ─────────────────────────────────────────────

  describe('Infrastructure Assertions', () => {
    it('AC-14: parse produces zero EACH/MAP/FOLD/FILTER legacy tokens', () => {
      // Legacy keyword token types were removed from TOKEN_TYPES when the
      // keyword-based syntax was replaced with callable-function syntax.
      expect(TOKEN_TYPES).not.toHaveProperty('EACH');
      expect(TOKEN_TYPES).not.toHaveProperty('MAP');
      expect(TOKEN_TYPES).not.toHaveProperty('FOLD');
      expect(TOKEN_TYPES).not.toHaveProperty('FILTER');
    });

    it('AC-15: AST contains no EachExpr/MapExpr/FoldExpr/FilterExpr nodes', () => {
      // Legacy AST node types are removed. Parse a new-syntax script and walk
      // the full AST tree to confirm no legacy node type appears.
      const LEGACY_TYPES = new Set([
        'EachExpr',
        'MapExpr',
        'FoldExpr',
        'FilterExpr',
      ]);
      const visit = (value: unknown): void => {
        if (value === null || typeof value !== 'object') return;
        if (Array.isArray(value)) {
          value.forEach(visit);
          return;
        }
        const node = value as Record<string, unknown>;
        if (typeof node['type'] === 'string') {
          expect(LEGACY_TYPES.has(node['type'] as string)).toBe(false);
        }
        Object.values(node).forEach(visit);
      };
      visit(parse('list[1, 2, 3] -> seq({ $ * 2 })'));
    });

    it('AC-16: src/parser/parser-collect.ts does not exist (removed)', async () => {
      const fs = await import('fs');
      const exists = fs.existsSync(
        new URL('../../../../src/parser/parser-collect.ts', import.meta.url)
          .pathname
      );
      expect(exists).toBe(false);
    });
  });
});
