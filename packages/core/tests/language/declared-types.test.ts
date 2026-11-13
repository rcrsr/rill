/**
 * Rill Language Tests: declared types travel with the value
 *
 * A declaration or assertion sets a type that travels beside the value
 * through `$`, captures, element access, parameters and iteration. A computed
 * result is a new value and takes its own type. `.^type` reports the declared
 * type, `.^effective` the value's own type.
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  createRillStream,
  structureToTypeValue,
  parse,
  ParseError,
  type RillValue,
  type TypeStructure,
} from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

const U = 'union(number, string)';
const DECL = `1 => $x:${U}\n`;
const LIST = `list[1, 2] => $l:list(${U})\n`;

async function expectLocked(
  source: string,
  options?: Parameters<typeof run>[1]
): Promise<void> {
  await expectHalt(() => run(source, options), {
    code: 'RILL_R001',
    hostErrorId: 'RILL-R001',
  });
}

describe('Rill Language: declared types', () => {
  describe('variables and pipe', () => {
    it('reports the declared type for .^type', async () => {
      expect(await run(`${DECL}$x.^type == ${U}`)).toBe(true);
    });

    it('reports the own type for .^effective', async () => {
      expect(await run(`${DECL}$x.^effective == number`)).toBe(true);
    });

    it('carries the declaration through $ in a block', async () => {
      expect(await run(`${DECL}$x -> { $.^type } => $t\n$t == ${U}`)).toBe(
        true
      );
    });

    it('carries the declaration through a plain capture', async () => {
      expect(await run(`${DECL}$x => $y\n$y.^type == ${U}`)).toBe(true);
    });

    it('allows a different member after capturing a declared value', async () => {
      expect(await run(`${DECL}$x => $y\n"a" => $y\n$y`)).toBe('a');
    });

    it('carries the declaration through an inline capture', async () => {
      expect(await run(`${DECL}$x => $y -> .^type => $t\n$t == ${U}`)).toBe(
        true
      );
    });

    it('carries the declaration through a grouped expression', async () => {
      expect(await run(`${DECL}($x).^type == ${U}`)).toBe(true);
    });

    it('carries the asserted type through an assertion', async () => {
      expect(await run(`1 -> :${U} -> .^type => $t\n$t == ${U}`)).toBe(true);
    });

    it('keeps the union when a bare capture reassigns the variable', async () => {
      expect(await run(`${DECL}"a" => $x\n$x.^type == ${U}`)).toBe(true);
    });

    it('keeps value equality independent of the declaration', async () => {
      expect(await run(`${DECL}$x == 1`)).toBe(true);
    });

    it('replaces the declaration with an assertion after checking the value', async () => {
      expect(await run(`${DECL}$x -> :number => $y\n$y.^type == number`)).toBe(
        true
      );
      await expectLocked(`${DECL}$x -> :number => $y\n"a" => $y`);
    });

    it('replaces the declaration with a new capture declaration', async () => {
      expect(await run(`${DECL}$x => $z:number\n$z.^type == number`)).toBe(
        true
      );
    });

    it('restores the slot after a chain', async () => {
      expect(
        await run(`${DECL}1 -> { tuple[$x, $.^type == number] } => $t\n$t[1]`)
      ).toBe(true);
    });

    it('keeps the declaration through pass', async () => {
      expect(
        await run(`${DECL}$x -> pass { 1 } -> .^type => $t\n$t == ${U}`)
      ).toBe(true);
    });

    it('reports the own type for .^effective on an undeclared value', async () => {
      expect(await run('1 => $a\n$a.^effective == number')).toBe(true);
    });
  });

  describe('own-type paths', () => {
    it('takes the own type for a binary result', async () => {
      await expectLocked(`${DECL}$x + 1 => $y\n"a" => $y`);
    });

    it('takes the own type for a binary result with an equal value', async () => {
      await expectLocked(`${DECL}$x * 1 => $y\n"a" => $y`);
    });

    it('takes the own type for a method result', async () => {
      await expectLocked(
        `"A" => $s:union(string, number)\n$s -> .upper => $t\n1 => $t`
      );
      expect(
        await run(
          '"a" => $s:union(number, string)\n$s -> .upper -> .^type => $t\n$t == string'
        )
      ).toBe(true);
    });

    it('takes the own type for a unary result', async () => {
      await expectLocked(
        `true => $b:union(bool, string)\n!$b => $c\n"a" => $c`
      );
    });

    it('takes the own type for a conditional result', async () => {
      await expectLocked(`${DECL}(true ? $x ! 2) => $y\n"a" => $y`);
    });

    it('takes the own type for a loop result', async () => {
      await expectLocked(
        `${DECL}0 -> while ($ < 1) do { $x } => $y\n"a" => $y`
      );
    });

    it('takes the own type for loop $ after the first body run', async () => {
      expect(
        await run(
          `${DECL}$x -> while ($ < 3) do<limit: 5> { ($.^type == ${U}) ? $x ! 9 }`
        )
      ).toBe(9);
    });

    it('takes the own type for a guard result', async () => {
      await expectLocked(`${DECL}guard { $x } => $y\n"a" => $y`);
    });

    it('takes the own type for a retry result', async () => {
      await expectLocked(`${DECL}retry<limit: 2> { $x } => $y\n"a" => $y`);
    });

    it('takes the own type for a timeout result', async () => {
      await expectLocked(
        `${DECL}timeout<total: duration(0, 0, 0, 0, 0, 0, 200)> { $x } => $y\n"a" => $y`
      );
    });

    it('takes the own type for the ?? default branch', async () => {
      await expectLocked(
        `${DECL}dict[a: 1] => $d\n($d.zz ?? $x) => $y\n"a" => $y`
      );
    });

    it('takes the own type for .?', async () => {
      expect(
        await run(
          `dict[a: 1] => $d:dict(a: ${U})\n$d.?a => $e\n$e.^type == bool`
        )
      ).toBe(true);
    });

    it('takes the own type for a dispatch lookup', async () => {
      await expectLocked(`${DECL}"a" -> dict[a: $x] => $y\n"a" => $y`);
    });

    it('takes the own type for a spread argument', async () => {
      expect(
        await run(`${DECL}|a| { $a.^type == number } => $f\n$f(...tuple[$x])`)
      ).toBe(true);
    });

    it('takes the own type for a computed .(expr) key', async () => {
      const src = `dict[a: 1] => $d:dict(a: ${U})\n`;
      expect(await run(`${src}$d.("a").^type == number`)).toBe(true);
      expect(await run(`${src}$d.a.^type == ${U}`)).toBe(true);
    });

    it('takes the own type when iterating a non-list', async () => {
      expect(
        await run(
          `dict[a: 1] => $d:dict(a: ${U})\n$d -> seq({ $.value.^type == number })`
        )
      ).toEqual([true]);
    });

    it('takes the own type for a closure result', async () => {
      await expectLocked(`${DECL}|a| { $a } => $f\n$f($x) => $y\n"a" => $y`);
    });

    it('takes the own type for a closure result with a declared return type', async () => {
      expect(
        await run(
          `${DECL}|a: ${U}| { $a }:${U} => $f\n$f(1) -> .^type => $t\n$t == number`
        )
      ).toBe(true);
    });

    it('takes the own type for a host call result with a declared return type', async () => {
      const unionType: TypeStructure = {
        kind: 'union',
        members: [{ kind: 'number' }, { kind: 'string' }],
      };
      const functions = {
        h: {
          params: [],
          returnType: structureToTypeValue(unionType),
          fn: (): RillValue => 1,
        },
      };
      await expectLocked('h() => $y\n"a" => $y', { functions });
      expect(
        await run('h() -> .^type => $t\n$t == number', { functions })
      ).toBe(true);
    });

    it('takes the own type for a block result', async () => {
      await expectLocked(`${DECL}$x -> { $ } => $y\n"a" => $y`);
    });

    it('takes the own type for stream chunks', async () => {
      const chunks: RillValue[] = [1, 2];
      const result = await run('mk() -> seq({ $.^type == number })', {
        functions: {
          mk: {
            params: [],
            returnType: anyTypeValue,
            fn: () =>
              createRillStream({
                chunks: (async function* () {
                  yield* chunks;
                })(),
                resolve: async () => null,
              }),
          },
        },
      });
      expect(result).toEqual([true, true]);
    });

    it('clears the slot after a loop', async () => {
      expect(
        await run(
          `${DECL}$x -> while ($ < 3) do<limit: 5> { $ + 5 } -> .^type => $t\n$t == number`
        )
      ).toBe(true);
    });
  });

  describe('any is not a declaration', () => {
    it('locks the variable as number after capturing into any', async () => {
      await expectLocked('1 => $x:any\n"a" => $x');
      expect(await run('1 => $x:any\n$x.^type == number')).toBe(true);
    });

    it('reports the argument own type for an any param', async () => {
      expect(await run('|v: any| { $v.^type == number } => $f\n$f(1)')).toBe(
        true
      );
    });
  });

  describe('collections', () => {
    it('reports the declared element type for a declared list element', async () => {
      expect(await run(`${LIST}$l[0].^type == ${U}`)).toBe(true);
    });

    it('locks a captured declared element to the declaration', async () => {
      expect(await run(`${LIST}$l[0] => $e\n"a" => $e\n$e`)).toBe('a');
    });

    it('locks a captured inferred element to its own type', async () => {
      await expectLocked('list[1, 2] => $l\n$l[0] => $e\n"a" => $e');
    });

    it('carries the declared field type through .name and -> .name', async () => {
      const src = `dict[name: "a"] => $d:dict(name: union(string, number))\n`;
      expect(await run(`${src}$d.name.^type == union(string, number)`)).toBe(
        true
      );
      expect(
        await run(
          `${src}$d -> .name -> .^type => $t\n$t == union(string, number)`
        )
      ).toBe(true);
      expect(await run(`${src}$d.name => $n\n1 => $n\n$n`)).toBe(1);
    });

    it('carries the declared element type through iteration', async () => {
      expect(await run(`${LIST}$l -> seq({ $.^type == ${U} })`)).toEqual([
        true,
        true,
      ]);
    });

    it('reports the declared list type for .^type', async () => {
      expect(await run(`${LIST}$l.^type == list(${U})`)).toBe(true);
    });
  });

  describe('parameters', () => {
    it('reports the declared param type for .^type and own type for .^effective', async () => {
      const f = `|v: union(string, number)| { list[$v.^type == union(string, number), $v.^effective == number] } => $f\n`;
      expect(await run(`${f}$f(1)`)).toEqual([true, true]);
    });

    it('halts when a param body reassigns a variable from the child scope', async () => {
      await expectHalt(() => run('|x: number| { "a" => $x } => $f\n$f(1)'), {
        code: 'RILL_R001',
        hostErrorId: 'RILL-R001',
        messagePattern: 'Cannot reassign outer variable $x',
      });
    });

    it('locks a capture of a typed param to the declared param type', async () => {
      await expectHalt(
        () => run(`|k: ${U}| { $k => $y\ntrue => $y\n$y } => $f\n$f(1)`),
        {
          code: 'RILL_R001',
          hostErrorId: 'RILL-R001',
          messagePattern: `locked as ${U}`,
        }
      );
    });

    it('lets a union param accept another member after a capture', async () => {
      expect(
        await run(`|k: ${U}| { $k => $y\n"a" => $y\n$y } => $f\n$f(1)`)
      ).toBe('a');
    });

    it('carries the caller declaration into an untyped param by positional call', async () => {
      expect(await run(`${DECL}|v| { $v.^type == ${U} } => $f\n$f($x)`)).toBe(
        true
      );
    });

    it('carries the caller declaration into an untyped param by pipe', async () => {
      expect(await run(`${DECL}|v| { $v.^type == ${U} } => $f\n$x -> $f`)).toBe(
        true
      );
    });

    it('dispatches on .^effective.name under a declared union', async () => {
      const f = `|v: union(string, number)| { $v.^effective.name -> dict[string: "s", number: "n"] } => $f\n`;
      expect(await run(`${f}$f(1)`)).toBe('n');
    });

    it('halts a dispatch on .^type.name under a declared union', async () => {
      const f = `|v: union(string, number)| { $v.^type.name -> dict[string: "s", number: "n"] } => $f\n`;
      await expectHalt(() => run(`${f}$f(1)`), {
        code: 'RILL_R009',
        hostErrorId: 'RILL-R009',
      });
    });

    it('keeps -> :?number working under a declared union', async () => {
      expect(
        await run('|v: union(string, number)| { $v -> :?number } => $f\n$f(1)')
      ).toBe(true);
    });
  });

  describe('undeclared arguments to a $ param', () => {
    // The pipe declaration slot is keyed by value, so a call whose argument
    // equals the caller's declared pipe value must not inherit the slot.
    const OUTER = `${DECL}`;

    it('reports the own type for a $ param called with an equal undeclared value', async () => {
      expect(
        await run(
          `${OUTER}$x -> { { $.^type } => $f\n$f(1) } => $t\n$t == number`
        )
      ).toBe(true);
    });

    it('locks a capture in a $ param body to the own type of an equal undeclared value', async () => {
      await expectLocked(
        `${OUTER}$x -> { { $ => $y\n"s" => $y\n$y } => $f\n$f(1) }`
      );
    });

    it('reports the own type for an equal undeclared seed given to chain', async () => {
      expect(
        await run(`${OUTER}$x -> { chain(1, { $.^type }) } => $t\n$t == number`)
      ).toBe(true);
    });

    it('reports the own type for an equal undeclared seed given to iterate', async () => {
      expect(
        await run(
          `${OUTER}$x -> { iterate(1, { ($.^type == number) ? 5 ! 7 }) -> take(2) -> seq({ $ }) }`
        )
      ).toEqual([1, 5]);
    });
  });

  describe('negative index on a short value', () => {
    const SHORT = 'tuple[1] -> :tuple(number, string = "x") => $t\n';

    it('projects the element type from the value length, not the declared length', async () => {
      expect(await run(`${SHORT}$t[-1].^type == number`)).toBe(true);
    });

    it('locks a capture of a negative-index element to the projected type', async () => {
      await expectLocked(`${SHORT}$t[-1] => $v\n"abc" => $v`);
    });
  });

  describe('bare kind annotation', () => {
    it('reports the bare kind for .^type and the inferred structure for .^effective', async () => {
      expect(await run('list[1, 2] => $l:list\n$l.^type == list')).toBe(true);
      expect(
        await run('list[1, 2] => $l:list\n$l.^effective == list(number)')
      ).toBe(true);
    });
  });

  describe('status code', () => {
    it('carries union(#ok, error_code) on .!code', async () => {
      expect(await run('"x".!code.^type == union(#ok, error_code)')).toBe(true);
    });

    it('reports atom for .^effective on .!code', async () => {
      expect(await run('"x".!code.^effective == atom')).toBe(true);
    });

    it('locks a captured .!code to the declared union', async () => {
      expect(
        await run(
          '"x".!code => $c\n#TIMEOUT => $c\n$c.^type == union(#ok, error_code)'
        )
      ).toBe(true);
      await expectLocked('"x".!code => $c\n"s" => $c');
    });
  });

  describe('assertions', () => {
    it('evaluates the operand once', async () => {
      let calls = 0;
      const counted = await run('count() -> :number', {
        functions: {
          count: {
            params: [],
            returnType: anyTypeValue,
            fn: (): RillValue => ++calls,
          },
        },
      });
      expect(counted).toBe(1);
      expect(calls).toBe(1);
    });

    it('calls a closure once for a postfix assertion', async () => {
      let calls = 0;
      const counted = await run('count():number', {
        functions: {
          count: {
            params: [],
            returnType: anyTypeValue,
            fn: (): RillValue => ++calls,
          },
        },
      });
      expect(counted).toBe(1);
      expect(calls).toBe(1);
    });
  });

  describe('parsing', () => {
    it('rejects ^(effective: 1) as a reserved annotation key', () => {
      expect(() => parse('^(effective: 1) |x| { $x }')).toThrow(ParseError);
    });
  });
});
