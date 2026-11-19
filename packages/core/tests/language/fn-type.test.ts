/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language: the fn type.
 *
 * `fn` is the type of every function. A function type names its parameters
 * (named, or unnamed and bound to `$` and `$@`) and the type it yields.
 * Function types are equal only when names, types, defaults, and outer all
 * match. The closure name and the `|params|` literals are removed.
 */

import { describe, expect } from 'vitest';
import {
  isCallable,
  isTypeValue,
  parse,
  ParseError,
  type ApplicationCallable,
} from '@rcrsr/rill';

import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';
import { createHostCallable } from '../helpers/structure.js';
import { rule } from '../helpers/rule.js';

/** Parses `source` and returns the ParseError it raises, failing when it parses. */
function parseError(source: string): ParseError {
  try {
    parse(source);
  } catch (err) {
    if (err instanceof ParseError) return err;
    throw err;
  }
  throw new Error(`expected a ParseError for: ${source}`);
}

/** A host-provided function taking `name: string` and `age: number`. */
function makeHostFn(): ApplicationCallable {
  return createHostCallable({
    __type: 'callable',
    kind: 'application',
    params: [
      {
        name: 'name',
        type: { kind: 'string' },
        defaultValue: undefined,
        annotations: {},
      },
      {
        name: 'age',
        type: { kind: 'number' },
        defaultValue: undefined,
        annotations: {},
      },
    ],
    fn: () => null,
    isProperty: false,
  });
}

describe('Rill Language: fn type', () => {
  describe('naming', () => {
    rule('fn.name').it(
      'names the type of a script-defined function',
      async () => {
        expect(await run('fn(x: number) { $x } => $f\n$f.^type.name')).toBe(
          'fn'
        );
      }
    );

    rule('fn.name').it(
      'names the type of a host-provided function',
      async () => {
        const result = await run('$f.^type.name', {
          variables: { f: makeHostFn() },
        });
        expect(result).toBe('fn');
      }
    );

    rule('fn.name').it(
      'evaluates the type name fn to a type value',
      async () => {
        const result = await run('fn');
        expect(isTypeValue(result)).toBe(true);
        if (!isTypeValue(result)) throw new Error('expected type value');
        expect(result.typeName).toBe('fn');
      }
    );

    rule('fn.no-closure').it('rejects closure after an assertion colon', () => {
      const err = parseError('1 -> :closure');
      expect(err.errorId).toBe('RILL-P012');
      expect(err.message).toContain('fn');
    });

    rule('fn.no-closure').it('rejects closure in a capture annotation', () => {
      const err = parseError('1 => $x:closure');
      expect(err.errorId).toBe('RILL-P012');
      expect(err.message).toContain('fn');
    });

    rule('fn.no-closure').it('rejects closure as a parameter type', () => {
      const err = parseError('fn(callback: closure) { $callback }');
      expect(err.errorId).toBe('RILL-P012');
      expect(err.message).toContain('fn');
    });

    rule('fn.no-closure').it('rejects closure as a type argument', () => {
      const err = parseError('list(closure)');
      expect(err.errorId).toBe('RILL-P012');
      expect(err.message).toContain('fn');
    });
  });

  describe('type positions', () => {
    rule('fn.position').it(
      'accepts a fn type after an assertion colon',
      async () => {
        expect(
          await run('fn(x: number) { $x } => $f\n$f -> :?fn(x: number)')
        ).toBe(true);
        expect(
          await run('fn(x: number) { $x } => $f\n$f -> :fn(x: number)')
        ).toSatisfy(isCallable);
      }
    );

    rule('fn.position').it(
      'accepts a fn type in a capture annotation',
      async () => {
        const result = await run(
          'fn(x: number):number { $x } => $f:fn(x: number):number\n$f(4)'
        );
        expect(result).toBe(4);
      }
    );

    rule('fn.position').it(
      'accepts a fn type as a parameter type',
      async () => {
        const script = `
        fn(apply: fn(x: string):string) { $apply("a") } => $run
        $run(fn(x: string):string { "{$x}!" })
      `;
        expect(await run(script)).toBe('a!');
      }
    );

    rule('fn.position').it(
      'accepts a fn type as an argument of another type',
      async () => {
        const script = `
        list[fn(x: string):string { $x }] => $fns:list(fn(x: string):string)
        $fns -> .len
      `;
        expect(await run(script)).toBe(1);
      }
    );

    rule('fn.position').it(
      'rejects a list of fns whose element type differs',
      async () => {
        await expectHalt(
          () =>
            run(
              'list[fn(x: number) { $x }] => $fns:list(fn(x: string):string)'
            ),
          { code: 'TYPE_MISMATCH' }
        );
      }
    );
  });

  describe('bare fn', () => {
    rule('fn.bare').it('accepts a function with named params', async () => {
      expect(await run('fn(x: number) { $x } => $f\n$f -> :?fn')).toBe(true);
    });

    rule('fn.bare').it('accepts a function with unnamed params', async () => {
      expect(await run('fn(number) { $ } => $f\n$f -> :?fn')).toBe(true);
    });

    rule('fn.bare').it('accepts a function with no params', async () => {
      expect(await run('fn() { 1 } => $f\n$f -> :?fn')).toBe(true);
    });

    rule('fn.bare').it('accepts a host-provided function', async () => {
      expect(await run('$f -> :?fn', { variables: { f: makeHostFn() } })).toBe(
        true
      );
    });

    rule('fn.bare').it('rejects a value that is not a function', async () => {
      expect(await run('1 -> :?fn')).toBe(false);
      expect(await run('"fn" -> :?fn')).toBe(false);
    });
  });

  describe('empty parentheses', () => {
    rule('fn.empty').it('names a function that takes no params', async () => {
      expect(await run('fn() { 1 } => $f\n$f -> :?fn()')).toBe(true);
      expect(await run('fn(x: number) { $x } => $f\n$f -> :?fn()')).toBe(false);
    });

    rule('fn.empty').it('does not equal the bare fn', async () => {
      expect(await run('fn() == fn')).toBe(false);
      expect(await run('fn() != fn')).toBe(true);
    });
  });

  describe('omitted parameter type and outer', () => {
    rule('fn.omitted').it(
      'equals fn(x: any):any when the param type and outer are omitted',
      async () => {
        expect(await run('fn(x) == fn(x: any):any')).toBe(true);
      }
    );

    rule('fn.omitted').it(
      'gives a param with a default and no type the type any',
      async () => {
        expect(await run('fn(x = 5).inner == ordered[x: any]')).toBe(true);
        expect(await run('fn(x = 5) { $x } => $f\n$f("text")')).toBe('text');
      }
    );
  });

  describe('named parameters', () => {
    rule('fn.named').it('declares a param with a name and a type', async () => {
      expect(await run('fn(x: number).inner == ordered[x: number]')).toBe(true);
    });

    rule('fn.named').it('keeps a default as part of the type', async () => {
      expect(await run('fn(x: number = 0).defaults')).toEqual({ x: 0 });
      expect(await run('fn(x: number = 0) == fn(x: number)')).toBe(false);
    });

    rule('fn.named').it('lets a call omit a defaulted param', async () => {
      expect(await run('fn(x: number = 7) { $x } => $f\n$f()')).toBe(7);
    });
  });

  describe('unnamed parameters', () => {
    rule('fn.unnamed').it(
      'declares an unnamed param when only a type is written',
      async () => {
        expect(await run('fn(number).inner == tuple[number]')).toBe(true);
      }
    );

    rule('fn.unnamed').it(
      'binds the pipe value to the first unnamed param as $',
      async () => {
        expect(await run('5 -> fn(number) { $ + 1 }')).toBe(6);
      }
    );

    rule('fn.unnamed-limit').it(
      'binds the second unnamed param as $@',
      async () => {
        expect(await run('fn(number, number) { $ + $@ } => $f\n$f(2, 3)')).toBe(
          5
        );
      }
    );

    rule('fn.unnamed-no-default').it(
      'rejects a default on an unnamed param with RILL-P028',
      () => {
        expect(parseError('fn(number = 1)').errorId).toBe('RILL-P028');
      }
    );

    rule('fn.unnamed-limit').it(
      'rejects a third unnamed param with RILL-P028',
      () => {
        expect(parseError('fn(number, number, number)').errorId).toBe(
          'RILL-P028'
        );
      }
    );

    rule('fn.no-mix').it(
      'rejects a named param after an unnamed one with RILL-P028',
      () => {
        expect(parseError('fn(number, x: number)').errorId).toBe('RILL-P028');
      }
    );

    rule('fn.no-mix').it(
      'rejects an unnamed param after a named one with RILL-P028',
      () => {
        expect(parseError('fn(x: number, number)').errorId).toBe('RILL-P028');
      }
    );
  });

  describe('outer', () => {
    rule('fn.outer').it('yields the result type from .outer', async () => {
      expect(await run('fn(x: number):string.outer == string')).toBe(true);
    });

    rule('fn.outer').it(
      'yields any from .outer when no outer is written',
      async () => {
        expect(await run('fn(x: number).outer == any')).toBe(true);
      }
    );

    rule('fn.outer').it(
      'yields any from .outer of a function with no declared outer',
      async () => {
        expect(
          await run('fn(x: number) { 1 } => $f\n$f.^type.outer == any')
        ).toBe(true);
      }
    );

    rule('fn.outer').it(
      'accepts fn:T as a fn type with outer T and no params list',
      async () => {
        expect(await run('fn:string -> string')).toBe('fn:string');
      }
    );
  });

  describe('equality', () => {
    rule('fn.equality').it(
      'equates fn types with equal names, types, defaults, and outer',
      async () => {
        expect(
          await run('fn(x: number = 3):string == fn(x: number = 3):string')
        ).toBe(true);
      }
    );

    rule('fn.equality').it(
      'does not equate types with different parameter names',
      async () => {
        expect(await run('fn(y: string):string == fn(x: string):string')).toBe(
          false
        );
      }
    );

    rule('fn.equality').it(
      'does not equate types with different parameter types',
      async () => {
        expect(await run('fn(x: number):string == fn(x: string):string')).toBe(
          false
        );
      }
    );

    rule('fn.equality').it(
      'does not equate an omitted outer with string',
      async () => {
        expect(await run('fn(x: string) == fn(x: string):string')).toBe(false);
      }
    );

    rule('fn.equality').it(
      'does not equate a defaulted param with the same param without a default',
      async () => {
        expect(await run('fn(x: number = 1) == fn(x: number)')).toBe(false);
      }
    );

    rule('fn.equality', 'structural-typing.function').it(
      'gives a function the type its own type equals',
      async () => {
        expect(
          await run('fn(x: number = 3) { $x } => $f\n$f -> :?fn(x: number = 3)')
        ).toBe(true);
      }
    );

    rule('fn.equality', 'structural-typing.function').it(
      'does not give a function a type that omits its default',
      async () => {
        expect(
          await run('fn(x: number = 3) { $x } => $f\n$f -> :?fn(x: number)')
        ).toBe(false);
      }
    );

    rule('fn.equality', 'structural-typing.function').it(
      'does not give a function a type that adds a default it lacks',
      async () => {
        expect(
          await run('fn(x: number) { $x } => $f\n$f -> :?fn(x: number = 3)')
        ).toBe(false);
      }
    );

    rule('fn.equality', 'structural-typing.function').it(
      'does not give a function with an extra defaulted param the shorter type',
      async () => {
        expect(
          await run(
            'fn(x: number, y: number = 1) { $x } => $f\n$f -> :?fn(x: number)'
          )
        ).toBe(false);
      }
    );

    rule('structural-typing.function').it(
      'compares a function value to a type held in a variable',
      async () => {
        const script = `
          fn(x: string, y: number) { $x } => $ref
          $ref.^type => $refType
          fn(x: string = "a", y: number = 0) { $x } => $fn
          $fn -> :?$refType
        `;
        expect(await run(script)).toBe(false);
      }
    );
  });

  describe('inner', () => {
    rule('fn.inner-named').it(
      'yields an ordered of types for named params',
      async () => {
        expect(
          await run('fn(x: number):string.inner == ordered[x: number]')
        ).toBe(true);
      }
    );

    rule('fn.inner-named').it('yields an empty ordered for fn()', async () => {
      expect(await run('fn().inner == ordered[]')).toBe(true);
    });

    rule('fn.inner-unnamed').it(
      'yields a tuple of types for unnamed params',
      async () => {
        expect(await run('fn(any).inner == tuple[any]')).toBe(true);
        expect(
          await run('fn(number, number).inner == tuple[number, number]')
        ).toBe(true);
      }
    );

    rule('fn.inner-unnamed').it(
      'yields a tuple for a function whose body reads unnamed params',
      async () => {
        expect(
          await run('fn { $ + $@ } => $f\n$f.^type.inner == tuple[any, any]')
        ).toBe(true);
      }
    );

    rule('fn.inner-type').it(
      'types .inner as union(ordered, tuple, type)',
      async () => {
        const probe = ':? union(ordered, tuple, type)';
        expect(await run(`fn(x: number).inner ${probe}`)).toBe(true);
        expect(await run(`fn(number).inner ${probe}`)).toBe(true);
        expect(await run(`fn.inner ${probe}`)).toBe(true);
      }
    );

    rule('fn.inner-type').it(
      'yields any from .inner of the bare fn',
      async () => {
        expect(await run('fn.inner == any')).toBe(true);
      }
    );
  });

  describe('printing', () => {
    rule('fn.print').it('prints a fn type in the complete form', async () => {
      expect(await run('fn(x: number):string -> string')).toBe(
        'fn(x: number):string'
      );
    });

    rule('fn.print').it('prints an unnamed param as its type', async () => {
      expect(await run('fn(number) -> string')).toBe('fn(number):any');
    });

    rule('fn.print').it('prints a default after the param type', async () => {
      expect(await run('fn(x: number = 3):string -> string')).toBe(
        'fn(x: number = 3):string'
      );
    });

    rule('fn.print').it('prints a fn type nested in a list type', async () => {
      expect(await run('list(fn(x: string):string) -> string')).toBe(
        'list(fn(x: string):string)'
      );
    });
  });

  describe('param form', () => {
    rule('defaults.param-form').it(
      'accepts = literal after a param type',
      async () => {
        expect(
          await run('fn(x: number = 3):string { $x -> string } => $f\n$f()')
        ).toBe('3');
      }
    );

    rule('defaults.param-form').it(
      'carries the default in the type',
      async () => {
        expect(await run('fn(x: number = 3):string.defaults')).toEqual({
          x: 3,
        });
      }
    );
  });

  describe('bare fn assertion', () => {
    rule('assertion.bare-fn').it(
      'sets the bare kind fn as the asserted type',
      async () => {
        const result = await run(
          'fn(x: number) { $x } => $f:fn\n$f.^type.name'
        );
        expect(result).toBe('fn');
      }
    );

    rule('assertion.bare-fn').it('passes a function through :fn', async () => {
      expect(await run('fn() { "x" } -> :fn -> $()')).toBe('x');
    });

    rule('assertion.bare-fn').it(
      'halts when :fn meets a value that is not a function',
      async () => {
        await expectHalt(() => run('"fn" -> :fn'), { code: 'TYPE_MISMATCH' });
      }
    );
  });

  describe('signature literal values', () => {
    rule('fn.position', 'fn.empty', 'fn.outer').it(
      'evaluates fn():string to a type value with zero params and string outer',
      async () => {
        const result = await run('fn():string');
        expect(isTypeValue(result)).toBe(true);
        if (!isTypeValue(result)) throw new Error('expected type value');
        expect(result.typeName).toBe('fn');
        const structure = result.structure as {
          kind: string;
          params: unknown[];
          ret: { kind: string };
        };
        expect(structure.kind).toBe('fn');
        expect(structure.params).toEqual([]);
        expect(structure.ret).toEqual({ kind: 'string' });
      }
    );

    rule('fn.named').it(
      'carries the annotation of a single annotated param',
      async () => {
        const result = await run(`
        fn(^("label") x: string):number => $t
        $t
      `);
        expect(isTypeValue(result)).toBe(true);
        if (!isTypeValue(result)) throw new Error('expected type value');
        const structure = result.structure as {
          params: { name: string; annotations?: Record<string, unknown> }[];
        };
        expect(structure.params).toHaveLength(1);
        expect(structure.params[0]!.name).toBe('x');
        expect(structure.params[0]!.annotations).toEqual({
          description: 'label',
        });
      }
    );

    rule('fn.named').it(
      'carries annotations only on the annotated param of several',
      async () => {
        const result = await run(`
        fn(^(description: "d") x: string, y: number):bool => $t
        $t
      `);
        expect(isTypeValue(result)).toBe(true);
        if (!isTypeValue(result)) throw new Error('expected type value');
        const structure = result.structure as {
          params: { name: string; annotations?: Record<string, unknown> }[];
        };
        expect(structure.params).toHaveLength(2);
        expect(structure.params[0]!.annotations).toEqual({ description: 'd' });
        expect(structure.params[1]!.name).toBe('y');
        expect(structure.params[1]!.annotations).toBeUndefined();
      }
    );

    rule('fn.value').it(
      'keeps a fn type with a body a callable, not a type value',
      async () => {
        const result = await run('fn(x: number) { $x }');
        expect(isTypeValue(result)).toBe(false);
        expect(isCallable(result)).toBe(true);
      }
    );

    rule('structural-typing.function').it(
      'ignores param annotations when comparing a function to a signature type',
      async () => {
        const script = `
          fn(^("label") x: string):number => $t
          fn(x: string):number { 1 } -> :$t
        `;
        expect(isCallable(await run(script))).toBe(true);
      }
    );
  });
});
