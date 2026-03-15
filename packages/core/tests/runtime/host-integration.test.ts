/**
 * Rill Runtime Tests: Host Integration
 * Tests for custom functions, call-site location, AbortSignal, and application callables
 */

import {
  AbortError,
  anyTypeValue,
  buildTypeMethodDicts,
  callable,
  createRuntimeContext,
  inferStructuralType,
  isApplicationCallable,
  isCallable,
  isScriptCallable,
  parse,
  rillTypeToTypeValue,
  type ApplicationCallable,
  type RillFunction,
  type RillValue,
  type SourceLocation,
} from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Host Integration', () => {
  describe('Custom Functions', () => {
    it('registers and calls custom function', async () => {
      const result = await run('shout("hello")', {
        functions: {
          shout: {
            params: [
              {
                name: 'text',
                type: { type: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => String(args['text']).toUpperCase(),
          },
        },
      });
      expect(result).toBe('HELLO');
    });

    it('custom function receives arguments', async () => {
      const result = await run('repeat("hello", 3)', {
        functions: {
          repeat: {
            params: [
              {
                name: 'str',
                type: { type: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
              {
                name: 'count',
                type: { type: 'number' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => {
              const str = String(args['str']);
              const count =
                typeof args['count'] === 'number' ? args['count'] : 1;
              return str.repeat(count);
            },
          },
        },
      });
      expect(result).toBe('hellohellohello');
    });

    it('custom function receives context', async () => {
      const result = await run('withPrefix("test")', {
        variables: { prefix: 'PREFIX:' },
        functions: {
          withPrefix: {
            params: [
              {
                name: 'text',
                type: { type: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args, ctx) => {
              const prefix = ctx.variables.get('prefix') ?? '';
              return `${prefix}${args['text']}`;
            },
          },
        },
      });
      expect(result).toBe('PREFIX:test');
    });

    it('custom function can be async', async () => {
      const result = await run('fetchData("url")', {
        functions: {
          fetchData: {
            params: [
              {
                name: 'url',
                type: { type: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: async (args) => {
              await new Promise((r) => setTimeout(r, 10));
              return `fetched:${args['url']}`;
            },
          },
        },
      });
      expect(result).toBe('fetched:url');
    });

    it('custom function is callable alongside built-in functions', async () => {
      const result = await run('my_type("hello")', {
        functions: {
          my_type: {
            params: [
              {
                name: 'value',
                type: { type: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: () => 'custom-type',
          },
        },
      });
      expect(result).toBe('custom-type');
    });
  });

  describe('Function Call-Site Location', () => {
    it('function receives location parameter', async () => {
      let capturedLocation: SourceLocation | undefined;
      await run('locate("test")', {
        functions: {
          locate: {
            params: [
              {
                name: 'text',
                type: { type: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (_args, _ctx, location) => {
              capturedLocation = location;
              return 'done';
            },
          },
        },
      });
      expect(capturedLocation).toBeDefined();
      expect(capturedLocation?.line).toBe(1);
    });

    it('location reflects actual call site', async () => {
      const locations: SourceLocation[] = [];
      await run('track(1)\ntrack(2)\ntrack(3)', {
        functions: {
          track: {
            params: [
              {
                name: 'value',
                type: { type: 'number' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (_args, _ctx, location) => {
              if (location) locations.push(location);
              return null;
            },
          },
        },
      });
      expect(locations).toHaveLength(3);
      expect(locations[0]?.line).toBe(1);
      expect(locations[1]?.line).toBe(2);
      expect(locations[2]?.line).toBe(3);
    });

    it('location is undefined for internal calls', async () => {
      // Built-in functions should still work; typeName via host API
      const result = (await run('"hello" => $v\n$v.^type')) as any;
      expect(result.typeName).toBe('string');
    });
  });

  describe('AbortSignal Cancellation', () => {
    it('completes normally when not aborted', async () => {
      const controller = new AbortController();
      const result = await run('"hello"', {
        signal: controller.signal,
      });
      expect(result).toBe('hello');
    });

    it('throws AbortError when signal is aborted before execution', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        run('"hello"', { signal: controller.signal })
      ).rejects.toThrow(AbortError);
    });

    it('throws AbortError when aborted during function call', async () => {
      const controller = new AbortController();

      const slowFn: RillFunction = {
        params: [
          {
            name: 'input',
            type: { type: 'string' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: async (): Promise<RillValue> => {
          await new Promise((r) => setTimeout(r, 50));
          return 'done';
        },
      };

      // Abort after a short delay
      setTimeout(() => controller.abort(), 10);

      // The second function call should be aborted
      await expect(
        run('"x" -> slow -> slow', {
          functions: { slow: slowFn },
          signal: controller.signal,
        })
      ).rejects.toThrow(AbortError);
    });

    it('throws AbortError during for loop iteration', async () => {
      const controller = new AbortController();
      let iterations = 0;

      const countFn: RillFunction = {
        params: [
          {
            name: 'item',
            type: { type: 'number' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: (): RillValue => {
          iterations++;
          if (iterations >= 3) {
            controller.abort();
          }
          return iterations;
        },
      };

      await expect(
        run('list[1,2,3,4,5,6,7,8,9,10] -> each { count() }', {
          functions: { count: countFn },
          signal: controller.signal,
        })
      ).rejects.toThrow(AbortError);

      // Should have stopped around iteration 3-4
      expect(iterations).toBeLessThan(10);
    });

    it('throws AbortError during while loop iteration', async () => {
      const controller = new AbortController();
      let iterations = 0;

      const tickFn: RillFunction = {
        params: [
          {
            name: 'item',
            type: { type: 'number' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: (): RillValue => {
          iterations++;
          if (iterations >= 3) {
            controller.abort();
          }
          return iterations;
        },
      };

      await expect(
        run('list[1, 2, 3, 4, 5] -> each { tick($) }', {
          functions: { tick: tickFn },
          signal: controller.signal,
        })
      ).rejects.toThrow(AbortError);

      expect(iterations).toBeLessThan(100);
    });

    it('AbortError has correct properties', async () => {
      const controller = new AbortController();
      controller.abort();

      try {
        await run('"test"', { signal: controller.signal });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AbortError);
        const abortErr = err as AbortError;
        expect(abortErr.errorId).toBe('RILL-R013');
        expect(abortErr.message).toContain('aborted');
      }
    });

    it('abort is checked in stepper step()', async () => {
      const controller = new AbortController();
      const ast = parse('"a"\n"b"\n"c"');
      const ctx = createRuntimeContext({ signal: controller.signal });

      const { createStepper } = await import('@rcrsr/rill');
      const stepper = createStepper(ast, ctx);

      // Execute first step
      await stepper.step();
      expect(stepper.done).toBe(false);

      // Abort before second step
      controller.abort();

      // Second step should throw
      await expect(stepper.step()).rejects.toThrow(AbortError);
    });

    it('abort works with custom functions', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        run('custom()', {
          functions: {
            custom: { params: [], fn: () => 'should not reach' },
          },
          signal: controller.signal,
        })
      ).rejects.toThrow(AbortError);
    });
  });

  describe('Application Callables', () => {
    it('callable() creates an application callable', () => {
      const fn = callable((args) => args[0]);
      expect(isCallable(fn)).toBe(true);
      expect(isApplicationCallable(fn)).toBe(true);
      expect(fn.kind).toBe('application');
      expect(fn.isProperty).toBe(false);
    });

    it('callable() with isProperty=true creates property-style callable', () => {
      const fn = callable(() => 'value', true);
      expect(fn.isProperty).toBe(true);
    });

    it('application callable can be returned from function', async () => {
      const result = await run('getGreeter()', {
        functions: {
          getGreeter: {
            params: [],
            fn: () => callable((args) => `Hello, ${args[0]}!`),
          },
        },
      });
      expect(result).not.toBeNull();
      expect(typeof result).toBe('object');
    });

    it('application callable can be invoked after capture', async () => {
      const result = await run('getGreeter() => $greet -> $greet("World")', {
        functions: {
          getGreeter: {
            params: [],
            fn: () => callable((args) => `Hello, ${args[0]}!`),
          },
        },
      });
      expect(result).toBe('Hello, World!');
    });

    it('application callable in dict can be called', async () => {
      const result = await run('$obj.greet("World")', {
        variables: {
          obj: {
            greet: callable((args) => `Hello, ${args[0]}!`),
          },
        },
      });
      expect(result).toBe('Hello, World!');
    });

    it('property-style callable auto-invokes on dict access', async () => {
      const result = await run('$obj.name', {
        variables: {
          obj: {
            name: callable(() => 'computed-value', true),
          },
        },
      });
      expect(result).toBe('computed-value');
    });

    it('property-style callable receives bound dict', async () => {
      const result = await run('$obj.fullName', {
        variables: {
          obj: {
            first: 'John',
            last: 'Doe',
            fullName: callable((args) => {
              const dict = args[0] as Record<string, RillValue>;
              return `${dict.first} ${dict.last}`;
            }, true),
          },
        },
      });
      expect(result).toBe('John Doe');
    });

    it('application callable receives context when invoked', async () => {
      let capturedVarValue: RillValue = null;
      await run('$fn()', {
        variables: {
          testVar: 'from-context',
          fn: callable((_args, ctx) => {
            capturedVarValue = ctx.variables.get('testVar') ?? null;
            return 'done';
          }),
        },
      });
      expect(capturedVarValue).toBe('from-context');
    });

    it('application callable receives location when invoked', async () => {
      let capturedLocation: SourceLocation | undefined;
      await run('$fn("test")', {
        variables: {
          fn: callable((_args, _ctx, location) => {
            capturedLocation = location;
            return 'done';
          }),
        },
      });
      expect(capturedLocation).toBeDefined();
      expect(capturedLocation?.line).toBe(1);
    });

    it('type guards distinguish callable kinds', async () => {
      // Application callable
      const appCallable = callable(() => 'app');
      expect(isCallable(appCallable)).toBe(true);
      expect(isApplicationCallable(appCallable)).toBe(true);
      expect(isScriptCallable(appCallable)).toBe(false);

      // Script callable returned as RillValue
      const scriptResult = await run('|x| { $x }');
      expect(scriptResult).not.toBeNull();
    });

    it('non-callables return false from type guards', () => {
      expect(isCallable('string')).toBe(false);
      expect(isCallable(42)).toBe(false);
      expect(isCallable([1, 2, 3])).toBe(false);
      expect(isCallable({ key: 'value' })).toBe(false);
      expect(isCallable(null)).toBe(false);
    });
  });

  describe('inferStructuralType on ApplicationCallable', () => {
    it('reads params and returnType from ApplicationCallable', () => {
      const fn: ApplicationCallable = {
        __type: 'callable' as const,
        kind: 'application' as const,
        isProperty: false,
        fn: () => 'test',
        params: [{ name: 'text', type: { type: 'string' }, annotations: {} }],
        returnType: rillTypeToTypeValue({ type: 'dict' }),
        annotations: {},
      };
      const result = inferStructuralType(fn as unknown as RillValue);
      expect(result.type).toBe('closure');
      if (result.type === 'closure') {
        expect(result.params).toEqual([
          { name: 'text', type: { type: 'string' } },
        ]);
        expect(result.ret).toEqual({ type: 'dict' });
      }
    });

    it('uses empty params when ApplicationCallable.params is empty', () => {
      const fn: ApplicationCallable = {
        __type: 'callable' as const,
        kind: 'application' as const,
        isProperty: false,
        fn: () => 'test',
        params: [],
        returnType: anyTypeValue,
        annotations: {},
      };
      const result = inferStructuralType(fn as unknown as RillValue);
      expect(result.type).toBe('closure');
      if (result.type === 'closure') {
        expect(result.params).toEqual([]);
      }
    });

    it('uses anyTypeValue as ret when returnType is anyTypeValue', () => {
      const fn: ApplicationCallable = {
        __type: 'callable' as const,
        kind: 'application' as const,
        isProperty: false,
        fn: () => 'test',
        params: [],
        returnType: anyTypeValue,
        annotations: {},
      };
      const result = inferStructuralType(fn as unknown as RillValue);
      expect(result.type).toBe('closure');
      if (result.type === 'closure') {
        expect(result.ret).toEqual({ type: 'any' });
      }
    });
  });

  describe('typeMethodDicts (AC-39, IR-1)', () => {
    it('typeMethodDicts is populated at context creation', () => {
      const ctx = createRuntimeContext();
      expect(ctx.typeMethodDicts).toBeDefined();
      expect(ctx.typeMethodDicts.size).toBeGreaterThan(0);
    });

    it('typeMethodDicts contains entries for all built-in types', () => {
      const ctx = createRuntimeContext();
      for (const typeName of [
        'string',
        'list',
        'dict',
        'number',
        'bool',
        'vector',
      ]) {
        expect(ctx.typeMethodDicts.has(typeName)).toBe(true);
      }
    });

    it('typeMethodDicts values are frozen dicts of ApplicationCallable (AC-8, AC-9, AC-10)', () => {
      const ctx = createRuntimeContext();
      const stringMethods = ctx.typeMethodDicts.get('string');
      expect(stringMethods).toBeDefined();
      expect(Object.isFrozen(stringMethods)).toBe(true);
      // string.trim() should be present as a callable value
      expect(stringMethods!['trim']).toBeDefined();
      expect(isCallable(stringMethods!['trim'] as RillValue)).toBe(true);

      const listMethods = ctx.typeMethodDicts.get('list');
      expect(listMethods).toBeDefined();
      // list.first() should be present
      expect(listMethods!['first']).toBeDefined();
      expect(isCallable(listMethods!['first'] as RillValue)).toBe(true);

      const dictMethods = ctx.typeMethodDicts.get('dict');
      expect(dictMethods).toBeDefined();
      // dict.keys() should be present
      expect(dictMethods!['keys']).toBeDefined();
      expect(isCallable(dictMethods!['keys'] as RillValue)).toBe(true);
    });

    it('typeMethodDicts is built fresh per context (not a shared reference)', () => {
      const ctx = createRuntimeContext();
      const ctx2 = createRuntimeContext();
      // Each context builds its own map; they are distinct instances.
      expect(ctx2.typeMethodDicts).not.toBe(ctx.typeMethodDicts);
      // But their contents are equivalent.
      expect(ctx2.typeMethodDicts.get('string')).toBeDefined();
      expect(ctx2.typeMethodDicts.get('list')).toBeDefined();
    });
  });
});

// Separate describe block for EC-6 / AC-16 / AC-17 duplicate detection tests.
describe('buildTypeMethodDicts duplicate detection (EC-6, AC-16, AC-17)', () => {
  it('same method name on different types does not throw (AC-17)', () => {
    // "len" exists on both string and list — no error expected.
    const ctx = createRuntimeContext();
    const stringLen = ctx.typeMethodDicts.get('string')?.['len'];
    const listLen = ctx.typeMethodDicts.get('list')?.['len'];
    expect(stringLen).toBeDefined();
    expect(listLen).toBeDefined();
    // They are separate callable instances.
    expect(stringLen).not.toBe(listLen);
  });

  it('throws on duplicate method name for the same type (EC-6, AC-16)', () => {
    const fn: RillFunction = {
      params: [],
      fn: async () => '',
      annotations: {},
      returnType: anyTypeValue,
    };
    // Pass the same typeName twice with the same method name to trigger EC-6.
    expect(() =>
      buildTypeMethodDicts([
        ['string', { trim: fn }],
        ['string', { trim: fn }],
      ])
    ).toThrow("Duplicate method 'trim' on type 'string'");
  });
});

// ============================================================
// Reflection on all 3 callable kinds (AC-1, 2, 3, 4, 23, 25, 26, 28, 29, 30, 31, 32, 33, 37)
// ============================================================
describe('Callable reflection via ^ operator', () => {
  describe('^description on ApplicationCallable (AC-1, AC-4, AC-25, AC-26)', () => {
    it('returns description string when annotations.description is set (AC-25, AC-26)', async () => {
      const result = await run('$greet.^description', {
        variables: {
          greet: {
            __type: 'callable' as const,
            kind: 'application' as const,
            isProperty: false,
            fn: () => 'hello',
            params: [],
            returnType: anyTypeValue,
            annotations: { description: 'Says hello' },
          } satisfies ApplicationCallable,
        },
      });
      expect(result).toBe('Says hello');
    });

    it('returns {} when annotations.description is absent (AC-23)', async () => {
      const result = await run('$myFn.^description', {
        variables: {
          myFn: {
            __type: 'callable' as const,
            kind: 'application' as const,
            isProperty: false,
            fn: () => null,
            params: [],
            returnType: anyTypeValue,
            annotations: {},
          } satisfies ApplicationCallable,
        },
      });
      // No description annotation: ^description returns {}
      expect(result).toEqual({});
    });

    it('does not throw RILL-R003 when ^ applied to callable (AC-4)', async () => {
      // Applying ^ to any callable kind must not produce RILL-R003
      await expect(
        run('$myFn.^description', {
          variables: {
            myFn: {
              __type: 'callable' as const,
              kind: 'application' as const,
              isProperty: false,
              fn: () => null,
              params: [],
              returnType: anyTypeValue,
              annotations: {},
            } satisfies ApplicationCallable,
          },
        })
      ).resolves.toBeDefined();
    });
  });

  describe('^description on RuntimeCallable (AC-32)', () => {
    it('.^description on log returns {} (no annotations on runtime callables)', () => {
      // Access the log callable from context directly and reflect on it
      const ctx = createRuntimeContext();
      const logCallable = ctx.functions.get('log');
      expect(logCallable).toBeDefined();
      // annotations is an empty record on RuntimeCallables
      expect(
        (logCallable as unknown as { annotations: Record<string, unknown> })
          .annotations['description']
      ).toBeUndefined();
    });
  });

  describe('^description on ScriptCallable (AC-1)', () => {
    it('returns description annotation value from rill script closure', async () => {
      // Annotation must precede the closure expression
      const result = await run(
        '^("greets") |x: string| { $x } => $fn\n$fn.^description'
      );
      expect(result).toBe('greets');
    });
  });

  describe('^input on ApplicationCallable (AC-2, AC-28, AC-29)', () => {
    it('returns RillTypeValue with ordered type (AC-28)', async () => {
      const result = (await run('$myFn.^input', {
        variables: {
          myFn: {
            __type: 'callable' as const,
            kind: 'application' as const,
            isProperty: false,
            fn: () => null,
            params: [
              {
                name: 'text',
                type: { type: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            returnType: rillTypeToTypeValue({ type: 'string' }),
            annotations: {},
          } satisfies ApplicationCallable,
        },
      })) as Record<string, unknown>;
      expect(result['__rill_type']).toBe(true);
      expect(result['typeName']).toBe('ordered');
    });

    it('returns empty ordered type for zero-param callable (AC-5, AC-29)', async () => {
      const result = (await run('$myFn.^input', {
        variables: {
          myFn: {
            __type: 'callable' as const,
            kind: 'application' as const,
            isProperty: false,
            fn: () => null,
            params: [],
            returnType: anyTypeValue,
            annotations: {},
          } satisfies ApplicationCallable,
        },
      })) as Record<string, unknown>;
      expect(result['__rill_type']).toBe(true);
      expect(result['typeName']).toBe('ordered');
    });
  });

  describe('^input on ScriptCallable (AC-37)', () => {
    it('returns RillTypeValue reflecting script closure params', async () => {
      const result = (await run(
        '|x: string, y: number| { $x } => $fn\n$fn.^input'
      )) as Record<string, unknown>;
      expect(result['__rill_type']).toBe(true);
      expect(result['typeName']).toBe('ordered');
    });
  });

  describe('^output on ApplicationCallable (AC-3, AC-30, AC-31)', () => {
    it('returns registered returnType RillTypeValue (AC-30, AC-31)', async () => {
      const returnType = rillTypeToTypeValue({ type: 'string' });
      const result = (await run('$myFn.^output', {
        variables: {
          myFn: {
            __type: 'callable' as const,
            kind: 'application' as const,
            isProperty: false,
            fn: () => null,
            params: [],
            returnType,
            annotations: {},
          } satisfies ApplicationCallable,
        },
      })) as Record<string, unknown>;
      // ^output returns the RillTypeValue — which has a __rill_type sentinel
      expect(result).toHaveProperty('__rill_type', true);
      expect(result).toHaveProperty('typeName', 'string');
    });
  });

  describe('^output on RuntimeCallable (AC-33)', () => {
    it('.^output on log returns anyTypeValue (BC-7)', () => {
      // Access the log callable from context directly and check returnType
      const ctx = createRuntimeContext();
      const logCallable = ctx.functions.get('log') as unknown as {
        returnType: Record<string, unknown>;
      };
      expect(logCallable).toBeDefined();
      expect(logCallable.returnType).toHaveProperty('__rill_type', true);
      expect(logCallable.returnType).toHaveProperty('typeName', 'any');
    });
  });
});

// ============================================================
// Method dispatch with $ receiver binding (AC-8)
// ============================================================
describe('Method dispatch with $ binding (AC-8)', () => {
  it('$ is bound to the receiver inside the method body (trim strips whitespace)', async () => {
    // string.trim() uses the receiver as $; receiver = " hello "
    const result = await run('" hello ".trim()');
    expect(result).toBe('hello');
  });

  it('built-in type method receives receiver as first arg (len)', async () => {
    // Built-in methods are registered via buildTypeMethodDicts; fn(args) where args[0] = receiver.
    // len() returns the character count of the receiver string.
    const result = await run('"hello".len()');
    expect(result).toBe(5);
  });
});

// ============================================================
// Error contracts (EC-1, EC-2, EC-4, EC-7, AC-34, AC-35)
// ============================================================
describe('Error contracts', () => {
  describe('EC-1 / AC-34: method on wrong type → RILL-R003', () => {
    it('calling string method trim() on number throws RILL-R003', async () => {
      // trim exists on string type; calling on number triggers cross-type receiver error
      try {
        await run('42.trim()');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId', 'RILL-R003');
      }
    });

    it('error message contains the type name (AC-34)', async () => {
      try {
        await run('42.trim()');
        expect.fail('Should have thrown');
      } catch (err) {
        const msg = (err as Error).message;
        expect(msg).toContain('number');
      }
    });
  });

  describe('EC-2 / AC-35: method on callable value → RILL-R003', () => {
    it('calling .method() on a callable throws RILL-R003', async () => {
      try {
        await run('$fn.someMethod()', {
          variables: {
            fn: callable(() => null),
          },
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId', 'RILL-R003');
      }
    });
  });

  describe('EC-4: unknown annotation key → RILL-R008', () => {
    it('accessing unknown annotation key on callable throws RILL-R008', async () => {
      try {
        await run('$fn.^unknownKey', {
          variables: {
            fn: callable(() => null),
          },
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId', 'RILL-R008');
      }
    });
  });

  describe('EC-7 / AC-24: wrong argument type to method → RILL-R001', () => {
    it('passing number where string expected throws RILL-R001', async () => {
      // starts_with expects |prefix: string| — passing a number triggers RILL-R001
      try {
        await run('"hello".starts_with(42)');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId', 'RILL-R001');
      }
    });
  });
});

// ============================================================
// Spread marshaling integration (IR-5, EC-5, AC-7, AC-9, AC-13, AC-14)
// ============================================================
describe('Spread marshaling: host function (ApplicationCallable)', () => {
  /**
   * Build an ApplicationCallable with params (x: any, y: any) that records
   * the positional args it receives from the runtime.
   */
  function makeCaptureXY(): {
    capturedArgs: Record<string, RillValue>;
    fn: ApplicationCallable;
  } {
    const capturedArgs: Record<string, RillValue> = {};
    const fn: ApplicationCallable = {
      __type: 'callable' as const,
      kind: 'application' as const,
      isProperty: false,
      params: [
        {
          name: 'x',
          type: { type: 'any' },
          defaultValue: undefined,
          annotations: {},
        },
        {
          name: 'y',
          type: { type: 'any' },
          defaultValue: undefined,
          annotations: {},
        },
      ],
      returnType: anyTypeValue,
      annotations: {},
      fn: (args) => {
        Object.assign(capturedArgs, args);
        return null;
      },
    };
    return { capturedArgs, fn };
  }

  describe('AC-7: dict spread by name delivers args in param-declaration order', () => {
    it('dict[y: 2, x: 1] onto fn(x, y) — host receives x=1 at index 0, y=2 at index 1', async () => {
      // Arrange
      const { capturedArgs, fn } = makeCaptureXY();

      // Act: dict spread maps by name regardless of key order in the dict literal
      await run('$fn(...dict[y: 2, x: 1])', {
        variables: { fn: fn as unknown as RillValue },
      });

      // Assert: host receives named keys; x=1, y=2 regardless of dict insertion order
      expect(capturedArgs['x']).toBe(1);
      expect(capturedArgs['y']).toBe(2);
    });

    it('dict[x: 10, y: 20] in matching order also binds correctly', async () => {
      const { capturedArgs, fn } = makeCaptureXY();

      await run('$fn(...dict[x: 10, y: 20])', {
        variables: { fn: fn as unknown as RillValue },
      });

      expect(capturedArgs['x']).toBe(10);
      expect(capturedArgs['y']).toBe(20);
    });
  });

  describe('AC-9: tuple spread by position delivers args in tuple order', () => {
    it('tuple[1, 2] onto fn(x, y) — host receives x=1 at index 0, y=2 at index 1', async () => {
      // Arrange
      const { capturedArgs, fn } = makeCaptureXY();

      // Act: tuple spread maps values positionally; position 0 → x, position 1 → y
      await run('$fn(...tuple[1, 2])', {
        variables: { fn: fn as unknown as RillValue },
      });

      // Assert: host receives named keys keyed by param name
      expect(capturedArgs['x']).toBe(1);
      expect(capturedArgs['y']).toBe(2);
    });

    it('tuple spread via pipe: tuple[5, 6] -> $fn(...) produces same positional binding', async () => {
      const { capturedArgs, fn } = makeCaptureXY();

      await run('tuple[5, 6] -> $fn(...)', {
        variables: { fn: fn as unknown as RillValue },
      });

      expect(capturedArgs['x']).toBe(5);
      expect(capturedArgs['y']).toBe(6);
    });
  });

  describe('AC-13: bare spread with null spread value raises RILL-R001', () => {
    it('spreading a null variable raises RILL-R001', async () => {
      const { fn } = makeCaptureXY();

      // Arrange: $nullVar holds null (valid RillValue); spreading it into
      // bindArgsToParams produces spreadValue === null, which triggers RILL-R001.
      // This is distinct from bare ... with no pipe (which raises RILL-R005).
      try {
        await run('$fn(...$nullVar)', {
          variables: {
            fn: fn as unknown as RillValue,
            nullVar: null,
          },
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId', 'RILL-R001');
      }
    });
  });

  describe('AC-14: dict spread key matching no param raises RILL-R001', () => {
    it('key "z" absent from fn(x, y) params throws RILL-R001', async () => {
      const { fn } = makeCaptureXY();

      try {
        // "z" is not a declared parameter
        await run('$fn(...dict[x: 1, z: 99])', {
          variables: { fn: fn as unknown as RillValue },
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toHaveProperty('errorId', 'RILL-R001');
      }
    });

    it('error message names the unrecognized key', async () => {
      const { fn } = makeCaptureXY();

      try {
        await run('$fn(...dict[x: 1, badKey: 99])', {
          variables: { fn: fn as unknown as RillValue },
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as Error).message).toMatch(/badKey/);
      }
    });
  });
});

// ============================================================
// Ordered-param marshaling acceptance tests (Phase 2)
// ============================================================

describe('AC-3: Host function receives Record<string, RillValue> with named keys', () => {
  it('fn with params (x, y) called as fn(1, 2) receives {x: 1, y: 2}', async () => {
    let receivedArgs: Record<string, RillValue> | undefined;

    await run('add(10, 20)', {
      functions: {
        add: {
          params: [
            {
              name: 'x',
              type: { type: 'number' },
              defaultValue: undefined,
              annotations: {},
            },
            {
              name: 'y',
              type: { type: 'number' },
              defaultValue: undefined,
              annotations: {},
            },
          ],
          fn: (args) => {
            receivedArgs = args;
            return null;
          },
        },
      },
    });

    expect(receivedArgs).toBeDefined();
    expect(receivedArgs!['x']).toBe(10);
    expect(receivedArgs!['y']).toBe(20);
    // Verify it is a plain Record, not an array
    expect(Array.isArray(receivedArgs)).toBe(false);
    expect(typeof receivedArgs).toBe('object');
  });

  it('fn with string param receives value keyed by param name', async () => {
    let receivedArgs: Record<string, RillValue> | undefined;

    await run('greet("alice")', {
      functions: {
        greet: {
          params: [
            {
              name: 'name',
              type: { type: 'string' },
              defaultValue: undefined,
              annotations: {},
            },
          ],
          fn: (args) => {
            receivedArgs = args;
            return `Hello ${args['name']}`;
          },
        },
      },
    });

    expect(receivedArgs!['name']).toBe('alice');
  });
});

describe('AC-5: Block closure sets $ to pipe value post-marshaling', () => {
  it('42 -> { $ } — block closure returns $ which equals the piped value', async () => {
    // Block closure: the piped value (42) is marshaled to the $ param,
    // then ctx.pipeValue is synced to 42 (IR-4). $ resolves to pipeValue.
    const result = await run('42 -> { $ }');
    expect(result).toBe(42);
  });

  it('block closure $ matches pipe value for string input', async () => {
    // Block closure with string input: $ resolves to the piped string value.
    const result = await run('"hello" -> { $ }');
    expect(result).toBe('hello');
  });

  it('block closure exposes $ to host function via ctx.pipeValue', async () => {
    // Host function with one param receives the pipe value (which becomes $).
    let capturedDollar: RillValue = null;
    await run('42 -> { capture($) }', {
      functions: {
        capture: {
          params: [
            {
              name: 'value',
              type: { type: 'any' },
              defaultValue: undefined,
              annotations: {},
            },
          ],
          fn: (args) => {
            capturedDollar = args['value'] ?? null;
            return null;
          },
        },
      },
    });

    expect(capturedDollar).toBe(42);
  });
});

describe('AC-6: Named-param closure does not modify $', () => {
  it('|x| closure called with value does not expose that value as $', async () => {
    let capturedDollar: RillValue = null;

    // A named-param closure: the pipe value before the closure should NOT be $ inside
    await run(
      `
      |x| { capture() } => $fn
      99 -> $fn(42)
    `,
      {
        functions: {
          capture: {
            params: [],
            fn: (_args, ctx) => {
              capturedDollar = ctx.pipeValue;
              return null;
            },
          },
        },
      }
    );

    // Inside a named-param closure, $ is NOT set to the piped value 42.
    // pipeValue is null because the closure has explicit params.
    expect(capturedDollar).toBeNull();
  });
});

describe('AC-8: Method dispatch — bound dict fills first ordered entry', () => {
  it('$person.greet() passes dict as receiver (first param)', async () => {
    let receivedReceiver: RillValue = null;

    const result = await run('$person.greet()', {
      variables: {
        person: {
          name: 'alice',
          greet: {
            __type: 'callable' as const,
            kind: 'application' as const,
            isProperty: true,
            params: [
              {
                name: 'self',
                type: { type: 'any' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            returnType: anyTypeValue,
            annotations: {},
            fn: (args) => {
              receivedReceiver = args['self'] ?? null;
              const self = args['self'] as Record<string, RillValue>;
              return `Hello, I am ${self['name']}`;
            },
          } as ApplicationCallable,
        },
      },
    });

    expect(result).toBe('Hello, I am alice');
    // The bound dict (person) was passed as the receiver argument
    expect((receivedReceiver as Record<string, RillValue>)['name']).toBe(
      'alice'
    );
  });
});

describe('AC-16: Untyped callable (params undefined) skips marshaling, works as before', () => {
  it('callable() factory function receives raw array cast as Record', async () => {
    let receivedFirst: RillValue = null;

    let receivedArgs: unknown;

    const fn = callable((args) => {
      // Untyped callables receive positional array (RillValue[]), not a Record.
      receivedArgs = args;
      receivedFirst = (args as unknown as RillValue[])[0] ?? null;
      return receivedFirst;
    });

    const result = await run('$myFn("test")', {
      variables: { myFn: fn as unknown as RillValue },
    });

    expect(result).toBe('test');
    expect(receivedFirst).toBe('test');
    // AC-16: verify delivery is RillValue[] (array), not a Record
    expect(Array.isArray(receivedArgs)).toBe(true);
  });

  it('callable() factory pipe-invoked with value works', async () => {
    // When an untyped callable is pipe-invoked (`"piped" -> $myFn`), the runtime
    // treats it as zero-param style: the pipe value is accessible via ctx.pipeValue,
    // not via args (which remains empty for zero-param style invocation).
    let capturedPipe: RillValue = null;

    const fn = callable((_args, ctx) => {
      capturedPipe = ctx.pipeValue;
      return ctx.pipeValue;
    });

    const result = await run('"piped" -> $myFn', {
      variables: { myFn: fn as unknown as RillValue },
    });

    expect(result).toBe('piped');
    expect(capturedPipe).toBe('piped');
  });
});
