/**
 * Tests for collections handler helper contracts and builtin dispatch
 *
 * These tests verify:
 * 1. The iterable helper contracts (RILL-R002, RILL-R003, element expansion)
 *    exercised via the runtime evaluator (eval/handlers/collections.ts).
 * 2. The builtin dispatch path (seq, fan, fold, filter, acc) via run().
 */

import { createVector } from '@rcrsr/rill';
import { describe, it, expect } from 'vitest';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

describe('collections handlers', () => {
  describe('getIterableElements helper contract', () => {
    describe('RILL-R002: non-iterable input', () => {
      it('raises error for number input to seq', async () => {
        await expectHalt(() => run('42 -> seq({ $ })'), {
          code: 'RILL_R002',
          hostErrorId: 'RILL-R002',
          messagePattern: 'Collection operators require',
        });
      });

      it('raises error for bool input to seq', async () => {
        await expectHalt(() => run('true -> seq({ $ })'), {
          code: 'RILL_R002',
          hostErrorId: 'RILL-R002',
          messagePattern: 'Collection operators require',
        });
      });

      it('raises error for number input to fan', async () => {
        await expectHalt(() => run('42 -> fan({ $ })'), {
          code: 'RILL_R002',
          hostErrorId: 'RILL-R002',
          messagePattern: 'Collection operators require',
        });
      });

      it('raises error with RILL-R002 error id', async () => {
        await expectHalt(() => run('42 -> seq({ $ })'), {
          code: 'RILL_R002',
          hostErrorId: 'RILL-R002',
        });
      });
    });

    describe('RILL-R003: vector input rejected', () => {
      it('raises error for vector input to seq', async () => {
        const vec = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
        await expectHalt(
          () => run('$v -> seq({ $ })', { variables: { v: vec } }),
          {
            code: 'RILL_R003',
            hostErrorId: 'RILL-R003',
            messagePattern: 'Collection operators require',
          }
        );
      });

      it('raises RILL-R003 for vector input', async () => {
        const vec = createVector(new Float32Array([1.0, 2.0, 3.0]), 'model-a');
        await expectHalt(
          () => run('$v -> seq({ $ })', { variables: { v: vec } }),
          { code: 'RILL_R003', hostErrorId: 'RILL-R003' }
        );
      });

      it('raises error for vector input to fan', async () => {
        const vec = createVector(new Float32Array([2.0, 3.0]), 'model-b');
        await expectHalt(
          () => run('$v -> fan({ $ })', { variables: { v: vec } }),
          {
            code: 'RILL_R003',
            hostErrorId: 'RILL-R003',
            messagePattern: 'Collection operators require',
          }
        );
      });
    });

    describe('list element expansion', () => {
      it('iterates list elements with seq', async () => {
        const result = await run('list[1, 2, 3] -> seq({ $ * 2 })');
        expect(result).toEqual([2, 4, 6]);
      });

      it('iterates empty list', async () => {
        const result = await run('list[] -> seq({ $ })');
        expect(result).toEqual([]);
      });
    });

    describe('string character expansion', () => {
      it('iterates string as characters', async () => {
        const result = await run('"abc" -> seq({ $ })');
        expect(result).toEqual(['a', 'b', 'c']);
      });
    });

    describe('dict entry expansion', () => {
      it('iterates dict as key-value entries', async () => {
        const result = await run('[a: 1, b: 2] -> fan({ $.key })');
        expect(result).toEqual(['a', 'b']);
      });
    });

    describe('expandIterator: iterator protocol materialisation', () => {
      it('materialises range iterator to elements', async () => {
        const result = await run('range(0, 3) -> seq({ $ * 10 })');
        expect(result).toEqual([0, 10, 20]);
      });

      it('materialises repeat iterator to elements', async () => {
        const result = await run('repeat(5, 3) -> fold(0, { $@ + $ })');
        expect(result).toBe(15);
      });
    });
  });

  describe('builtin dispatch: seq (sequential iteration)', () => {
    it('returns all results in order', async () => {
      const result = await run('list[1, 2, 3] -> seq({ $ * 2 })');
      expect(result).toEqual([2, 4, 6]);
    });

    it('handles empty collection', async () => {
      const result = await run('list[] -> seq({ $ * 2 })');
      expect(result).toEqual([]);
    });

    it('supports break for early termination', async () => {
      const result = await run(
        'list[1, 2, 3, 4, 5] -> seq({ ($ == 3) ? break ! $ })'
      );
      expect(result).toEqual([1, 2]);
    });

    it('propagates errors from body evaluation', async () => {
      await expectHalt(() => run('list[1, 2, 3] -> seq({ $undefined })'), {
        code: 'RILL_R005',
        hostErrorId: 'RILL-R005',
      });
    });

    it('raises error when body is not a closure', async () => {
      await expectHalt(() => run('list[1] -> seq(42)'), {
        code: 'RILL_R040',
        hostErrorId: 'RILL-R040',
        messagePattern: /seq.*closure/i,
      });
    });
  });

  describe('builtin dispatch: fan (parallel iteration)', () => {
    it('returns all results', async () => {
      const result = await run('list[1, 2, 3] -> fan({ $ * 2 })');
      expect(result).toEqual([2, 4, 6]);
    });

    it('handles empty collection', async () => {
      const result = await run('list[] -> fan({ $ * 2 })');
      expect(result).toEqual([]);
    });

    it('processes elements concurrently', async () => {
      const result = await run('list[1, 2, 3] -> fan({ $ + 1 })');
      expect(result).toEqual([2, 3, 4]);
    });

    it('respects concurrency option', async () => {
      const result = await run(
        'list[1, 2, 3, 4] -> fan({ $ * 2 }, [concurrency: 2])'
      );
      expect(result).toEqual([2, 4, 6, 8]);
    });

    it('halts with RILL-R001 on fractional concurrency', async () => {
      await expectHalt(
        () => run('list[1, 2, 3] -> fan({ $ }, dict[concurrency: 0.5])'),
        {
          code: 'RILL_R001',
          hostErrorId: 'RILL-R001',
          messagePattern: /positive integer/i,
        }
      );
    });

    it('halts with RILL-R001 on an unknown option key', async () => {
      await expectHalt(
        () => run('list[1, 2, 3] -> fan({ $ }, dict[batch_size: 2])'),
        {
          code: 'RILL_R001',
          hostErrorId: 'RILL-R001',
          messagePattern:
            /fan: unknown option 'batch_size'; recognized options are 'concurrency'/,
        }
      );
    });
  });

  describe('builtin dispatch: fold (sequential reduction)', () => {
    it('reduces list to final accumulator', async () => {
      const result = await run('list[1, 2, 3] -> fold(0, { $@ + $ })');
      expect(result).toBe(6);
    });

    it('returns initial accumulator for empty collection', async () => {
      const result = await run('list[] -> fold(10, { $@ + $ })');
      expect(result).toBe(10);
    });

    it('raises error when body is not a closure', async () => {
      await expectHalt(() => run('list[1] -> fold(0, 42)'), {
        code: 'RILL_R040',
        hostErrorId: 'RILL-R040',
        messagePattern: /fold.*closure/i,
      });
    });
  });

  describe('builtin dispatch: filter (predicate filter)', () => {
    it('filters elements where predicate is true', async () => {
      const result = await run('list[1, 2, 3, 4, 5] -> filter({ $ > 2 })');
      expect(result).toEqual([3, 4, 5]);
    });

    it('handles empty collection', async () => {
      const result = await run('list[] -> filter({ $ > 2 })');
      expect(result).toEqual([]);
    });

    it('preserves original element order', async () => {
      const result = await run('list[5, 1, 3, 2, 4] -> filter({ $ > 2 })');
      expect(result).toEqual([5, 3, 4]);
    });

    it('raises error when predicate does not return bool', async () => {
      await expectHalt(() => run('list[1, 2, 3] -> filter({ $ * 2 })'), {
        code: 'RILL_R001',
        hostErrorId: 'RILL-R001',
        messagePattern: /predicate must return bool/i,
      });
    });

    it('respects concurrency option', async () => {
      const result = await run(
        'list[1, 2, 3, 4] -> filter({ $ > 1 }, dict[concurrency: 2])'
      );
      expect(result).toEqual([2, 3, 4]);
    });

    it('halts with RILL-R001 on fractional concurrency', async () => {
      await expectHalt(
        () => run('list[1, 2, 3] -> filter({ $ > 1 }, dict[concurrency: 0.5])'),
        {
          code: 'RILL_R001',
          hostErrorId: 'RILL-R001',
          messagePattern: /positive integer/i,
        }
      );
    });

    it('halts with RILL-R001 on an unknown option key', async () => {
      await expectHalt(
        () => run('list[1, 2, 3] -> filter({ $ > 1 }, dict[batch_size: 2])'),
        {
          code: 'RILL_R001',
          hostErrorId: 'RILL-R001',
          messagePattern:
            /filter: unknown option 'batch_size'; recognized options are 'concurrency'/,
        }
      );
    });
  });

  describe('builtin dispatch: acc (sequential scan with accumulator)', () => {
    it('produces running accumulation results', async () => {
      const result = await run('list[1, 2, 3] -> acc(0, { $@ + $ })');
      expect(result).toEqual([1, 3, 6]);
    });

    it('handles empty collection', async () => {
      const result = await run('list[] -> acc(0, { $@ + $ })');
      expect(result).toEqual([]);
    });
  });

  describe('iteration limits (RILL-R010)', () => {
    it('raises error when iterator expansion exceeds limit', async () => {
      await expectHalt(() => run('range(1, 20000) -> seq({ $ })'), {
        code: 'RILL_R010',
        hostErrorId: 'RILL-R010',
      });
    });
  });
});
