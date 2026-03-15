/**
 * Rill Runtime Tests: ExtensionResult Suspend/Restore Type Contract
 * Compile-time type tests for IR-13 and IR-14.
 *
 * Specification Mapping:
 * - IR-13: ExtensionResult.suspend?(): unknown
 * - IR-14: ExtensionResult.restore?(state: unknown): void
 *
 * These tests verify the TypeScript type shape only.
 * No suspend/restore logic is executed.
 *
 * Test Coverage:
 * - IR-13+14: Object with both suspend and restore satisfies ExtensionResult
 * - IR-13:    Object with only suspend satisfies ExtensionResult
 * - IR-14:    Object with only restore satisfies ExtensionResult
 * - IR-13,14: Object without suspend/restore (just dispose) satisfies ExtensionResult
 * - IR-13,14: Object with only function definitions satisfies ExtensionResult
 * - IR-13:    suspend() return type is unknown (not string, not void)
 * - IR-14:    restore(state) parameter type is unknown
 */

import { describe, expectTypeOf, it } from 'vitest';
import type { ExtensionResult } from '../../src/runtime/ext/extensions.js';

describe('Rill Runtime: ExtensionResult Suspend/Restore Type Contract', () => {
  describe('IR-13+14: Object with suspend and restore satisfies ExtensionResult', () => {
    it('accepts an extension with both suspend and restore', () => {
      const ext = {
        greet: {
          params: [{ name: 'name', type: 'string' as const }],
          fn: (_args: unknown[]) => 'hello',
        },
        suspend: () => ({ count: 42 }),
        restore: (_state: unknown) => {},
      } satisfies ExtensionResult;

      // Verify the shape compiles and fields are accessible
      expectTypeOf(ext.suspend).toBeFunction();
      expectTypeOf(ext.restore).toBeFunction();
    });
  });

  describe('IR-13: Object with only suspend satisfies ExtensionResult', () => {
    it('accepts an extension with suspend but no restore', () => {
      const ext = {
        ping: {
          params: [],
          fn: (_args: unknown[]) => 'pong',
        },
        suspend: () => 'snapshot',
      } satisfies ExtensionResult;

      expectTypeOf(ext.suspend).toBeFunction();
    });
  });

  describe('IR-14: Object with only restore satisfies ExtensionResult', () => {
    it('accepts an extension with restore but no suspend', () => {
      const ext = {
        ping: {
          params: [],
          fn: (_args: unknown[]) => 'pong',
        },
        restore: (_state: unknown) => {},
      } satisfies ExtensionResult;

      expectTypeOf(ext.restore).toBeFunction();
    });
  });

  describe('IR-13, IR-14: Object without suspend/restore still satisfies ExtensionResult', () => {
    it('accepts an extension with only dispose (no suspend or restore)', () => {
      const ext = {
        query: {
          params: [{ name: 'sql', type: 'string' as const }],
          fn: (_args: unknown[]) => [],
        },
        dispose: () => {},
      } satisfies ExtensionResult;

      // dispose is defined, suspend/restore are absent — type still satisfied
      expectTypeOf(ext.dispose).toBeFunction();
    });

    it('accepts an extension with only function definitions', () => {
      const ext = {
        add: {
          params: [
            { name: 'a', type: 'number' as const },
            { name: 'b', type: 'number' as const },
          ],
          fn: (args: unknown[]) =>
            (args['a'] as number) + (args['b'] as number),
        },
      } satisfies ExtensionResult;

      expectTypeOf(ext.add).toBeObject();
    });
  });

  describe('IR-13: suspend() return type is unknown', () => {
    it('suspend returns unknown, not a narrowed type', () => {
      const ext = {
        work: {
          params: [],
          fn: (_args: unknown[]) => null,
        },
        suspend: (): unknown => ({ version: 1, data: [1, 2, 3] }),
      } satisfies ExtensionResult;

      // Return type of suspend() must be unknown
      const suspendFn: (() => unknown) | undefined = ext.suspend;
      expectTypeOf(suspendFn!).returns.toBeUnknown();
    });

    it('suspend can return any value because return type is unknown', () => {
      // A function returning string satisfies () => unknown (covariance)
      const suspendReturnsString: () => unknown = () => 'serialized-state';
      // A function returning an object satisfies () => unknown
      const suspendReturnsObject: () => unknown = () => ({ key: 'val' });
      // A function returning undefined satisfies () => unknown
      const suspendReturnsUndefined: () => unknown = () => undefined;

      const extA = {
        op: { params: [], fn: (_args: unknown[]) => null },
        suspend: suspendReturnsString,
      } satisfies ExtensionResult;

      const extB = {
        op: { params: [], fn: (_args: unknown[]) => null },
        suspend: suspendReturnsObject,
      } satisfies ExtensionResult;

      const extC = {
        op: { params: [], fn: (_args: unknown[]) => null },
        suspend: suspendReturnsUndefined,
      } satisfies ExtensionResult;

      // All three satisfy ExtensionResult — compile-time proof
      expectTypeOf(extA.suspend).toBeFunction();
      expectTypeOf(extB.suspend).toBeFunction();
      expectTypeOf(extC.suspend).toBeFunction();
    });
  });

  describe('IR-14: restore(state) parameter type is unknown', () => {
    it('restore accepts unknown as its parameter', () => {
      const ext = {
        work: {
          params: [],
          fn: (_args: unknown[]) => null,
        },
        restore: (_state: unknown): void => {},
      } satisfies ExtensionResult;

      // Parameter type of restore must be unknown
      const restoreFn: ((state: unknown) => void) | undefined = ext.restore;
      expectTypeOf(restoreFn!).parameter(0).toBeUnknown();
    });

    it('restore implementation may narrow the unknown state internally', () => {
      // Narrowing inside the function body is valid; the declared param is unknown
      const ext = {
        counter: {
          params: [],
          fn: (_args: unknown[]) => 0,
        },
        restore: (state: unknown): void => {
          if (typeof state === 'object' && state !== null && 'count' in state) {
            // safe narrowing inside implementation
            void (state as { count: number }).count;
          }
        },
      } satisfies ExtensionResult;

      expectTypeOf(ext.restore!).parameter(0).toBeUnknown();
    });
  });
});
