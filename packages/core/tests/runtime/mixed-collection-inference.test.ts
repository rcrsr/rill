/**
 * Mixed-collection inference: inferStructure never halts on mixed lists and
 * reports a union element type; the strict list sites still halt.
 */

import { describe, expect, it } from 'vitest';
import {
  commonType,
  inferStructure,
  toNative,
  type RillValue,
  type TypeStructure,
} from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

const NUMBER_STRING = 'list(union(number, string))';
const mixed = (): RillValue => [1, 'a'];
const num: TypeStructure = { kind: 'number' };
const str: TypeStructure = { kind: 'string' };
const bool: TypeStructure = { kind: 'bool' };
const union = (...members: TypeStructure[]): TypeStructure => ({
  kind: 'union',
  members,
});

describe('Mixed-collection inference: union inner', () => {
  it('returns the member list from .inner and nests it in a list literal', async () => {
    const result = await run('union(1, "a") => $t\n$t.inner => $u\nlist[$u]');
    expect(result).toEqual([[1, 'a']]);
  });

  it('infers a union element type for the reversed inner list', async () => {
    const result = await run(
      'union(1, "a") => $t\n$t.inner -> .reverse => $r\n$r.^type.signature'
    );
    expect(result).toBe(NUMBER_STRING);
  });

  it('infers a union element type for the method-call form of inner', async () => {
    const result = await run(
      'union(1, "a") => $t\n$t -> .inner => $u\n$u.^type.signature'
    );
    expect(result).toBe(NUMBER_STRING);
  });

  it('accepts the inner list as a list literal element', async () => {
    const result = await run('union(1, "a") => $t\nlist[$t.inner]');
    expect(result).toEqual([[1, 'a']]);
  });

  it('compares inner lists across equal unions', async () => {
    const result = await run(
      'union(1, "a") => $t\n$t.inner == union("a", 1).inner'
    );
    expect(result).toBe(true);
  });
});

describe('Mixed-collection inference: host-injected mixed list', () => {
  const variables = (): Record<string, RillValue> => ({ m: mixed() });

  it('reports the union element type for .^type and .^effective', async () => {
    expect(await run('$m.^type.signature', { variables: variables() })).toBe(
      NUMBER_STRING
    );
    expect(
      await run('$m.^effective.signature', { variables: variables() })
    ).toBe(NUMBER_STRING);
  });

  it('accepts the list twice in a list literal', async () => {
    const result = await run('list[$m, $m]', { variables: variables() });
    expect(result).toEqual([
      [1, 'a'],
      [1, 'a'],
    ]);
  });

  it('accepts a list literal mixing the list with a string', async () => {
    const result = await run('list[$m, "x"]', { variables: variables() });
    expect(result).toEqual([[1, 'a'], 'x']);
  });

  it('halts TYPE_MISMATCH, not R002, on a narrower list assertion', async () => {
    await expectHalt(
      () => run('$m -> :list(number)', { variables: variables() }),
      { code: 'TYPE_MISMATCH' }
    );
  });

  it('passes a list assertion naming the union element', async () => {
    const result = await run('$m -> :list(union(number, string))', {
      variables: variables(),
    });
    expect(result).toEqual([1, 'a']);
  });

  it('reports the union element inside a dict field type', async () => {
    const result = await run('dict[x: $m].^type.signature', {
      variables: variables(),
    });
    expect(result).toBe(`dict(x: ${NUMBER_STRING})`);
  });
});

describe('Mixed-collection inference: inferred element types', () => {
  it('reports a union for a seq result mixing kinds', async () => {
    const result = await run(
      'list[1, 2] -> seq({ ($ == 1) ? "a" ! 2 }) => $r\n$r.^type.signature'
    );
    expect(result).toBe(NUMBER_STRING);
  });

  it('infers a union element for a mixed list', () => {
    expect(inferStructure([1, 'a'])).toEqual({
      kind: 'list',
      element: union(num, str),
    });
  });

  it('infers a union of the inner list types for nested lists with different elements', () => {
    expect(inferStructure([[1, 'a'], [true]])).toEqual({
      kind: 'list',
      element: union(
        { kind: 'list', element: union(num, str) },
        { kind: 'list', element: bool }
      ),
    });
  });

  it('merges two unions only when structurally equal', () => {
    expect(commonType(union(num, str), union(str, num))).toMatchObject({
      kind: 'union',
    });
    expect(commonType(union(num, str), union(num, bool))).toBeNull();
  });

  it('reports the union signature through toNative', () => {
    expect(toNative(mixed()).rillTypeSignature).toBe(NUMBER_STRING);
  });
});

describe('Mixed-collection inference: mixed sites do not halt', () => {
  it('accepts a mixed list literal', async () => {
    expect(await run('list[1, "a"]')).toEqual([1, 'a']);
  });

  it('accepts spreading a mixed list into a list literal', async () => {
    expect(await run('list[...$m]', { variables: { m: mixed() } })).toEqual([
      1,
      'a',
    ]);
  });

  it('accepts tuple-to-list conversion of mixed elements', async () => {
    expect(await run('tuple[1, "a"] -> list')).toEqual([1, 'a']);
  });

  it('compares an inner list with a mixed list literal', async () => {
    expect(await run('union(1, "a") => $t\n$t.inner == list[1, "a"]')).toBe(
      true
    );
  });
});

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [
      item,
      ...rest,
    ])
  );
}

describe('Mixed-collection inference: order and duplicate independence', () => {
  const pools: readonly string[][] = [
    ['dict[a: 1]', 'dict[b: 2]', 'dict[c: 3]'],
    ['ordered[a: 1]', 'ordered[b: 2]', 'ordered[c: 3]'],
    ['list[]', 'list[1]', 'list["a"]'],
    ['list[list[]]', 'list[list[1]]', 'list[1]'],
    [
      'dict[a: list[], b: list[1]]',
      'dict[a: list["s"], b: list[]]',
      'dict[a: list[1], b: list[]]',
    ],
    ['dict[a: list[]]', 'dict[b: list[1]]', 'dict[c: list["s"]]'],
  ];

  it.each(pools)(
    'infers the same type for every ordering of %s, %s, %s',
    async (...pool) => {
      const signatures = new Set<string>();
      for (const order of permutations(pool)) {
        const literal = `list[${order.join(', ')}]`;
        signatures.add((await run(`${literal}.^type.signature`)) as string);
        const reference = `list[${pool.join(', ')}]`;
        expect(await run(`${literal}.^type == ${reference}.^type`)).toBe(true);
      }
      expect(signatures.size).toBe(1);
    }
  );

  it('leaves the type unchanged when a duplicate shape is appended', async () => {
    const base = await run('list[dict[a: 5], dict[b: 2]].^type.signature');
    const dup = await run(
      'list[dict[a: 5], dict[b: 2], dict[a: 5]].^type.signature'
    );
    expect(dup).toBe(base);
  });

  it('infers a three-member union of dict shapes', async () => {
    expect(
      await run(
        'list[dict[a: 1], dict[b: 2], dict[c: 3]].^type == list(union(dict(a: number), dict(b: number), dict(c: number)))'
      )
    ).toBe(true);
  });
});

describe('Mixed-collection inference: commonType of keyed compounds', () => {
  it('returns null for dicts with different fields', () => {
    const a: TypeStructure = {
      kind: 'dict',
      fields: { a: { type: num } },
    };
    const b: TypeStructure = {
      kind: 'dict',
      fields: { b: { type: num } },
    };
    expect(commonType(a, b)).toBeNull();
  });

  it('returns null for ordereds with different fields', () => {
    const a: TypeStructure = {
      kind: 'ordered',
      fields: [{ name: 'a', type: num }],
    };
    const b: TypeStructure = {
      kind: 'ordered',
      fields: [{ name: 'b', type: num }],
    };
    expect(commonType(a, b)).toBeNull();
  });

  it('refines list(any) with list(number) to list(number)', () => {
    expect(
      commonType(
        { kind: 'list', element: { kind: 'any' } },
        { kind: 'list', element: num }
      )
    ).toEqual({ kind: 'list', element: num });
  });
});

describe('Mixed-collection inference: element carries its inferred type', () => {
  it('gives an iterated element of a mixed list the union element type', async () => {
    const result = await run('list[1, "a"] -> seq({ $.^type -> .signature })');
    expect(result).toEqual(['union(number, string)', 'union(number, string)']);
  });

  it('gives an indexed element of a mixed list the union element type', async () => {
    const result = await run('list[1, "a"] => $m\n$m[0].^type.signature');
    expect(result).toBe('union(number, string)');
  });

  it('gives an element of a host-injected mixed list the union element type', async () => {
    const result = await run('$m[1].^type.signature', {
      variables: { m: mixed() },
    });
    expect(result).toBe('union(number, string)');
  });
});
