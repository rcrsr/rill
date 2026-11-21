/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: Tuple types name positions
 *
 * `tuple(T)` with one argument names exactly one position. A tuple type has
 * no uniform form; a sequence of any length is `list(T)`.
 */

import { describe, expect } from 'vitest';

import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';

const tuple = (...entries: unknown[]) => ({
  __rill_tuple: true,
  entries,
});

describe('Rill Language: tuple types name positions', () => {
  const { it } = rule(
    'tuple.one-position',
    'tuple.no-uniform',
    'tuple.any-position'
  );

  describe('one argument names one position', () => {
    it('tuple[1].^type equals tuple(number)', async () => {
      expect(await run('tuple[1].^type == tuple(number)')).toBe(true);
    });

    it('nested one-position types are equal', async () => {
      expect(await run('tuple[tuple[1]].^type == tuple(tuple(number))')).toBe(
        true
      );
    });

    it('tuple[1].^type prints tuple(number)', async () => {
      expect(await run('tuple[1].^type.signature')).toBe('tuple(number)');
    });

    it('a one-element tuple has tuple(number)', async () => {
      expect(await run('tuple[1] -> :?tuple(number)')).toBe(true);
    });

    it('a wrong-typed element does not have tuple(number)', async () => {
      expect(await run('tuple["a"] -> :?tuple(number)')).toBe(false);
    });

    it('a two-element tuple does not have tuple(number)', async () => {
      expect(await run('tuple[1, 2] -> :?tuple(number)')).toBe(false);
    });

    it('a three-element tuple does not have tuple(number)', async () => {
      expect(await run('tuple[1, 2, 3] -> :?tuple(number)')).toBe(false);
    });

    it('an empty tuple does not have tuple(number)', async () => {
      expect(await run('tuple[] -> :?tuple(number)')).toBe(false);
    });

    it('asserting a one-element tuple returns it', async () => {
      expect(await run('tuple[1] -> :tuple(number)')).toEqual(tuple(1));
    });

    it('asserting a longer tuple halts TYPE_MISMATCH', async () => {
      await expectHalt(() => run('tuple[1, 2] -> :tuple(number)'), {
        code: 'TYPE_MISMATCH',
      });
    });

    it('converting drops extra elements', async () => {
      expect(await run('tuple[1, 2] -> tuple(number)')).toEqual(tuple(1));
      expect(await run('tuple[1, 2, 3] -> tuple(number)')).toEqual(tuple(1));
    });

    it('converting an empty tuple halts RILL-R044', async () => {
      await expectHalt(() => run('tuple[] -> tuple(number)'), {
        code: 'RILL_R044',
      });
    });

    it('two-position types stay positional and exact', async () => {
      expect(await run('tuple[1, 2].^type == tuple(number, number)')).toBe(
        true
      );
      expect(await run('tuple[1, 2] -> :tuple(number, number)')).toEqual(
        tuple(1, 2)
      );
      expect(await run('tuple[1, 2, 3] -> :?tuple(number, number)')).toBe(
        false
      );
      expect(await run('tuple[1, 2, 3] -> tuple(number, number)')).toEqual(
        tuple(1, 2)
      );
    });

    it('bare tuple accepts any tuple', async () => {
      expect(await run('tuple[1, 2, 3] -> :?tuple')).toBe(true);
    });
  });

  describe('no uniform form', () => {
    it('a tuple does not have a list type', async () => {
      expect(await run('tuple[1, 2, 3] -> :?list(number)')).toBe(false);
    });

    it('a list has list(number)', async () => {
      expect(await run('list[1, 2, 3] -> :?list(number)')).toBe(true);
    });

    it('a tuple converts to list(number)', async () => {
      expect(await run('tuple[1, 2, 3] -> list(number)')).toEqual([1, 2, 3]);
    });

    it('tuple(number) carries no uniform value type', async () => {
      const result = (await run('tuple(number)')) as {
        structure: { valueType?: unknown; elements?: unknown };
      };
      expect(result.structure.valueType).toBeUndefined();
      expect(result.structure.elements).toEqual([{ type: { kind: 'number' } }]);
    });

    it('dict and ordered name their fields', async () => {
      expect(await run('ordered[a: 1].^type == ordered(a: number)')).toBe(true);
    });
  });

  describe('tuple(any) names one position', () => {
    it('tuple(any) does not equal tuple', async () => {
      expect(await run('tuple(any) == tuple')).toBe(false);
    });

    it('a one-element tuple has tuple(any)', async () => {
      expect(await run('tuple[1] -> :?tuple(any)')).toBe(true);
    });

    it('a two-element tuple does not have tuple(any)', async () => {
      expect(await run('tuple[1, 2] -> :?tuple(any)')).toBe(false);
    });
  });
});

describe('Rill Language: tuple value methods', () => {
  const { it } = rule('tuple.len', 'selection.at');

  it('.len returns the number of positions', async () => {
    expect(await run('tuple[1, "a"].len')).toBe(2);
    expect(await run('tuple[1, "a"] -> .len')).toBe(2);
    expect(await run('tuple[].len')).toBe(0);
  });

  it('.len on an .entries pair is 2', async () => {
    expect(await run('dict[a: 1].entries[0].len')).toBe(2);
  });

  it('.at reads a position, counting negative indexes from the end', async () => {
    expect(await run('tuple[1, "a"].at(0)')).toBe(1);
    expect(await run('tuple[1, "a"].at(-1)')).toBe('a');
  });

  it('.at out of range halts RILL-R009', async () => {
    await expectHalt(() => run('tuple[1].at(3)'), { code: 'RILL_R009' });
  });
});
