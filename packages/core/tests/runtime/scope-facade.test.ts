/**
 * Rill Runtime Tests: ScopeContext facade
 *
 * Specification Mapping:
 * - IR-1: getVariable(name) walks parent chain; returns value or undefined.
 * - IR-2: hasVariable(name) walks parent chain; returns boolean.
 * - AC-2: ctx.getVariable matches legacy getVariable(ctx, name) for present/chain lookups.
 * - AC-3: ctx.hasVariable matches legacy hasVariable(ctx, name) for present/absent.
 * - AC-4: Root ctx returns undefined for unknown names without recursion error.
 * - AC-E7: Child returns parent binding when absent in child.
 * - AC-E8: Mutating child.variables does not mutate parent.variables.
 * - BC-6: Empty fresh-Map child finds parent binding via parent-chain lookup.
 *
 * Construction strategy:
 * - Uses createRuntimeContext for root scope.
 * - Uses createChildContext for child scopes.
 * - No standalone facade constructors (TD-3).
 */

import { describe, expect, it } from 'vitest';
import {
  createRuntimeContext,
  createChildContext,
  getVariable,
  hasVariable,
} from '@rcrsr/rill';

describe('ScopeContext', () => {
  describe('IR-1: getVariable', () => {
    it('returns the value for a present variable name', () => {
      const ctx = createRuntimeContext({ variables: { x: 'hello' } });
      expect(ctx.getVariable('x')).toBe('hello');
    });

    it('returns undefined for an absent variable name', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.getVariable('notHere')).toBeUndefined();
    });

    it('AC-4: root ctx returns undefined for unknown name without throwing', () => {
      const ctx = createRuntimeContext({});
      expect(() => ctx.getVariable('unknownDeep')).not.toThrow();
      expect(ctx.getVariable('unknownDeep')).toBeUndefined();
    });
  });

  describe('IR-2: hasVariable', () => {
    it('returns true when variable is present in scope', () => {
      const ctx = createRuntimeContext({ variables: { flag: true } });
      expect(ctx.hasVariable('flag')).toBe(true);
    });

    it('returns false when variable is absent from scope', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.hasVariable('missing')).toBe(false);
    });
  });

  describe('AC-2: ctx.getVariable matches legacy getVariable(ctx, name)', () => {
    it('both return the same value for a present name', () => {
      const ctx = createRuntimeContext({ variables: { num: 42 } });
      expect(ctx.getVariable('num')).toBe(getVariable(ctx, 'num'));
    });

    it('both return undefined for an absent name', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.getVariable('absent')).toBe(getVariable(ctx, 'absent'));
    });

    it('both walk the parent chain identically', () => {
      const parent = createRuntimeContext({
        variables: { shared: 'parentVal' },
      });
      const child = createChildContext(parent);
      expect(child.getVariable('shared')).toBe(getVariable(child, 'shared'));
      expect(child.getVariable('shared')).toBe('parentVal');
    });
  });

  describe('AC-3: ctx.hasVariable matches legacy hasVariable(ctx, name)', () => {
    it('both return true for a present name', () => {
      const ctx = createRuntimeContext({ variables: { a: 1 } });
      expect(ctx.hasVariable('a')).toBe(hasVariable(ctx, 'a'));
    });

    it('both return false for an absent name', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.hasVariable('absent')).toBe(hasVariable(ctx, 'absent'));
    });

    it('both walk the parent chain identically', () => {
      const parent = createRuntimeContext({ variables: { top: true } });
      const child = createChildContext(parent);
      expect(child.hasVariable('top')).toBe(hasVariable(child, 'top'));
      expect(child.hasVariable('top')).toBe(true);
    });
  });

  describe('AC-E7 / BC-6: parent-chain walk', () => {
    it('child returns parent binding when absent in child (AC-E7)', () => {
      const parent = createRuntimeContext({ variables: { greeting: 'hi' } });
      const child = createChildContext(parent);
      // child.variables is empty; lookup must walk to parent
      expect(child.variables.size).toBe(0);
      expect(child.getVariable('greeting')).toBe('hi');
    });

    it('BC-6: fresh-Map child finds parent binding via parent-chain', () => {
      const parent = createRuntimeContext({ variables: { score: 99 } });
      const child = createChildContext(parent);
      expect(child.variables.size).toBe(0);
      expect(child.getVariable('score')).toBe(99);
      expect(child.hasVariable('score')).toBe(true);
    });

    it('child binding shadows parent binding', () => {
      const parent = createRuntimeContext({ variables: { val: 'parent' } });
      const child = createChildContext(parent);
      child.variables.set('val', 'child');
      expect(child.getVariable('val')).toBe('child');
      expect(parent.getVariable('val')).toBe('parent');
    });

    it('lookup walks full depth of three-level chain', () => {
      const root = createRuntimeContext({ variables: { deep: 'root-val' } });
      const mid = createChildContext(root);
      const leaf = createChildContext(mid);
      expect(leaf.getVariable('deep')).toBe('root-val');
      expect(leaf.hasVariable('deep')).toBe(true);
    });

    it('returns undefined when variable absent from entire chain', () => {
      const root = createRuntimeContext({});
      const child = createChildContext(root);
      expect(child.getVariable('nowhere')).toBeUndefined();
      expect(child.hasVariable('nowhere')).toBe(false);
    });
  });

  describe('Error Contracts (EC-*)', () => {
    it('EC-1: getVariable() for absent name returns undefined and does not throw', () => {
      const ctx = createRuntimeContext({});
      let result: unknown;
      expect(() => {
        result = ctx.getVariable('absolutelyNotHere');
      }).not.toThrow();
      expect(result).toBeUndefined();
    });

    it('EC-2: hasVariable() for absent name returns false and does not throw', () => {
      const ctx = createRuntimeContext({});
      let result: unknown;
      expect(() => {
        result = ctx.hasVariable('absolutelyNotHere');
      }).not.toThrow();
      expect(result).toBe(false);
    });
  });

  describe('AC-E8: child mutation does not affect parent', () => {
    it('setting a new key in child.variables does not appear in parent.variables', () => {
      const parent = createRuntimeContext({ variables: { base: 'ok' } });
      const child = createChildContext(parent);
      child.variables.set('childOnly', 'secret');
      expect(parent.variables.has('childOnly')).toBe(false);
    });

    it('overwriting a key in child.variables does not mutate parent.variables', () => {
      const parent = createRuntimeContext({
        variables: { shared: 'original' },
      });
      const child = createChildContext(parent);
      child.variables.set('shared', 'modified');
      // Parent still sees original value
      expect(parent.variables.get('shared')).toBe('original');
      // Child sees overridden value
      expect(child.variables.get('shared')).toBe('modified');
    });
  });
});
