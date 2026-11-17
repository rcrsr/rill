/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Runtime Tests: Dynamic Field Access Keys
 *
 * Covers the variable-key form (`$d.$k`) and the bracket form
 * (`$d[expr]`) of field access on dicts, lists, ordered values, and
 * non-container targets.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';

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

    it('reads a number-spelled key by its string spelling', async () => {
      expect(await run('dict[1: "x"] => $d\n"1" => $k\n$d.$k')).toBe('x');
    });

    it('reads a bool-spelled key by its string spelling', async () => {
      expect(await run('dict[true: "x"] => $d\n"true" => $k\n$d.$k')).toBe('x');
    });

    rule('selection.key-type').it(
      'halts #TYPE_MISMATCH on a number key on a number-spelled-key dict',
      async () => {
        await expectHalt(() => run('dict[1: "x"] => $d\n2 => $k\n$d.$k'), {
          code: 'TYPE_MISMATCH',
          messagePattern: 'Dict key must be string, got number',
        });
      }
    );

    rule('selection.key-no-mask').it(
      'halts #TYPE_MISMATCH on a number key on a plain dict even with ??',
      async () => {
        await expectHalt(
          () => run('dict[a: 1] => $d\n1 => $k\n$d.$k ?? "dflt"'),
          { code: 'TYPE_MISMATCH' }
        );
      }
    );

    rule('selection.key-no-mask').it(
      'halts #TYPE_MISMATCH on a bool key on a plain dict even with ??',
      async () => {
        await expectHalt(
          () => run('dict[a: 1] => $d\ntrue => $k\n$d.$k ?? "dflt"'),
          { code: 'TYPE_MISMATCH' }
        );
      }
    );

    it('falls back with ?? on an absent string key', async () => {
      expect(await run('dict[a: 1] => $d\n"z" => $k\n$d.$k ?? "dflt"')).toBe(
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
        code: 'TYPE_MISMATCH',
        messagePattern: `Dict key must be string, got ${typeName}`,
      });
    });
  });

  describe('computed key ($d[expr])', () => {
    it('reads and misses a number-spelled key by string selector', async () => {
      expect(await run('dict[1: "x"] => $d\n$d["1"]')).toBe('x');
      await expectHalt(() => run('dict[1: "x"] => $d\n$d["2"]'), {
        code: 'RILL_R009',
        messagePattern: 'Undefined dict key: 2',
      });
      expect(await run('dict[a: 1] => $d\n$d["z"] ?? "dflt"')).toBe('dflt');
    });

    rule('selection.key-no-mask').it(
      'halts #TYPE_MISMATCH on a number selector even with ??',
      async () => {
        await expectHalt(() => run('dict[1: "x"] => $d\n$d[1] ?? "dflt"'), {
          code: 'TYPE_MISMATCH',
          messagePattern: 'Dict key must be string, got number',
        });
      }
    );

    it('reads a bool-spelled key by its string spelling', async () => {
      expect(await run('dict[true: "x"] => $d\n$d["true"]')).toBe('x');
    });

    it('reads a list element by negative index', async () => {
      expect(await run('list[1, 2, 3] => $d\n$d[-1]')).toBe(3);
    });

    it('halts on an out-of-bounds list index and honors ??', async () => {
      await expectHalt(() => run('list[1, 2, 3] => $d\n$d[5]'), {
        code: 'RILL_R009',
        messagePattern: 'List index out of bounds: 5',
      });
      expect(await run('list[1, 2, 3] => $d\n$d[5] ?? "dflt"')).toBe('dflt');
    });

    it('reads ordered entries by positive and negative index', async () => {
      expect(await run('ordered[a: 1, b: 2] => $d\n$d[1]')).toBe(2);
      expect(await run('ordered[a: 1, b: 2] => $d\n$d[-1]')).toBe(2);
    });

    it('halts on an out-of-bounds ordered index and honors ??', async () => {
      await expectHalt(() => run('ordered[a: 1, b: 2] => $d\n$d[5]'), {
        code: 'RILL_R009',
        messagePattern: 'Ordered index out of bounds: 5',
      });
      expect(await run('ordered[a: 1, b: 2] => $d\n$d[5] ?? "dflt"')).toBe(
        'dflt'
      );
    });

    it('halts when a number key indexes a non-list, even with ??', async () => {
      await expectHalt(() => run('"str" => $d\n$d[1]'), {
        code: 'RILL_R002',
        messagePattern: 'Cannot index string',
      });
      await expectHalt(() => run('"str" => $d\n$d[1] ?? "dflt"'), {
        code: 'RILL_R002',
        messagePattern: 'Cannot index string',
      });
    });

    it('halts when a string key targets a non-dict, even with ??', async () => {
      await expectHalt(() => run('"str" => $d\n$d["a"] ?? "dflt"'), {
        code: 'RILL_R002',
        messagePattern: 'Cannot index string',
      });
    });

    it('reads and misses a string key on a dict', async () => {
      expect(await run('dict[a: 1] => $d\n$d["a"]')).toBe(1);
      await expectHalt(() => run('dict[a: 1] => $d\n$d["b"]'), {
        code: 'RILL_R009',
        messagePattern: 'Undefined dict key: b',
      });
      expect(await run('dict[a: 1] => $d\n$d["b"] ?? "dflt"')).toBe('dflt');
    });

    it.each([
      ['dict[x: 1]', 'dict'],
      ['list[1]', 'list'],
      ['true', 'bool'],
      ['|x|($x)', 'closure'],
    ])('rejects a %s bracket key on a plain dict', async (expr, typeName) => {
      await expectHalt(() => run(`dict[a: 1] => $d\n$d[${expr}]`), {
        code: 'TYPE_MISMATCH',
        messagePattern: `Dict key must be string, got ${typeName}`,
      });
    });
  });
});
