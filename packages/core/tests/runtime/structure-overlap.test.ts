/**
 * Tests for structureOverlaps() and the comparison overlap gate.
 */

import { structureOverlaps, type TypeStructure } from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';
import { expectHalt } from '../helpers/halt.js';
import { run } from '../helpers/runtime.js';

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
    'distinct literals of one kind do not overlap',
    { kind: 'literal', value: 'a' },
    { kind: 'literal', value: 'b' },
    false,
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
  ['closures overlap by kind', { kind: 'fn' }, { kind: 'fn', ret: num }, true],
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
  ['stream does not overlap fn', { kind: 'stream' }, { kind: 'fn' }, false],
];

describe('structureOverlaps', () => {
  it.each(rows)('%s', (_name, a, b, expected) => {
    expect(structureOverlaps(a, b)).toBe(expected);
    expect(structureOverlaps(b, a)).toBe(expected);
  });
});

describe('comparison overlap gate', () => {
  it('halts with the comparison message when types cannot overlap', async () => {
    await expectHalt(() => run('1 == "a"'), {
      code: 'TYPE_MISMATCH',
      messagePattern: /^Cannot compare number with string using ==$/,
    });
  });

  it('names the kind, never the value, of an undeclared operand', async () => {
    const setup = '"a" => $s:union("a", "b")\n';
    await expectHalt(() => run(setup + '$s == "sk-SECRET-TOKEN-123"'), {
      code: 'TYPE_MISMATCH',
      messagePattern: /^Cannot compare union\("a", "b"\) with string using ==$/,
    });
  });

  it('halts catchably', async () => {
    expect(
      await run('(guard { 1 == "a" } => $r).!code == #TYPE_MISMATCH')
    ).toBe(true);
  });

  it('passes when types overlap', async () => {
    expect(await run('1 == 2')).toBe(false);
  });
});

describe('declared dict overlap', () => {
  const declared = 'dict[a: 1] => $x:dict(a: number)\n';
  const defaulted = 'dict[a: 1] => $x:dict(a: number, b: number = 0)\n';

  it('halts == on an extra key against a declared dict', async () => {
    await expectHalt(() => run(`${declared}$x == dict[a: 1, b: 2]`), {
      code: 'TYPE_MISMATCH',
    });
  });

  it('halts != on an extra key against a declared dict', async () => {
    await expectHalt(() => run(`${declared}$x != dict[a: 1, b: 3]`), {
      code: 'TYPE_MISMATCH',
    });
  });

  it('halts when the declared dict is the right operand', async () => {
    await expectHalt(() => run(`${declared}dict[a: 1, b: 2] == $x`), {
      code: 'TYPE_MISMATCH',
    });
  });

  it('halts .eq and .ne on an extra key against a declared dict', async () => {
    await expectHalt(() => run(`${declared}$x -> .eq(dict[a: 1, b: 2])`), {
      code: 'TYPE_MISMATCH',
    });
    await expectHalt(() => run(`${declared}$x -> .ne(dict[a: 1, b: 2])`), {
      code: 'TYPE_MISMATCH',
    });
  });

  it('halts .has when the list is declared and the sought dict has an extra key', async () => {
    await expectHalt(
      () =>
        run(
          'list[dict[a: 1]] => $l:list(dict(a: number))\n$l -> .has(dict[a: 1, b: 2])'
        ),
      { code: 'TYPE_MISMATCH' }
    );
  });

  it('halts .has when the sought dict is declared and the element has an extra key', async () => {
    await expectHalt(
      () =>
        run(
          'dict[a: 1] => $x:dict(a: number)\nlist[dict[a: 1, b: 2]] -> .has($x)'
        ),
      { code: 'TYPE_MISMATCH' }
    );
  });

  it('compares false when the one-sided key of the declared dict is defaulted', async () => {
    expect(await run(`${defaulted}$x == dict[a: 1, b: 2]`)).toBe(false);
    expect(await run(`${defaulted}dict[a: 1, b: 2] == $x`)).toBe(false);
  });

  it('still halts when a shared key of a declared dict has a different type', async () => {
    await expectHalt(() => run(`${declared}$x == dict[a: "x", b: 2]`), {
      code: 'TYPE_MISMATCH',
    });
  });

  it('still halts on inferred dicts with different keys', async () => {
    await expectHalt(() => run('dict[a: 1] == dict[a: 1, b: 2]'), {
      code: 'TYPE_MISMATCH',
    });
    await expectHalt(() => run('dict[a: 1] -> .eq(dict[a: 1, b: 2])'), {
      code: 'TYPE_MISMATCH',
    });
  });

  it('still halts on an undeclared list whose element dicts differ in keys', async () => {
    await expectHalt(
      () => run('list[dict[a: 1], dict[b: 2]] -> seq({ $ == dict[a: 1] })'),
      { code: 'TYPE_MISMATCH' }
    );
    await expectHalt(() => run('list[dict[a: 1]] -> .has(dict[a: 1, b: 2])'), {
      code: 'TYPE_MISMATCH',
    });
  });
});
