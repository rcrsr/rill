/**
 * Rill Runtime Tests: Dynamic Field Access Keys
 *
 * Covers the variable-key form (`$d.$k`) and the computed-key form
 * (`$d.(expr)`) of field access, plus the alternatives form
 * (`$d.(a || b)`) on dicts, lists, ordered values, and non-container
 * targets.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

describe('Dynamic field access keys', () => {
  describe('variable key ($d.$k)', () => {
    it('halts when the key variable is undefined', async () => {
      await expectHalt(() => run('dict[a: 1] => $d\n$d.$k'), {
        code: 'RILL_R005',
        messagePattern: "Variable 'k' is undefined",
      });
    });

    it('halts when the pipe variable is undefined for $d.$', async () => {
      await expectHalt(() => run('dict[a: 1] => $d\n$d.$'), {
        code: 'RILL_R005',
        messagePattern: "Pipe variable '$' is undefined",
      });
    });

    it('uses the pipe value as the key for $d.$', async () => {
      expect(await run('dict[a: 1] => $d\n"a" -> { $d.$ }')).toBe(1);
    });

    it('reads a typed number key that exists', async () => {
      expect(await run('dict[1: "x"] => $d\n1 => $k\n$d.$k')).toBe('x');
    });

    it('reads a typed bool key that exists', async () => {
      expect(await run('dict[true: "x"] => $d\ntrue => $k\n$d.$k')).toBe('x');
    });

    it('halts on a missing typed key', async () => {
      await expectHalt(() => run('dict[1: "x"] => $d\n2 => $k\n$d.$k'), {
        code: 'RILL_R009',
        messagePattern: 'Undefined dict key: 2',
      });
    });

    it('falls back with ?? on a missing typed key', async () => {
      expect(await run('dict[1: "x"] => $d\n2 => $k\n$d.$k ?? "dflt"')).toBe(
        'dflt'
      );
    });

    it('reads a list element with a negative number key', async () => {
      expect(await run('list[1, 2, 3] => $d\n-1 => $k\n$d.$k')).toBe(3);
    });

    it('halts on a negative out-of-bounds list index', async () => {
      await expectHalt(() => run('list[1, 2, 3] => $d\n-4 => $k\n$d.$k'), {
        code: 'RILL_R009',
        messagePattern: 'List index out of bounds: -4',
      });
    });

    it('halts on an out-of-bounds list index', async () => {
      await expectHalt(() => run('list[1, 2, 3] => $d\n5 => $k\n$d.$k'), {
        code: 'RILL_R009',
        messagePattern: 'List index out of bounds: 5',
      });
    });

    it('falls back with ?? on an out-of-bounds list index', async () => {
      expect(await run('list[1, 2, 3] => $d\n5 => $k\n$d.$k ?? "dflt"')).toBe(
        'dflt'
      );
    });

    it('reads ordered entries by positive and negative index', async () => {
      expect(await run('ordered[a: 1, b: 2] => $d\n1 => $k\n$d.$k')).toBe(2);
      expect(await run('ordered[a: 1, b: 2] => $d\n-2 => $k\n$d.$k')).toBe(1);
    });

    it('halts on an out-of-bounds ordered index', async () => {
      await expectHalt(() => run('ordered[a: 1, b: 2] => $d\n5 => $k\n$d.$k'), {
        code: 'RILL_R009',
        messagePattern: 'Ordered index out of bounds: 5',
      });
    });

    it('falls back with ?? on an out-of-bounds ordered index', async () => {
      expect(
        await run('ordered[a: 1, b: 2] => $d\n5 => $k\n$d.$k ?? "dflt"')
      ).toBe('dflt');
    });

    it('halts when a number key indexes a non-list', async () => {
      await expectHalt(() => run('"str" => $d\n1 => $k\n$d.$k'), {
        code: 'RILL_R002',
        messagePattern: 'Cannot index string',
      });
    });

    it('falls back with ?? when a number key indexes a non-list', async () => {
      expect(await run('"str" => $d\n1 => $k\n$d.$k ?? "dflt"')).toBe('dflt');
    });

    it('falls back with ?? when a string key targets a non-dict', async () => {
      expect(await run('"str" => $d\n"a" => $k\n$d.$k ?? "dflt"')).toBe('dflt');
    });

    it('halts when a string key targets a non-dict', async () => {
      await expectHalt(() => run('"str" => $d\n"a" => $k\n$d.$k'), {
        code: 'RILL_R003',
        messagePattern: "Cannot access field 'a' on non-dict",
      });
    });

    it('reads and misses a string key on a dict', async () => {
      expect(await run('dict[a: 1] => $d\n"a" => $k\n$d.$k')).toBe(1);
      await expectHalt(() => run('dict[a: 1] => $d\n"b" => $k\n$d.$k'), {
        code: 'RILL_R009',
        messagePattern: "Dict has no field 'b'",
      });
      expect(await run('dict[a: 1] => $d\n"b" => $k\n$d.$k ?? "dflt"')).toBe(
        'dflt'
      );
    });

    it.each([
      ['dict[x: 1]', 'dict'],
      ['list[1]', 'list'],
      ['true', 'bool'],
      ['|x|($x)', 'closure'],
    ])('rejects a %s key on a plain dict', async (keyExpr, typeName) => {
      await expectHalt(() => run(`dict[a: 1] => $d\n${keyExpr} => $k\n$d.$k`), {
        code: 'RILL_R002',
        messagePattern: `Key must be string or number, got ${typeName}`,
      });
    });
  });

  describe('computed key ($d.(expr))', () => {
    it('reads and misses a typed number key', async () => {
      expect(await run('dict[1: "x"] => $d\n$d.(1)')).toBe('x');
      await expectHalt(() => run('dict[1: "x"] => $d\n$d.(2)'), {
        code: 'RILL_R009',
        messagePattern: 'Undefined dict key: 2',
      });
      expect(await run('dict[1: "x"] => $d\n$d.(2) ?? "dflt"')).toBe('dflt');
    });

    it('reads a typed bool key', async () => {
      expect(await run('dict[true: "x"] => $d\n$d.(true)')).toBe('x');
    });

    it('reads a list element by negative index', async () => {
      expect(await run('list[1, 2, 3] => $d\n$d.(-1)')).toBe(3);
    });

    it('halts on an out-of-bounds list index and honors ??', async () => {
      await expectHalt(() => run('list[1, 2, 3] => $d\n$d.(5)'), {
        code: 'RILL_R009',
        messagePattern: 'List index out of bounds: 5',
      });
      expect(await run('list[1, 2, 3] => $d\n$d.(5) ?? "dflt"')).toBe('dflt');
    });

    it('reads ordered entries by positive and negative index', async () => {
      expect(await run('ordered[a: 1, b: 2] => $d\n$d.(1)')).toBe(2);
      expect(await run('ordered[a: 1, b: 2] => $d\n$d.(-1)')).toBe(2);
    });

    it('halts on an out-of-bounds ordered index and honors ??', async () => {
      await expectHalt(() => run('ordered[a: 1, b: 2] => $d\n$d.(5)'), {
        code: 'RILL_R009',
        messagePattern: 'Ordered index out of bounds: 5',
      });
      expect(await run('ordered[a: 1, b: 2] => $d\n$d.(5) ?? "dflt"')).toBe(
        'dflt'
      );
    });

    it('halts when a number key indexes a non-list and honors ??', async () => {
      await expectHalt(() => run('"str" => $d\n$d.(1)'), {
        code: 'RILL_R002',
        messagePattern: 'Cannot index string',
      });
      expect(await run('"str" => $d\n$d.(1) ?? "dflt"')).toBe('dflt');
    });

    it('falls back with ?? when a string key targets a non-dict', async () => {
      expect(await run('"str" => $d\n$d.("a") ?? "dflt"')).toBe('dflt');
    });

    it('reads and misses a string key on a dict', async () => {
      expect(await run('dict[a: 1] => $d\n$d.("a")')).toBe(1);
      await expectHalt(() => run('dict[a: 1] => $d\n$d.("b")'), {
        code: 'RILL_R009',
        messagePattern: "Dict has no field 'b'",
      });
      expect(await run('dict[a: 1] => $d\n$d.("b") ?? "dflt"')).toBe('dflt');
    });

    it.each([
      ['dict[x: 1]', 'dict'],
      ['list[1]', 'list'],
      ['true', 'bool'],
      ['|x|($x)', 'closure'],
    ])('rejects a %s computed key on a plain dict', async (expr, typeName) => {
      await expectHalt(() => run(`dict[a: 1] => $d\n$d.(${expr})`), {
        code: 'RILL_R002',
        messagePattern: `Computed key evaluated to ${typeName}, expected string or number`,
      });
    });
  });

  describe('alternatives ($d.(a || b))', () => {
    it('returns the first alternative when present', async () => {
      expect(await run('dict[a: 1, b: 2] => $d\n$d.(a || b)')).toBe(1);
    });

    it('returns the second alternative when the first is missing', async () => {
      expect(await run('dict[b: 2] => $d\n$d.(a || b)')).toBe(2);
    });

    it('halts when the target is not a dict', async () => {
      await expectHalt(() => run('"s" => $d\n$d.(a || b)'), {
        code: 'RILL_R002',
        messagePattern: 'Alternative access requires dict, got string',
      });
    });

    it('falls back with ?? when all alternatives are missing', async () => {
      expect(await run('dict[c: 1] => $d\n$d.(a || b) ?? "dflt"')).toBe('dflt');
    });

    it('halts when all alternatives are missing and no ?? follows', async () => {
      await expectHalt(() => run('dict[c: 1] => $d\n$d.(a || b)'), {
        code: 'RILL_R009',
        messagePattern: "Dict has none of the fields 'a', 'b'",
      });
    });

    it('recovers the all-missing halt through guard', async () => {
      expect(
        await run(
          'dict[c: 1] => $d\nguard { $d.(a || b) } => $r\n$r.! ? "missing" ! $r'
        )
      ).toBe('missing');
    });
  });
});
