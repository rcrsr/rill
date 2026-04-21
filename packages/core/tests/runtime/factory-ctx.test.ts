/**
 * Rill Runtime Tests: ExtensionFactoryCtx surface
 *
 * Specification Mapping (task 3.6):
 * - IR-9: ExtensionFactoryCtx surface is exactly `{ registerErrorCode, signal }`.
 * - AC-7  / AC-N5 / EC-15: TypeScript rejects excess properties on
 *   ExtensionFactoryCtx literals via the exact-prop check under `strict`.
 * - AC-E6 / EC-1: Re-registering the same atom name with a different kind
 *   raises an init-time conflict at `registerErrorCode`.
 * - FR-ERR-19 / FR-ERR-20: Positive factory-init registration path.
 *
 * Construction strategy:
 * - The runtime does not yet invoke `ExtensionFactory` inside
 *   `createRuntimeContext`. Tests drive the factory signature directly by
 *   constructing an `ExtensionFactoryCtx` literal and calling the factory,
 *   matching the current extension wiring (see extensions.test.ts).
 */

import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  ExtensionFactory,
  ExtensionFactoryCtx,
  ExtensionFactoryResult,
} from '@rcrsr/rill';
import {
  atomName,
  registerErrorCode,
  resolveAtom,
} from '../../src/runtime/core/types/atom-registry.js';

/**
 * Builds a factory-scope ctx literal wired to a fresh AbortController.
 * Mirrors the wiring `createRuntimeContext` performs internally so tests
 * can exercise the factory contract without spinning up a full runtime.
 */
function makeFactoryCtx(): ExtensionFactoryCtx {
  const controller = new AbortController();
  return {
    registerErrorCode: (name: string, kind: string): void => {
      registerErrorCode(name, kind);
    },
    signal: controller.signal,
  };
}

describe('ExtensionFactoryCtx', () => {
  describe('AC-7 / AC-N5 / EC-15: exact-prop shape', () => {
    it('accepts a literal with exactly { registerErrorCode, signal }', () => {
      const ctx: ExtensionFactoryCtx = makeFactoryCtx();

      // Positive shape evidence: both members are present and correctly typed.
      expectTypeOf(ctx.registerErrorCode).toBeFunction();
      expectTypeOf(ctx.signal).toEqualTypeOf<AbortSignal>();

      // Runtime sanity: the ctx is usable as-is.
      expect(typeof ctx.registerErrorCode).toBe('function');
      expect(ctx.signal).toBeInstanceOf(AbortSignal);
    });

    it('TypeScript rejects an extra property via excess-property check', () => {
      const controller = new AbortController();

      // The @ts-expect-error directive asserts the excess-property check
      // rejects the `extra` member. If the exact-prop contract regresses
      // and the compiler accepts the extra, tsc flags the directive as
      // unused, turning this into a compile-time failure (AC-N5 / EC-15).
      // @ts-expect-error AC-N5: ExtensionFactoryCtx rejects excess properties
      const withExtra: ExtensionFactoryCtx = {
        registerErrorCode: () => {},
        signal: controller.signal,
        extra: 1,
      };

      // Read the literal so the `withExtra` binding is not optimised out;
      // this keeps the directive anchored to the literal line.
      expect(typeof withExtra.registerErrorCode).toBe('function');
    });

    it('TypeScript rejects a satisfies-clause with excess properties', () => {
      const controller = new AbortController();

      // `satisfies` also runs the excess-property check when the target is
      // a structural interface. The directive anchors that behavior.
      const shape = {
        registerErrorCode: () => {},
        signal: controller.signal,
        // @ts-expect-error AC-N5: `satisfies` rejects excess property
        extra: 'nope',
      } satisfies ExtensionFactoryCtx;

      expect(shape.signal).toBe(controller.signal);
    });
  });

  describe('FR-ERR-19 / FR-ERR-20: Positive factory registration', () => {
    it('factory receives a ctx whose registerErrorCode registers atoms', () => {
      // Use a unique name so parallel test runs never conflict. Registry
      // state is module-scoped (§atom-registry); a well-formed unique
      // name keeps the test hermetic.
      const uniqueName = `FACTORY_CTX_OK_${Date.now().toString(36).toUpperCase()}`;

      const factory: ExtensionFactory<{ tag: string }> = (
        config,
        ctx
      ): ExtensionFactoryResult => {
        ctx.registerErrorCode(uniqueName, 'generic');
        return { value: { _tag: config.tag } };
      };

      const ctx = makeFactoryCtx();
      const result = factory({ tag: 'ok' }, ctx);

      // Runtime observable: the atom is resolvable post-factory.
      const atom = resolveAtom(uniqueName);
      expect(atomName(atom)).toBe(uniqueName);
      expect(atom.kind).toBe('generic');
      // Factory returned the expected shape.
      expect('value' in (result as ExtensionFactoryResult)).toBe(true);
    });

    it('registerErrorCode is idempotent for identical (name, kind)', () => {
      const uniqueName = `FACTORY_CTX_IDEMP_${Date.now().toString(36).toUpperCase()}`;
      const ctx = makeFactoryCtx();

      // First registration succeeds.
      expect(() => ctx.registerErrorCode(uniqueName, 'generic')).not.toThrow();

      // Second identical registration is a no-op; returns existing atom.
      expect(() => ctx.registerErrorCode(uniqueName, 'generic')).not.toThrow();

      const atom = resolveAtom(uniqueName);
      expect(atomName(atom)).toBe(uniqueName);
    });
  });

  describe('AC-E6 / EC-1: duplicate registration with different kind', () => {
    it('throws at factory init when re-registering with a different kind', () => {
      const uniqueName = `FACTORY_CTX_CONFLICT_${Date.now().toString(36).toUpperCase()}`;
      const ctx = makeFactoryCtx();

      // First registration with kind='generic' succeeds.
      ctx.registerErrorCode(uniqueName, 'generic');

      // Re-registering the same name with a different kind raises
      // synchronously inside the factory init path (AC-E6).
      expect(() => ctx.registerErrorCode(uniqueName, 'auth')).toThrow(
        /already registered with kind/i
      );
    });

    it('rejects well-formed but differently-kinded registration across two factories', () => {
      const uniqueName = `FACTORY_CTX_CROSS_${Date.now().toString(36).toUpperCase()}`;

      // Factory A registers the atom.
      const factoryA: ExtensionFactory<unknown> = (
        _cfg,
        ctx
      ): ExtensionFactoryResult => {
        ctx.registerErrorCode(uniqueName, 'generic');
        return { value: {} };
      };
      factoryA({}, makeFactoryCtx());

      // Factory B attempts the same name with a different kind. The
      // registry is module-scoped so the collision fires across factories.
      const factoryB: ExtensionFactory<unknown> = (
        _cfg,
        ctx
      ): ExtensionFactoryResult => {
        ctx.registerErrorCode(uniqueName, 'auth');
        return { value: {} };
      };

      expect(() => factoryB({}, makeFactoryCtx())).toThrow(
        /already registered with kind/i
      );
    });
  });

  describe('signal: factory abort propagation', () => {
    it('ctx.signal mirrors the factory-scope controller lifecycle', () => {
      const controller = new AbortController();
      const ctx: ExtensionFactoryCtx = {
        registerErrorCode: () => {},
        signal: controller.signal,
      };

      expect(ctx.signal.aborted).toBe(false);
      controller.abort();
      expect(ctx.signal.aborted).toBe(true);
    });
  });
});
