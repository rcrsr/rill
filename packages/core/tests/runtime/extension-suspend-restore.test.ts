/**
 * Rill Runtime Tests: ExtensionFactoryResult Suspend/Restore Type Contract
 * Compile-time type tests for IR-13 and IR-14.
 *
 * Specification Mapping:
 * - IR-13: ExtensionFactoryResult.suspend?(): unknown
 * - IR-14: ExtensionFactoryResult.restore?(state: unknown): void
 *
 * These tests verify the TypeScript type shape only.
 * No suspend/restore logic is executed.
 *
 * Test Coverage:
 * - IR-13+14: Object with both suspend and restore satisfies ExtensionFactoryResult
 * - IR-13:    Object with only suspend satisfies ExtensionFactoryResult
 * - IR-14:    Object with only restore satisfies ExtensionFactoryResult
 * - IR-13,14: Object without suspend/restore (just dispose) satisfies ExtensionFactoryResult
 * - IR-13,14: Object with only value satisfies ExtensionFactoryResult
 * - IR-13:    suspend() return type is unknown (not string, not void)
 * - IR-14:    restore(state) parameter type is unknown
 */

import { describe, expectTypeOf, it } from 'vitest';
import type { ExtensionFactoryResult } from '../../src/runtime/ext/extensions.js';

describe('Rill Runtime: ExtensionFactoryResult Suspend/Restore Type Contract', () => {
  describe('IR-13+14: Object with suspend and restore satisfies ExtensionFactoryResult', () => {
    it('accepts an extension with both suspend and restore', () => {
      const ext = {
        value: {
          greet: {
            params: [{ name: 'name', type: 'string' as const }],
            fn: (_args: unknown[]) => 'hello',
          },
        },
        suspend: () => ({ count: 42 }),
        restore: (_state: unknown) => {},
      } satisfies ExtensionFactoryResult;

      // Verify the shape compiles and fields are accessible
      expectTypeOf(ext.suspend).toBeFunction();
      expectTypeOf(ext.restore).toBeFunction();
    });
  });

  describe('IR-13: Object with only suspend satisfies ExtensionFactoryResult', () => {
    it('accepts an extension with suspend but no restore', () => {
      const ext = {
        value: {
          ping: {
            params: [],
            fn: (_args: unknown[]) => 'pong',
          },
        },
        suspend: () => 'snapshot',
      } satisfies ExtensionFactoryResult;

      expectTypeOf(ext.suspend).toBeFunction();
    });
  });

  describe('IR-14: Object with only restore satisfies ExtensionFactoryResult', () => {
    it('accepts an extension with restore but no suspend', () => {
      const ext = {
        value: {
          ping: {
            params: [],
            fn: (_args: unknown[]) => 'pong',
          },
        },
        restore: (_state: unknown) => {},
      } satisfies ExtensionFactoryResult;

      expectTypeOf(ext.restore).toBeFunction();
    });
  });

  describe('IR-13, IR-14: Object without suspend/restore still satisfies ExtensionFactoryResult', () => {
    it('accepts an extension with only dispose (no suspend or restore)', () => {
      const ext = {
        value: {
          query: {
            params: [{ name: 'sql', type: 'string' as const }],
            fn: (_args: unknown[]) => [],
          },
        },
        dispose: () => {},
      } satisfies ExtensionFactoryResult;

      // dispose is defined, suspend/restore are absent -- type still satisfied
      expectTypeOf(ext.dispose).toBeFunction();
    });

    it('accepts an extension with only value', () => {
      const ext = {
        value: {
          add: {
            params: [
              { name: 'a', type: 'number' as const },
              { name: 'b', type: 'number' as const },
            ],
            fn: (args: unknown[]) =>
              (args['a'] as number) + (args['b'] as number),
          },
        },
      } satisfies ExtensionFactoryResult;

      expectTypeOf(ext.value).toBeObject();
    });
  });

  describe('IR-13: suspend() return type is unknown', () => {
    it('suspend returns unknown, not a narrowed type', () => {
      const ext = {
        value: {
          work: {
            params: [],
            fn: (_args: unknown[]) => null,
          },
        },
        suspend: (): unknown => ({ version: 1, data: [1, 2, 3] }),
      } satisfies ExtensionFactoryResult;

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
        value: { op: { params: [], fn: (_args: unknown[]) => null } },
        suspend: suspendReturnsString,
      } satisfies ExtensionFactoryResult;

      const extB = {
        value: { op: { params: [], fn: (_args: unknown[]) => null } },
        suspend: suspendReturnsObject,
      } satisfies ExtensionFactoryResult;

      const extC = {
        value: { op: { params: [], fn: (_args: unknown[]) => null } },
        suspend: suspendReturnsUndefined,
      } satisfies ExtensionFactoryResult;

      // All three satisfy ExtensionFactoryResult -- compile-time proof
      expectTypeOf(extA.suspend).toBeFunction();
      expectTypeOf(extB.suspend).toBeFunction();
      expectTypeOf(extC.suspend).toBeFunction();
    });
  });

  describe('IR-14: restore(state) parameter type is unknown', () => {
    it('restore accepts unknown as its parameter', () => {
      const ext = {
        value: {
          work: {
            params: [],
            fn: (_args: unknown[]) => null,
          },
        },
        restore: (_state: unknown): void => {},
      } satisfies ExtensionFactoryResult;

      // Parameter type of restore must be unknown
      const restoreFn: ((state: unknown) => void) | undefined = ext.restore;
      expectTypeOf(restoreFn!).parameter(0).toBeUnknown();
    });

    it('restore implementation may narrow the unknown state internally', () => {
      // Narrowing inside the function body is valid; the declared param is unknown
      const ext = {
        value: {
          counter: {
            params: [],
            fn: (_args: unknown[]) => 0,
          },
        },
        restore: (state: unknown): void => {
          if (typeof state === 'object' && state !== null && 'count' in state) {
            // safe narrowing inside implementation
            void (state as { count: number }).count;
          }
        },
      } satisfies ExtensionFactoryResult;

      expectTypeOf(ext.restore!).parameter(0).toBeUnknown();
    });
  });
});
