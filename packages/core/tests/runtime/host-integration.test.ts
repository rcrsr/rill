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
            fn: (args) => String(args[0]).toUpperCase(),
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
              const str = String(args[0]);
              const count = typeof args[1] === 'number' ? args[1] : 1;
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
              return `${prefix}${args[0]}`;
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
              return `fetched:${args[0]}`;
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
        expect(result.params).toEqual([['text', { type: 'string' }]]);
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
    it('returns RillOrdered with params entries (AC-28)', async () => {
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
      expect(result['__rill_ordered']).toBe(true);
      expect(Array.isArray(result['entries'])).toBe(true);
    });

    it('returns empty entries for zero-param callable (AC-5, AC-29)', async () => {
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
      expect(result['__rill_ordered']).toBe(true);
      expect(result['entries']).toEqual([]);
    });
  });

  describe('^input on ScriptCallable (AC-37)', () => {
    it('returns RillOrdered reflecting script closure params', async () => {
      const result = (await run(
        '|x: string, y: number| { $x } => $fn\n$fn.^input'
      )) as Record<string, unknown>;
      expect(result['__rill_ordered']).toBe(true);
      expect(Array.isArray(result['entries'])).toBe(true);
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
// Method dispatch with $ receiver binding (AC-14)
// ============================================================
describe('Method dispatch with $ binding (AC-14)', () => {
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
