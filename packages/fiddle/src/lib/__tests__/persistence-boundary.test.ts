/**
 * Boundary condition tests for persistence edge cases not covered in
 * persistence.test.ts
 *
 * Coverage:
 * - Extreme splitRatio values stay within the clamped range
 * - Repeated loads fall back to defaults when reads throw
 * - Array-valued storage recovers with defaults
 * - First visit default source is executable Rill
 * - Partial stored objects keep valid fields
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadEditorState } from '../persistence.js';

// ============================================================
// HELPERS
// ============================================================

/** Build an in-memory Storage whose reads throw. */
function createThrowingStorage(): Storage {
  return {
    length: 0,
    clear: () => {},
    key: () => null,
    getItem: () => {
      throw new Error('localStorage unavailable');
    },
    setItem: () => {},
    removeItem: () => {},
  };
}

/** Import a persistence module whose availability cache starts empty. */
function importFreshPersistence(): Promise<typeof import('../persistence.js')> {
  vi.resetModules();
  return import('../persistence.js');
}

describe('persistence boundary conditions', () => {
  // Store original window.innerWidth
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    // Clear localStorage before each test
    window.localStorage.clear();
    // Mock window.innerWidth to 1200px for consistent test expectations
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1200,
    });
  });

  afterEach(() => {
    // Restore window.innerWidth
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('Panel at minimum size', () => {
    it('does not collapse panels below minimum with extreme values', () => {
      const extremeValues = [-100, 0, 1, 99, 100, 999];

      for (const ratio of extremeValues) {
        window.localStorage.setItem(
          'rill-fiddle-editor-state',
          JSON.stringify({
            splitRatio: ratio,
            lastSource: 'test',
          })
        );

        const state = loadEditorState();

        // All extreme values clamped to valid range [16.67, 83.33]
        expect(state.splitRatio).toBeGreaterThanOrEqual(16);
        expect(state.splitRatio).toBeLessThanOrEqual(84);
      }
    });
  });

  describe('localStorage unavailable', () => {
    it('uses defaults on every load when reading localStorage fails', async () => {
      // Given: localStorage throws on getItem
      const fake = createThrowingStorage();
      vi.stubGlobal('localStorage', fake);
      const fresh = await importFreshPersistence();

      // When: Multiple loads
      const load1 = fresh.loadEditorState();
      const load2 = fresh.loadEditorState();

      // Then: Both return defaults (no persistence between calls)
      expect(load1).toEqual(load2);
      expect(load1.splitRatio).toBe(50);
      expect(load1.lastSource).toContain('Hello, World!');
    });
  });

  describe('Corrupt localStorage', () => {
    it('recovers when stored value is an array', () => {
      // Given: Valid JSON but array instead of object
      window.localStorage.setItem(
        'rill-fiddle-editor-state',
        '["array", "value"]'
      );

      // When: Loading editor state
      const state = loadEditorState();

      // Then: Returns defaults
      expect(state.splitRatio).toBe(50);
    });
  });

  describe('First visit (no localStorage)', () => {
    it('contains executable Rill code on first visit', () => {
      // When: Loading editor state with clean localStorage
      const state = loadEditorState();

      // Then: lastSource contains valid Rill syntax
      expect(state.lastSource).toContain('# Hello World example');
      expect(state.lastSource).toContain('"Hello, World!" -> log');
    });
  });

  describe('Combined boundary scenarios', () => {
    it('handles valid splitRatio with missing other fields', () => {
      // Given: Partial object (only splitRatio)
      window.localStorage.setItem(
        'rill-fiddle-editor-state',
        JSON.stringify({
          splitRatio: 60,
        })
      );

      // When: Loading editor state
      const state = loadEditorState();

      // Then: Preserves valid splitRatio, uses default lastSource
      expect(state.splitRatio).toBe(60);
      expect(state.lastSource).toContain('Hello, World!');
    });
  });
});
