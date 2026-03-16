/**
 * Rill Runtime Tests: toCallable
 *
 * Tests for RillFunction-to-ApplicationCallable conversion and validation.
 *
 * Specification Mapping:
 * - EC-1: toCallable(null) throws TypeError [AC-19]
 * - EC-1: toCallable(undefined) throws TypeError
 * - EC-2: toCallable with non-function fn throws TypeError
 * - EC-3: toCallable with non-array params throws TypeError
 * - AC-6: toCallable(valid) returns ApplicationCallable with correct fields
 */

import { describe, expect, it } from 'vitest';
import { toCallable, anyTypeValue, type RillFunction } from '@rcrsr/rill';

describe('toCallable', () => {
  describe('EC-1, AC-19: null/undefined input throws TypeError', () => {
    it('throws TypeError for null input', () => {
      expect(() => toCallable(null as unknown as RillFunction)).toThrow(
        TypeError
      );
      expect(() => toCallable(null as unknown as RillFunction)).toThrow(
        'RillFunction cannot be null or undefined'
      );
    });

    it('throws TypeError for undefined input', () => {
      expect(() => toCallable(undefined as unknown as RillFunction)).toThrow(
        TypeError
      );
      expect(() => toCallable(undefined as unknown as RillFunction)).toThrow(
        'RillFunction cannot be null or undefined'
      );
    });
  });

  describe('EC-2: non-function fn throws TypeError', () => {
    it('throws TypeError when fn is a string', () => {
      const invalid = { fn: 'notfn', params: [], returnType: anyTypeValue };
      expect(() => toCallable(invalid as unknown as RillFunction)).toThrow(
        TypeError
      );
      expect(() => toCallable(invalid as unknown as RillFunction)).toThrow(
        'RillFunction.fn must be a function'
      );
    });

    it('throws TypeError when fn is a number', () => {
      const invalid = { fn: 42, params: [], returnType: anyTypeValue };
      expect(() => toCallable(invalid as unknown as RillFunction)).toThrow(
        'RillFunction.fn must be a function'
      );
    });
  });

  describe('EC-3: non-array params throws TypeError', () => {
    it('throws TypeError when params is a string', () => {
      const invalid = {
        fn: () => null,
        params: 'notarray',
        returnType: anyTypeValue,
      };
      expect(() => toCallable(invalid as unknown as RillFunction)).toThrow(
        TypeError
      );
      expect(() => toCallable(invalid as unknown as RillFunction)).toThrow(
        'RillFunction.params must be an array'
      );
    });

    it('throws TypeError when params is an object', () => {
      const invalid = {
        fn: () => null,
        params: {},
        returnType: anyTypeValue,
      };
      expect(() => toCallable(invalid as unknown as RillFunction)).toThrow(
        'RillFunction.params must be an array'
      );
    });
  });

  describe('AC-6: valid RillFunction returns ApplicationCallable', () => {
    it('returns callable with correct __type and kind fields', () => {
      const validDef: RillFunction = {
        fn: () => 'hello',
        params: [],
        returnType: anyTypeValue,
      };

      const result = toCallable(validDef);

      expect(result.__type).toBe('callable');
      expect(result.kind).toBe('application');
    });

    it('returns callable with isProperty set to false', () => {
      const validDef: RillFunction = {
        fn: () => null,
        params: [],
        returnType: anyTypeValue,
      };

      const result = toCallable(validDef);

      expect(result.isProperty).toBe(false);
    });

    it('preserves fn reference from input definition', () => {
      const myFn = () => 42;
      const validDef: RillFunction = {
        fn: myFn,
        params: [],
        returnType: anyTypeValue,
      };

      const result = toCallable(validDef);

      expect(result.fn).toBe(myFn);
    });

    it('preserves params from input definition', () => {
      const params = [
        {
          name: 'x',
          type: { kind: 'number' as const },
          defaultValue: undefined,
          annotations: {},
        },
      ];
      const validDef: RillFunction = {
        fn: () => null,
        params,
        returnType: anyTypeValue,
      };

      const result = toCallable(validDef);

      expect(result.params).toBe(params);
      expect(result.params[0]?.name).toBe('x');
    });

    it('preserves returnType from input definition', () => {
      const validDef: RillFunction = {
        fn: () => null,
        params: [],
        returnType: anyTypeValue,
      };

      const result = toCallable(validDef);

      expect(result.returnType).toBe(anyTypeValue);
    });

    it('preserves annotations when provided', () => {
      const annotations = { description: 'A test function' };
      const validDef: RillFunction = {
        fn: () => null,
        params: [],
        returnType: anyTypeValue,
        annotations,
      };

      const result = toCallable(validDef);

      expect(result.annotations).toEqual({ description: 'A test function' });
    });

    it('defaults annotations to empty object when absent', () => {
      const validDef: RillFunction = {
        fn: () => null,
        params: [],
        returnType: anyTypeValue,
      };

      const result = toCallable(validDef);

      expect(result.annotations).toEqual({});
    });
  });
});
