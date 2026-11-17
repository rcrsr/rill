/**
 * Rill Runtime Tests: Equality methods on every comparable value kind
 *
 * `.eq` and `.ne` compare as `==` does, so each method table whose values
 * support `==` exposes them, including the type-mismatch halt.
 */

import { describe, expect, it } from 'vitest';
import { BUILTIN_METHODS } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

describe('duration equality methods', () => {
  it('returns true from .eq for equal durations', async () => {
    expect(await run('duration("48h") -> .eq(duration("2d"))')).toBe(true);
  });

  it('returns false from .eq for different durations', async () => {
    expect(await run('duration("1s") -> .eq(duration("2s"))')).toBe(false);
  });

  it('returns true from .ne for different durations', async () => {
    expect(await run('duration("1s") -> .ne(duration("2s"))')).toBe(true);
  });

  it('returns false from .ne for equal durations', async () => {
    expect(await run('duration("1s") -> .ne(duration("1s"))')).toBe(false);
  });

  it('halts #TYPE_MISMATCH when .eq compares a duration with a number', async () => {
    await expectHalt(() => run('duration("1s").eq(1)'), {
      code: 'TYPE_MISMATCH',
    });
  });
});

describe('tuple equality methods', () => {
  it('returns true from .eq for equal tuples', async () => {
    expect(await run('tuple[1, 2] -> .eq(tuple[1, 2])')).toBe(true);
  });

  it('returns true from .ne for different tuples', async () => {
    expect(await run('tuple[1, 2] -> .ne(tuple[1, 3])')).toBe(true);
  });

  it('halts when .eq compares a tuple with a number', async () => {
    await expectHalt(() => run('tuple[1].eq(1)'), { code: 'TYPE_MISMATCH' });
  });
});

describe('ordered equality methods', () => {
  it('returns true from .eq for equal ordered values', async () => {
    expect(await run('ordered[a: 1] -> .eq(ordered[a: 1])')).toBe(true);
  });

  it('returns true from .ne for different ordered values', async () => {
    expect(await run('ordered[a: 1] -> .ne(ordered[a: 2])')).toBe(true);
  });

  it('halts when .eq compares ordered with a number', async () => {
    await expectHalt(() => run('ordered[a: 1].eq(1)'), {
      code: 'TYPE_MISMATCH',
    });
  });
});

describe('vector equality methods', () => {
  it('registers .eq and .ne in the vector method table', () => {
    expect(Object.keys(BUILTIN_METHODS.vector)).toEqual(
      expect.arrayContaining(['eq', 'ne'])
    );
  });
});
