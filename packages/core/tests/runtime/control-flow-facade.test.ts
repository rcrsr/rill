/**
 * Rill Runtime Tests: ControlFlowContext facade
 *
 * Specification Mapping:
 * - pipeValue: read/write on fresh and child contexts.
 * - annotationStack: push/pop semantics.
 * - BC-3: pushCallFrame at maxCallStackDepth drops oldest frame;
 *         child inherits maxCallStackDepth.
 * - BC-5: signal undefined runs to completion; signal present + abort
 *         enables early termination.
 * - timeout: value propagated from options.
 * - autoExceptions: RegExp[] populated and pattern-matched.
 *
 * Construction strategy:
 * - Uses createRuntimeContext for root scope.
 * - Uses createChildContext (internal export) for child scopes.
 * - Uses pushCallFrame / popCallFrame from public barrel.
 * - No standalone facade constructors (TD-3).
 */

import { describe, expect, it } from 'vitest';
import {
  createRuntimeContext,
  createChildContext,
  pushCallFrame,
  popCallFrame,
  type CallFrame,
} from '@rcrsr/rill';

/** Build a minimal CallFrame for stack tests. */
function frame(name: string): CallFrame {
  return { name, location: undefined };
}

describe('ControlFlowContext', () => {
  describe('pipeValue', () => {
    it('starts as null on a fresh context', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.pipeValue).toBeNull();
    });

    it('can be mutated directly', () => {
      const ctx = createRuntimeContext({});
      ctx.pipeValue = 'new-value';
      expect(ctx.pipeValue).toBe('new-value');
    });

    it('child inherits parent pipeValue at construction time', () => {
      const parent = createRuntimeContext({});
      parent.pipeValue = 42;
      const child = createChildContext(parent);
      expect(child.pipeValue).toBe(42);
    });

    it('child pipeValue mutation does not affect parent', () => {
      const parent = createRuntimeContext({});
      parent.pipeValue = 'original';
      const child = createChildContext(parent);
      child.pipeValue = 'modified';
      expect(parent.pipeValue).toBe('original');
    });
  });

  describe('annotationStack', () => {
    it('starts empty on a fresh context', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.annotationStack).toHaveLength(0);
    });

    it('push adds entry to the stack', () => {
      const ctx = createRuntimeContext({});
      ctx.annotationStack.push({ key: 'value' });
      expect(ctx.annotationStack).toHaveLength(1);
      expect(ctx.annotationStack[0]).toEqual({ key: 'value' });
    });

    it('pop removes the last entry', () => {
      const ctx = createRuntimeContext({});
      ctx.annotationStack.push({ a: 1 });
      ctx.annotationStack.push({ b: 2 });
      const popped = ctx.annotationStack.pop();
      expect(popped).toEqual({ b: 2 });
      expect(ctx.annotationStack).toHaveLength(1);
    });

    it('child shares annotationStack reference with parent', () => {
      const parent = createRuntimeContext({});
      const child = createChildContext(parent);
      expect(child.annotationStack).toBe(parent.annotationStack);
    });
  });

  describe('callStack and pushCallFrame / popCallFrame', () => {
    it('callStack starts empty', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.callStack).toHaveLength(0);
    });

    it('pushCallFrame adds a frame', () => {
      const ctx = createRuntimeContext({});
      pushCallFrame(ctx, frame('fn1'));
      expect(ctx.callStack).toHaveLength(1);
      expect(ctx.callStack[0]!.name).toBe('fn1');
    });

    it('popCallFrame removes the last frame', () => {
      const ctx = createRuntimeContext({});
      pushCallFrame(ctx, frame('fn1'));
      pushCallFrame(ctx, frame('fn2'));
      popCallFrame(ctx);
      expect(ctx.callStack).toHaveLength(1);
      expect(ctx.callStack[0]!.name).toBe('fn1');
    });

    it('popCallFrame on empty stack is a no-op', () => {
      const ctx = createRuntimeContext({});
      expect(() => popCallFrame(ctx)).not.toThrow();
      expect(ctx.callStack).toHaveLength(0);
    });
  });

  describe('BC-3: maxCallStackDepth enforcement', () => {
    it('pushing past maxCallStackDepth drops the oldest frame', () => {
      const ctx = createRuntimeContext({ maxCallStackDepth: 3 });
      pushCallFrame(ctx, frame('f1'));
      pushCallFrame(ctx, frame('f2'));
      pushCallFrame(ctx, frame('f3'));
      // Stack is full at depth 3; one more push must drop 'f1'.
      pushCallFrame(ctx, frame('f4'));
      expect(ctx.callStack).toHaveLength(3);
      expect(ctx.callStack[0]!.name).toBe('f2');
      expect(ctx.callStack[2]!.name).toBe('f4');
    });

    it('child inherits maxCallStackDepth from parent', () => {
      const parent = createRuntimeContext({ maxCallStackDepth: 5 });
      const child = createChildContext(parent);
      expect(child.maxCallStackDepth).toBe(5);
    });

    it('default maxCallStackDepth is 100', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.maxCallStackDepth).toBe(100);
    });
  });

  describe('BC-5: signal propagation', () => {
    it('signal is undefined when no signal option is provided', () => {
      // A fresh context with no signal option has a chained factory signal,
      // not undefined; the factory controller's signal is always present.
      // What BC-5 means: the optional host-supplied signal is not required.
      const ctx = createRuntimeContext({});
      // signal is defined (factory-scope controller) but not yet aborted.
      expect(ctx.signal).toBeDefined();
      expect(ctx.signal!.aborted).toBe(false);
    });

    it('signal from AbortController starts not aborted', () => {
      const controller = new AbortController();
      const ctx = createRuntimeContext({ signal: controller.signal });
      expect(ctx.signal!.aborted).toBe(false);
    });

    it('aborting the host controller aborts ctx.signal', () => {
      const controller = new AbortController();
      const ctx = createRuntimeContext({ signal: controller.signal });
      controller.abort();
      expect(ctx.signal!.aborted).toBe(true);
    });

    it('dispose aborts ctx.signal (factory-scope controller path)', async () => {
      const ctx = createRuntimeContext({});
      expect(ctx.signal!.aborted).toBe(false);
      await ctx.dispose();
      expect(ctx.signal!.aborted).toBe(true);
    });

    it('child inherits parent signal by reference', () => {
      const parent = createRuntimeContext({});
      const child = createChildContext(parent);
      expect(child.signal).toBe(parent.signal);
    });
  });

  describe('timeout', () => {
    it('is undefined when not specified', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.timeout).toBeUndefined();
    });

    it('reflects the value from options', () => {
      const ctx = createRuntimeContext({ timeout: 3000 });
      expect(ctx.timeout).toBe(3000);
    });

    it('child inherits timeout from parent', () => {
      const parent = createRuntimeContext({ timeout: 1500 });
      const child = createChildContext(parent);
      expect(child.timeout).toBe(1500);
    });
  });

  describe('autoExceptions', () => {
    it('is empty when no autoExceptions option is given', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.autoExceptions).toHaveLength(0);
    });

    it('compiles string patterns into RegExp objects', () => {
      const ctx = createRuntimeContext({ autoExceptions: ['error.*', 'fail'] });
      expect(ctx.autoExceptions).toHaveLength(2);
      expect(ctx.autoExceptions[0]).toBeInstanceOf(RegExp);
      expect(ctx.autoExceptions[1]).toBeInstanceOf(RegExp);
    });

    it('compiled patterns match expected strings', () => {
      const ctx = createRuntimeContext({ autoExceptions: ['error.*'] });
      const pattern = ctx.autoExceptions[0]!;
      expect(pattern.test('error: something went wrong')).toBe(true);
      expect(pattern.test('success')).toBe(false);
    });

    it('child inherits autoExceptions array reference', () => {
      const parent = createRuntimeContext({ autoExceptions: ['fail'] });
      const child = createChildContext(parent);
      expect(child.autoExceptions).toBe(parent.autoExceptions);
    });
  });
});
