/**
 * Rill Runtime Tests: DispatchContext facade
 *
 * Specification Mapping:
 * - Facade Membership: functions, typeMethodDicts, leafTypes,
 *   unvalidatedMethodReceivers (shared by reference).
 * - functions Map: built-in and user-defined functions are retrievable.
 * - typeMethodDicts: per-type method dicts are populated from registrations.
 * - leafTypes: contains expected leaf type names (plus 'any').
 * - unvalidatedMethodReceivers: contains method names that skip receiver check.
 * - Shared-by-reference: child shares parent's dispatch surface without copy.
 *
 * Construction strategy:
 * - Uses createRuntimeContext for root scope.
 * - Uses createChildContext (internal export) for child scopes.
 * - No standalone facade constructors (TD-3).
 */

import { describe, expect, it } from 'vitest';
import {
  createRuntimeContext,
  createChildContext,
  isCallable,
} from '@rcrsr/rill';

describe('DispatchContext', () => {
  describe('functions Map', () => {
    it('built-in functions are present on a fresh context', () => {
      const ctx = createRuntimeContext({});
      // 'log' is a well-known built-in that is always present
      expect(ctx.functions.has('log')).toBe(true);
    });

    it('user-defined function is registered and retrievable by name', () => {
      const myFn = async () => 'result';
      const ctx = createRuntimeContext({
        functions: {
          myFn: { params: [], fn: myFn },
        },
      });
      expect(ctx.functions.has('myFn')).toBe(true);
      const entry = ctx.functions.get('myFn');
      expect(entry).toBeDefined();
    });

    it('user-defined function is callable via the stored entry', () => {
      const ctx = createRuntimeContext({
        functions: {
          greet: { params: [], fn: async () => 'hello' },
        },
      });
      const entry = ctx.functions.get('greet');
      expect(isCallable(entry)).toBe(true);
    });

    it('unknown function name returns undefined', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.functions.get('__notRegistered__')).toBeUndefined();
    });
  });

  describe('typeMethodDicts', () => {
    it('string type has a method dict', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.typeMethodDicts.has('string')).toBe(true);
    });

    it('list type has a method dict', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.typeMethodDicts.has('list')).toBe(true);
    });

    it('dict type has a method dict', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.typeMethodDicts.has('dict')).toBe(true);
    });

    it('string type method dict contains upper method', () => {
      const ctx = createRuntimeContext({});
      const stringMethods = ctx.typeMethodDicts.get('string');
      expect(stringMethods).toBeDefined();
      expect('upper' in stringMethods!).toBe(true);
    });

    it('method dict entries are callable', () => {
      const ctx = createRuntimeContext({});
      const stringMethods = ctx.typeMethodDicts.get('string');
      const upper = stringMethods!['upper'];
      expect(isCallable(upper)).toBe(true);
    });
  });

  describe('leafTypes', () => {
    it('leafTypes is a Set', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.leafTypes).toBeInstanceOf(Set);
    });

    it("leafTypes contains 'any'", () => {
      const ctx = createRuntimeContext({});
      expect(ctx.leafTypes.has('any')).toBe(true);
    });

    it("leafTypes contains 'string'", () => {
      const ctx = createRuntimeContext({});
      expect(ctx.leafTypes.has('string')).toBe(true);
    });

    it("leafTypes contains 'number'", () => {
      const ctx = createRuntimeContext({});
      expect(ctx.leafTypes.has('number')).toBe(true);
    });

    it("leafTypes contains 'bool'", () => {
      const ctx = createRuntimeContext({});
      expect(ctx.leafTypes.has('bool')).toBe(true);
    });
  });

  describe('unvalidatedMethodReceivers', () => {
    it('unvalidatedMethodReceivers is a Set', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.unvalidatedMethodReceivers).toBeInstanceOf(Set);
    });

    it("contains 'has' (skips receiver validation)", () => {
      const ctx = createRuntimeContext({});
      expect(ctx.unvalidatedMethodReceivers.has('has')).toBe(true);
    });

    it("contains 'has_any'", () => {
      const ctx = createRuntimeContext({});
      expect(ctx.unvalidatedMethodReceivers.has('has_any')).toBe(true);
    });

    it("contains 'has_all'", () => {
      const ctx = createRuntimeContext({});
      expect(ctx.unvalidatedMethodReceivers.has('has_all')).toBe(true);
    });
  });

  describe('shared-by-reference: child inherits dispatch surface', () => {
    it('child.functions is the same reference as parent.functions', () => {
      const ctx = createRuntimeContext({});
      const child = createChildContext(ctx);
      expect(child.functions).toBe(ctx.functions);
    });

    it('child.typeMethodDicts is the same reference as parent.typeMethodDicts', () => {
      const ctx = createRuntimeContext({});
      const child = createChildContext(ctx);
      expect(child.typeMethodDicts).toBe(ctx.typeMethodDicts);
    });

    it('child.leafTypes is the same reference as parent.leafTypes', () => {
      const ctx = createRuntimeContext({});
      const child = createChildContext(ctx);
      expect(child.leafTypes).toBe(ctx.leafTypes);
    });

    it('child.unvalidatedMethodReceivers is the same reference as parent', () => {
      const ctx = createRuntimeContext({});
      const child = createChildContext(ctx);
      expect(child.unvalidatedMethodReceivers).toBe(
        ctx.unvalidatedMethodReceivers
      );
    });
  });
});
