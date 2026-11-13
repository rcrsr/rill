/**
 * Rill Runtime Tests: host function signature shorthand
 *
 * A host function may be declared as `{ signature, fn }` instead of
 * `{ params, returnType, fn }`. Both entry points, createRuntimeContext
 * `functions` and toCallable, normalize the shorthand at registration time.
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  createRuntimeContext,
  generateManifest,
  getFunctions,
  parse,
  execute,
  RuntimeError,
  toCallable,
  structureToTypeValue,
  type RillFunction,
  type RillParam,
  type TypeStructure,
  type RillFunctionDefinition,
  type RillValue,
} from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { expectRuntimeError } from '../helpers/halt.js';

const fn = (): RillValue => 'ok';

const FULL_SIGNATURE =
  '|^(description: "pd") a: union(string, number), b: dict(k: string), c: list(string), d: number = -3, e: string = "x"|:string';

const strT: TypeStructure = { kind: 'string' };
const numT: TypeStructure = { kind: 'number' };

function param(
  name: string,
  type: TypeStructure,
  defaultValue?: RillValue,
  annotations: Record<string, RillValue> = {}
): RillParam {
  return { name, type, defaultValue, annotations };
}

/** Explicit definition equivalent to FULL_SIGNATURE plus its annotations. */
const explicitFull: RillFunction = {
  params: [
    param('a', { kind: 'union', members: [strT, numT] }, undefined, {
      description: 'pd',
    }),
    param('b', { kind: 'dict', fields: { k: { type: strT } } }),
    param('c', { kind: 'list', element: strT }),
    param('d', numT, -3),
    param('e', strT, 'x'),
  ],
  returnType: structureToTypeValue(strT),
  annotations: { category: 'io', description: 'does things' },
  fn,
};

/** Run a script and return the annotations of a registered function's callable. */
function reflect(
  def: RillFunctionDefinition,
  member: '^type' | '^type.outer'
): Promise<RillValue> {
  return run(`$f.${member}`, {
    variables: { f: toCallable(def) },
  });
}

function catchRegistration(build: () => unknown): RuntimeError {
  try {
    build();
  } catch (err) {
    expect(err).toBeInstanceOf(RuntimeError);
    return err as RuntimeError;
  }
  throw new Error('expected registration to throw');
}

describe('host function signature shorthand', () => {
  describe('equivalence with the explicit form', () => {
    const shorthand: RillFunctionDefinition = {
      signature: `^(category: "io") ${FULL_SIGNATURE}`,
      description: 'does things',
      fn,
    };

    const viaShorthand = createRuntimeContext({ functions: { f: shorthand } });

    it('reflects params, return type and merged annotations', () => {
      const [meta] = getFunctions(viaShorthand);
      expect(meta?.name).toBe('f');
      expect(meta?.params.map((p) => p.name)).toEqual([
        'a',
        'b',
        'c',
        'd',
        'e',
      ]);
      expect(meta?.params[0]?.description).toBe('pd');
      expect(meta?.description).toBe('does things');
      const registered = viaShorthand.functions.get('f');
      expect(registered?.params[0]?.annotations).toEqual({ description: 'pd' });
      expect(registered?.annotations).toEqual({
        category: 'io',
        description: 'does things',
      });
      expect(meta?.params.map((p) => p.type)).toEqual([
        'union(number, string)',
        'dict(k: string)',
        'list(string)',
        'number',
        'string',
      ]);
      expect(meta?.returnType).toBe('string');
      expect(meta?.params[3]?.defaultValue).toBe(-3);
      expect(meta?.params[4]?.defaultValue).toBe('x');
    });

    it('matches an independently built explicit registration', () => {
      const viaExplicit = createRuntimeContext({
        functions: { f: explicitFull },
      });
      expect(getFunctions(viaShorthand)).toEqual(getFunctions(viaExplicit));
      expect(generateManifest(viaShorthand)).toBe(
        generateManifest(viaExplicit)
      );
    });

    it('produces equal ^type and ^type.outer from scripts', async () => {
      expect(await reflect(shorthand, '^type')).toEqual(
        await reflect(explicitFull, '^type')
      );
      expect(await reflect(shorthand, '^type.outer')).toEqual(
        await reflect(explicitFull, '^type.outer')
      );
    });

    it('parses the documented signatures', () => {
      const ctx = createRuntimeContext({
        functions: {
          log_it: { signature: '|str: string, count: number = 1|:any', fn },
          greet: {
            signature:
              '|^(description: "Person to greet") name: string|:string',
            fn,
          },
        },
      });
      const explicit = createRuntimeContext({
        functions: {
          log_it: {
            params: [param('str', strT), param('count', numT, 1)],
            returnType: structureToTypeValue({ kind: 'any' }),
            fn,
          },
          greet: {
            params: [
              param('name', strT, undefined, {
                description: 'Person to greet',
              }),
            ],
            returnType: structureToTypeValue(strT),
            fn,
          },
        },
      });
      const byName = new Map(getFunctions(ctx).map((m) => [m.name, m]));
      expect(byName.get('log_it')?.params.map((p) => p.type)).toEqual([
        'string',
        'number',
      ]);
      expect(byName.get('log_it')?.params[1]?.defaultValue).toBe(1);
      expect(byName.get('log_it')?.returnType).toBe('any');
      expect(byName.get('greet')?.params[0]?.type).toBe('string');
      expect(byName.get('greet')?.params[0]?.description).toBe(
        'Person to greet'
      );
      expect(byName.get('greet')?.returnType).toBe('string');
      expect(getFunctions(ctx)).toEqual(getFunctions(explicit));
      expect(generateManifest(ctx)).toBe(generateManifest(explicit));
    });
  });

  describe('createRuntimeContext wiring', () => {
    it('calls a shorthand function and returns its value', async () => {
      const result = await run('echo("hi")', {
        functions: {
          echo: {
            signature: '|s: string|:string',
            fn: (args) => `got ${String(args['s'])}`,
          },
        },
      });
      expect(result).toBe('got hi');
    });

    it('halts with RILL-R001 on a wrong argument type', async () => {
      await expectRuntimeError(
        () =>
          run('echo(5)', {
            functions: { echo: { signature: '|s: string|:string', fn } },
          }),
        { code: 'RILL-R001' }
      );
    });
  });

  describe('toCallable wiring', () => {
    it('is callable as a variable dict member and keeps isProperty', async () => {
      const callable = toCallable(
        { signature: '|n: number|:number', fn: (a) => Number(a['n']) * 2 },
        true
      );
      expect(callable.isProperty).toBe(true);
      const ctx = createRuntimeContext({
        variables: { tools: { double: callable } },
      });
      const out = await execute(parse('$tools.double(4)'), ctx);
      expect(out.result).toBe(8);
    });

    it('preserves isProperty false by default', () => {
      expect(toCallable({ signature: '||', fn }).isProperty).toBe(false);
    });
  });

  describe('registration-time failure', () => {
    const invalid = [
      ['two names without a separator', '|a b|', '1:4'],
      ['trailing tokens', '|a| extra', '1:5'],
      ['a variable as a type', '|a: $t|', '1:5'],
      ['an unterminated string', '|a: string = "oops|', '1:14'],
      ['an error on the second line', '|\n  a: string,\n  b c\n|', '3:5'],
      ['dict type arguments without names', '|a: dict(string)|', '1:5'],
      ['list type with two arguments', '|a: list(string, number)|', '1:5'],
      ['a variable inside tuple arguments', '|a: tuple(string, $t)|', '1:5'],
      ['a bad return type', '|a: list(string)|:dict(string)', '1:19'],
      ['an unsupported default literal', '|a: string = foo|', '1:14'],
      ['a minus without a number', '|a: number = -x|', '1:15'],
      ['a non-string annotation value', '|^(k: 5) a: string|', '1:7'],
    ] as const;

    it.each(invalid)(
      'createRuntimeContext throws R091 with function key and position: %s',
      (_label, signature, position) => {
        const err = catchRegistration(() =>
          createRuntimeContext({ functions: { myFn: { signature, fn } } })
        );
        expect(err.errorId).toBe('RILL-R091');
        expect(err.message).toContain("function 'myFn'");
        expect(err.message.endsWith(` at ${position}`)).toBe(true);
      }
    );

    it.each(invalid)(
      'toCallable throws R091 naming <anonymous>: %s',
      (_label, signature, position) => {
        const err = catchRegistration(() => toCallable({ signature, fn }));
        expect(err.errorId).toBe('RILL-R091');
        expect(err.message).toContain("function '<anonymous>'");
        expect(err.message.endsWith(` at ${position}`)).toBe(true);
      }
    );

    it('keeps the original parser error as cause', () => {
      const err = catchRegistration(() =>
        toCallable({ signature: '|a b|', fn })
      );
      expect(err.cause).toBeInstanceOf(Error);
      expect((err.cause as Error).message).toContain(
        "expected ',' or '|' between parameters"
      );
    });

    it('does not invoke an earlier function when a later one is invalid', () => {
      let calls = 0;
      expect(() =>
        createRuntimeContext({
          functions: {
            first: {
              signature: '||',
              fn: () => {
                calls += 1;
                return 'ok';
              },
            },
            second: { signature: '|a b|', fn },
          },
        })
      ).toThrow(RuntimeError);
      expect(calls).toBe(0);
    });

    it('reports a signature error before the missing-description check', () => {
      const err = catchRegistration(() =>
        createRuntimeContext({
          functions: { myFn: { signature: '|a b|', fn } },
          requireDescriptions: true,
        })
      );
      expect(err.errorId).toBe('RILL-R091');
    });
  });

  describe('requireDescriptions', () => {
    it('rejects a shorthand without a function description with R069', () => {
      const err = catchRegistration(() =>
        createRuntimeContext({
          functions: { myFn: { signature: '|a: string|', fn } },
          requireDescriptions: true,
        })
      );
      expect(err.errorId).toBe('RILL-R069');
    });

    it('rejects a shorthand without a parameter description with R070', () => {
      const err = catchRegistration(() =>
        createRuntimeContext({
          functions: {
            myFn: { signature: '|a: string|', description: 'does it', fn },
          },
          requireDescriptions: true,
        })
      );
      expect(err.errorId).toBe('RILL-R070');
    });

    it('accepts descriptions supplied through the signature and the field', () => {
      const ctx = createRuntimeContext({
        functions: {
          myFn: {
            signature: '|^(description: "the input") a: string|',
            description: 'does it',
            fn,
          },
        },
        requireDescriptions: true,
      });
      expect(getFunctions(ctx)[0]?.description).toBe('does it');
    });
  });

  describe('mixing forms', () => {
    const base = { signature: '|a: string|', fn };
    const mixed = [
      ['signature with params', { ...base, params: [] }],
      ['signature with returnType', { ...base, returnType: anyTypeValue }],
    ] as const;

    it.each(mixed)('createRuntimeContext rejects %s with R091', (_l, def) => {
      const err = catchRegistration(() =>
        createRuntimeContext({
          functions: { myFn: def as unknown as RillFunctionDefinition },
        })
      );
      expect(err.errorId).toBe('RILL-R091');
      expect(err.message).toContain('myFn');
    });

    it.each(mixed)('toCallable rejects %s with R091', (_l, def) => {
      const err = catchRegistration(() =>
        toCallable(def as unknown as RillFunctionDefinition)
      );
      expect(err.errorId).toBe('RILL-R091');
    });
  });

  describe('annotation sources', () => {
    it('rejects description declared by field and by function annotation', () => {
      const def: RillFunctionDefinition = {
        signature: '^(description: "d") |a: string|',
        description: 'other',
        fn,
      };
      const err = catchRegistration(() =>
        createRuntimeContext({ functions: { myFn: def } })
      );
      expect(err.errorId).toBe('RILL-R091');
      expect(err.message).toContain('description');
    });

    it('rejects an annotations option colliding with a signature annotation', () => {
      const err = catchRegistration(() =>
        toCallable({
          signature: '^(category: "io") |a: string|',
          annotations: { category: 'x' },
          fn,
        })
      );
      expect(err.errorId).toBe('RILL-R091');
      expect(err.message).toContain('category');
    });

    it('keeps a __proto__ function annotation as an own property', async () => {
      const ctx = createRuntimeContext({
        functions: {
          f: { signature: '^(__proto__: "p") |a: string|', fn },
        },
      });
      const annotations = ctx.functions.get('f')?.annotations ?? {};
      expect(
        Object.prototype.hasOwnProperty.call(annotations, '__proto__')
      ).toBe(true);
      expect(Object.getPrototypeOf(annotations)).toBe(Object.prototype);
      const viaScript = await run('$f.^__proto__', {
        variables: {
          f: toCallable({ signature: '^(__proto__: "p") |a: string|', fn }),
        },
      });
      expect(viaScript).toBe('p');
    });
  });

  describe('field type validation', () => {
    it.each([
      ['non-string signature', { signature: 42, fn }],
      ['non-string description', { signature: '||', description: 7, fn }],
      ['string annotations', { signature: '||', annotations: 'abc', fn }],
      ['array annotations', { signature: '||', annotations: ['a'], fn }],
      ['null annotations', { signature: '||', annotations: null, fn }],
    ])('rejects a %s with R091 from both entry points', (_l, def) => {
      const typed = def as unknown as RillFunctionDefinition;
      const viaContext = catchRegistration(() =>
        createRuntimeContext({ functions: { myFn: typed } })
      );
      expect(viaContext.errorId).toBe('RILL-R091');
      const viaCallable = catchRegistration(() => toCallable(typed));
      expect(viaCallable.errorId).toBe('RILL-R091');
    });
  });

  describe('non-object definitions', () => {
    it('reaches the existing RILL-R085 path instead of a TypeError', () => {
      const err = catchRegistration(() =>
        createRuntimeContext({
          functions: { f: 5 as unknown as RillFunctionDefinition },
        })
      );
      expect(err.errorId).toBe('RILL-R085');
    });
  });

  describe('defaults and edge forms', () => {
    it('keeps RILL-R077 for a default that mismatches its type', () => {
      const err = catchRegistration(() =>
        createRuntimeContext({
          functions: { myFn: { signature: '|x: number = "a"|', fn } },
        })
      );
      expect(err.errorId).toBe('RILL-R077');
    });

    it('treats || as empty params', () => {
      const ctx = createRuntimeContext({
        functions: { f: { signature: '||', fn } },
      });
      expect(getFunctions(ctx)[0]?.params).toEqual([]);
    });

    it('defaults an omitted return type to any', async () => {
      const out = await reflect(
        { signature: '|a: string|', fn },
        '^type.outer'
      );
      const explicit = await reflect(
        { params: [], returnType: anyTypeValue, fn },
        '^type.outer'
      );
      expect(out).toEqual(explicit);
    });
  });

  describe('field defaults inside a type', () => {
    function firstParamType(signature: string): TypeStructure | undefined {
      return toCallable({ signature, fn }).params[0]?.type;
    }

    function registrationError(signature: string): RuntimeError {
      return catchRegistration(() =>
        createRuntimeContext({ functions: { f: { signature, fn } } })
      );
    }

    it('carries dict field defaults of each literal kind', () => {
      expect(
        firstParamType(
          '|d: dict(a: number, s: string = "x", t: bool = true, n: number = -2)|'
        )
      ).toEqual({
        kind: 'dict',
        fields: {
          a: { type: numT },
          s: { type: strT, defaultValue: 'x' },
          t: { type: { kind: 'bool' }, defaultValue: true },
          n: { type: numT, defaultValue: -2 },
        },
      });
    });

    it('carries trailing tuple defaults and nested dict defaults', () => {
      expect(firstParamType('|d: tuple(string, number = 0)|')).toEqual({
        kind: 'tuple',
        elements: [{ type: strT }, { type: numT, defaultValue: 0 }],
      });
      expect(
        firstParamType('|d: dict(o: dict(x: number, y: number = 1))|')
      ).toEqual({
        kind: 'dict',
        fields: {
          o: {
            type: {
              kind: 'dict',
              fields: { x: { type: numT }, y: { type: numT, defaultValue: 1 } },
            },
          },
        },
      });
    });

    it('accepts a field default in the return type', async () => {
      const out = await reflect(
        { signature: '||:dict(a: number, b: number = 0)', fn },
        '^type.outer'
      );
      const explicit = await reflect(
        {
          params: [],
          returnType: structureToTypeValue({
            kind: 'dict',
            fields: { a: { type: numT }, b: { type: numT, defaultValue: 0 } },
          }),
          fn,
        },
        '^type.outer'
      );
      expect(out).toEqual(explicit);
    });

    it('fills an omitted defaulted field before the host function runs', async () => {
      const result = await run('f(dict[a: 1])', {
        functions: {
          f: {
            signature: '|d: dict(a: number, b: number = 0)|',
            fn: (args) => args['d'] ?? '',
          },
        },
      });
      expect(result).toEqual({ a: 1, b: 0 });
    });

    it('rejects a field default that mismatches its type with RILL-R091', () => {
      const err = registrationError('|d: dict(a: number, b: number = "x")|');
      expect(err.errorId).toBe('RILL-R091');
      expect(err.message).toMatch(
        /Default value for field 'b' must be number, got string/
      );
    });

    it('rejects a default on the list element type with RILL-R091', () => {
      const err = registrationError('|d: list(number = 1)|');
      expect(err.errorId).toBe('RILL-R091');
      expect(err.message).toMatch(/list element type cannot carry a default/);
    });

    it('rejects a non-trailing tuple default with RILL-R091', () => {
      const err = registrationError('|d: tuple(number = 1, string)|');
      expect(err.errorId).toBe('RILL-R091');
      expect(err.message).toMatch(/default values must be trailing/);
    });

    it('rejects a non-literal field default with RILL-R091', () => {
      const err = registrationError('|d: dict(a: number = $x)|');
      expect(err.errorId).toBe('RILL-R091');
      expect(err.message).toMatch(/unsupported default value/);
    });
  });

  describe('explicit form is untouched', () => {
    it('keeps the params array identity through toCallable', () => {
      const def: RillFunction = { params: [], returnType: anyTypeValue, fn };
      expect(toCallable(def).params).toBe(def.params);
    });
  });
});
