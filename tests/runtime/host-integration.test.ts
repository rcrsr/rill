/**
 * Rill Runtime Tests: Host Integration
 * Tests for custom functions, call-site location, AbortSignal, and application callables
 */

import {
  AbortError,
  callable,
  createRuntimeContext,
  execute,
  isApplicationCallable,
  isCallable,
  isScriptCallable,
  parse,
  type RillValue,
  type SourceLocation,
} from '../../src/index.js';
import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Host Integration', () => {
  describe('Custom Functions', () => {
    it('registers and calls custom function', async () => {
      const result = await run('shout("hello")', {
        functions: {
          shout: {
            params: [{ name: 'text', type: 'string' }],
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
              { name: 'str', type: 'string' },
              { name: 'count', type: 'number' },
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
            params: [{ name: 'text', type: 'string' }],
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
            params: [{ name: 'url', type: 'string' }],
            fn: async (args) => {
              await new Promise((r) => setTimeout(r, 10));
              return `fetched:${args[0]}`;
            },
          },
        },
      });
      expect(result).toBe('fetched:url');
    });

    it('custom function overrides built-in function', async () => {
      const result = await run('type("hello")', {
        functions: {
          type: {
            params: [{ name: 'value', type: 'string' }],
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
            params: [{ name: 'text', type: 'string' }],
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
            params: [{ name: 'value', type: 'number' }],
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
      // Built-in functions should still work
      const result = await run('"hello" -> type');
      expect(result).toBe('string');
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

      const slowFn: HostFunctionDefinition = {
        params: [{ name: 'input', type: 'string' }],
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

      const countFn: HostFunctionDefinition = {
        params: [{ name: 'item', type: 'number' }],
        fn: (): RillValue => {
          iterations++;
          if (iterations >= 3) {
            controller.abort();
          }
          return iterations;
        },
      };

      await expect(
        run('[1,2,3,4,5,6,7,8,9,10] -> each { count() }', {
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

      const tickFn: HostFunctionDefinition = {
        params: [{ name: 'item', type: 'number' }],
        fn: (): RillValue => {
          iterations++;
          if (iterations >= 3) {
            controller.abort();
          }
          return iterations;
        },
      };

      await expect(
        run('[1, 2, 3, 4, 5] -> each { tick($) }', {
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

      const { createStepper } = await import('../../src/index.js');
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
      expect(isApplicationCallable(result)).toBe(true);
    });

    it('application callable can be invoked after capture', async () => {
      const result = await run('getGreeter() :> $greet -> $greet("World")', {
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

      // Script callable (from Rill source)
      const result = await run('|x| { $x }');
      expect(isCallable(result)).toBe(true);
      expect(isScriptCallable(result)).toBe(true);
      expect(isApplicationCallable(result)).toBe(false);
    });

    it('non-callables return false from type guards', () => {
      expect(isCallable('string')).toBe(false);
      expect(isCallable(42)).toBe(false);
      expect(isCallable([1, 2, 3])).toBe(false);
      expect(isCallable({ key: 'value' })).toBe(false);
      expect(isCallable(null)).toBe(false);
    });
  });
});
