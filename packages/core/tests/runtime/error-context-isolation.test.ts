/**
 * Rill Runtime Tests: Error context isolation
 *
 * Covers two invariants for host-boundary error enrichment:
 *  - a call-stack snapshot attached to a rewrapped/augmented error must
 *    never leak back onto the original error instance that a host function
 *    threw.
 *  - RillError#withContext returns a distinct instance that preserves the
 *    subclass prototype and leaves the original context untouched.
 */

import { describe, expect, it } from 'vitest';
import { RillError, RuntimeError } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

describe('Rill Runtime: error context isolation', () => {
  describe('call-stack snapshot isolation across the rewrap boundary', () => {
    it('sets callStack on the propagated error without mutating the original thrown error', async () => {
      let original: RuntimeError | undefined;
      let caught: unknown;

      try {
        // failFn throws a RuntimeError with no location, which forces the
        // closures.ts extension-dispatch boundary to rewrap it with a fresh
        // instance before the call-stack snapshot is attached higher up in
        // callable-strategy.ts.
        await run('failFn()', {
          functions: {
            failFn: {
              params: [],
              fn: () => {
                const e = new RuntimeError('RILL-R001', 'Test error');
                original = e;
                throw e;
              },
            },
          },
        });
        expect.fail('Expected run() to reject');
      } catch (e) {
        caught = e;
      }

      expect(original).toBeInstanceOf(RuntimeError);
      expect(caught).toBeInstanceOf(RillError);

      // The propagated (enriched) error carries the call-stack snapshot...
      const enrichedContext = (caught as RillError).context;
      const enrichedCallStack = enrichedContext?.['callStack'];
      expect(enrichedCallStack).toBeDefined();
      expect(
        Array.isArray(enrichedCallStack) ? enrichedCallStack.length : 0
      ).toBeGreaterThan(0);

      // ...but the original error thrown by the host function stays
      // untouched: no callStack was ever written onto it.
      expect(original?.context?.['callStack']).toBeUndefined();

      // The propagated error is not the same object as the original.
      expect(caught).not.toBe(original);

      // The rewrap preserves the original error message; it does not go
      // missing when the error is cloned via withContext.
      expect((caught as RillError).message).toBe(original?.message);
    });
  });

  describe('RillError#withContext', () => {
    it('returns a distinct instance, preserves the subclass prototype, and leaves the original context untouched', () => {
      const original = new RuntimeError('RILL-R001', 'Base error', undefined, {
        existing: 'value',
      });

      const augmented = original.withContext({ callStack: ['frame-a'] });

      // Distinct object.
      expect(augmented).not.toBe(original);

      // Subclass identity preserved.
      expect(augmented).toBeInstanceOf(RuntimeError);
      expect(Object.getPrototypeOf(augmented)).toBe(
        Object.getPrototypeOf(original)
      );

      // Original untouched.
      expect(original.context).toEqual({ existing: 'value' });

      // Merged patch present on the new instance, alongside the prior
      // context entries.
      expect(augmented.context).toEqual({
        existing: 'value',
        callStack: ['frame-a'],
      });

      // The original error message survives the clone: `message` is a
      // non-enumerable own property on Error instances and must be copied
      // explicitly rather than relying on Object.assign.
      expect(augmented.message).toBe(original.message);

      // `stack` is backed by a V8 accessor that closes over the original
      // instance; the clone must carry a formatted own-property stack
      // rather than inheriting an accessor that resolves to undefined.
      expect(typeof augmented.stack).toBe('string');
      expect(augmented.stack).not.toHaveLength(0);
    });

    it('does not share the context object reference with the original', () => {
      const original = new RuntimeError('RILL-R001', 'Base error', undefined, {
        existing: 'value',
      });

      const augmented = original.withContext({ callStack: ['frame-a'] });

      expect(augmented.context).not.toBe(original.context);
    });
  });
});
