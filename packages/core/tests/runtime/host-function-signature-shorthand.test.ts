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
  '|^(description: "pd") a: string|number, b: dict(k: string), c: list(string), d: number = -3, e: string = "x"|:string';

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
  member: '^input' | '^output'
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
        'string|number',
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

    it('produces equal ^input and ^output from scripts', async () => {
      expect(await reflect(shorthand, '^input')).toEqual(
        await reflect(explicitFull, '^input')
      );
      expect(await reflect(shorthand, '^output')).toEqual(
        await reflect(explicitFull, '^output')
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
      ['two names without a separator', '|a b|'],
      ['trailing tokens', '|a| extra'],
      ['a variable as a type', '|a: $t|'],
      ['an unterminated string', '|a: string = "oops|'],
    ] as const;

    it.each(invalid)(
      'createRuntimeContext throws R091 with function key and position: %s',
      (_label, signature) => {
        const err = catchRegistration(() =>
          createRuntimeContext({ functions: { myFn: { signature, fn } } })
        );
        expect(err.errorId).toBe('RILL-R091');
        expect(err.message).toContain('myFn');
        expect(err.message).toMatch(/\sat \d+:\d+$/);
      }
    );

    it.each(invalid)(
      'toCallable throws R091 naming <anonymous>: %s',
      (_label, signature) => {
        const err = catchRegistration(() => toCallable({ signature, fn }));
        expect(err.errorId).toBe('RILL-R091');
        expect(err.message).toContain('<anonymous>');
        expect(err.message).toMatch(/\sat \d+:\d+$/);
      }
    );

    it('fails before any script executes', () => {
      expect(() =>
        createRuntimeContext({
          functions: { myFn: { signature: '|a b|', fn } },
        })
      ).toThrow(RuntimeError);
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
      const out = await reflect({ signature: '|a: string|', fn }, '^output');
      const explicit = await reflect(
        { params: [], returnType: anyTypeValue, fn },
        '^output'
      );
      expect(out).toEqual(explicit);
    });
  });

  describe('explicit form is untouched', () => {
    it('keeps the params array identity through toCallable', () => {
      const def: RillFunction = { params: [], returnType: anyTypeValue, fn };
      expect(toCallable(def).params).toBe(def.params);
    });
  });
});
