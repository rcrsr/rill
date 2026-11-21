/**
 * Tests for map lookup through the key index, declared empty-map selection,
 * sort over a map, and the iteration ceiling on a map source.
 */

import { describe, expect, it } from 'vitest';
import { isMap } from '@rcrsr/rill';
import { expectHalt } from '../helpers/halt.js';
import { run } from '../helpers/runtime.js';

describe('map lookup', () => {
  it('finds each key of a large map by value', async () => {
    const result = await run(
      'range(0, 500) -> seq({ list[$, $ * 2] }) -> :list(list(number)) -> .len'
    );
    expect(result).toBe(500);
    expect(
      await run(
        'map[1: "a", 2: "b", 3: "c"] => $m\nlist[$m[1], $m[2], $m[3]] -> .join(",")'
      )
    ).toBe('a,b,c');
  });

  it('keeps an atom key distinct from a string key of the same name', async () => {
    expect(await run('map[#a: 1] => $m\n$m.?[#a]')).toBe(true);
  });
});

describe('declared empty map selection', () => {
  it('halts #TYPE_MISMATCH on a wrong-kind read', async () => {
    await expectHalt(() => run('map(number, string)[] => $m\n$m["x"] ?? ""'), {
      code: 'TYPE_MISMATCH',
    });
  });

  it('halts #TYPE_MISMATCH on a wrong-kind probe', async () => {
    await expectHalt(() => run('map(number, string)[] => $m\n$m.?["x"]'), {
      code: 'TYPE_MISMATCH',
    });
  });
});

describe('union-keyed declared empty map selection', () => {
  const decl = 'map(union("a", "b"), number)[] => $m\n';

  it('halts #TYPE_MISMATCH on a wrong-kind read', async () => {
    await expectHalt(() => run(`${decl}$m[1] ?? 0`), { code: 'TYPE_MISMATCH' });
  });

  it('halts #TYPE_MISMATCH on a wrong-kind probe', async () => {
    await expectHalt(() => run(`${decl}$m.?[1]`), { code: 'TYPE_MISMATCH' });
  });
});

describe('sort over a map', () => {
  it('returns a map ordered by key', async () => {
    const result = await run('map[3: "c", 1: "a", 2: "b"] -> sort');
    expect(isMap(result)).toBe(true);
    if (isMap(result)) {
      expect(result.entries.map(([k]) => k)).toEqual([1, 2, 3]);
    }
  });

  it('returns a map ordered by the key function', async () => {
    const result = await run('map["a": 3, "b": 1] -> sort({ $.value })');
    expect(isMap(result)).toBe(true);
    if (isMap(result)) {
      expect(result.entries).toEqual([
        ['b', 1],
        ['a', 3],
      ]);
    }
  });

  it('halts RILL-R010 past the iteration ceiling', async () => {
    const entries = Array.from({ length: 10001 }, (_, i) => `${i}: ${i}`);
    await expect(
      run(`map[${entries.join(', ')}] -> sort`)
    ).rejects.toMatchObject({ errorId: 'RILL-R010' });
  });
});
