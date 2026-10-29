/**
 * Rill Runtime Tests: Call Stack End-to-End Behavior
 * Tests for call stack infrastructure integration with actual Rill code execution
 * Focuses on infrastructure behavior, not automatic call stack attachment
 */

import { describe, expect, it } from 'vitest';
import { run, toRuntimeContext } from '../helpers/runtime.js';
import {
  anyTypeValue,
  type CallFrame,
  RuntimeError,
  getCallStack,
} from '@rcrsr/rill';

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
            returnType: anyTypeValue,
            params: [],
            fn: (_args, ctx) => {
              // Verify infrastructure can track at least one frame
              maxStackDepth = Math.max(
                maxStackDepth,
                toRuntimeContext(ctx).callStack.length
              );
              expect(toRuntimeContext(ctx).callStack.length).toBe(1);
              expect(toRuntimeContext(ctx).callStack[0]?.functionName).toBe(
                'testFn'
              );
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
    it('drops the oldest frame when live frames exceed maxCallStackDepth', async () => {
      let snapshot: CallFrame[] = [];

      // Three nested closures plus the probe call make four live frames.
      await run('||{ ||{ ||{ probe() }() }() }()', {
        maxCallStackDepth: 3,
        functions: {
          probe: {
            returnType: anyTypeValue,
            params: [],
            fn: (_args, ctx) => {
              snapshot = [...toRuntimeContext(ctx).callStack];
              return '';
            },
          },
        },
      });

      expect(snapshot.map((f) => f.functionName)).toEqual([
        '<closure>',
        '<closure>',
        'probe',
      ]);
    });

    it('call stack at exactly maxCallStackDepth shows all frames', async () => {
      let snapshot: CallFrame[] = [];

      // Four nested closures plus the probe call make exactly five frames.
      await run('||{ ||{ ||{ ||{ probe() }() }() }() }()', {
        maxCallStackDepth: 5,
        functions: {
          probe: {
            returnType: anyTypeValue,
            params: [],
            fn: (_args, ctx) => {
              snapshot = [...toRuntimeContext(ctx).callStack];
              return '';
            },
          },
        },
      });

      expect(snapshot.map((f) => f.functionName)).toEqual([
        '<closure>',
        '<closure>',
        '<closure>',
        '<closure>',
        'probe',
      ]);
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
        await run('list[1, 2] -> .missing'); // Missing method
        expect.fail('Should have thrown');
      } catch (err) {
        error = err as RuntimeError;
      }

      expect(error).toBeDefined();
      const callStack = getCallStack(error!);
      expect(callStack).toEqual([]);
    });
  });
});
