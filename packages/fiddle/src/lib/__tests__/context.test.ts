/**
 * Unit tests for the context module (Task 3.5)
 *
 * Tests DEMO_CONTEXT_VALUES shape and key presence.
 */

import { describe, it, expect } from 'vitest';
import { DEMO_CONTEXT_VALUES } from '../context.js';

// ============================================================
// DEMO_CONTEXT_VALUES
// ============================================================

describe('DEMO_CONTEXT_VALUES', () => {
  it('exports a plain object', () => {
    expect(typeof DEMO_CONTEXT_VALUES).toBe('object');
    expect(DEMO_CONTEXT_VALUES).not.toBeNull();
    expect(Array.isArray(DEMO_CONTEXT_VALUES)).toBe(false);
  });

  describe('flat keys', () => {
    it('contains timeout as a number', () => {
      expect(typeof DEMO_CONTEXT_VALUES['timeout']).toBe('number');
    });

    it('contains debug as a boolean', () => {
      expect(typeof DEMO_CONTEXT_VALUES['debug']).toBe('boolean');
    });

    it('contains environment as a string', () => {
      expect(typeof DEMO_CONTEXT_VALUES['environment']).toBe('string');
    });

    it('contains model as a string', () => {
      expect(typeof DEMO_CONTEXT_VALUES['model']).toBe('string');
    });
  });

  describe('nested dot-path keys', () => {
    it('contains limits as a nested object', () => {
      expect(typeof DEMO_CONTEXT_VALUES['limits']).toBe('object');
      expect(DEMO_CONTEXT_VALUES['limits']).not.toBeNull();
    });

    it('limits.max_tokens is a number', () => {
      const limits = DEMO_CONTEXT_VALUES['limits'] as Record<string, unknown>;
      expect(typeof limits['max_tokens']).toBe('number');
    });

    it('limits.max_retries is a number', () => {
      const limits = DEMO_CONTEXT_VALUES['limits'] as Record<string, unknown>;
      expect(typeof limits['max_retries']).toBe('number');
    });
  });

  it('all values are rill-serializable (no functions or class instances)', () => {
    for (const value of Object.values(DEMO_CONTEXT_VALUES)) {
      const type = typeof value;
      // Allowed: string, number, boolean, object (plain), null
      if (type === 'object' && value !== null) {
        expect(
          Array.isArray(value) ||
            Object.getPrototypeOf(value) === Object.prototype
        ).toBe(true);
      } else {
        expect(['string', 'number', 'boolean']).toContain(type);
      }
    }
  });
});
