/**
 * Test call stack exports from src/index.ts
 */

import { describe, it, expect } from 'vitest';
import {
  type CallFrame,
  getCallStack,
  pushCallFrame,
  popCallFrame,
  createRuntimeContext,
} from '@rcrsr/rill';
import { RuntimeError } from '@rcrsr/rill';

describe('Call Stack Exports', () => {
  describe('CallFrame type', () => {
    it('is exported and can be used for type annotations', () => {
      const frame: CallFrame = {
        location: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 5, offset: 4 },
        },
        functionName: 'test_function',
        context: 'test context',
      };

      expect(frame.functionName).toBe('test_function');
      expect(frame.context).toBe('test context');
    });
  });

  describe('getCallStack', () => {
    it('is exported from src/index.ts', () => {
      expect(typeof getCallStack).toBe('function');
    });

    it('returns empty array for error without call stack', () => {
      const error = new RuntimeError('RILL-R001', 'Test error', undefined);
      const callStack = getCallStack(error);
      expect(callStack).toEqual([]);
    });

    it('returns call stack from error context', () => {
      const frame: CallFrame = {
        location: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 5, offset: 4 },
        },
        functionName: 'test_fn',
      };

      const error = new RuntimeError('RILL-R001', 'Test error', undefined, {
        callStack: [frame],
      });

      const callStack = getCallStack(error);
      expect(callStack).toHaveLength(1);
      expect(callStack[0]?.functionName).toBe('test_fn');
    });
  });

  describe('pushCallFrame', () => {
    it('is exported from src/index.ts', () => {
      expect(typeof pushCallFrame).toBe('function');
    });

    it('adds frame to context call stack', () => {
      const ctx = createRuntimeContext();
      const frame: CallFrame = {
        location: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 5, offset: 4 },
        },
        functionName: 'test',
      };

      pushCallFrame(ctx, frame);
      expect(ctx.callStack).toHaveLength(1);
      expect(ctx.callStack[0]).toBe(frame);
    });
  });

  describe('popCallFrame', () => {
    it('is exported from src/index.ts', () => {
      expect(typeof popCallFrame).toBe('function');
    });

    it('removes frame from context call stack', () => {
      const ctx = createRuntimeContext();
      const frame: CallFrame = {
        location: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 5, offset: 4 },
        },
        functionName: 'test',
      };

      pushCallFrame(ctx, frame);
      expect(ctx.callStack).toHaveLength(1);

      popCallFrame(ctx);
      expect(ctx.callStack).toHaveLength(0);
    });

    it('is no-op on empty call stack', () => {
      const ctx = createRuntimeContext();
      expect(ctx.callStack).toHaveLength(0);

      popCallFrame(ctx);
      expect(ctx.callStack).toHaveLength(0);
    });
  });
});
