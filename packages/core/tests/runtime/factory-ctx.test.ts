/**
 * Rill Runtime Tests: ExtensionFactoryCtx surface
 *
 * - ExtensionFactoryCtx exposes exactly `{ signal }`.
 * - TypeScript rejects excess properties on ExtensionFactoryCtx literals via
 *   the exact-prop check under `strict`, including the removed
 *   `registerErrorCode` member.
 * - `registerErrorCode` is not part of the package exports.
 *
 * Core has no construction site for `ExtensionFactoryCtx`; the host builds
 * it, so tests build literals directly.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';
import * as rill from '@rcrsr/rill';
import type {
  ExtensionFactory,
  ExtensionFactoryCtx,
  ExtensionFactoryResult,
} from '@rcrsr/rill';

describe('ExtensionFactoryCtx', () => {
  describe('exact-prop shape', () => {
    it('accepts a literal with exactly { signal }', () => {
      const controller = new AbortController();
      const ctx: ExtensionFactoryCtx = { signal: controller.signal };

      expectTypeOf(ctx.signal).toEqualTypeOf<AbortSignal>();
      expectTypeOf<keyof ExtensionFactoryCtx>().toEqualTypeOf<'signal'>();
      expect(Object.keys(ctx)).toEqual(['signal']);
      expect(ctx.signal).toBeInstanceOf(AbortSignal);
    });

    it('TypeScript rejects an extra property via excess-property check', () => {
      const controller = new AbortController();

      // If the exact-prop contract regresses and the compiler accepts the
      // extra, tsc flags the directive as unused.
      const withExtra: ExtensionFactoryCtx = {
        signal: controller.signal,
        // @ts-expect-error ExtensionFactoryCtx rejects excess properties
        extra: 1,
      };

      expect(withExtra.signal).toBe(controller.signal);
    });

    it('TypeScript rejects registerErrorCode on a ctx literal', () => {
      const controller = new AbortController();

      const withRegister: ExtensionFactoryCtx = {
        signal: controller.signal,
        // @ts-expect-error registerErrorCode is no longer part of the ctx
        registerErrorCode: () => {},
      };

      expect(withRegister.signal).toBe(controller.signal);
    });

    it('TypeScript rejects a satisfies-clause with excess properties', () => {
      const controller = new AbortController();

      const shape = {
        signal: controller.signal,
        // @ts-expect-error `satisfies` rejects excess property
        extra: 'nope',
      } satisfies ExtensionFactoryCtx;

      expect(shape.signal).toBe(controller.signal);
    });
  });

  describe('package exports', () => {
    it('does not export registerErrorCode', () => {
      expect('registerErrorCode' in rill).toBe(false);
    });
  });

  describe('factory invocation', () => {
    it('passes the ctx signal through to the factory', () => {
      const controller = new AbortController();
      const factory: ExtensionFactory<{ tag: string }> = (
        config,
        ctx
      ): ExtensionFactoryResult => ({
        value: { _tag: config.tag, aborted: ctx.signal.aborted },
      });

      const result = factory({ tag: 'ok' }, { signal: controller.signal });

      expect('value' in result).toBe(true);
    });
  });

  describe('signal: factory abort propagation', () => {
    it('ctx.signal mirrors the factory-scope controller lifecycle', () => {
      const controller = new AbortController();
      const ctx: ExtensionFactoryCtx = { signal: controller.signal };

      expect(ctx.signal.aborted).toBe(false);
      controller.abort();
      expect(ctx.signal.aborted).toBe(true);
    });
  });
});
