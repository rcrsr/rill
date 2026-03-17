/**
 * Tests for iterator value utilities
 * Verifies formatValue for iterator type
 *
 * Integration tests:
 * EC-3: iterator == iterator raises RILL-R002 via script execution
 */

import { describe, expect, it } from 'vitest';
import { callable, formatValue, isIterator } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

describe('Iterator value utilities', () => {
  describe('formatValue', () => {
    it('returns "type(iterator)" for a valid iterator (not-done with value+next)', () => {
      const iterator = {
        done: false,
        value: 1,
        next: callable(() => ({
          done: true,
          next: callable(() => ({ done: true, next: callable(() => ({})) })),
        })),
      };
      expect(formatValue(iterator)).toBe('type(iterator)');
    });

    it('returns "type(iterator)" for a done iterator (done=true with next)', () => {
      const iterator = {
        done: true,
        next: callable(() => ({ done: true, next: callable(() => ({})) })),
      };
      expect(formatValue(iterator)).toBe('type(iterator)');
    });

    it('correctly identifies iterator via isIterator guard', () => {
      const iterator = {
        done: false,
        value: 42,
        next: callable(() => ({
          done: true,
          next: callable(() => ({ done: true, next: callable(() => ({})) })),
        })),
      };
      expect(isIterator(iterator)).toBe(true);
    });

    it('correctly rejects non-iterator dicts', () => {
      expect(isIterator({ done: true })).toBe(false);
      expect(isIterator({ next: callable(() => ({})) })).toBe(false);
      expect(isIterator({ done: 'true', next: callable(() => ({})) })).toBe(
        false
      );
    });
  });

  // ============================================================
  // Integration: EC-3 iterator equality via script execution
  // ============================================================

  describe('EC-3 integration: iterator equality via script', () => {
    it('raises RILL-R002 for iterator == iterator', async () => {
      await expect(run('range(1, 3) == range(1, 3)')).rejects.toHaveProperty(
        'errorId',
        'RILL-R002'
      );
    });

    it('raises RILL-R002 for iterator != iterator', async () => {
      await expect(run('range(1, 3) != range(4, 6)')).rejects.toHaveProperty(
        'errorId',
        'RILL-R002'
      );
    });
  });
});
