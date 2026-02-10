/**
 * Tests for iterator value utilities
 * Verifies formatValue for iterator type
 */

import { describe, expect, it } from 'vitest';
import { callable } from '../../src/runtime/core/callable.js';
import { formatValue, isRillIterator } from '../../src/runtime/core/values.js';

describe('Iterator value utilities', () => {
  describe('formatValue', () => {
    it('returns "[iterator]" for a valid iterator (not-done with value+next)', () => {
      const iterator = {
        done: false,
        value: 1,
        next: callable(() => ({
          done: true,
          next: callable(() => ({ done: true, next: callable(() => ({})) })),
        })),
      };
      expect(formatValue(iterator)).toBe('[iterator]');
    });

    it('returns "[iterator]" for a done iterator (done=true with next)', () => {
      const iterator = {
        done: true,
        next: callable(() => ({ done: true, next: callable(() => ({})) })),
      };
      expect(formatValue(iterator)).toBe('[iterator]');
    });

    it('correctly identifies iterator via isRillIterator guard', () => {
      const iterator = {
        done: false,
        value: 42,
        next: callable(() => ({
          done: true,
          next: callable(() => ({ done: true, next: callable(() => ({})) })),
        })),
      };
      expect(isRillIterator(iterator)).toBe(true);
    });

    it('correctly rejects non-iterator dicts', () => {
      expect(isRillIterator({ done: true })).toBe(false);
      expect(isRillIterator({ next: callable(() => ({})) })).toBe(false);
      expect(isRillIterator({ done: 'true', next: callable(() => ({})) })).toBe(
        false
      );
    });
  });
});
