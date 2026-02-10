/**
 * Test suite for validation utilities.
 * Validates all error contracts (EC-17, EC-18, EC-19) and acceptance criteria (AC-5, AC-6).
 */

import { describe, it, expect } from 'vitest';
import { assertRequired } from '../src/validation.js';

describe('assertRequired', () => {
  describe('EC-17: undefined throws', () => {
    it('throws Error for undefined value', () => {
      expect(() => assertRequired(undefined, 'field')).toThrow(
        'field is required'
      );
    });

    it('throws with field name in message', () => {
      expect(() => assertRequired(undefined, 'apiKey')).toThrow(
        'apiKey is required'
      );
    });
  });

  describe('EC-18: null throws', () => {
    it('throws Error for null value', () => {
      expect(() => assertRequired(null, 'field')).toThrow('field is required');
    });

    it('throws with field name in message', () => {
      expect(() => assertRequired(null, 'endpoint')).toThrow(
        'endpoint is required'
      );
    });
  });

  describe('EC-19: empty string throws', () => {
    it('throws Error for empty string', () => {
      expect(() => assertRequired('', 'field')).toThrow('field is required');
    });

    it('throws with field name in message', () => {
      expect(() => assertRequired('', 'apiKey')).toThrow('apiKey is required');
    });
  });

  describe('AC-5: non-empty string passes validation', () => {
    it('passes for non-empty string', () => {
      expect(() => assertRequired('valid', 'apiKey')).not.toThrow();
    });

    it('passes for string with spaces', () => {
      expect(() => assertRequired('  spaces  ', 'field')).not.toThrow();
    });

    it('passes for single character', () => {
      expect(() => assertRequired('a', 'field')).not.toThrow();
    });
  });

  describe('AC-6: zero passes validation', () => {
    it('passes for number zero', () => {
      expect(() => assertRequired(0, 'timeout')).not.toThrow();
    });

    it('passes for positive number', () => {
      expect(() => assertRequired(100, 'timeout')).not.toThrow();
    });

    it('passes for negative number', () => {
      expect(() => assertRequired(-1, 'timeout')).not.toThrow();
    });
  });

  describe('type narrowing', () => {
    it('narrows string | undefined to string', () => {
      const value: string | undefined = 'test';
      assertRequired(value, 'field');
      // Type assertion: value is now string (not string | undefined)
      const result: string = value;
      expect(result).toBe('test');
    });

    it('narrows number | null to number', () => {
      const value: number | null = 42;
      assertRequired(value, 'field');
      // Type assertion: value is now number (not number | null)
      const result: number = value;
      expect(result).toBe(42);
    });
  });

  describe('edge cases', () => {
    it('passes for boolean true', () => {
      expect(() => assertRequired(true, 'field')).not.toThrow();
    });

    it('passes for boolean false', () => {
      expect(() => assertRequired(false, 'field')).not.toThrow();
    });

    it('passes for object', () => {
      expect(() => assertRequired({ key: 'value' }, 'field')).not.toThrow();
    });

    it('passes for array', () => {
      expect(() => assertRequired([1, 2, 3], 'field')).not.toThrow();
    });

    it('passes for empty array', () => {
      expect(() => assertRequired([], 'field')).not.toThrow();
    });
  });
});
