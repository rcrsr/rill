/**
 * Rill Runtime Tests: marshalArgs and .^input default preservation
 *
 * Unit tests for the marshalArgs function (error contracts and happy paths)
 * and .^input introspection for closure parameter default values.
 *
 * AC-1:  args=[1], params (x, y:2)  → {x:1, y:2}   (pipe + default)
 * AC-2:  args=[1,2], params (x, y)  → {x:1, y:2}   (positional)
 * AC-4:  closure (y=2) .^input → 3-element entry
 * AC-10: missing required y → RILL-R044
 * AC-11: excess args → RILL-R045
 * AC-12: type mismatch → RILL-R001
 * AC-15: args=[], params () → {}
 * AC-19: closure no defaults → 2-element .^input entries
 * AC-20: untyped callable → empty ordered .^input
 * EC-4:  buildMethodEntry receiver missing → RILL-R044
 */

import { RuntimeError } from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

// marshalArgs and MarshalOptions are internal to callable.ts and not exported
// from the public API. Direct import is intentional for unit testing this
// internal function — see Implementation Notes.
import {
  marshalArgs,
  type MarshalOptions,
  type RillParam,
} from '../../src/runtime/core/callable.js';

// BUILTIN_METHODS is internal to builtins.ts. Direct import is intentional
// for testing the EC-4 error contract in buildMethodEntry.
import { BUILTIN_METHODS } from '../../src/runtime/ext/builtins.js';

import { run } from '../helpers/runtime.js';

// ============================================================
// marshalArgs unit tests
// ============================================================

describe('marshalArgs', () => {
  // Helpers to build typed params concisely
  function makeParam(
    name: string,
    type?: { type: string },
    defaultValue?: unknown
  ): RillParam {
    return {
      name,
      type: type as RillParam['type'],
      defaultValue: defaultValue as RillParam['defaultValue'],
      annotations: {},
    };
  }

  const opts: MarshalOptions = {
    functionName: 'testFn',
    location: undefined,
  };

  describe('AC-15: zero-param zero-arg → empty record', () => {
    it('returns {} when params and args are both empty', () => {
      const result = marshalArgs([], [], opts);
      expect(result).toEqual({});
    });
  });

  describe('AC-2: positional binding', () => {
    it('maps args positionally when no defaults are involved', () => {
      const params = [
        makeParam('x', { type: 'number' }),
        makeParam('y', { type: 'number' }),
      ];
      const result = marshalArgs([1, 2], params, opts);
      expect(result).toEqual({ x: 1, y: 2 });
    });
  });

  describe('AC-1: default hydration', () => {
    it('fills missing trailing arg from defaultValue', () => {
      const params = [
        makeParam('x', { type: 'number' }),
        makeParam('y', { type: 'number' }, 2),
      ];
      // Only first arg supplied; y must be hydrated from default
      const result = marshalArgs([1], params, opts);
      expect(result).toEqual({ x: 1, y: 2 });
    });
  });

  describe('AC-11 / EC-1: excess args → RILL-R045', () => {
    it('throws RILL-R045 when more args than params', () => {
      const params = [makeParam('x', { type: 'number' })];
      expect(() => marshalArgs([1, 2], params, opts)).toThrow(RuntimeError);
      try {
        marshalArgs([1, 2], params, opts);
      } catch (err) {
        expect((err as RuntimeError).errorId).toBe('RILL-R045');
      }
    });

    it('error message includes expected and actual count', () => {
      const params = [makeParam('x', { type: 'number' })];
      try {
        marshalArgs([1, 2], params, opts);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        expect((err as RuntimeError).message).toContain('1');
        expect((err as RuntimeError).message).toContain('2');
      }
    });
  });

  describe('AC-10 / EC-2: missing required → RILL-R044', () => {
    it('throws RILL-R044 when required param has no arg and no default', () => {
      const params = [
        makeParam('x', { type: 'number' }),
        makeParam('y', { type: 'number' }),
      ];
      // Only x supplied; y is required with no default
      expect(() => marshalArgs([1], params, opts)).toThrow(RuntimeError);
      try {
        marshalArgs([1], params, opts);
      } catch (err) {
        expect((err as RuntimeError).errorId).toBe('RILL-R044');
      }
    });

    it('error message names the missing parameter', () => {
      const params = [
        makeParam('x', { type: 'number' }),
        makeParam('y', { type: 'number' }),
      ];
      try {
        marshalArgs([1], params, opts);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        expect((err as RuntimeError).message).toContain('y');
      }
    });
  });

  describe('AC-12 / EC-3: type mismatch → RILL-R001', () => {
    it('throws RILL-R001 when arg type does not match param type', () => {
      const params = [makeParam('x', { type: 'number' })];
      // Passing a string where number is expected
      expect(() => marshalArgs(['not-a-number'], params, opts)).toThrow(
        RuntimeError
      );
      try {
        marshalArgs(['not-a-number'], params, opts);
      } catch (err) {
        expect((err as RuntimeError).errorId).toBe('RILL-R001');
      }
    });

    it('error message names the mismatched parameter', () => {
      const params = [makeParam('score', { type: 'number' })];
      try {
        marshalArgs(['bad'], params, opts);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        expect((err as RuntimeError).message).toContain('score');
      }
    });

    it('passes when arg matches declared type', () => {
      const params = [makeParam('x', { type: 'number' })];
      const result = marshalArgs([42], params, opts);
      expect(result).toEqual({ x: 42 });
    });
  });

  describe('untyped params (type: undefined)', () => {
    it('accepts any value when param.type is undefined', () => {
      const params = [makeParam('x', undefined)];
      expect(marshalArgs(['hello'], params, opts)).toEqual({ x: 'hello' });
      expect(marshalArgs([42], params, opts)).toEqual({ x: 42 });
      expect(marshalArgs([null], params, opts)).toEqual({ x: null });
    });
  });

  describe('functionName in options', () => {
    it('includes functionName in RILL-R044 error context', () => {
      const params = [makeParam('x', { type: 'number' })];
      const customOpts: MarshalOptions = {
        functionName: 'mySpecialFn',
        location: undefined,
      };
      try {
        marshalArgs([], params, customOpts);
        expect.fail('Should have thrown');
      } catch (err) {
        // functionName is in the error context, not the message
        expect((err as RuntimeError).context).toMatchObject({
          functionName: 'mySpecialFn',
        });
      }
    });

    it('falls back to <anonymous> when options is undefined', () => {
      const params = [makeParam('x', { type: 'number' })];
      try {
        marshalArgs([], params, undefined);
        expect.fail('Should have thrown');
      } catch (err) {
        // functionName defaults to <anonymous> in the error context
        expect((err as RuntimeError).context).toMatchObject({
          functionName: '<anonymous>',
        });
      }
    });
  });
});

// ============================================================
// EC-4: buildMethodEntry receiver missing → RILL-R044
// ============================================================

describe('EC-4: buildMethodEntry receiver missing from record raises RILL-R044', () => {
  it('throws RILL-R044 when fn called without receiver in args', () => {
    // Arrange: pick any built-in method entry produced by buildMethodEntry
    const lenEntry = BUILTIN_METHODS.string.len;

    // Act: call fn with an empty record (no 'receiver' key)
    expect(() =>
      lenEntry.fn({}, { variables: new Map(), pipeValue: null } as never)
    ).toThrow(RuntimeError);

    try {
      lenEntry.fn({}, { variables: new Map(), pipeValue: null } as never);
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as RuntimeError).errorId).toBe('RILL-R044');
    }
  });

  it('error message names the missing receiver parameter', () => {
    const lenEntry = BUILTIN_METHODS.string.len;

    try {
      lenEntry.fn({}, { variables: new Map(), pipeValue: null } as never);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeError);
      expect((err as RuntimeError).message).toContain('receiver');
    }
  });

  it('does not throw when receiver key is present', () => {
    const emptyEntry = BUILTIN_METHODS.string.empty;

    // 'receiver' present with a string value; method should execute
    const result = emptyEntry.fn({ receiver: 'hello' }, {
      variables: new Map(),
      pipeValue: null,
    } as never);
    expect(result).toBe(false);
  });
});

// ============================================================
// .^input default preservation tests
// ============================================================

describe('.^input default preservation', () => {
  describe('AC-4: closure with default → 3-element entry', () => {
    it('returns 3-element entry [name, typeValue, defaultValue] for param with default', async () => {
      // |y: number = 2| produces a typed param with a default value
      const result = (await run(
        '|y: number = 2| { $y } => $fn\n$fn.^input'
      )) as {
        __rill_ordered: boolean;
        entries: [string, unknown, unknown?][];
      };
      expect(result['__rill_ordered']).toBe(true);
      const entries = result.entries;
      expect(entries).toHaveLength(1);
      // 3-element tuple: [paramName, typeValue, defaultValue]
      expect(entries[0]).toHaveLength(3);
      expect(entries[0]![0]).toBe('y');
      // Third element is the default value
      expect(entries[0]![2]).toBe(2);
    });

    it('mixed params: typed-with-default produces 3-element, typed-no-default produces 2-element', async () => {
      // |x: string, y: number = 10| — x has no default, y has default
      const result = (await run(
        '|x: string, y: number = 10| { $x } => $fn\n$fn.^input'
      )) as {
        entries: [string, unknown, unknown?][];
      };
      const entries = result.entries;
      expect(entries).toHaveLength(2);
      // x: no default → 2-element
      expect(entries[0]).toHaveLength(2);
      expect(entries[0]![0]).toBe('x');
      // y: default=10 → 3-element
      expect(entries[1]).toHaveLength(3);
      expect(entries[1]![0]).toBe('y');
      expect(entries[1]![2]).toBe(10);
    });
  });

  describe('AC-19: closure without defaults → 2-element entries', () => {
    it('returns 2-element entries for typed params with no defaults', async () => {
      const result = (await run(
        '|x: string, y: number| { $x } => $fn\n$fn.^input'
      )) as {
        __rill_ordered: boolean;
        entries: [string, unknown, unknown?][];
      };
      expect(result['__rill_ordered']).toBe(true);
      const entries = result.entries;
      expect(entries).toHaveLength(2);
      // Both params have no defaults: 2-element tuples
      expect(entries[0]).toHaveLength(2);
      expect(entries[0]![0]).toBe('x');
      expect(entries[1]).toHaveLength(2);
      expect(entries[1]![0]).toBe('y');
    });
  });

  describe('AC-20: untyped callable → empty ordered', () => {
    it('callable() factory (untyped host callable) returns empty ordered for .^input', async () => {
      // The callable() factory sets params to undefined (untyped).
      // evaluateAnnotationAccess returns createOrdered([]) for this case.
      const { callable } = await import('@rcrsr/rill');
      const result = (await run('$fn.^input', {
        variables: {
          fn: callable(() => null),
        },
      })) as {
        __rill_ordered: boolean;
        entries: unknown[];
      };
      expect(result['__rill_ordered']).toBe(true);
      expect(result.entries).toEqual([]);
    });

    it('explicit zero-param closure (||{}) returns empty ordered for .^input', async () => {
      // ||{ ... } is a closure with an explicit empty param list (params = [])
      const result = (await run('||{ "result" } => $fn\n$fn.^input')) as {
        __rill_ordered: boolean;
        entries: unknown[];
      };
      expect(result['__rill_ordered']).toBe(true);
      expect(result.entries).toEqual([]);
    });
  });
});
