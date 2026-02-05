/**
 * Rill Runtime Tests: Call Stack Management
 * Tests for call stack initialization, push/pop operations, and extraction from errors
 */

import {
  createRuntimeContext,
  RuntimeError,
  type CallFrame,
  getCallStack,
  pushCallFrame,
  popCallFrame,
} from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

describe('Rill Runtime: Call Stack Management', () => {
  describe('RuntimeContext.callStack field', () => {
    it('initializes callStack to empty array (IC-8)', () => {
      const ctx = createRuntimeContext();
      expect(ctx.callStack).toEqual([]);
      expect(Array.isArray(ctx.callStack)).toBe(true);
    });

    it('callStack field exists (IC-7)', () => {
      const ctx = createRuntimeContext();
      expect('callStack' in ctx).toBe(true);
    });

    it('initializes maxCallStackDepth to 100 by default', () => {
      const ctx = createRuntimeContext();
      expect(ctx.maxCallStackDepth).toBe(100);
    });

    it('accepts custom maxCallStackDepth option', () => {
      const ctx = createRuntimeContext({ maxCallStackDepth: 50 });
      expect(ctx.maxCallStackDepth).toBe(50);
    });
  });

  describe('getCallStack', () => {
    it('returns call stack from RillError (IR-1)', () => {
      const frames: CallFrame[] = [
        {
          location: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 10, offset: 9 },
            source: 'test.rill',
          },
          functionName: 'testFunc',
        },
      ];

      const error = new RuntimeError('RILL-R001', 'Test error', undefined, {
        callStack: frames,
      });

      const result = getCallStack(error);
      expect(result).toEqual(frames);
    });

    it('returns empty array when no call stack in error (IR-1)', () => {
      const error = new RuntimeError('RILL-R001', 'Test error', undefined);
      const result = getCallStack(error);
      expect(result).toEqual([]);
    });

    it('returns defensive copy (immutable)', () => {
      const frames: CallFrame[] = [
        {
          location: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 10, offset: 9 },
            source: 'test.rill',
          },
          functionName: 'testFunc',
        },
      ];

      const error = new RuntimeError('RILL-R001', 'Test error', undefined, {
        callStack: frames,
      });

      const result1 = getCallStack(error);
      const result2 = getCallStack(error);

      // Different array instances
      expect(result1).not.toBe(result2);
      // But same content
      expect(result1).toEqual(result2);
    });

    it('throws TypeError for non-RillError (EC-1)', () => {
      const regularError = new Error('Regular error');
      expect(() => getCallStack(regularError as never)).toThrow(TypeError);
      expect(() => getCallStack(regularError as never)).toThrow(
        'Expected RillError instance'
      );
    });

    it('throws TypeError for null (EC-1)', () => {
      expect(() => getCallStack(null as never)).toThrow(TypeError);
      expect(() => getCallStack(null as never)).toThrow(
        'Expected RillError instance'
      );
    });

    it('throws TypeError for undefined (EC-1)', () => {
      expect(() => getCallStack(undefined as never)).toThrow(TypeError);
      expect(() => getCallStack(undefined as never)).toThrow(
        'Expected RillError instance'
      );
    });

    it('throws TypeError for plain object (EC-1)', () => {
      const obj = { errorId: 'RILL-R001', message: 'test' };
      expect(() => getCallStack(obj as never)).toThrow(TypeError);
      expect(() => getCallStack(obj as never)).toThrow(
        'Expected RillError instance'
      );
    });
  });

  describe('pushCallFrame', () => {
    it('adds frame to call stack (IR-2)', () => {
      const ctx = createRuntimeContext();
      const frame: CallFrame = {
        location: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 10, offset: 9 },
          source: 'test.rill',
        },
        functionName: 'testFunc',
      };

      pushCallFrame(ctx, frame);

      expect(ctx.callStack).toHaveLength(1);
      expect(ctx.callStack[0]).toBe(frame);
    });

    it('pushes multiple frames in order (IR-2)', () => {
      const ctx = createRuntimeContext();
      const frame1: CallFrame = {
        location: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 10, offset: 9 },
          source: 'test.rill',
        },
        functionName: 'func1',
      };
      const frame2: CallFrame = {
        location: {
          start: { line: 2, column: 1, offset: 10 },
          end: { line: 2, column: 10, offset: 19 },
          source: 'test.rill',
        },
        functionName: 'func2',
      };

      pushCallFrame(ctx, frame1);
      pushCallFrame(ctx, frame2);

      expect(ctx.callStack).toHaveLength(2);
      expect(ctx.callStack[0]).toBe(frame1);
      expect(ctx.callStack[1]).toBe(frame2);
    });

    it('respects maxCallStackDepth limit (IR-2)', () => {
      const ctx = createRuntimeContext({ maxCallStackDepth: 3 });

      for (let i = 0; i < 5; i++) {
        pushCallFrame(ctx, {
          location: {
            start: { line: i, column: 1, offset: i * 10 },
            end: { line: i, column: 10, offset: i * 10 + 9 },
            source: 'test.rill',
          },
          functionName: `func${i}`,
        });
      }

      // Should only keep last 3 frames
      expect(ctx.callStack).toHaveLength(3);
      expect(ctx.callStack[0]?.functionName).toBe('func2');
      expect(ctx.callStack[1]?.functionName).toBe('func3');
      expect(ctx.callStack[2]?.functionName).toBe('func4');
    });

    it('drops older frames when limit exceeded (IR-2)', () => {
      const ctx = createRuntimeContext({ maxCallStackDepth: 2 });

      const frame1: CallFrame = {
        location: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 10, offset: 9 },
          source: 'test.rill',
        },
        functionName: 'oldest',
      };
      const frame2: CallFrame = {
        location: {
          start: { line: 2, column: 1, offset: 10 },
          end: { line: 2, column: 10, offset: 19 },
          source: 'test.rill',
        },
        functionName: 'middle',
      };
      const frame3: CallFrame = {
        location: {
          start: { line: 3, column: 1, offset: 20 },
          end: { line: 3, column: 10, offset: 29 },
          source: 'test.rill',
        },
        functionName: 'newest',
      };

      pushCallFrame(ctx, frame1);
      pushCallFrame(ctx, frame2);
      expect(ctx.callStack).toHaveLength(2);

      pushCallFrame(ctx, frame3);
      expect(ctx.callStack).toHaveLength(2);
      expect(ctx.callStack[0]?.functionName).toBe('middle');
      expect(ctx.callStack[1]?.functionName).toBe('newest');
    });
  });

  describe('popCallFrame', () => {
    it('removes frame from call stack (IR-3)', () => {
      const ctx = createRuntimeContext();
      const frame: CallFrame = {
        location: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 10, offset: 9 },
          source: 'test.rill',
        },
        functionName: 'testFunc',
      };

      pushCallFrame(ctx, frame);
      expect(ctx.callStack).toHaveLength(1);

      popCallFrame(ctx);
      expect(ctx.callStack).toHaveLength(0);
    });

    it('pops in LIFO order', () => {
      const ctx = createRuntimeContext();
      const frame1: CallFrame = {
        location: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 10, offset: 9 },
          source: 'test.rill',
        },
        functionName: 'func1',
      };
      const frame2: CallFrame = {
        location: {
          start: { line: 2, column: 1, offset: 10 },
          end: { line: 2, column: 10, offset: 19 },
          source: 'test.rill',
        },
        functionName: 'func2',
      };

      pushCallFrame(ctx, frame1);
      pushCallFrame(ctx, frame2);

      popCallFrame(ctx);
      expect(ctx.callStack).toHaveLength(1);
      expect(ctx.callStack[0]?.functionName).toBe('func1');

      popCallFrame(ctx);
      expect(ctx.callStack).toHaveLength(0);
    });

    it('is no-op on empty stack (EC-2)', () => {
      const ctx = createRuntimeContext();
      expect(ctx.callStack).toHaveLength(0);

      // Should not throw
      popCallFrame(ctx);
      expect(ctx.callStack).toHaveLength(0);

      // Multiple pops should be fine
      popCallFrame(ctx);
      popCallFrame(ctx);
      expect(ctx.callStack).toHaveLength(0);
    });
  });

  describe('integration', () => {
    it('maintains correct stack across push/pop operations', () => {
      const ctx = createRuntimeContext();

      const frame1: CallFrame = {
        location: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 10, offset: 9 },
          source: 'test.rill',
        },
        functionName: 'main',
      };
      const frame2: CallFrame = {
        location: {
          start: { line: 5, column: 1, offset: 50 },
          end: { line: 5, column: 10, offset: 59 },
          source: 'test.rill',
        },
        functionName: 'helper',
      };
      const frame3: CallFrame = {
        location: {
          start: { line: 10, column: 1, offset: 100 },
          end: { line: 10, column: 10, offset: 109 },
          source: 'test.rill',
        },
        functionName: 'nested',
      };

      // main
      pushCallFrame(ctx, frame1);
      expect(ctx.callStack.map((f) => f.functionName)).toEqual(['main']);

      // main -> helper
      pushCallFrame(ctx, frame2);
      expect(ctx.callStack.map((f) => f.functionName)).toEqual([
        'main',
        'helper',
      ]);

      // main -> helper -> nested
      pushCallFrame(ctx, frame3);
      expect(ctx.callStack.map((f) => f.functionName)).toEqual([
        'main',
        'helper',
        'nested',
      ]);

      // main -> helper (nested returns)
      popCallFrame(ctx);
      expect(ctx.callStack.map((f) => f.functionName)).toEqual([
        'main',
        'helper',
      ]);

      // main (helper returns)
      popCallFrame(ctx);
      expect(ctx.callStack.map((f) => f.functionName)).toEqual(['main']);

      // (main returns)
      popCallFrame(ctx);
      expect(ctx.callStack).toHaveLength(0);
    });
  });
});
