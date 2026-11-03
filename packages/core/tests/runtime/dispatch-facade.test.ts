/**
 * Rill Runtime Tests: DispatchContext facade
 *
 * Specification Mapping:
 * - Facade Membership: functions, typeMethodDicts, leafTypes,
 *   unvalidatedMethodReceivers (shared by reference).
 * - functions Map: built-in and user-defined functions are retrievable.
 * - leaf types: any, string, number, bool reject type arguments.
 * - Shared-by-reference: child shares parent's dispatch surface without copy.
 *
 * Construction strategy:
 * - Uses createRuntimeContext for root scope.
 * - Uses createChildContext for child scopes.
 * - No standalone facade constructors (TD-3).
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  createRuntimeContext,
  createChildContext,
  isCallable,
} from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { expectHaltMessage } from '../helpers/halt.js';

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
          myFn: { returnType: anyTypeValue, params: [], fn: myFn },
        },
      });
      expect(ctx.functions.has('myFn')).toBe(true);
      const entry = ctx.functions.get('myFn');
      expect(entry).toBeDefined();
    });

    it('user-defined function is callable via the stored entry', () => {
      const ctx = createRuntimeContext({
        functions: {
          greet: {
            returnType: anyTypeValue,
            params: [],
            fn: async () => 'hello',
          },
        },
      });
      const entry = ctx.functions.get('greet');
      expect(
        entry !== undefined && typeof entry === 'object' && isCallable(entry)
      ).toBe(true);
    });

    it('unknown function name returns undefined', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.functions.get('__notRegistered__')).toBeUndefined();
    });
  });

  describe('leaf types reject type arguments', () => {
    it.each(['any', 'string', 'number', 'bool'])(
      '%s does not accept type arguments',
      async (leaf) => {
        await expectHaltMessage(
          () => run(`"x" :${leaf}(string)`),
          `${leaf} does not accept type arguments`
        );
      }
    );
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
