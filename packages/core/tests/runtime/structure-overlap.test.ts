/**
 * Tests for structureOverlaps() and the requireOverlap() halt.
 */

import {
  carriedStructure,
  requireOverlap,
  RuntimeHaltSignal,
  structureOverlaps,
  type TypeStructure,
} from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';
import { expectHaltSync } from '../helpers/halt.js';

const num: TypeStructure = { kind: 'number' };
const str: TypeStructure = { kind: 'string' };
const bool: TypeStructure = { kind: 'bool' };
const any: TypeStructure = { kind: 'any' };

const rows: [string, TypeStructure, TypeStructure, boolean][] = [
  ['any overlaps everything', any, num, true],
  [
    'union overlaps when some member does',
    { kind: 'union', members: [num, str] },
    str,
    true,
  ],
  [
    'union does not overlap when no member does',
    { kind: 'union', members: [num, str] },
    bool,
    false,
  ],
  ['different kinds never overlap', num, str, false],
  ['same scalar kind overlaps', num, num, true],
  [
    'literal is judged by its value kind',
    { kind: 'literal', value: 'a' },
    str,
    true,
  ],
  [
    'distinct literals of one kind overlap',
    { kind: 'literal', value: 'a' },
    { kind: 'literal', value: 'b' },
    true,
  ],
  [
    'literal of another kind does not overlap',
    { kind: 'literal', value: 1 },
    str,
    false,
  ],
  [
    'lists overlap when elements overlap',
    { kind: 'list', element: num },
    { kind: 'list', element: any },
    true,
  ],
  [
    'lists with disjoint elements do not overlap',
    { kind: 'list', element: num },
    { kind: 'list', element: str },
    false,
  ],
  [
    'absent list element reads as any',
    { kind: 'list' },
    { kind: 'list', element: num },
    true,
  ],
  [
    'dicts overlap when shared fields overlap',
    { kind: 'dict', fields: { a: { type: num } } },
    { kind: 'dict', fields: { a: { type: num } } },
    true,
  ],
  [
    'dicts with a disjoint shared field do not overlap',
    { kind: 'dict', fields: { a: { type: num } } },
    { kind: 'dict', fields: { a: { type: str } } },
    false,
  ],
  [
    'dict one-sided field without default does not overlap',
    { kind: 'dict', fields: { a: { type: num } } },
    { kind: 'dict', fields: { b: { type: num } } },
    false,
  ],
  [
    'dict one-sided fields with defaults overlap',
    { kind: 'dict', fields: { a: { type: num, defaultValue: 1 } } },
    { kind: 'dict', fields: { b: { type: num, defaultValue: 2 } } },
    true,
  ],
  [
    'unspecified dict overlaps any dict',
    { kind: 'dict' },
    { kind: 'dict', fields: { a: { type: num } } },
    true,
  ],
  [
    'unspecified tuple overlaps any tuple',
    { kind: 'tuple' },
    { kind: 'tuple', elements: [{ type: num }] },
    true,
  ],
  [
    'unspecified ordered overlaps any ordered',
    { kind: 'ordered' },
    { kind: 'ordered', fields: [{ name: 'a', type: num }] },
    true,
  ],
  [
    'ordered ignores field order',
    {
      kind: 'ordered',
      fields: [
        { name: 'a', type: num },
        { name: 'b', type: str },
      ],
    },
    {
      kind: 'ordered',
      fields: [
        { name: 'b', type: str },
        { name: 'a', type: num },
      ],
    },
    true,
  ],
  [
    'ordered with a disjoint field does not overlap',
    { kind: 'ordered', fields: [{ name: 'a', type: num }] },
    { kind: 'ordered', fields: [{ name: 'a', type: str }] },
    false,
  ],
  [
    'tuples overlap positionally',
    { kind: 'tuple', elements: [{ type: num }] },
    { kind: 'tuple', elements: [{ type: num }] },
    true,
  ],
  [
    'tuple extra position without default does not overlap',
    { kind: 'tuple', elements: [{ type: num }] },
    { kind: 'tuple', elements: [{ type: num }, { type: str }] },
    false,
  ],
  [
    'tuple extra defaulted position overlaps',
    { kind: 'tuple', elements: [{ type: num }] },
    {
      kind: 'tuple',
      elements: [{ type: num }, { type: str, defaultValue: 'x' }],
    },
    true,
  ],
  [
    'valueType overlaps fields that overlap it',
    { kind: 'dict', valueType: num },
    { kind: 'dict', fields: { a: { type: num } } },
    true,
  ],
  [
    'valueType does not overlap a disjoint field',
    { kind: 'dict', valueType: num },
    { kind: 'dict', fields: { a: { type: str } } },
    false,
  ],
  [
    'closures overlap by kind',
    { kind: 'closure' },
    { kind: 'closure', ret: num },
    true,
  ],
  [
    'iterators overlap by kind',
    { kind: 'iterator' },
    { kind: 'iterator' },
    true,
  ],
  ['vectors overlap by kind', { kind: 'vector' }, { kind: 'vector' }, true],
  ['types overlap by kind', { kind: 'type' }, { kind: 'type' }, true],
  [
    'datetimes overlap by kind',
    { kind: 'datetime' },
    { kind: 'datetime' },
    true,
  ],
  [
    'durations overlap by kind',
    { kind: 'duration' },
    { kind: 'duration' },
    true,
  ],
  ['atoms overlap by kind', { kind: 'atom' }, { kind: 'atom' }, true],
  [
    'streams overlap by kind',
    { kind: 'stream' },
    { kind: 'stream', chunk: num },
    true,
  ],
  [
    'stream does not overlap closure',
    { kind: 'stream' },
    { kind: 'closure' },
    false,
  ],
];

describe('structureOverlaps', () => {
  it.each(rows)('%s', (_name, a, b, expected) => {
    expect(structureOverlaps(a, b)).toBe(expected);
    expect(structureOverlaps(b, a)).toBe(expected);
  });
});

describe('carriedStructure', () => {
  it('prefers the declared structure', () => {
    expect(carriedStructure(1, str)).toBe(str);
  });

  it('infers the structure when none is declared', () => {
    expect(carriedStructure(1)).toEqual(num);
  });
});

describe('requireOverlap', () => {
  it('halts with the comparison message when types cannot overlap', () => {
    expectHaltSync(
      () => requireOverlap({ value: 1 }, { value: 'a' }, { fn: '==' }, '=='),
      {
        code: 'TYPE_MISMATCH',
        messagePattern: /^Cannot compare number with string using ==$/,
      }
    );
  });

  it('halts catchably', () => {
    let caught: unknown;
    try {
      requireOverlap({ value: 1 }, { value: 'a' }, { fn: '==' }, '==');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RuntimeHaltSignal);
    expect((caught as RuntimeHaltSignal).catchable).toBe(true);
  });

  it('returns when types overlap', () => {
    expect(() =>
      requireOverlap({ value: 1 }, { value: 2 }, { fn: '==' }, '==')
    ).not.toThrow();
  });
});
