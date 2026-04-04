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

import { describe, expect, it } from 'vitest';
import {
  BUILTIN_METHODS,
  createOrdered,
  createTuple,
  hydrateFieldDefaults,
  marshalArgs,
  RuntimeError,
  type MarshalOptions,
  type RillParam,
} from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

// ============================================================
// marshalArgs unit tests
// ============================================================

describe('marshalArgs', () => {
  // Helpers to build typed params concisely
  function makeParam(
    name: string,
    type?: { kind: string },
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
        makeParam('x', { kind: 'number' }),
        makeParam('y', { kind: 'number' }),
      ];
      const result = marshalArgs([1, 2], params, opts);
      expect(result).toEqual({ x: 1, y: 2 });
    });
  });

  describe('AC-1: default hydration', () => {
    it('fills missing trailing arg from defaultValue', () => {
      const params = [
        makeParam('x', { kind: 'number' }),
        makeParam('y', { kind: 'number' }, 2),
      ];
      // Only first arg supplied; y must be hydrated from default
      const result = marshalArgs([1], params, opts);
      expect(result).toEqual({ x: 1, y: 2 });
    });
  });

  describe('AC-11 / EC-1: excess args → RILL-R045', () => {
    it('throws RILL-R045 when more args than params', () => {
      const params = [makeParam('x', { kind: 'number' })];
      expect(() => marshalArgs([1, 2], params, opts)).toThrow(RuntimeError);
      try {
        marshalArgs([1, 2], params, opts);
      } catch (err) {
        expect((err as RuntimeError).errorId).toBe('RILL-R045');
      }
    });

    it('error message includes expected and actual count', () => {
      const params = [makeParam('x', { kind: 'number' })];
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
        makeParam('x', { kind: 'number' }),
        makeParam('y', { kind: 'number' }),
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
        makeParam('x', { kind: 'number' }),
        makeParam('y', { kind: 'number' }),
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
      const params = [makeParam('x', { kind: 'number' })];
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
      const params = [makeParam('score', { kind: 'number' })];
      try {
        marshalArgs(['bad'], params, opts);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        expect((err as RuntimeError).message).toContain('score');
      }
    });

    it('passes when arg matches declared type', () => {
      const params = [makeParam('x', { kind: 'number' })];
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
      const params = [makeParam('x', { kind: 'number' })];
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
      const params = [makeParam('x', { kind: 'number' })];
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

  // ============================================================
  // Dict/ordered field default hydration (Stage 2.5)
  // ============================================================

  describe('dict field default hydration', () => {
    it('fills missing dict field from field-level default', () => {
      const params: RillParam[] = [
        {
          name: 'opts',
          type: {
            kind: 'dict',
            fields: {
              a: { type: { kind: 'string' }, defaultValue: 'hello' },
              b: { type: { kind: 'number' } },
            },
          },
          defaultValue: undefined,
          annotations: {},
        },
      ];
      const result = marshalArgs([{ b: 42 }], params, opts);
      expect(result).toEqual({ opts: { a: 'hello', b: 42 } });
    });

    it('hydrates all fields when all have defaults and arg is empty dict', () => {
      const params: RillParam[] = [
        {
          name: 'cfg',
          type: {
            kind: 'dict',
            fields: {
              x: { type: { kind: 'string' }, defaultValue: 'alpha' },
              y: { type: { kind: 'number' }, defaultValue: 99 },
            },
          },
          defaultValue: undefined,
          annotations: {},
        },
      ];
      const result = marshalArgs([{}], params, opts);
      expect(result).toEqual({ cfg: { x: 'alpha', y: 99 } });
    });

    it('throws RILL-R001 when dict field missing without default', () => {
      const params: RillParam[] = [
        {
          name: 'opts',
          type: {
            kind: 'dict',
            fields: {
              a: { type: { kind: 'string' }, defaultValue: 'hello' },
              b: { type: { kind: 'number' } },
            },
          },
          defaultValue: undefined,
          annotations: {},
        },
      ];
      // Dict missing required field 'b' (no default)
      expect(() => marshalArgs([{ a: 'hi' }], params, opts)).toThrow(
        RuntimeError
      );
      try {
        marshalArgs([{ a: 'hi' }], params, opts);
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as RuntimeError).errorId).toBe('RILL-R001');
        expect((err as RuntimeError).message).toContain('opts');
      }
    });

    it('returns independent deep copies for nested dict defaults', () => {
      const params: RillParam[] = [
        {
          name: 'opts',
          type: {
            kind: 'dict',
            fields: {
              inner: {
                type: { kind: 'dict' },
                defaultValue: { nested: 'x' },
              },
            },
          },
          defaultValue: undefined,
          annotations: {},
        },
      ];
      const result1 = marshalArgs([{}], params, opts);
      const result2 = marshalArgs([{}], params, opts);
      const inner1 = (result1 as Record<string, unknown>).opts as Record<
        string,
        unknown
      >;
      const inner2 = (result2 as Record<string, unknown>).opts as Record<
        string,
        unknown
      >;
      // Mutate first result's default
      (inner1.inner as Record<string, unknown>).nested = 'mutated';
      // Second result must retain original default
      expect((inner2.inner as Record<string, unknown>).nested).toBe('x');
    });

    it('hydrates nested dict inner field defaults', () => {
      const params: RillParam[] = [
        {
          name: 'data',
          type: {
            kind: 'dict',
            fields: {
              outer: {
                type: {
                  kind: 'dict',
                  fields: {
                    a: { type: { kind: 'number' }, defaultValue: 42 },
                    b: { type: { kind: 'string' } },
                  },
                },
              },
            },
          },
          defaultValue: undefined,
          annotations: {},
        },
      ];
      // Inner dict present but missing field 'a' (has default)
      const result = marshalArgs([{ outer: { b: 'yes' } }], params, opts);
      expect(result).toEqual({ data: { outer: { a: 42, b: 'yes' } } });
    });
  });

  describe('ordered field default hydration', () => {
    it('fills trailing ordered entry from field-level default', () => {
      const params: RillParam[] = [
        {
          name: 'pair',
          type: {
            kind: 'ordered',
            fields: [
              { name: 'a', type: { kind: 'number' } },
              {
                name: 'b',
                type: { kind: 'string' },
                defaultValue: 'default-b',
              },
            ],
          },
          defaultValue: undefined,
          annotations: {},
        },
      ];
      const arg = createOrdered([['a', 1]]);
      const result = marshalArgs([arg], params, opts);
      const ordered = (result as Record<string, unknown>).pair as {
        __rill_ordered: boolean;
        entries: [string, unknown][];
      };
      expect(ordered.__rill_ordered).toBe(true);
      expect(ordered.entries).toEqual([
        ['a', 1],
        ['b', 'default-b'],
      ]);
    });
  });

  // ============================================================
  // Extra key/entry preservation (structural match allows extras)
  // ============================================================

  describe('dict extra key preservation', () => {
    it('preserves extra keys not declared in type.fields', () => {
      const params: RillParam[] = [
        {
          name: 'opts',
          type: {
            kind: 'dict',
            fields: {
              a: { type: { kind: 'number' } },
              b: { type: { kind: 'number' } },
            },
          },
          defaultValue: undefined,
          annotations: {},
        },
      ];
      const result = marshalArgs(
        [{ a: 1, b: 2, extra: 'preserved' }],
        params,
        opts
      );
      expect(result).toEqual({
        opts: { a: 1, b: 2, extra: 'preserved' },
      });
    });

    it('preserves extra keys alongside default hydration', () => {
      const params: RillParam[] = [
        {
          name: 'cfg',
          type: {
            kind: 'dict',
            fields: {
              a: { type: { kind: 'string' }, defaultValue: 'hello' },
              b: { type: { kind: 'number' } },
            },
          },
          defaultValue: undefined,
          annotations: {},
        },
      ];
      // a is missing (hydrated from default), extra key present
      const result = marshalArgs([{ b: 42, bonus: true }], params, opts);
      expect(result).toEqual({
        cfg: { a: 'hello', b: 42, bonus: true },
      });
    });
  });

  describe('ordered extra entry preservation', () => {
    // structureMatches rejects ordered values with extra entries,
    // so these tests call hydrateFieldDefaults directly to verify the
    // hydration logic preserves extras independent of type checking.
    it('preserves extra entries not declared in type.fields', () => {
      const type = {
        kind: 'ordered' as const,
        fields: [
          { name: 'a', type: { kind: 'number' as const } },
          { name: 'b', type: { kind: 'number' as const } },
        ],
      };
      const arg = createOrdered([
        ['a', 1],
        ['b', 2],
        ['extra', 'preserved'],
      ]);
      const result = hydrateFieldDefaults(arg, type) as {
        __rill_ordered: boolean;
        entries: [string, unknown][];
      };
      expect(result.__rill_ordered).toBe(true);
      expect(result.entries).toEqual([
        ['a', 1],
        ['b', 2],
        ['extra', 'preserved'],
      ]);
    });

    it('preserves extra entries alongside default hydration', () => {
      const type = {
        kind: 'ordered' as const,
        fields: [
          { name: 'a', type: { kind: 'number' as const } },
          {
            name: 'b',
            type: { kind: 'string' as const },
            defaultValue: 'default-b',
          },
        ],
      };
      // b is missing (hydrated from default), extra entry present
      const arg = createOrdered([
        ['a', 1],
        ['bonus', 99],
      ]);
      const result = hydrateFieldDefaults(arg, type) as {
        __rill_ordered: boolean;
        entries: [string, unknown][];
      };
      expect(result.__rill_ordered).toBe(true);
      expect(result.entries).toEqual([
        ['a', 1],
        ['b', 'default-b'],
        ['bonus', 99],
      ]);
    });
  });

  // ============================================================
  // Tuple field default hydration (AC-5, BC-1, BC-2)
  // ============================================================

  describe('AC-5: tuple param hydration — omitted trailing default filled', () => {
    it('fills omitted trailing tuple element from field-level default', () => {
      const params: RillParam[] = [
        {
          name: 'coords',
          type: {
            kind: 'tuple',
            elements: [
              { type: { kind: 'number' } },
              { type: { kind: 'number' }, defaultValue: 0 },
            ],
          },
          defaultValue: undefined,
          annotations: {},
        },
      ];
      // Tuple with only first element; second should hydrate from default
      const arg = createTuple([10]);
      const result = marshalArgs([arg], params, opts);
      const tuple = (result as Record<string, unknown>).coords as {
        __rill_tuple: boolean;
        entries: unknown[];
      };
      expect(tuple.__rill_tuple).toBe(true);
      expect(tuple.entries).toEqual([10, 0]);
    });
  });

  describe('BC-1: all-default tuple with empty value', () => {
    it('fills all elements when tuple is empty and all have defaults', () => {
      const params: RillParam[] = [
        {
          name: 'tri',
          type: {
            kind: 'tuple',
            elements: [
              { type: { kind: 'string' }, defaultValue: 'a' },
              { type: { kind: 'number' }, defaultValue: 1 },
              { type: { kind: 'bool' }, defaultValue: true },
            ],
          },
          defaultValue: undefined,
          annotations: {},
        },
      ];
      const arg = createTuple([]);
      const result = marshalArgs([arg], params, opts);
      const tuple = (result as Record<string, unknown>).tri as {
        __rill_tuple: boolean;
        entries: unknown[];
      };
      expect(tuple.__rill_tuple).toBe(true);
      expect(tuple.entries).toEqual(['a', 1, true]);
    });
  });

  // ============================================================
  // Omitted collection-typed param with all-defaulted fields (Stage 2 synthesis)
  // ============================================================

  describe('omitted collection param with all-defaulted fields', () => {
    it('synthesizes empty dict and hydrates field defaults when param omitted', () => {
      const params: RillParam[] = [
        makeParam('a', { kind: 'string' }),
        {
          name: 'b',
          type: {
            kind: 'dict',
            fields: {
              c: { type: { kind: 'number' }, defaultValue: 3 },
            },
          },
          defaultValue: undefined,
          annotations: {},
        },
      ];
      // Only first arg supplied; dict param 'b' omitted
      const result = marshalArgs(['test'], params, opts);
      expect(result).toEqual({ a: 'test', b: { c: 3 } });
    });

    it('synthesizes empty ordered and hydrates field defaults when param omitted', () => {
      const params: RillParam[] = [
        makeParam('a', { kind: 'string' }),
        {
          name: 'b',
          type: {
            kind: 'ordered',
            fields: [
              {
                name: 'x',
                type: { kind: 'number' },
                defaultValue: 10,
              },
              {
                name: 'y',
                type: { kind: 'string' },
                defaultValue: 'hi',
              },
            ],
          },
          defaultValue: undefined,
          annotations: {},
        },
      ];
      const result = marshalArgs(['test'], params, opts);
      const ordered = (result as Record<string, unknown>).b as {
        __rill_ordered: boolean;
        entries: [string, unknown][];
      };
      expect((result as Record<string, unknown>).a).toBe('test');
      expect(ordered.__rill_ordered).toBe(true);
      expect(ordered.entries).toEqual([
        ['x', 10],
        ['y', 'hi'],
      ]);
    });

    it('throws RILL-R001 when omitted dict param has a field without default', () => {
      const params: RillParam[] = [
        makeParam('a', { kind: 'string' }),
        {
          name: 'b',
          type: {
            kind: 'dict',
            fields: {
              c: { type: { kind: 'number' }, defaultValue: 3 },
              d: { type: { kind: 'string' } }, // no default
            },
          },
          defaultValue: undefined,
          annotations: {},
        },
      ];
      // Omitting 'b' synthesizes empty dict, but field 'd' has no default
      // Stage 3 type-check catches the missing required field with RILL-R001
      expect(() => marshalArgs(['test'], params, opts)).toThrow(RuntimeError);
      try {
        marshalArgs(['test'], params, opts);
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as RuntimeError).errorId).toBe('RILL-R001');
      }
    });
  });

  describe('IC-3: closure params with defaultValue marshal correctly', () => {
    it('marshals closure-style params where trailing defaults fill omitted args', () => {
      // Simulates a closure |x: string, y: number = 5, z: bool = true| { ... }
      // Called with only x supplied; y and z hydrate from defaults
      const params = [
        makeParam('x', { kind: 'string' }),
        makeParam('y', { kind: 'number' }, 5),
        makeParam('z', { kind: 'bool' }, true),
      ];
      const result = marshalArgs(['hello'], params, opts);
      expect(result).toEqual({ x: 'hello', y: 5, z: true });
    });

    it('overrides defaultValue when caller supplies explicit arg', () => {
      // Closure |a: number = 10, b: number = 20| called with both args
      const params = [
        makeParam('a', { kind: 'number' }, 10),
        makeParam('b', { kind: 'number' }, 20),
      ];
      const result = marshalArgs([99, 42], params, opts);
      expect(result).toEqual({ a: 99, b: 42 });
    });

    it('handles single defaulted param with no args supplied', () => {
      // Closure |x: string = "fallback"| called with zero args
      const params = [makeParam('x', { kind: 'string' }, 'fallback')];
      const result = marshalArgs([], params, opts);
      expect(result).toEqual({ x: 'fallback' });
    });

    it('handles mixed required and defaulted params with partial args', () => {
      // Closure |a: number, b: string = "default", c: number = 0|
      // Called with a and b supplied; c hydrates from default
      const params = [
        makeParam('a', { kind: 'number' }),
        makeParam('b', { kind: 'string' }, 'default'),
        makeParam('c', { kind: 'number' }, 0),
      ];
      const result = marshalArgs([7, 'custom'], params, opts);
      expect(result).toEqual({ a: 7, b: 'custom', c: 0 });
    });
  });

  describe('BC-2: zero-default tuple with exact-length value', () => {
    it('passes through when tuple matches element count with no defaults', () => {
      const params: RillParam[] = [
        {
          name: 'pair',
          type: {
            kind: 'tuple',
            elements: [
              { type: { kind: 'number' } },
              { type: { kind: 'string' } },
            ],
          },
          defaultValue: undefined,
          annotations: {},
        },
      ];
      const arg = createTuple([42, 'hello']);
      const result = marshalArgs([arg], params, opts);
      const tuple = (result as Record<string, unknown>).pair as {
        __rill_tuple: boolean;
        entries: unknown[];
      };
      expect(tuple.__rill_tuple).toBe(true);
      expect(tuple.entries).toEqual([42, 'hello']);
    });
  });

  // ============================================================
  // FR-DFIELD-2: RillFieldDef consumers handle optional annotations
  // ============================================================

  describe('RillFieldDef with optional annotations in marshalArgs', () => {
    it('marshals dict param whose fields carry annotations', () => {
      const params: RillParam[] = [
        {
          name: 'opts',
          type: {
            kind: 'dict',
            fields: {
              a: {
                type: { kind: 'string' },
                defaultValue: 'hi',
                annotations: { description: 'greeting' },
              },
              b: { type: { kind: 'number' } },
            },
          },
          defaultValue: undefined,
          annotations: {},
        },
      ];
      // Annotations on RillFieldDef do not affect marshal behavior
      const result = marshalArgs([{ b: 42 }], params, opts);
      expect(result).toEqual({ opts: { a: 'hi', b: 42 } });
    });

    it('marshals dict param whose fields omit annotations', () => {
      const params: RillParam[] = [
        {
          name: 'cfg',
          type: {
            kind: 'dict',
            fields: {
              x: { type: { kind: 'number' }, defaultValue: 10 },
            },
          },
          defaultValue: undefined,
          annotations: {},
        },
      ];
      // No annotations property on field — should still hydrate defaults
      const result = marshalArgs([{}], params, opts);
      expect(result).toEqual({ cfg: { x: 10 } });
    });

    it('marshals param with annotations on the param itself', () => {
      const params: RillParam[] = [
        {
          name: 'x',
          type: { kind: 'number' },
          defaultValue: 5,
          annotations: { description: 'count' },
        },
      ];
      // Param-level annotations do not affect marshaling
      const result = marshalArgs([], params, opts);
      expect(result).toEqual({ x: 5 });
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
  describe('AC-4: closure with default → RillFieldDef with defaultValue', () => {
    it('returns RillFieldDef with defaultValue for param with default', async () => {
      // |y: number = 2| produces a typed param with a default value
      const result = (await run(
        '|y: number = 2| { $y } => $fn\n$fn.^input'
      )) as {
        __rill_type: boolean;
        typeName: string;
        structure: {
          type: string;
          fields: { name: string; type: unknown; defaultValue?: unknown }[];
        };
      };
      expect(result['__rill_type']).toBe(true);
      expect(result.typeName).toBe('ordered');
      const fields = result.structure.fields;
      expect(fields).toHaveLength(1);
      expect(fields[0]!.name).toBe('y');
      expect(fields[0]!.defaultValue).toBe(2);
    });

    it('mixed params: defaulted has defaultValue, required omits it', async () => {
      // |x: string, y: number = 10| — x has no default, y has default
      const result = (await run(
        '|x: string, y: number = 10| { $x } => $fn\n$fn.^input'
      )) as {
        structure: {
          type: string;
          fields: { name: string; type: unknown; defaultValue?: unknown }[];
        };
      };
      const fields = result.structure.fields;
      expect(fields).toHaveLength(2);
      // x: no default → no defaultValue property
      expect(fields[0]!.name).toBe('x');
      expect(fields[0]).not.toHaveProperty('defaultValue');
      // y: default=10 → defaultValue present
      expect(fields[1]!.name).toBe('y');
      expect(fields[1]!.defaultValue).toBe(10);
    });
  });

  describe('AC-19: closure without defaults → RillFieldDef without defaultValue', () => {
    it('returns RillFieldDef fields without defaultValue for undefaulted params', async () => {
      const result = (await run(
        '|x: string, y: number| { $x } => $fn\n$fn.^input'
      )) as {
        __rill_type: boolean;
        typeName: string;
        structure: {
          type: string;
          fields: { name: string; type: unknown; defaultValue?: unknown }[];
        };
      };
      expect(result['__rill_type']).toBe(true);
      expect(result.typeName).toBe('ordered');
      const fields = result.structure.fields;
      expect(fields).toHaveLength(2);
      // Both params have no defaults: no defaultValue property
      expect(fields[0]!.name).toBe('x');
      expect(fields[0]).not.toHaveProperty('defaultValue');
      expect(fields[1]!.name).toBe('y');
      expect(fields[1]).not.toHaveProperty('defaultValue');
    });
  });

  describe('AC-20: untyped callable → empty ordered type', () => {
    it('callable() factory (untyped host callable) returns empty ordered type for .^input', async () => {
      // The callable() factory sets params to undefined (untyped).
      // evaluateAnnotationAccess returns structureToTypeValue({ kind: 'ordered', fields: [] }) for this case.
      const { callable } = await import('@rcrsr/rill');
      const result = (await run('$fn.^input', {
        variables: {
          fn: callable(() => null),
        },
      })) as {
        __rill_type: boolean;
        typeName: string;
        structure: { type: string; fields: unknown[] };
      };
      expect(result['__rill_type']).toBe(true);
      expect(result.typeName).toBe('ordered');
      expect(result.structure.fields).toEqual([]);
    });

    it('explicit zero-param closure (||{}) returns empty ordered type for .^input', async () => {
      // ||{ ... } is a closure with an explicit empty param list (params = [])
      const result = (await run('||{ "result" } => $fn\n$fn.^input')) as {
        __rill_type: boolean;
        typeName: string;
        structure: { type: string; fields: unknown[] };
      };
      expect(result['__rill_type']).toBe(true);
      expect(result.typeName).toBe('ordered');
      expect(result.structure.fields).toEqual([]);
    });
  });
});
