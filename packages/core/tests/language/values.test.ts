/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Values: kinds, immutability, the host null boundary, vacancy, and the
 * equality rules no other locked test proves.
 */

import { describe, expect } from 'vitest';
import { anyTypeValue, type RillParam } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';

function returning(value: unknown) {
  return {
    params: [] as RillParam[],
    returnType: anyTypeValue,
    fn: () => value as never,
  };
}

describe('Rill Language: values', () => {
  rule('value.kinds').it('gives every literal one kind', async () => {
    expect(
      await run(
        'tuple["a", 1, true, #a, duration(...dict[ms: 1]), datetime(...dict[unix: 0]), list[], tuple[], dict[], ordered[], map[], fn { 1 }, number] -> seq({ $.^type.name })'
      )
    ).toEqual([
      'string',
      'number',
      'bool',
      'atom',
      'duration',
      'datetime',
      'list',
      'tuple',
      'dict',
      'ordered',
      'map',
      'fn',
      'type',
    ]);
  });

  rule('value.always').it(
    'yields a value from an expression over nothing',
    async () => {
      expect(await run('list[] -> seq({ $ })')).toEqual([]);
    }
  );

  rule('value.no-null', 'value.host-null').it(
    'halts RILL-R085 when a host function returns null or undefined',
    async () => {
      for (const value of [null, undefined, { a: null }, [1, null]]) {
        await expectHalt(
          () => run('ret()', { functions: { ret: returning(value) } }),
          { code: 'RILL_R085', hostErrorId: 'RILL-R085' }
        );
      }
    }
  );

  rule('value.immutable').it(
    'leaves a collection unchanged after a method yields a new one',
    async () => {
      expect(await run('list[1, 2] => $a\n$a -> .reverse\n$a')).toEqual([1, 2]);
      expect(await run('dict[a: 1] => $d\n$d -> .keys\n$d')).toEqual({ a: 1 });
    }
  );

  rule('value.no-alias').it(
    'keeps a collection value when its source variable is rebound',
    async () => {
      expect(
        await run('list[1, 2] => $a\nlist[$a, 3] => $b\nlist[9] => $a\n$b')
      ).toEqual([[1, 2], 3]);
    }
  );

  rule('value.valid-invalid').it(
    'reports a value as valid or invalid',
    async () => {
      expect(await run('1 => $v\n$v.!')).toBe(false);
      expect(await run('guard { $nope } => $r\n$r.!')).toBe(true);
      expect(await run('guard { $nope } => $r\n$r.!code == #RILL_R005')).toBe(
        true
      );
    }
  );
});

describe('Rill Language: vacancy', () => {
  rule('vacancy.empty-probe').it(
    'halts RILL-R003 on .empty for a value that cannot be empty',
    async () => {
      for (const src of [
        '5',
        'true',
        '#a',
        'duration(...dict[ms: 0])',
        'datetime(...dict[unix: 0])',
        'number',
      ]) {
        await expectHalt(() => run(`${src} -> .empty`), {
          code: 'RILL_R003',
        });
      }
      await expectHalt(() => run('fn { 1 } => $f\n$f -> .empty'), {
        code: 'RILL_R003',
      });
    }
  );

  rule('vacancy.fallback').it(
    'evaluates the fallback only when the value is vacant',
    async () => {
      expect(await run('"x" ?? { error "boom" }')).toBe('x');
    }
  );
});

describe('Rill Language: equality', () => {
  rule('equality.number').it('compares numbers by numeric value', async () => {
    expect(await run('1 == 1.0')).toBe(true);
    expect(await run('0 == -0')).toBe(true);
  });

  rule('equality.ordered-seq').it(
    'compares tuples and ordereds position by position',
    async () => {
      expect(await run('tuple[1, 2] == tuple[1, 2]')).toBe(true);
      expect(await run('tuple[1, 2] == tuple[2, 1]')).toBe(false);
      expect(await run('ordered[a: 1, b: 2] == ordered[a: 1, b: 2]')).toBe(
        true
      );
      expect(await run('ordered[a: 1, b: 2] == ordered[b: 2, a: 1]')).toBe(
        false
      );
      expect(await run('list[1, 2] == list[2, 1]')).toBe(false);
    }
  );

  rule('equality.keyed').it('compares maps in any order', async () => {
    expect(await run('map["a": 1, "b": 2] == map["b": 2, "a": 1]')).toBe(true);
    expect(await run('map["a": 1] == map["a": 2]')).toBe(false);
  });

  rule('equality.iterator').it(
    'halts RILL-R002 when an operand is an iterator',
    async () => {
      await expectHalt(() => run('range(0, 3) == range(0, 3)'), {
        code: 'RILL_R002',
      });
      await expectHalt(() => run('range(0, 3) => $i\n$i != 1'), {
        code: 'RILL_R002',
      });
      expect(
        await run('guard { range(0, 3) == 1 } => $r\n$r.!code == #RILL_R002')
      ).toBe(true);
    }
  );
});
