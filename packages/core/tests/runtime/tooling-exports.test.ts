/**
 * Test tooling-facing exports from src/index.ts
 */

import { describe, it, expect } from 'vitest';
import { BUILTIN_FUNCTIONS, KEYWORDS } from '@rcrsr/rill';
import { BUILTIN_FUNCTIONS as INTERNAL_BUILTIN_FUNCTIONS } from '../../src/runtime/ext/builtins.js';
import { KEYWORDS as INTERNAL_KEYWORDS } from '../../src/lexer/operators.js';

describe('Tooling Exports', () => {
  describe('BUILTIN_FUNCTIONS', () => {
    it('is exported from src/index.ts as a readonly string array', () => {
      expect(Array.isArray(BUILTIN_FUNCTIONS)).toBe(true);
      expect(BUILTIN_FUNCTIONS.length).toBeGreaterThan(0);
      for (const name of BUILTIN_FUNCTIONS) {
        expect(typeof name).toBe('string');
      }
    });

    it('is frozen and rejects mutation at runtime', () => {
      expect(Object.isFrozen(BUILTIN_FUNCTIONS)).toBe(true);
      expect(() =>
        (BUILTIN_FUNCTIONS as string[]).push('not_a_real_function')
      ).toThrow();
    });

    it('lists exactly the keys of the internal builtin function record', () => {
      const internalNames = Object.keys(INTERNAL_BUILTIN_FUNCTIONS);
      expect(BUILTIN_FUNCTIONS.length).toBe(internalNames.length);
      expect(new Set(BUILTIN_FUNCTIONS)).toEqual(new Set(internalNames));
    });
  });

  describe('KEYWORDS', () => {
    it('is exported from src/index.ts as a readonly string array', () => {
      expect(Array.isArray(KEYWORDS)).toBe(true);
      expect(KEYWORDS.length).toBeGreaterThan(0);
      for (const name of KEYWORDS) {
        expect(typeof name).toBe('string');
      }
    });

    it('is frozen and rejects mutation at runtime', () => {
      expect(Object.isFrozen(KEYWORDS)).toBe(true);
      expect(() => (KEYWORDS as string[]).push('not_a_real_keyword')).toThrow();
    });

    it('lists exactly the keys of the internal keyword record', () => {
      const internalNames = Object.keys(INTERNAL_KEYWORDS);
      expect(KEYWORDS.length).toBe(internalNames.length);
      expect(new Set(KEYWORDS)).toEqual(new Set(internalNames));
    });
  });
});
