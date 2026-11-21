/**
 * Tests for the map value model: construction faults, display, equality,
 * structural inference, matching, overlap, host conversion, and the
 * host-result brand check.
 */

import { describe, expect, it } from 'vitest';
import {
  createMap,
  createOrdered,
  deepEquals,
  formatStructure,
  formatValue,
  inferStructure,
  isDict,
  isMap,
  resolveAtom,
  structureMatches,
  structureOverlaps,
  toNative,
  type RillAtomValue,
  type TypeStructure,
} from '@rcrsr/rill';
import {
  normalizeHostResult,
  validateHostResult,
} from '../../src/runtime/core/callable.js';
import { expectHaltSync } from '../helpers/halt.js';

function atom(name: string): RillAtomValue {
  return { __rill_atom: true, atom: resolveAtom(name) };
}

const ATOM_KEY: TypeStructure = { kind: 'atom' };
const NUMBER: TypeStructure = { kind: 'number' };
const STRING: TypeStructure = { kind: 'string' };

describe('createMap', () => {
  it('keeps entries in insertion order', () => {
    const map = createMap([
      ['b', 1],
      ['a', 2],
    ]);

    expect(map.entries.map(([k]) => k)).toEqual(['b', 'a']);
  });

  it('freezes the map', () => {
    expect(Object.isFrozen(createMap([['a', 1]]))).toBe(true);
  });

  it('halts #TYPE_MISMATCH on a non-scalar key', () => {
    expectHaltSync(() => createMap([[[1, 2], 'x']]), {
      code: 'TYPE_MISMATCH',
      messagePattern: /scalar/,
    });
  });

  it('halts #TYPE_MISMATCH on keys of two kinds', () => {
    expectHaltSync(
      () =>
        createMap([
          [atom('a'), 1],
          ['b', 2],
        ]),
      { code: 'TYPE_MISMATCH', messagePattern: /one kind/ }
    );
  });

  it('halts #INVALID_INPUT on a duplicate key', () => {
    expectHaltSync(
      () =>
        createMap([
          [1, 'x'],
          [1.0, 'y'],
        ]),
      { code: 'INVALID_INPUT', messagePattern: /Duplicate/ }
    );
  });
});

describe('map value', () => {
  it('formats in insertion order', () => {
    const map = createMap([
      ['b', 1],
      ['a', 2],
    ]);

    expect(formatValue(map)).toBe('map["b": 1, "a": 2]');
  });

  it('formats an empty map as map[]', () => {
    expect(formatValue(createMap([]))).toBe('map[]');
  });

  it('is identified as a map and an ordered is not', () => {
    expect(isMap(createMap([['a', 1]]))).toBe(true);
    expect(isMap(createOrdered([['a', 1]]))).toBe(false);
  });

  it('is not a dict', () => {
    expect(isDict(createMap([['a', 1]]))).toBe(false);
  });

  it('compares equal regardless of entry order', () => {
    const a = createMap([
      ['x', 1],
      ['y', 2],
    ]);
    const b = createMap([
      ['y', 2],
      ['x', 1],
    ]);

    expect(deepEquals(a, b)).toBe(true);
  });

  it('compares unequal when a value differs', () => {
    const a = createMap([['x', 1]]);
    const b = createMap([['x', 2]]);

    expect(deepEquals(a, b)).toBe(false);
  });

  it('compares unequal when the sizes differ', () => {
    const a = createMap([['x', 1]]);
    const b = createMap([
      ['x', 1],
      ['y', 2],
    ]);

    expect(deepEquals(a, b)).toBe(false);
  });

  it('does not equal an ordered holding the same pairs', () => {
    expect(deepEquals(createMap([['x', 1]]), createOrdered([['x', 1]]))).toBe(
      false
    );
  });
});

describe('map structure', () => {
  it('infers atom keys and a union of value types', () => {
    const map = createMap([
      [atom('a'), 1],
      [atom('b'), 'x'],
    ]);

    expect(formatStructure(inferStructure(map))).toBe(
      'map(atom, union(number, string))'
    );
  });

  it('infers a bare map from an empty map', () => {
    expect(formatStructure(inferStructure(createMap([])))).toBe('map');
  });

  it('prints an unspecified slot as any', () => {
    expect(formatStructure({ kind: 'map', value: NUMBER })).toBe(
      'map(any, number)'
    );
  });

  it('matches a map whose keys and values fit the slots', () => {
    const map = createMap([[atom('a'), 1]]);

    expect(
      structureMatches(map, { kind: 'map', key: ATOM_KEY, value: NUMBER })
    ).toBe(true);
    expect(structureMatches(map, { kind: 'map' })).toBe(true);
  });

  it('rejects a map whose key kind or value type differs', () => {
    const map = createMap([[atom('a'), 1]]);

    expect(
      structureMatches(map, { kind: 'map', key: STRING, value: NUMBER })
    ).toBe(false);
    expect(
      structureMatches(map, { kind: 'map', key: ATOM_KEY, value: STRING })
    ).toBe(false);
  });

  it('matches an empty map against any map type', () => {
    expect(
      structureMatches(createMap([]), {
        kind: 'map',
        key: STRING,
        value: NUMBER,
      })
    ).toBe(true);
  });

  it('does not match a dict or ordered against a map type', () => {
    expect(structureMatches({ a: 1 }, { kind: 'map' })).toBe(false);
    expect(structureMatches(createOrdered([['a', 1]]), { kind: 'map' })).toBe(
      false
    );
  });

  it('does not match a map against a dict type', () => {
    expect(structureMatches(createMap([['a', 1]]), { kind: 'dict' })).toBe(
      false
    );
  });

  it.each<[string, TypeStructure, TypeStructure, boolean]>([
    ['same slots', mapOf(ATOM_KEY, NUMBER), mapOf(ATOM_KEY, NUMBER), true],
    ['bare against specific', { kind: 'map' }, mapOf(ATOM_KEY, NUMBER), true],
    [
      'different key kinds',
      mapOf(ATOM_KEY, NUMBER),
      mapOf(STRING, NUMBER),
      false,
    ],
    [
      'different value types',
      mapOf(ATOM_KEY, NUMBER),
      mapOf(ATOM_KEY, STRING),
      false,
    ],
    ['against a dict', { kind: 'map' }, { kind: 'dict' }, false],
  ])('overlap: %s', (_name, a, b, expected) => {
    expect(structureOverlaps(a, b)).toBe(expected);
    expect(structureOverlaps(b, a)).toBe(expected);
  });
});

function mapOf(key: TypeStructure, value: TypeStructure): TypeStructure {
  return { kind: 'map', key, value };
}

describe('map host conversion', () => {
  it('converts to a JS Map with atom keys as their names', () => {
    const result = toNative(
      createMap([
        [atom('a'), 1],
        [atom('b'), 'x'],
      ])
    );

    expect(result.rillTypeName).toBe('map');
    expect(result.value).toBeInstanceOf(Map);
    expect(result.value).toEqual(
      new Map<unknown, unknown>([
        ['a', 1],
        ['b', 'x'],
      ])
    );
  });

  it('accepts a well-formed map from a host function', () => {
    expect(() =>
      validateHostResult(createMap([['a', 1]]), 'host_fn')
    ).not.toThrow();
  });

  it.each<[string, unknown]>([
    ['entries that are not an array', { __rill_map: true, entries: 'x' }],
    ['an entry that is not a pair', { __rill_map: true, entries: [['a']] }],
    ['a non-scalar key', { __rill_map: true, entries: [[[1], 'x']] }],
    [
      'keys of two kinds',
      {
        __rill_map: true,
        entries: [
          ['a', 1],
          [2, 1],
        ],
      },
    ],
    [
      'a duplicate key',
      {
        __rill_map: true,
        entries: [
          ['a', 1],
          ['a', 2],
        ],
      },
    ],
  ])('rejects a forged brand with %s', (_name, forged) => {
    expect(() => validateHostResult(forged, 'host_fn')).toThrow(
      /malformed map brand/
    );
  });

  it('returns a frozen copy of a raw map the host still holds', () => {
    const shared = { __rill_map: true, entries: [['a', 1]] };
    const result = normalizeHostResult(shared, 'host_fn');
    shared.entries.push(['b', 2]);
    expect(isMap(result) ? result.entries : []).toHaveLength(1);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('rejects a host JS Map in validation-only mode', () => {
    expect(() => validateHostResult(new Map(), 'host_fn')).toThrow(/Map/);
  });

  it('rejects a forged atom key with a host-result halt', () => {
    const forged = { __rill_map: true, entries: [[{ __rill_atom: true }, 1]] };
    expect(() => validateHostResult(forged, 'host_fn')).toThrow(
      /malformed map brand/
    );
  });

  it('rejects a forged datetime key that has no unix', () => {
    const forged = {
      __rill_map: true,
      entries: [[{ __rill_datetime: true }, 1]],
    };
    expect(() => validateHostResult(forged, 'host_fn')).toThrow(
      /malformed map brand/
    );
  });

  it.each<[string, (v: unknown) => unknown]>([
    ['map', (v) => ({ __rill_map: true, entries: [['a', v]] })],
    ['ordered', (v) => ({ __rill_ordered: true, entries: [['a', v]] })],
    ['tuple', (v) => ({ __rill_tuple: true, entries: [v] })],
  ])('rejects an undefined or raw function value in a %s', (_n, build) => {
    // oxlint-disable-next-line unicorn/no-useless-undefined -- the host value under test
    expect(() => validateHostResult(build(undefined), 'host_fn')).toThrow(
      /invalid value at/
    );
    expect(() =>
      validateHostResult(
        build(() => 1),
        'host_fn'
      )
    ).toThrow(/invalid value at/);
  });
});

describe('host JS Map conversion', () => {
  it('converts a string-keyed Map to a rill map', () => {
    const result = normalizeHostResult(
      new Map<unknown, unknown>([
        ['a', 1],
        ['b', 'x'],
      ]),
      'host_fn'
    );
    expect(result).toEqual(
      createMap([
        ['a', 1],
        ['b', 'x'],
      ])
    );
  });

  it('converts number-keyed and atom-keyed Maps', () => {
    expect(isMap(normalizeHostResult(new Map([[1, 'x']]), 'host_fn'))).toBe(
      true
    );
    expect(normalizeHostResult(new Map([[atom('a'), 1]]), 'host_fn')).toEqual(
      createMap([[atom('a'), 1]])
    );
  });

  it('converts a Map nested in a dict and a list', () => {
    const result = normalizeHostResult(
      { m: new Map([['a', 1]]), l: [new Map([[true, 2]])] },
      'host_fn'
    );
    expect(result).toEqual({
      m: createMap([['a', 1]]),
      l: [createMap([[true, 2]])],
    });
  });

  it('rejects mixed key kinds with the path', () => {
    const mixed = new Map<unknown, unknown>([
      ['a', 1],
      [2, 1],
    ]);
    expect(() => normalizeHostResult({ m: mixed }, 'host_fn')).toThrow(
      /invalid value at \.m/
    );
  });

  it('rejects a non-scalar key', () => {
    expect(() => normalizeHostResult(new Map([[[1], 'x']]), 'host_fn')).toThrow(
      /scalar/
    );
  });

  it('rejects an invalid value inside a Map with the key in the path', () => {
    expect(() =>
      // oxlint-disable-next-line no-useless-undefined -- the host value under test
      normalizeHostResult(new Map([['a', undefined]]), 'host_fn')
    ).toThrow(/at \.a/);
  });

  it('keeps rejecting Date and Set', () => {
    expect(() => normalizeHostResult(new Date(), 'host_fn')).toThrow(/Date/);
    expect(() => normalizeHostResult(new Set(), 'host_fn')).toThrow(/Set/);
  });

  it('exports a converted map through toNative as a tagged wrapper, not a Map', () => {
    const map = normalizeHostResult(new Map([['a', 1]]), 'host_fn');
    expect(toNative(map)).toEqual({
      rillTypeName: 'map',
      rillTypeSignature: 'map(string, number)',
      value: new Map([['a', 1]]),
    });
  });

  it('exports an atom-keyed map through toNative with the atom names as keys', () => {
    expect(toNative(createMap([[atom('a'), 1]]))).toEqual({
      rillTypeName: 'map',
      rillTypeSignature: 'map(atom, number)',
      value: new Map([['a', 1]]),
    });
  });
});
