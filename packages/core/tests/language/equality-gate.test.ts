/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Equality gate: == and != halt on operands whose types cannot overlap, and
 * on operands with no equality protocol. Carried types never change a result.
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  createRillStream,
  type RillParam,
  type RillValue,
} from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';

function makeStreamFn(chunks: RillValue[]) {
  return {
    params: [] as RillParam[],
    returnType: anyTypeValue,
    fn: () =>
      createRillStream({
        chunks: (async function* () {
          for (const c of chunks) yield c;
        })(),
        resolve: async () => null,
      }),
  };
}

describe('Rill Language: equality gate', () => {
  rule('equality.no-overlap', 'structural-typing.overlap-scalar').it(
    'halts == between number and string',
    async () => {
      await expectHalt(() => run('1 == "1"'), { code: 'TYPE_MISMATCH' });
    }
  );

  rule('equality.no-overlap', 'structural-typing.overlap-kind').it(
    'halts == between a tuple and a list',
    async () => {
      await expectHalt(() => run('tuple[1] == list[1]'), {
        code: 'TYPE_MISMATCH',
      });
    }
  );

  rule('equality.no-overlap').it(
    'halts != between number and string',
    async () => {
      await expectHalt(() => run('1 != "1"'), { code: 'TYPE_MISMATCH' });
    }
  );

  it('lets guard recover a mismatched equality', async () => {
    const result = await run(
      'guard { 1 == "1" } => $r\n$r.!code == #TYPE_MISMATCH'
    );
    expect(result).toBe(true);
  });

  rule('equality.no-overlap', 'structural-typing.overlap-list').it(
    'halts when declared list element types cannot overlap',
    async () => {
      await expectHalt(
        () => run('(list[] -> :list(number)) == (list[] -> :list(string))'),
        { code: 'TYPE_MISMATCH' }
      );
    }
  );

  rule('structural-typing.overlap-list').it(
    'compares an empty list with a non-empty list as false',
    async () => {
      expect(await run('list[] == list["a"]')).toBe(false);
    }
  );

  rule('structural-typing.overlap-union').it(
    'compares a union-declared variable with a member type without halting',
    async () => {
      expect(await run('42 => $x:union(string, number)\n$x == "a"')).toBe(
        false
      );
    }
  );

  rule('carried-type.own-element', 'equality.no-overlap').it(
    'halts when an element of an undeclared mixed list is compared by its own type',
    async () => {
      await expectHalt(() => run('list[1, "a"] -> seq({ $ == "a" })'), {
        code: 'TYPE_MISMATCH',
      });
    }
  );

  rule('carried-type.element').it(
    'compares each element of a declared mixed list against the union element type',
    async () => {
      expect(
        await run(
          'list[1, "a"] -> :list(union(number, string)) -> seq({ $ == "a" })'
        )
      ).toEqual([false, true]);
    }
  );

  it('compares a status code with built-in and custom atoms without halting', async () => {
    expect(
      await run('(guard { "1x" -> atom } => $r).!code == #RILL_R082')
    ).toBe(false);
    expect(await run('(guard { "1x" -> atom } => $r).!code == #CUSTOM')).toBe(
      false
    );
  });

  rule('equality.no-overlap', 'structural-typing.overlap-fields').it(
    'halts when dict shapes cannot overlap',
    async () => {
      await expectHalt(() => run('dict[a: 1] == dict[a: 1, b: 2]'), {
        code: 'TYPE_MISMATCH',
      });
    }
  );

  const declaredDict = 'dict[a: 1, b: 2] => $x:dict(a: number)\n';

  rule('equality.declared-dict').it(
    'passes a one-sided dict key when an operand carries a declared type',
    async () => {
      expect(await run(`${declaredDict}$x == dict[a: 1, b: 2]`)).toBe(true);
      expect(await run(`${declaredDict}dict[a: 1, b: 2] != $x`)).toBe(false);
      expect(await run(`${declaredDict}$x -> .eq(dict[a: 1, b: 2])`)).toBe(
        true
      );
      expect(
        await run(
          'list[dict[a: 1, b: 2]] => $l:list(dict(a: number))\n$l -> .has(dict[a: 1, b: 2])'
        )
      ).toBe(true);
    }
  );

  rule('equality.declared-dict').it(
    'still halts when a shared key of a declared dict has another type',
    async () => {
      await expectHalt(() => run(`${declaredDict}$x == dict[a: "x", b: 2]`), {
        code: 'TYPE_MISMATCH',
      });
    }
  );

  rule('equality.declared-dict', 'carried-type.own-element').it(
    'halts on an undeclared list whose element dicts differ in keys',
    async () => {
      await expectHalt(
        () => run('list[dict[a: 1], dict[b: 2]] -> seq({ $ == dict[a: 1] })'),
        { code: 'TYPE_MISMATCH' }
      );
      expect(
        await run(
          'list[dict[a: 1], dict[b: 2]] => $l:list(dict)\n$l -> seq({ $ == dict[a: 1] })'
        )
      ).toEqual([true, false]);
    }
  );

  it('halts RILL-R002 when the right operand is a stream', async () => {
    await expectHalt(
      () =>
        run('make_stream() => $s\n1 == $s', {
          functions: { make_stream: makeStreamFn([1]) },
        }),
      { code: 'RILL_R002', hostErrorId: 'RILL-R002' }
    );
  });
});
