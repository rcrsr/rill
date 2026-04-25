/**
 * Rill Runtime Tests: RuntimeContext composition and child-context reference sharing
 *
 * Specification Mapping:
 * - AC-1:  Composed RuntimeContext exposes all fields as a flat literal; destructuring
 *          and direct field access succeed without compilation errors.
 * - AC-5:  createChildContext(parent) returns fresh variables and variableTypes Maps.
 * - AC-6:  Dispatch facade fields are reference-equal to parent's.
 * - AC-7:  Lifecycle methods are reference-equal to parent's; dispose() returns same promise.
 * - AC-11: Existing destructuring patterns work unchanged.
 * - AC-E5: Dispatch facade reference equality holds (positive assertion).
 * - AC-E6: Lifecycle promise equality holds (positive assertion).
 * - AC-E7: Variable lookup in child returns parent's binding when absent in child.
 * - AC-E8: Mutating child.variables does not mutate parent.variables.
 * - BC-1:  10-level nested chain preserves dispatch facade reference identity at all levels.
 * - BC-2:  Child created from disposed parent returns isDisposed() === true immediately.
 *
 * Construction strategy:
 * - Uses createRuntimeContext for root scope.
 * - Uses createChildContext for child scopes.
 * - No standalone facade constructors (TD-3).
 */

import { describe, expect, it } from 'vitest';
import { createRuntimeContext, createChildContext } from '@rcrsr/rill';

describe('RuntimeContext composition', () => {
  describe('AC-1 / AC-11: flat field access and destructuring', () => {
    it('AC-1: direct field access succeeds for variables, functions, signal, dispose, callStack', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.variables).toBeInstanceOf(Map);
      expect(ctx.functions).toBeInstanceOf(Map);
      // signal is AbortSignal | undefined; just accessing it must not throw
      expect(() => ctx.signal).not.toThrow();
      expect(typeof ctx.dispose).toBe('function');
      expect(Array.isArray(ctx.callStack)).toBe(true);
    });

    it('AC-1: ctx.variables.get(name) succeeds for an existing variable', () => {
      const ctx = createRuntimeContext({ variables: { x: 42 } });
      expect(ctx.variables.get('x')).toBe(42);
    });

    it('AC-11: destructuring const { parent, variables, functions, signal, dispose, callStack } = ctx succeeds', () => {
      const ctx = createRuntimeContext({});
      // If TypeScript compiles this the destructure is valid at the type level.
      const { parent, variables, functions, signal, dispose, callStack } = ctx;
      expect(parent).toBeUndefined(); // root has no parent
      expect(variables).toBeInstanceOf(Map);
      expect(functions).toBeInstanceOf(Map);
      expect(signal === undefined || signal instanceof AbortSignal).toBe(true);
      expect(typeof dispose).toBe('function');
      expect(Array.isArray(callStack)).toBe(true);
    });
  });

  describe('AC-5: child has fresh Maps for variables and variableTypes', () => {
    it('AC-5: child.variables is a new Map (not the parent instance)', () => {
      const parent = createRuntimeContext({});
      const child = createChildContext(parent);
      expect(child.variables).not.toBe(parent.variables);
    });

    it('AC-5: child.variableTypes is a new Map (not the parent instance)', () => {
      const parent = createRuntimeContext({});
      const child = createChildContext(parent);
      expect(child.variableTypes).not.toBe(parent.variableTypes);
    });
  });

  describe('AC-6 / AC-E5: dispatch facade reference equality', () => {
    it('AC-6 / AC-E5: child.functions === parent.functions', () => {
      const parent = createRuntimeContext({});
      const child = createChildContext(parent);
      expect(child.functions).toBe(parent.functions);
    });

    it('AC-6 / AC-E5: child.typeMethodDicts === parent.typeMethodDicts', () => {
      const parent = createRuntimeContext({});
      const child = createChildContext(parent);
      expect(child.typeMethodDicts).toBe(parent.typeMethodDicts);
    });

    it('AC-6 / AC-E5: child.leafTypes === parent.leafTypes', () => {
      const parent = createRuntimeContext({});
      const child = createChildContext(parent);
      expect(child.leafTypes).toBe(parent.leafTypes);
    });

    it('AC-6 / AC-E5: child.unvalidatedMethodReceivers === parent.unvalidatedMethodReceivers', () => {
      const parent = createRuntimeContext({});
      const child = createChildContext(parent);
      expect(child.unvalidatedMethodReceivers).toBe(
        parent.unvalidatedMethodReceivers
      );
    });
  });

  describe('AC-7 / AC-E6: lifecycle method and promise reference equality', () => {
    it('AC-7: child.dispose is the same function reference as parent.dispose', () => {
      const parent = createRuntimeContext({});
      const child = createChildContext(parent);
      expect(child.dispose).toBe(parent.dispose);
    });

    it('AC-7 / AC-E6: child.dispose() and parent.dispose() return the same Promise', () => {
      const parent = createRuntimeContext({});
      const child = createChildContext(parent);
      const childPromise = child.dispose();
      const parentPromise = parent.dispose();
      expect(childPromise).toBe(parentPromise);
    });
  });

  describe('AC-E8: child variable mutation does not affect parent', () => {
    it('AC-E8: child.variables.set() does not appear in parent.variables', () => {
      const parent = createRuntimeContext({ variables: { base: 'ok' } });
      const child = createChildContext(parent);
      child.variables.set('childOnly', 'secret');
      expect(parent.variables.has('childOnly')).toBe(false);
    });

    it('AC-E8: overwriting a shared key in child does not mutate parent', () => {
      const parent = createRuntimeContext({
        variables: { shared: 'original' },
      });
      const child = createChildContext(parent);
      child.variables.set('shared', 'modified');
      expect(parent.variables.get('shared')).toBe('original');
    });
  });

  describe('AC-E7: variable lookup falls through to parent chain', () => {
    it('AC-E7: getVariable on child returns parent binding when absent in child', () => {
      const parent = createRuntimeContext({ variables: { greeting: 'hello' } });
      const child = createChildContext(parent);
      // child.variables is empty; the lookup must walk to parent
      expect(child.variables.size).toBe(0);
      expect(child.getVariable('greeting')).toBe('hello');
    });
  });

  describe('BC-1: 10-level nested chain preserves dispatch facade identity', () => {
    it('BC-1: functions reference is identical at every level of a 10-deep chain', () => {
      const root = createRuntimeContext({});
      let ctx = root;
      for (let i = 0; i < 10; i++) {
        ctx = createChildContext(ctx);
        expect(ctx.functions).toBe(root.functions);
        expect(ctx.typeMethodDicts).toBe(root.typeMethodDicts);
        expect(ctx.leafTypes).toBe(root.leafTypes);
        expect(ctx.unvalidatedMethodReceivers).toBe(
          root.unvalidatedMethodReceivers
        );
      }
    });
  });

  describe('BC-2: child from disposed parent is already disposed', () => {
    it('BC-2: child.isDisposed() returns true when parent is already disposed', async () => {
      const parent = createRuntimeContext({});
      await parent.dispose();
      const child = createChildContext(parent);
      expect(child.isDisposed()).toBe(true);
    });
  });
});
