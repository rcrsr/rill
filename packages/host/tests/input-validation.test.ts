/**
 * Unit tests for validateInputParams() and injectDefaults().
 *
 * Both functions are exported from routes.ts and tested directly here.
 *
 * Covered:
 *   validateInputParams:
 *     - Returns [] for valid params (required param provided, correct type)
 *     - Missing required param → { param: 'x', message: 'required' } [EC-8]
 *     - Type mismatch → { param: 'score', message: 'expected number, got string' } [EC-9]
 *     - Multiple failures returned in single call, in manifest key order [AC-14]
 *     - null for required param fails required check [AC-18]
 *     - Extra undeclared params produce no issue
 *     - Missing optional param produces no issue
 *     - params undefined treated as {} — all required params fail
 *     - bool type → "boolean" in error message
 *
 *   injectDefaults:
 *     - Injects defaults for absent keys where descriptor.default is set
 *     - Does NOT overwrite provided values
 *     - Returns new object (original not mutated)
 *     - null is valid default — injected when param absent [AC-19]
 *     - Params not in schema pass through unchanged
 *     - Does not throw [EC-10]
 */

import { describe, it, expect } from 'vitest';
import { validateInputParams, injectDefaults } from '../src/routes.js';
import type { InputValidationIssue } from '../src/routes.js';
import type { InputSchema } from '@rcrsr/rill-compose';

// ============================================================
// validateInputParams
// ============================================================

describe('validateInputParams', () => {
  // --------------------------------------------------------
  // Returns [] for valid params
  // --------------------------------------------------------
  describe('valid params', () => {
    it('returns [] when required string param is provided with correct type', () => {
      const schema: InputSchema = {
        query: { type: 'string', required: true },
      };
      const issues = validateInputParams({ query: 'hello' }, schema);
      expect(issues).toEqual([]);
    });

    it('returns [] when required number param is provided with correct type', () => {
      const schema: InputSchema = {
        score: { type: 'number', required: true },
      };
      const issues = validateInputParams({ score: 42 }, schema);
      expect(issues).toEqual([]);
    });

    it('returns [] when required bool param is provided with correct type', () => {
      const schema: InputSchema = {
        active: { type: 'bool', required: true },
      };
      const issues = validateInputParams({ active: true }, schema);
      expect(issues).toEqual([]);
    });

    it('returns [] when required list param is provided with correct type', () => {
      const schema: InputSchema = {
        tags: { type: 'list', required: true },
      };
      const issues = validateInputParams({ tags: ['a', 'b'] }, schema);
      expect(issues).toEqual([]);
    });

    it('returns [] when required dict param is provided with correct type', () => {
      const schema: InputSchema = {
        meta: { type: 'dict', required: true },
      };
      const issues = validateInputParams({ meta: { key: 'val' } }, schema);
      expect(issues).toEqual([]);
    });

    it('returns [] when schema is empty', () => {
      const schema: InputSchema = {};
      const issues = validateInputParams({ anything: 'x' }, schema);
      expect(issues).toEqual([]);
    });

    it('returns [] for optional param that is provided with correct type', () => {
      const schema: InputSchema = {
        limit: { type: 'number', required: false },
      };
      const issues = validateInputParams({ limit: 10 }, schema);
      expect(issues).toEqual([]);
    });
  });

  // --------------------------------------------------------
  // Missing required param [EC-8]
  // --------------------------------------------------------
  describe('missing required param [EC-8]', () => {
    it('returns required issue when required string param is absent', () => {
      const schema: InputSchema = {
        query: { type: 'string', required: true },
      };
      const issues = validateInputParams({}, schema);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toEqual<InputValidationIssue>({
        param: 'query',
        message: 'required',
      });
    });

    it('returns required issue when required number param is absent', () => {
      const schema: InputSchema = {
        count: { type: 'number', required: true },
      };
      const issues = validateInputParams({}, schema);
      expect(issues[0]).toEqual<InputValidationIssue>({
        param: 'count',
        message: 'required',
      });
    });
  });

  // --------------------------------------------------------
  // Type mismatch [EC-9]
  // --------------------------------------------------------
  describe('type mismatch [EC-9]', () => {
    it('returns type mismatch issue when number param receives string', () => {
      const schema: InputSchema = {
        score: { type: 'number', required: true },
      };
      const issues = validateInputParams({ score: 'high' }, schema);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toEqual<InputValidationIssue>({
        param: 'score',
        message: 'expected number, got string',
      });
    });

    it('returns type mismatch issue when string param receives number', () => {
      const schema: InputSchema = {
        name: { type: 'string', required: true },
      };
      const issues = validateInputParams({ name: 42 }, schema);
      expect(issues[0]).toEqual<InputValidationIssue>({
        param: 'name',
        message: 'expected string, got number',
      });
    });

    it('returns "expected boolean" (not "expected bool") for bool type mismatch', () => {
      const schema: InputSchema = {
        active: { type: 'bool', required: true },
      };
      const issues = validateInputParams({ active: 'yes' }, schema);
      expect(issues[0]).toEqual<InputValidationIssue>({
        param: 'active',
        message: 'expected boolean, got string',
      });
    });

    it('returns type mismatch for list param receiving a dict', () => {
      const schema: InputSchema = {
        items: { type: 'list', required: false },
      };
      const issues = validateInputParams({ items: { key: 'val' } }, schema);
      expect(issues[0]?.message).toBe('expected list, got dict');
    });

    it('returns type mismatch for dict param receiving an array', () => {
      const schema: InputSchema = {
        meta: { type: 'dict', required: false },
      };
      const issues = validateInputParams({ meta: [1, 2, 3] }, schema);
      expect(issues[0]?.message).toBe('expected dict, got list');
    });
  });

  // --------------------------------------------------------
  // Multiple failures in single call, manifest key order [AC-14]
  // --------------------------------------------------------
  describe('multiple failures in single call [AC-14]', () => {
    it('returns all failures without short-circuiting', () => {
      const schema: InputSchema = {
        query: { type: 'string', required: true },
        limit: { type: 'number', required: true },
        active: { type: 'bool', required: true },
      };
      const issues = validateInputParams({}, schema);
      expect(issues).toHaveLength(3);
    });

    it('returns failures in manifest key order', () => {
      const schema: InputSchema = {
        first: { type: 'string', required: true },
        second: { type: 'number', required: true },
        third: { type: 'bool', required: true },
      };
      const issues = validateInputParams({}, schema);
      expect(issues[0]?.param).toBe('first');
      expect(issues[1]?.param).toBe('second');
      expect(issues[2]?.param).toBe('third');
    });

    it('returns both required and type issues in a single call', () => {
      const schema: InputSchema = {
        query: { type: 'string', required: true },
        score: { type: 'number', required: false },
      };
      // query is missing (required), score has wrong type
      const issues = validateInputParams({ score: 'bad' }, schema);
      const params = issues.map((i) => i.param);
      expect(params).toContain('query');
      expect(params).toContain('score');
    });
  });

  // --------------------------------------------------------
  // null for required param [AC-18]
  // --------------------------------------------------------
  describe('null for required param [AC-18]', () => {
    it('returns required issue when null is provided for required param', () => {
      const schema: InputSchema = {
        feedback: { type: 'string', required: true },
      };
      const issues = validateInputParams({ feedback: null }, schema);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toEqual<InputValidationIssue>({
        param: 'feedback',
        message: 'required',
      });
    });

    it('does not return type mismatch when null fails required check', () => {
      const schema: InputSchema = {
        score: { type: 'number', required: true },
      };
      const issues = validateInputParams({ score: null }, schema);
      // Only required issue, no type mismatch
      expect(issues).toHaveLength(1);
      expect(issues[0]?.message).toBe('required');
    });
  });

  // --------------------------------------------------------
  // Extra undeclared params produce no issue
  // --------------------------------------------------------
  describe('extra undeclared params', () => {
    it('produces no issue for params not in schema', () => {
      const schema: InputSchema = {
        query: { type: 'string', required: true },
      };
      const issues = validateInputParams(
        { query: 'hello', extra: 'ignored', another: 42 },
        schema
      );
      expect(issues).toEqual([]);
    });
  });

  // --------------------------------------------------------
  // Missing optional param produces no issue
  // --------------------------------------------------------
  describe('missing optional param', () => {
    it('produces no issue when optional param is absent', () => {
      const schema: InputSchema = {
        limit: { type: 'number', required: false },
      };
      const issues = validateInputParams({}, schema);
      expect(issues).toEqual([]);
    });

    it('produces no issue when param has no required field and is absent', () => {
      const schema: InputSchema = {
        tag: { type: 'string' },
      };
      const issues = validateInputParams({}, schema);
      expect(issues).toEqual([]);
    });
  });

  // --------------------------------------------------------
  // params undefined treated as {} — all required params fail
  // --------------------------------------------------------
  describe('params undefined treated as {}', () => {
    it('treats undefined params as {} and reports all required params missing', () => {
      const schema: InputSchema = {
        query: { type: 'string', required: true },
        count: { type: 'number', required: true },
      };
      const issues = validateInputParams(undefined, schema);
      expect(issues).toHaveLength(2);
      const params = issues.map((i) => i.param);
      expect(params).toContain('query');
      expect(params).toContain('count');
    });

    it('returns [] when params is undefined and schema is empty', () => {
      const issues = validateInputParams(undefined, {});
      expect(issues).toEqual([]);
    });
  });
});

// ============================================================
// injectDefaults
// ============================================================

describe('injectDefaults', () => {
  // --------------------------------------------------------
  // Injects defaults for absent keys
  // --------------------------------------------------------
  describe('default injection', () => {
    it('injects default value for absent param', () => {
      const schema: InputSchema = {
        limit: { type: 'number', default: 10 },
      };
      const result = injectDefaults({}, schema);
      expect(result['limit']).toBe(10);
    });

    it('injects string default for absent param', () => {
      const schema: InputSchema = {
        mode: { type: 'string', default: 'fast' },
      };
      const result = injectDefaults({}, schema);
      expect(result['mode']).toBe('fast');
    });

    it('injects boolean default for absent param', () => {
      const schema: InputSchema = {
        verbose: { type: 'bool', default: false },
      };
      const result = injectDefaults({}, schema);
      expect(result['verbose']).toBe(false);
    });

    it('injects array default for absent param', () => {
      const schema: InputSchema = {
        tags: { type: 'list', default: [] },
      };
      const result = injectDefaults({}, schema);
      expect(result['tags']).toEqual([]);
    });

    it('injects multiple defaults in a single call', () => {
      const schema: InputSchema = {
        limit: { type: 'number', default: 10 },
        mode: { type: 'string', default: 'auto' },
      };
      const result = injectDefaults({}, schema);
      expect(result['limit']).toBe(10);
      expect(result['mode']).toBe('auto');
    });
  });

  // --------------------------------------------------------
  // Does NOT overwrite provided values
  // --------------------------------------------------------
  describe('does not overwrite provided values', () => {
    it('preserves caller-provided value over default', () => {
      const schema: InputSchema = {
        limit: { type: 'number', default: 10 },
      };
      const result = injectDefaults({ limit: 50 }, schema);
      expect(result['limit']).toBe(50);
    });

    it('preserves caller-provided 0 over non-zero default', () => {
      const schema: InputSchema = {
        count: { type: 'number', default: 5 },
      };
      const result = injectDefaults({ count: 0 }, schema);
      expect(result['count']).toBe(0);
    });

    it('preserves caller-provided empty string over string default', () => {
      const schema: InputSchema = {
        mode: { type: 'string', default: 'auto' },
      };
      const result = injectDefaults({ mode: '' }, schema);
      expect(result['mode']).toBe('');
    });
  });

  // --------------------------------------------------------
  // Returns new object — original not mutated
  // --------------------------------------------------------
  describe('returns new object without mutating original', () => {
    it('does not mutate the original params object', () => {
      const schema: InputSchema = {
        limit: { type: 'number', default: 10 },
      };
      const original = { query: 'hello' };
      injectDefaults(original, schema);
      expect(Object.prototype.hasOwnProperty.call(original, 'limit')).toBe(
        false
      );
    });

    it('returns a new object reference', () => {
      const schema: InputSchema = {
        limit: { type: 'number', default: 10 },
      };
      const original = { query: 'hello' };
      const result = injectDefaults(original, schema);
      expect(result).not.toBe(original);
    });
  });

  // --------------------------------------------------------
  // null is a valid default [AC-19]
  // --------------------------------------------------------
  describe('null default [AC-19]', () => {
    it('injects null default when param is absent', () => {
      const schema: InputSchema = {
        token: { type: 'string', default: null },
      };
      const result = injectDefaults({}, schema);
      expect(Object.prototype.hasOwnProperty.call(result, 'token')).toBe(true);
      expect(result['token']).toBeNull();
    });

    it('does not overwrite provided value with null default', () => {
      const schema: InputSchema = {
        token: { type: 'string', default: null },
      };
      const result = injectDefaults({ token: 'abc' }, schema);
      expect(result['token']).toBe('abc');
    });
  });

  // --------------------------------------------------------
  // Params not in schema pass through unchanged
  // --------------------------------------------------------
  describe('params not in schema pass through', () => {
    it('preserves extra params not declared in schema', () => {
      const schema: InputSchema = {
        limit: { type: 'number', default: 10 },
      };
      const result = injectDefaults({ extra: 'value', other: 99 }, schema);
      expect(result['extra']).toBe('value');
      expect(result['other']).toBe(99);
    });
  });

  // --------------------------------------------------------
  // Does not throw [EC-10]
  // --------------------------------------------------------
  describe('does not throw [EC-10]', () => {
    it('does not throw for empty params and empty schema', () => {
      expect(() => injectDefaults({}, {})).not.toThrow();
    });

    it('does not throw for params with no schema defaults', () => {
      const schema: InputSchema = {
        query: { type: 'string', required: true },
      };
      expect(() => injectDefaults({ query: 'test' }, schema)).not.toThrow();
    });

    it('does not throw when all params are provided and no defaults needed', () => {
      const schema: InputSchema = {
        a: { type: 'string', default: 'x' },
        b: { type: 'number', default: 1 },
      };
      expect(() =>
        injectDefaults({ a: 'provided', b: 42 }, schema)
      ).not.toThrow();
    });
  });
});
