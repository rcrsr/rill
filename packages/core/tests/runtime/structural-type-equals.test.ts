/**
 * Tests for structureEquals default value comparison.
 *
 * Verifies that two structural types with identical field types but
 * different default values are NOT considered equal (IR-7).
 */

import {
  type TypeStructure,
  type RillParam,
  type ApplicationCallable,
  anyTypeValue,
  commonType,
  structureEquals,
  structureMatches,
} from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

/**
 * Helper: create a minimal ApplicationCallable for structureMatches tests.
 * Only the fields inspected by the closure branch are populated.
 */
function makeCallable(
  params: readonly RillParam[],
  returnType = anyTypeValue
): ApplicationCallable {
  return {
    __type: 'callable',
    kind: 'application',
    isProperty: false,
    params,
    annotations: {},
    returnType,
    fn: async () => null,
  };
}

describe('structureEquals', () => {
  describe('dict branch - default value comparison', () => {
    it('returns true when both fields have identical defaults', () => {
      const a: TypeStructure = {
        kind: 'dict',
        fields: { x: { type: { kind: 'number' }, defaultValue: 42 } },
      };
      const b: TypeStructure = {
        kind: 'dict',
        fields: { x: { type: { kind: 'number' }, defaultValue: 42 } },
      };
      expect(structureEquals(a, b)).toBe(true);
    });

    it('returns false when fields have different default values', () => {
      const a: TypeStructure = {
        kind: 'dict',
        fields: { x: { type: { kind: 'number' }, defaultValue: 1 } },
      };
      const b: TypeStructure = {
        kind: 'dict',
        fields: { x: { type: { kind: 'number' }, defaultValue: 2 } },
      };
      expect(structureEquals(a, b)).toBe(false);
    });

    it('returns false when one field has a default and the other does not', () => {
      const a: TypeStructure = {
        kind: 'dict',
        fields: { x: { type: { kind: 'number' }, defaultValue: 0 } },
      };
      const b: TypeStructure = {
        kind: 'dict',
        fields: { x: { type: { kind: 'number' } } },
      };
      expect(structureEquals(a, b)).toBe(false);
    });

    it('returns true when neither field has a default', () => {
      const a: TypeStructure = {
        kind: 'dict',
        fields: { x: { type: { kind: 'number' } } },
      };
      const b: TypeStructure = {
        kind: 'dict',
        fields: { x: { type: { kind: 'number' } } },
      };
      expect(structureEquals(a, b)).toBe(true);
    });

    it('returns false when string defaults differ', () => {
      const a: TypeStructure = {
        kind: 'dict',
        fields: { name: { type: { kind: 'string' }, defaultValue: 'Alice' } },
      };
      const b: TypeStructure = {
        kind: 'dict',
        fields: { name: { type: { kind: 'string' }, defaultValue: 'Bob' } },
      };
      expect(structureEquals(a, b)).toBe(false);
    });
  });

  describe('ordered branch - default value comparison', () => {
    it('returns true when both fields have identical defaults', () => {
      const a: TypeStructure = {
        kind: 'ordered',
        fields: [{ name: 'x', type: { kind: 'number' }, defaultValue: 10 }],
      };
      const b: TypeStructure = {
        kind: 'ordered',
        fields: [{ name: 'x', type: { kind: 'number' }, defaultValue: 10 }],
      };
      expect(structureEquals(a, b)).toBe(true);
    });

    it('returns false when fields have different default values', () => {
      const a: TypeStructure = {
        kind: 'ordered',
        fields: [{ name: 'x', type: { kind: 'number' }, defaultValue: 1 }],
      };
      const b: TypeStructure = {
        kind: 'ordered',
        fields: [{ name: 'x', type: { kind: 'number' }, defaultValue: 2 }],
      };
      expect(structureEquals(a, b)).toBe(false);
    });

    it('returns false when one field has a default and the other does not', () => {
      const a: TypeStructure = {
        kind: 'ordered',
        fields: [{ name: 'x', type: { kind: 'number' }, defaultValue: 0 }],
      };
      const b: TypeStructure = {
        kind: 'ordered',
        fields: [{ name: 'x', type: { kind: 'number' } }],
      };
      expect(structureEquals(a, b)).toBe(false);
    });

    it('returns true when neither field has a default', () => {
      const a: TypeStructure = {
        kind: 'ordered',
        fields: [{ name: 'x', type: { kind: 'number' } }],
      };
      const b: TypeStructure = {
        kind: 'ordered',
        fields: [{ name: 'x', type: { kind: 'number' } }],
      };
      expect(structureEquals(a, b)).toBe(true);
    });

    it('compares multiple fields including defaults correctly', () => {
      const a: TypeStructure = {
        kind: 'ordered',
        fields: [
          { name: 'x', type: { kind: 'number' } },
          { name: 'y', type: { kind: 'string' }, defaultValue: 'hello' },
        ],
      };
      const b: TypeStructure = {
        kind: 'ordered',
        fields: [
          { name: 'x', type: { kind: 'number' } },
          { name: 'y', type: { kind: 'string' }, defaultValue: 'world' },
        ],
      };
      expect(structureEquals(a, b)).toBe(false);
    });

    it('two ordered types with identical defaults compare equal [AC-10]', () => {
      const a: TypeStructure = {
        kind: 'ordered',
        fields: [
          { name: 'x', type: { kind: 'number' }, defaultValue: 10 },
          { name: 'y', type: { kind: 'string' }, defaultValue: 'ok' },
        ],
      };
      const b: TypeStructure = {
        kind: 'ordered',
        fields: [
          { name: 'x', type: { kind: 'number' }, defaultValue: 10 },
          { name: 'y', type: { kind: 'string' }, defaultValue: 'ok' },
        ],
      };
      expect(structureEquals(a, b)).toBe(true);
    });

    it('two ordered types differing only in default compare not-equal [AC-11]', () => {
      const a: TypeStructure = {
        kind: 'ordered',
        fields: [
          { name: 'x', type: { kind: 'number' }, defaultValue: 10 },
          { name: 'y', type: { kind: 'string' }, defaultValue: 'ok' },
        ],
      };
      const b: TypeStructure = {
        kind: 'ordered',
        fields: [
          { name: 'x', type: { kind: 'number' }, defaultValue: 10 },
          { name: 'y', type: { kind: 'string' }, defaultValue: 'nope' },
        ],
      };
      expect(structureEquals(a, b)).toBe(false);
    });
  });

  describe('tuple branch - default value comparison', () => {
    it('returns true when both elements have identical defaults', () => {
      const a: TypeStructure = {
        kind: 'tuple',
        elements: [{ type: { kind: 'number' }, defaultValue: 5 }],
      };
      const b: TypeStructure = {
        kind: 'tuple',
        elements: [{ type: { kind: 'number' }, defaultValue: 5 }],
      };
      expect(structureEquals(a, b)).toBe(true);
    });

    it('returns false when elements have different default values', () => {
      const a: TypeStructure = {
        kind: 'tuple',
        elements: [{ type: { kind: 'number' }, defaultValue: 1 }],
      };
      const b: TypeStructure = {
        kind: 'tuple',
        elements: [{ type: { kind: 'number' }, defaultValue: 2 }],
      };
      expect(structureEquals(a, b)).toBe(false);
    });

    it('returns false when one element has a default and the other does not', () => {
      const a: TypeStructure = {
        kind: 'tuple',
        elements: [{ type: { kind: 'number' }, defaultValue: 0 }],
      };
      const b: TypeStructure = {
        kind: 'tuple',
        elements: [{ type: { kind: 'number' } }],
      };
      expect(structureEquals(a, b)).toBe(false);
    });

    it('returns true when neither element has a default', () => {
      const a: TypeStructure = {
        kind: 'tuple',
        elements: [{ type: { kind: 'string' } }],
      };
      const b: TypeStructure = {
        kind: 'tuple',
        elements: [{ type: { kind: 'string' } }],
      };
      expect(structureEquals(a, b)).toBe(true);
    });

    it('compares boolean defaults correctly', () => {
      const a: TypeStructure = {
        kind: 'tuple',
        elements: [{ type: { kind: 'bool' }, defaultValue: true }],
      };
      const b: TypeStructure = {
        kind: 'tuple',
        elements: [{ type: { kind: 'bool' }, defaultValue: false }],
      };
      expect(structureEquals(a, b)).toBe(false);
    });

    it('two tuple types with identical defaults compare equal [AC-10]', () => {
      const a: TypeStructure = {
        kind: 'tuple',
        elements: [
          { type: { kind: 'number' }, defaultValue: 42 },
          { type: { kind: 'string' }, defaultValue: 'hi' },
        ],
      };
      const b: TypeStructure = {
        kind: 'tuple',
        elements: [
          { type: { kind: 'number' }, defaultValue: 42 },
          { type: { kind: 'string' }, defaultValue: 'hi' },
        ],
      };
      expect(structureEquals(a, b)).toBe(true);
    });

    it('two tuple types differing only in default compare not-equal [AC-11]', () => {
      const a: TypeStructure = {
        kind: 'tuple',
        elements: [
          { type: { kind: 'number' }, defaultValue: 42 },
          { type: { kind: 'string' }, defaultValue: 'hi' },
        ],
      };
      const b: TypeStructure = {
        kind: 'tuple',
        elements: [
          { type: { kind: 'number' }, defaultValue: 42 },
          { type: { kind: 'string' }, defaultValue: 'bye' },
        ],
      };
      expect(structureEquals(a, b)).toBe(false);
    });
  });

  describe('commonType', () => {
    it('returns the specific type when first arg is any [AC-9]', () => {
      const result = commonType({ kind: 'any' }, { kind: 'number' });
      expect(result).toEqual({ kind: 'number' });
    });

    it('returns the specific type when second arg is any (symmetric) [AC-9]', () => {
      const result = commonType({ kind: 'number' }, { kind: 'any' });
      expect(result).toEqual({ kind: 'number' });
    });

    it('returns input type for two structurally equal list(number) types [AC-10]', () => {
      const listNum: TypeStructure = {
        kind: 'list',
        element: { kind: 'number' },
      };
      const listNum2: TypeStructure = {
        kind: 'list',
        element: { kind: 'number' },
      };
      const result = commonType(listNum, listNum2);
      expect(result).toEqual({ kind: 'list', element: { kind: 'number' } });
    });

    it('returns null for incompatible leaf types [AC-14]', () => {
      const result = commonType({ kind: 'number' }, { kind: 'string' });
      expect(result).toBeNull();
    });

    it('never returns undefined for any input combination [AC-15]', () => {
      const leafTypes: TypeStructure[] = [
        { kind: 'number' },
        { kind: 'string' },
        { kind: 'bool' },
        { kind: 'vector' },
        { kind: 'type' },
        { kind: 'any' },
      ];
      const compoundTypes: TypeStructure[] = [
        { kind: 'list', element: { kind: 'number' } },
        { kind: 'dict', fields: { x: { type: { kind: 'number' } } } },
        { kind: 'tuple', elements: [{ type: { kind: 'number' } }] },
        { kind: 'ordered', fields: [{ name: 'x', type: { kind: 'number' } }] },
        { kind: 'closure', params: [] },
        { kind: 'union', members: [{ kind: 'string' }] },
      ];
      const allTypes = [...leafTypes, ...compoundTypes];

      // leaf x leaf
      for (const a of leafTypes) {
        for (const b of leafTypes) {
          expect(commonType(a, b)).not.toBeUndefined();
        }
      }

      // compound x compound
      for (const a of compoundTypes) {
        for (const b of compoundTypes) {
          expect(commonType(a, b)).not.toBeUndefined();
        }
      }

      // leaf x compound (both directions)
      for (const a of leafTypes) {
        for (const b of compoundTypes) {
          expect(commonType(a, b)).not.toBeUndefined();
          expect(commonType(b, a)).not.toBeUndefined();
        }
      }

      // Verify all 144 combinations were checked (12 types total)
      expect(allTypes).toHaveLength(12);
      expect(
        leafTypes.length * leafTypes.length +
          compoundTypes.length * compoundTypes.length +
          leafTypes.length * compoundTypes.length * 2
      ).toBe(144);
    });

    it('returns bare list for list(number) vs list(string) [AC-20]', () => {
      const listNum: TypeStructure = {
        kind: 'list',
        element: { kind: 'number' },
      };
      const listStr: TypeStructure = {
        kind: 'list',
        element: { kind: 'string' },
      };
      const result = commonType(listNum, listStr);
      expect(result).toEqual({ kind: 'list' });
    });
  });

  describe('existing behavior preserved', () => {
    it('leaf types equal by type alone', () => {
      expect(structureEquals({ kind: 'number' }, { kind: 'number' })).toBe(
        true
      );
      expect(structureEquals({ kind: 'string' }, { kind: 'bool' })).toBe(false);
    });

    it('list types compare element type recursively', () => {
      const a: TypeStructure = { kind: 'list', element: { kind: 'number' } };
      const b: TypeStructure = { kind: 'list', element: { kind: 'number' } };
      expect(structureEquals(a, b)).toBe(true);
    });

    it('union types compare members in order', () => {
      const a: TypeStructure = {
        kind: 'union',
        members: [{ kind: 'string' }, { kind: 'number' }],
      };
      const b: TypeStructure = {
        kind: 'union',
        members: [{ kind: 'string' }, { kind: 'number' }],
      };
      expect(structureEquals(a, b)).toBe(true);
    });

    it('dict fields with same types and no defaults are equal', () => {
      const a: TypeStructure = {
        kind: 'dict',
        fields: {
          x: { type: { kind: 'number' } },
          y: { type: { kind: 'string' } },
        },
      };
      const b: TypeStructure = {
        kind: 'dict',
        fields: {
          x: { type: { kind: 'number' } },
          y: { type: { kind: 'string' } },
        },
      };
      expect(structureEquals(a, b)).toBe(true);
    });
  });

  describe('closure branch - structureEquals regression guard', () => {
    it('returns false for closures differing only by defaultValue [AC-10]', () => {
      const a: TypeStructure = {
        kind: 'closure',
        params: [{ name: 'x', type: { kind: 'number' }, defaultValue: 10 }],
      };
      const b: TypeStructure = {
        kind: 'closure',
        params: [{ name: 'x', type: { kind: 'number' }, defaultValue: 99 }],
      };
      expect(structureEquals(a, b)).toBe(false);
    });

    it('returns false when one closure param has default and the other does not [AC-10]', () => {
      const a: TypeStructure = {
        kind: 'closure',
        params: [{ name: 'x', type: { kind: 'number' }, defaultValue: 10 }],
      };
      const b: TypeStructure = {
        kind: 'closure',
        params: [{ name: 'x', type: { kind: 'number' } }],
      };
      expect(structureEquals(a, b)).toBe(false);
    });

    it('returns true for closures with identical params and defaults', () => {
      const a: TypeStructure = {
        kind: 'closure',
        params: [{ name: 'x', type: { kind: 'number' }, defaultValue: 42 }],
      };
      const b: TypeStructure = {
        kind: 'closure',
        params: [{ name: 'x', type: { kind: 'number' }, defaultValue: 42 }],
      };
      expect(structureEquals(a, b)).toBe(true);
    });
  });

  describe('structureMatches - closure directional defaults', () => {
    it('closure WITH defaults satisfies annotation WITHOUT defaults [AC-8]', () => {
      const closureValue = makeCallable([
        {
          name: 'x',
          type: { kind: 'number' },
          defaultValue: 42,
          annotations: {},
        },
      ]);
      const annotation: TypeStructure = {
        kind: 'closure',
        params: [{ name: 'x', type: { kind: 'number' } }],
      };
      expect(structureMatches(closureValue, annotation)).toBe(true);
    });

    it('closure WITHOUT defaults fails annotation WITH defaults [AC-9]', () => {
      const closureValue = makeCallable([
        {
          name: 'x',
          type: { kind: 'number' },
          defaultValue: undefined,
          annotations: {},
        },
      ]);
      const annotation: TypeStructure = {
        kind: 'closure',
        params: [{ name: 'x', type: { kind: 'number' }, defaultValue: 10 }],
      };
      expect(structureMatches(closureValue, annotation)).toBe(false);
    });

    it('closure param type differs from annotation type [AC-18]', () => {
      const closureValue = makeCallable([
        {
          name: 'x',
          type: { kind: 'string' },
          defaultValue: undefined,
          annotations: {},
        },
      ]);
      const annotation: TypeStructure = {
        kind: 'closure',
        params: [{ name: 'x', type: { kind: 'number' } }],
      };
      expect(structureMatches(closureValue, annotation)).toBe(false);
    });

    it('closure missing default where annotation declares one [AC-19 / EC-5]', () => {
      const closureValue = makeCallable([
        {
          name: 'label',
          type: { kind: 'string' },
          defaultValue: undefined,
          annotations: {},
        },
      ]);
      const annotation: TypeStructure = {
        kind: 'closure',
        params: [
          { name: 'label', type: { kind: 'string' }, defaultValue: 'default' },
        ],
      };
      expect(structureMatches(closureValue, annotation)).toBe(false);
    });
  });
});
