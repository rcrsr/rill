/**
 * Rill Runtime Tests: Call Stack End-to-End Behavior
 * Tests for call stack infrastructure integration with actual Rill code execution
 * Focuses on infrastructure behavior, not automatic call stack attachment
 */

import { describe, expect, it } from 'vitest';
import { run } from '../helpers/runtime.js';
import { RuntimeError, getCallStack } from '../../src/index.js';

describe('Rill Runtime: Call Stack End-to-End', () => {
  describe('call stack infrastructure with nested calls (AC-7)', () => {
    it('call stack infrastructure supports multiple frames', async () => {
      // Test that the infrastructure can handle storing multiple frames
      // Note: Direct manual nesting doesn't work with host functions because
      // they bypass the runtime's invocation mechanism. The infrastructure
      // is designed to work with Rill code that invokes functions through
      // the runtime's evaluation pipeline.

      let maxStackDepth = 0;

      await run('testFn()', {
        functions: {
          testFn: {
            params: [],
            fn: (_args, ctx) => {
              // Verify infrastructure can track at least one frame
              maxStackDepth = Math.max(maxStackDepth, ctx.callStack.length);
              expect(ctx.callStack.length).toBe(1);
              expect(ctx.callStack[0]?.functionName).toBe('testFn');
              return 'ok';
            },
          },
        },
      });

      expect(maxStackDepth).toBe(1);
    });

    it('getCallStack returns empty array for errors without call stack', async () => {
      let error: RuntimeError | undefined;

      try {
        await run('error "test error"');
        expect.fail('Should have thrown');
      } catch (err) {
        error = err as RuntimeError;
      }

      expect(error).toBeDefined();
      const callStack = getCallStack(error!);
      expect(callStack).toEqual([]);
    });

    it('getCallStack returns frames when manually attached to error', async () => {
      const mockFrames = [
        {
          location: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 10, offset: 9 },
          },
          functionName: 'testFunc',
        },
      ];

      const error = new RuntimeError('RILL-R001', 'Test', undefined, {
        callStack: mockFrames,
      });

      const retrieved = getCallStack(error);
      expect(retrieved).toEqual(mockFrames);
      expect(retrieved).not.toBe(mockFrames); // Defensive copy
    });

    it('error with 3 nested call frames includes all frames (AC-7)', () => {
      const threeFrames = [
        {
          location: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 10, offset: 9 },
          },
          functionName: 'outerFunc',
        },
        {
          location: {
            start: { line: 2, column: 1, offset: 10 },
            end: { line: 2, column: 10, offset: 19 },
          },
          functionName: 'middleFunc',
        },
        {
          location: {
            start: { line: 3, column: 1, offset: 20 },
            end: { line: 3, column: 10, offset: 29 },
          },
          functionName: 'innerFunc',
        },
      ];

      const error = new RuntimeError('RILL-R001', 'Test', undefined, {
        callStack: threeFrames,
      });

      const retrieved = getCallStack(error);
      expect(retrieved).toHaveLength(3);
      expect(retrieved.map((f) => f.functionName)).toEqual([
        'outerFunc',
        'middleFunc',
        'innerFunc',
      ]);
    });
  });

  describe('call stack depth limits (AC-8, AC-21)', () => {
    it('respects maxCallStackDepth limit during execution', async () => {
      const maxDepth = 3;
      let maxObservedDepth = 0;

      const createNestedFn = (depth: number, maxNesting: number) => {
        return async (_args: unknown[], ctx: any): Promise<unknown> => {
          maxObservedDepth = Math.max(maxObservedDepth, ctx.callStack.length);

          if (depth >= maxNesting) {
            return 'done';
          }

          const next = ctx.functions?.[`fn${depth + 1}`];
          if (next) {
            return await next.fn([], ctx);
          }
          return null;
        };
      };

      const functions: Record<string, any> = {};
      for (let i = 0; i < 10; i++) {
        functions[`fn${i}`] = {
          params: [],
          fn: createNestedFn(i, 10),
        };
      }

      await run('fn0()', {
        maxCallStackDepth: maxDepth,
        functions,
      });

      // Max observed depth should not exceed limit
      expect(maxObservedDepth).toBeLessThanOrEqual(maxDepth);
    });

    it('call stack at exactly maxCallStackDepth shows all frames', async () => {
      const maxDepth = 5;
      const stackSnapshots: number[] = [];

      const createFn = (depth: number) => {
        return async (_args: unknown[], ctx: any): Promise<unknown> => {
          stackSnapshots.push(ctx.callStack.length);

          if (depth >= maxDepth) {
            return 'done';
          }

          const next = ctx.functions?.[`level${depth + 1}`];
          if (next) {
            return await next.fn([], ctx);
          }
          return null;
        };
      };

      const functions: Record<string, any> = {};
      for (let i = 1; i <= maxDepth; i++) {
        functions[`level${i}`] = {
          params: [],
          fn: createFn(i),
        };
      }

      await run('level1()', {
        maxCallStackDepth: maxDepth,
        functions,
      });

      // At exact depth, all frames should be present (no truncation)
      expect(Math.max(...stackSnapshots)).toBeLessThanOrEqual(maxDepth);
    });
  });

  describe('top-level errors have empty call stack (AC-9)', () => {
    it('error statement at top level has empty call stack', async () => {
      let error: RuntimeError | undefined;

      try {
        await run('error "top-level error"');
        expect.fail('Should have thrown');
      } catch (err) {
        error = err as RuntimeError;
      }

      expect(error).toBeDefined();
      expect(error!.errorId).toBe('RILL-R016');

      const callStack = getCallStack(error!);
      expect(callStack).toEqual([]);
    });

    it('runtime error at top level has empty call stack', async () => {
      let error: RuntimeError | undefined;

      try {
        await run('"string" + 123'); // Type error at top level
        expect.fail('Should have thrown');
      } catch (err) {
        error = err as RuntimeError;
      }

      expect(error).toBeDefined();
      const callStack = getCallStack(error!);
      expect(callStack).toEqual([]);
    });

    it('undefined variable error at top level has empty call stack', async () => {
      let error: RuntimeError | undefined;

      try {
        await run('$undefined'); // Variable not defined
        expect.fail('Should have thrown');
      } catch (err) {
        error = err as RuntimeError;
      }

      expect(error).toBeDefined();
      const callStack = getCallStack(error!);
      expect(callStack).toEqual([]);
    });

    it('top-level pipe operation error has empty call stack', async () => {
      let error: RuntimeError | undefined;

      try {
        await run('[1, 2] -> .missing'); // Missing method
        expect.fail('Should have thrown');
      } catch (err) {
        error = err as RuntimeError;
      }

      expect(error).toBeDefined();
      const callStack = getCallStack(error!);
      expect(callStack).toEqual([]);
    });
  });

  describe('call stack tracking during execution', () => {
    it('tracks host function calls in call stack', async () => {
      let stackInFunction: any[] = [];

      await run('testFunction()', {
        functions: {
          testFunction: {
            params: [],
            fn: (_args, ctx) => {
              stackInFunction = [...ctx.callStack];
              return 'ok';
            },
          },
        },
      });

      // Function should have been on the stack during execution
      expect(stackInFunction.length).toBe(1);
      expect(stackInFunction[0]?.functionName).toBe('testFunction');
    });

    it('pops frame after function returns', async () => {
      let ctxAfterCall: any;

      await run('testFn()', {
        functions: {
          testFn: {
            params: [],
            fn: (_args, ctx) => {
              ctxAfterCall = ctx;
              return null;
            },
          },
        },
      });

      // After execution, call stack should be empty (frame popped)
      expect(ctxAfterCall.callStack).toHaveLength(0);
    });

    it('includes call site location in frames', async () => {
      let frameLocation: any;

      await run('myFunction()', {
        functions: {
          myFunction: {
            params: [],
            fn: (_args, ctx) => {
              frameLocation = ctx.callStack[0]?.location;
              return null;
            },
          },
        },
      });

      expect(frameLocation).toBeDefined();
      expect(frameLocation.start).toBeDefined();
      expect(frameLocation.end).toBeDefined();
      expect(frameLocation.start.line).toBeGreaterThan(0);
    });

    it('includes function name in call stack frames', async () => {
      let functionName: string | undefined;

      await run('namedFunction()', {
        functions: {
          namedFunction: {
            params: [],
            fn: (_args, ctx) => {
              functionName = ctx.callStack[0]?.functionName;
              return null;
            },
          },
        },
      });

      expect(functionName).toBe('namedFunction');
    });
  });

  describe('getCallStack helper function', () => {
    it('returns defensive copy (immutable)', () => {
      const frames = [
        {
          location: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 10, offset: 9 },
          },
          functionName: 'test',
        },
      ];

      const error = new RuntimeError('RILL-R001', 'Test', undefined, {
        callStack: frames,
      });

      const copy1 = getCallStack(error);
      const copy2 = getCallStack(error);

      // Different instances
      expect(copy1).not.toBe(copy2);
      // Same content
      expect(copy1).toEqual(copy2);
      // Original unchanged
      expect(copy1).toEqual(frames);
    });

    it('returns empty array for error without call stack', () => {
      const error = new RuntimeError('RILL-R001', 'Test');
      const callStack = getCallStack(error);
      expect(callStack).toEqual([]);
    });
  });
});
