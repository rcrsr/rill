/**
 * Rill Runtime Tests: Observability
 * Tests for event callbacks
 */

import { AutoExceptionError, TimeoutError } from '../src/index.js';
import { describe, expect, it } from 'vitest';

import { createEventCollector, mockAsyncFn, run } from './helpers/runtime.js';

describe('Rill Runtime: Observability', () => {
  describe('onStepStart', () => {
    it('fires before each step', async () => {
      const { events, callbacks } = createEventCollector();
      await run('"a"\n"b"\n"c"', { observability: callbacks });

      expect(events.stepStart).toHaveLength(3);
    });

    it('includes correct index and total', async () => {
      const { events, callbacks } = createEventCollector();
      await run('"a"\n"b"', { observability: callbacks });

      expect(events.stepStart[0]).toMatchObject({ index: 0, total: 2 });
      expect(events.stepStart[1]).toMatchObject({ index: 1, total: 2 });
    });

    it('includes current pipeValue', async () => {
      // With scope isolation, $ doesn't propagate between sibling statements
      // Both statements see the initial $ (null unless host provides a value)
      const { events, callbacks } = createEventCollector();
      await run('"first"\n"second"', { observability: callbacks });

      expect(events.stepStart[0]?.pipeValue).toBe(null);
      expect(events.stepStart[1]?.pipeValue).toBe(null); // Was 'first' before scope isolation
    });
  });

  describe('onStepEnd', () => {
    it('fires after each step', async () => {
      const { events, callbacks } = createEventCollector();
      await run('"a"\n"b"\n"c"', { observability: callbacks });

      expect(events.stepEnd).toHaveLength(3);
    });

    it('includes correct index and total', async () => {
      const { events, callbacks } = createEventCollector();
      await run('"a"\n"b"', { observability: callbacks });

      expect(events.stepEnd[0]).toMatchObject({ index: 0, total: 2 });
      expect(events.stepEnd[1]).toMatchObject({ index: 1, total: 2 });
    });

    it('includes step value', async () => {
      const { events, callbacks } = createEventCollector();
      await run('"first"\n"second"', { observability: callbacks });

      expect(events.stepEnd[0]?.value).toBe('first');
      expect(events.stepEnd[1]?.value).toBe('second');
    });

    it('includes durationMs', async () => {
      const { events, callbacks } = createEventCollector();
      await run('"test"', { observability: callbacks });

      expect(events.stepEnd[0]?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('fires in correct order relative to onStepStart', async () => {
      const order: string[] = [];
      await run('"test"', {
        observability: {
          onStepStart: () => order.push('start'),
          onStepEnd: () => order.push('end'),
        },
      });

      expect(order).toEqual(['start', 'end']);
    });
  });

  describe('onHostCall', () => {
    it('fires before function execution', async () => {
      const { events, callbacks } = createEventCollector();
      await run('"test" -> identity', { observability: callbacks });

      expect(events.hostCall).toHaveLength(1);
      expect(events.hostCall[0]?.name).toBe('identity');
    });

    it('includes function arguments', async () => {
      const { events, callbacks } = createEventCollector();
      await run('identity(["a", "b"])', { observability: callbacks });

      expect(events.hostCall[0]?.name).toBe('identity');
      expect(events.hostCall[0]?.args).toEqual([['a', 'b']]);
    });

    it('fires for each function call', async () => {
      const { events, callbacks } = createEventCollector();
      await run('"x" -> identity -> identity -> identity', {
        observability: callbacks,
      });

      expect(events.hostCall).toHaveLength(3);
      expect(events.hostCall.every((e) => e.name === 'identity')).toBe(true);
    });

    it('fires for chained function calls', async () => {
      const { events, callbacks } = createEventCollector();
      await run('"x" -> identity -> identity', { observability: callbacks });

      expect(events.hostCall).toHaveLength(2);
      expect(events.hostCall.every((e) => e.name === 'identity')).toBe(true);
    });
  });

  describe('onFunctionReturn', () => {
    it('fires after function execution', async () => {
      const { events, callbacks } = createEventCollector();
      await run('"test" -> identity', { observability: callbacks });

      expect(events.functionReturn).toHaveLength(1);
      expect(events.functionReturn[0]?.name).toBe('identity');
    });

    it('includes return value', async () => {
      const { events, callbacks } = createEventCollector();
      await run('"hello" -> identity', { observability: callbacks });

      expect(events.functionReturn[0]?.value).toBe('hello');
    });

    it('includes durationMs', async () => {
      const { events, callbacks } = createEventCollector();
      await run('"test" -> identity', { observability: callbacks });

      expect(events.functionReturn[0]?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('measures async function duration', async () => {
      const slowFn = mockAsyncFn(50, 'done');
      const { events, callbacks } = createEventCollector();
      await run('"x" -> slowFn', {
        functions: { slowFn },
        observability: callbacks,
      });

      expect(events.functionReturn[0]?.durationMs).toBeGreaterThanOrEqual(40);
    });

    it('fires in correct order relative to onHostCall', async () => {
      const order: string[] = [];
      await run('"test" -> identity', {
        observability: {
          onHostCall: () => order.push('call'),
          onFunctionReturn: () => order.push('return'),
        },
      });

      expect(order).toEqual(['call', 'return']);
    });
  });

  describe('onCapture', () => {
    it('fires when variable is captured', async () => {
      const { events, callbacks } = createEventCollector();
      await run('"value" :> $myVar', { observability: callbacks });

      expect(events.capture).toHaveLength(1);
      expect(events.capture[0]).toEqual({ name: 'myVar', value: 'value' });
    });

    it('fires for each capture', async () => {
      const { events, callbacks } = createEventCollector();
      await run('"a" :> $x\n"b" :> $y\n"c" :> $z', {
        observability: callbacks,
      });

      expect(events.capture).toHaveLength(3);
      expect(events.capture.map((e) => e.name)).toEqual(['x', 'y', 'z']);
    });

    it('fires for captures in nested blocks', async () => {
      const { events, callbacks } = createEventCollector();
      await run('true -> ? { "inner" :> $nested }', {
        observability: callbacks,
      });

      expect(events.capture).toHaveLength(1);
      expect(events.capture[0]?.name).toBe('nested');
    });

    it('does not fire when no capture', async () => {
      const { events, callbacks } = createEventCollector();
      await run('"no capture here"', { observability: callbacks });

      expect(events.capture).toHaveLength(0);
    });
  });

  describe('onError', () => {
    it('fires on runtime error', async () => {
      const { events, callbacks } = createEventCollector();

      try {
        await run('unknownFn()', { observability: callbacks });
      } catch {
        // Expected
      }

      expect(events.error).toHaveLength(1);
      expect(events.error[0]?.error.message).toContain('Unknown function');
    });

    it('includes step index', async () => {
      const { events, callbacks } = createEventCollector();

      try {
        await run('"ok"\nunknownFn()', { observability: callbacks });
      } catch {
        // Expected
      }

      expect(events.error[0]?.index).toBe(1);
    });

    it('fires on AutoExceptionError', async () => {
      const { events, callbacks } = createEventCollector();

      try {
        await run('"ERROR: test"', {
          observability: callbacks,
          autoExceptions: ['ERROR'],
        });
      } catch {
        // Expected
      }

      expect(events.error).toHaveLength(1);
      expect(events.error[0]?.error).toBeInstanceOf(AutoExceptionError);
    });

    it('fires on TimeoutError', async () => {
      const slowFn = mockAsyncFn(200, 'done');
      const { events, callbacks } = createEventCollector();

      try {
        await run('"x" -> slowFn', {
          functions: { slowFn },
          timeout: 50,
          observability: callbacks,
        });
      } catch {
        // Expected
      }

      expect(events.error).toHaveLength(1);
      expect(events.error[0]?.error).toBeInstanceOf(TimeoutError);
    });
  });

  describe('Combined Events', () => {
    it('fires events in correct order for complex script', async () => {
      const order: string[] = [];
      await run('"start" :> $x\n"end" -> identity', {
        observability: {
          onStepStart: (e) => order.push(`stepStart:${e.index}`),
          onStepEnd: (e) => order.push(`stepEnd:${e.index}`),
          onHostCall: (e) => order.push(`call:${e.name}`),
          onFunctionReturn: (e) => order.push(`return:${e.name}`),
          onCapture: (e) => order.push(`capture:${e.name}`),
        },
      });

      expect(order).toEqual([
        'stepStart:0',
        'capture:x',
        'stepEnd:0',
        'stepStart:1',
        'call:identity',
        'return:identity',
        'stepEnd:1',
      ]);
    });
  });
});
