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
  TOKEN_TYPES,
  type RillStream,
  type TypeStructure,
} from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

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
