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

  rule('structural-typing.overlap-union', 'equality.kind').it(
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
  });

  it('halts comparing a status code with an atom outside the set', async () => {
    await expectHalt(
      () => run('(guard { "1x" -> atom } => $r).!code == #CUSTOM'),
      { code: 'TYPE_MISMATCH' }
    );
  });

  describe('closed atom sets', () => {
    const decl =
      'list[#wired, #wireless] => $l:list(union(#wired, #wireless))\n';
    const bad: [string, string][] = [
      ['==', '$s == #wirless'],
      ['!=', '$s != #wirless'],
      ['.eq', '$s -> .eq(#wirless)'],
      ['.ne', '$s -> .ne(#wirless)'],
      ['.has', '$l -> .has(#wirless)'],
      ['.has_any', '$l -> .has_any(list[#wirless])'],
      ['.has_all', '$l -> .has_all(list[#wirless])'],
    ];
    const good: [string, string, boolean][] = [
      ['==', '$s == #wireless', true],
      ['!=', '$s != #wireless', false],
      ['.eq', '$s -> .eq(#wireless)', true],
      ['.ne', '$s -> .ne(#wireless)', false],
      ['.has', '$l -> .has(#wireless)', true],
      ['.has_any', '$l -> .has_any(list[#wireless])', true],
      ['.has_all', '$l -> .has_all(list[#wireless])', true],
    ];
    const setup = `${decl}#wireless => $s:union(#wired, #wireless)\n`;

    it.each(bad)(
      'halts %s with an atom outside the declared set',
      async (_op, expr) => {
        await expectHalt(() => run(setup + expr), {
          code: 'TYPE_MISMATCH',
          messagePattern: 'with atom',
        });
      }
    );

    it.each(good)(
      'returns a bool for %s with a member atom',
      async (_op, expr, expected) => {
        expect(await run(setup + expr)).toBe(expected);
      }
    );

    it('halts filtering a declared list against an atom outside the set', async () => {
      await expectHalt(() => run(`${decl}$l -> filter({ $ == #wirless })`), {
        code: 'TYPE_MISMATCH',
      });
    });

    it('compares a member atom in filter without halting', async () => {
      expect(await run(`${decl}$l -> filter({ $ == #wireless }) -> .len`)).toBe(
        1
      );
    });

    rule('equality.closed-set').it(
      'keeps two undeclared atoms comparable',
      async () => {
        expect(await run('#TIMEOUT == #TIMEUOT')).toBe(false);
      }
    );

    rule('equality.closed-set').it(
      'halts a declared string literal union compared with an outside value',
      async () => {
        await expectHalt(() => run('"c" => $u:union("c", "f")\n$u == "x"'), {
          code: 'TYPE_MISMATCH',
        });
      }
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

  const declaredDict = 'dict[a: 1] => $x:dict(a: number)\n';
  const defaultedDict = 'dict[a: 1] => $x:dict(a: number, b: number = 0)\n';

  rule('structural-typing.overlap-fields').it(
    'halts when a one-sided dict key meets a declared type',
    async () => {
      const sources = [
        `${declaredDict}$x == dict[a: 1, b: 2]`,
        `${declaredDict}dict[a: 1, b: 2] != $x`,
        `${declaredDict}$x -> .eq(dict[a: 1, b: 2])`,
        `${declaredDict}$x -> .ne(dict[a: 1, b: 2])`,
        'list[dict[a: 1]] => $l:list(dict(a: number))\n$l -> .has(dict[a: 1, b: 2])',
      ];
      for (const source of sources) {
        await expectHalt(() => run(source), { code: 'TYPE_MISMATCH' });
      }
    }
  );

  rule('structural-typing.overlap-fields').it(
    'compares unequal without halting when the one-sided key of a declared dict is defaulted',
    async () => {
      expect(await run(`${defaultedDict}$x == dict[a: 1, b: 2]`)).toBe(false);
      expect(await run(`${defaultedDict}$x != dict[a: 1, b: 2]`)).toBe(true);
      expect(await run(`${defaultedDict}$x -> .eq(dict[a: 1, b: 2])`)).toBe(
        false
      );
    }
  );

  rule('structural-typing.overlap-fields').it(
    'still halts when a shared key of a declared dict has another type',
    async () => {
      await expectHalt(() => run(`${declaredDict}$x == dict[a: "x", b: 2]`), {
        code: 'TYPE_MISMATCH',
      });
    }
  );

  rule('structural-typing.overlap-fields', 'carried-type.own-element').it(
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

  rule('equality.stream').it(
    'halts RILL-R002 when the right operand is a stream',
    async () => {
      await expectHalt(
        () =>
          run('make_stream() => $s\n1 == $s', {
            functions: { make_stream: makeStreamFn([1]) },
          }),
        { code: 'RILL_R002', hostErrorId: 'RILL-R002' }
      );
    }
  );
  rule('structural-typing.overlap-literal', 'equality.no-overlap').it(
    'compares literal unions that share a member and halts on disjoint ones',
    async () => {
      expect(
        await run(
          '"a" => $x:union("a", "b")\n"b" => $y:union("b", "c")\n$x == $y'
        )
      ).toBe(false);
      await expectHalt(
        () => run('"a" => $x:union("a")\n"b" => $y:union("b")\n$x == $y'),
        { code: 'TYPE_MISMATCH' }
      );
      await expectHalt(
        () => run('1 => $x:union(1, 2)\n3 => $y:union(3, 4)\n$x == $y'),
        { code: 'TYPE_MISMATCH' }
      );
    }
  );
});
