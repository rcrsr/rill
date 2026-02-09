/**
 * Boundary condition tests for persistence edge cases
 *
 * Coverage:
 * - AC-20: Panel divider stops at 200px minimum; does not collapse below
 * - AC-21: Application functions without localStorage (mock unavailable)
 * - AC-22: Corrupt localStorage recovered with default state
 * - AC-24: First visit with no localStorage loads Hello World
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadEditorState,
  persistEditorState,
  type EditorState,
} from '../persistence.js';

describe('persistence boundary conditions', () => {
  // Store original localStorage
  const originalLocalStorage = globalThis.localStorage;
  // Store original window.innerWidth
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    // Mock window.innerWidth to 1200px for consistent test expectations
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1200,
    });
  });

  afterEach(() => {
    // Restore localStorage after each test
    globalThis.localStorage = originalLocalStorage;
    // Restore window.innerWidth
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    });
    vi.restoreAllMocks();
  });

  describe('AC-20: Panel at minimum size', () => {
    it('stops divider at minimum ratio enforcing 200px minimum', () => {
      // Given: splitRatio below minimum (~16.67% for 1200px viewport)
      localStorage.setItem(
        'rill-fiddle-editor-state',
        JSON.stringify({
          splitRatio: 5, // Far below minimum
          lastSource: 'test',
        })
      );

      // When: Loading editor state
      const state = loadEditorState();

      // Then: splitRatio clamped to minimum (200px / 1200px * 100 = 16.67%)
      expect(state.splitRatio).toBeGreaterThanOrEqual(16.66);
      expect(state.splitRatio).toBeLessThanOrEqual(16.68);
    });

    it('stops divider at maximum ratio enforcing 200px minimum on right', () => {
      // Given: splitRatio above maximum (~83.33% for 1200px viewport)
      localStorage.setItem(
        'rill-fiddle-editor-state',
        JSON.stringify({
          splitRatio: 95, // Far above maximum
          lastSource: 'test',
        })
      );

      // When: Loading editor state
      const state = loadEditorState();

      // Then: splitRatio clamped to maximum (100 - 16.67% = 83.33%)
      expect(state.splitRatio).toBeGreaterThanOrEqual(83.32);
      expect(state.splitRatio).toBeLessThanOrEqual(83.34);
    });

    it('does not collapse panels below minimum with extreme values', () => {
      const extremeValues = [-100, 0, 1, 99, 100, 999];

      for (const ratio of extremeValues) {
        localStorage.setItem(
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

    it('preserves valid ratios within minimum bounds', () => {
      const validRatios = [20, 30, 40, 50, 60, 70, 80];

      for (const ratio of validRatios) {
        localStorage.setItem(
          'rill-fiddle-editor-state',
          JSON.stringify({
            splitRatio: ratio,
            lastSource: 'test',
          })
        );

        const state = loadEditorState();

        // Valid ratios pass through unchanged
        expect(state.splitRatio).toBe(ratio);
      }
    });
  });

  describe('AC-21: localStorage unavailable', () => {
    it('functions without persistence when localStorage unavailable', () => {
      // Given: localStorage throws on all operations (private browsing mode)
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('localStorage unavailable');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('localStorage unavailable');
      });

      // When: Loading editor state
      const state = loadEditorState();

      // Then: Returns defaults without crashing
      expect(state.splitRatio).toBe(50);
      expect(state.lastSource).toContain('Hello, World!');
    });

    it('persists changes in memory when localStorage unavailable', () => {
      // Given: localStorage unavailable
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('localStorage unavailable');
      });

      const testState: EditorState = {
        splitRatio: 60,
        lastSource: 'test code',
      };

      // When: Attempting to persist
      // Then: No error thrown (fails silently)
      expect(() => persistEditorState(testState)).not.toThrow();
    });

    it('uses defaults on every load when localStorage unavailable', () => {
      // Given: localStorage throws on getItem
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('localStorage unavailable');
      });

      // When: Multiple loads
      const load1 = loadEditorState();
      const load2 = loadEditorState();

      // Then: Both return defaults (no persistence between calls)
      expect(load1).toEqual(load2);
      expect(load1.splitRatio).toBe(50);
    });
  });

  describe('AC-22: Corrupt localStorage', () => {
    it('recovers with default state when JSON is malformed', () => {
      // Given: Corrupt JSON data in localStorage
      localStorage.setItem('rill-fiddle-editor-state', '{invalid json}');

      // When: Loading editor state
      const state = loadEditorState();

      // Then: Returns defaults without crash
      expect(state.splitRatio).toBe(50);
      expect(state.lastSource).toContain('Hello, World!');
    });

    it('recovers when stored value is not an object', () => {
      // Given: Valid JSON but wrong type (string instead of object)
      localStorage.setItem('rill-fiddle-editor-state', '"string value"');

      // When: Loading editor state
      const state = loadEditorState();

      // Then: Returns defaults
      expect(state.splitRatio).toBe(50);
    });

    it('recovers when stored value is null', () => {
      // Given: Valid JSON but null value
      localStorage.setItem('rill-fiddle-editor-state', 'null');

      // When: Loading editor state
      const state = loadEditorState();

      // Then: Returns defaults
      expect(state.splitRatio).toBe(50);
    });

    it('recovers when stored value is an array', () => {
      // Given: Valid JSON but array instead of object
      localStorage.setItem('rill-fiddle-editor-state', '["array", "value"]');

      // When: Loading editor state
      const state = loadEditorState();

      // Then: Returns defaults
      expect(state.splitRatio).toBe(50);
    });

    it('recovers when object has invalid field types', () => {
      // Given: Object with wrong types for fields
      localStorage.setItem(
        'rill-fiddle-editor-state',
        JSON.stringify({
          splitRatio: 'not a number', // Should be number
          lastSource: {}, // Should be string
        })
      );

      // When: Loading editor state
      const state = loadEditorState();

      // Then: Returns defaults for invalid fields
      expect(state.splitRatio).toBe(50);
      expect(state.lastSource).toContain('Hello, World!');
    });

    it('overwrites corrupt data on next successful persist', () => {
      // Given: Corrupt data in localStorage
      localStorage.setItem('rill-fiddle-editor-state', '{corrupt}');

      // When: Load (returns defaults) then persist new state
      const loaded = loadEditorState();
      expect(loaded.splitRatio).toBe(50);

      const newState: EditorState = {
        splitRatio: 65,
        lastSource: 'recovered',
      };
      persistEditorState(newState);

      // Then: Subsequent load retrieves correct state
      const recovered = loadEditorState();
      expect(recovered).toEqual(newState);
    });
  });

  describe('AC-24: First visit (no localStorage)', () => {
    it('loads Hello World example on first visit', () => {
      // Given: Clean localStorage (first visit scenario)
      localStorage.clear();

      // When: Loading editor state
      const state = loadEditorState();

      // Then: Returns default with Hello World
      expect(state.lastSource).toContain('Hello, World!');
    });

    it('uses 50% split ratio on first visit', () => {
      // Given: Clean localStorage (first visit scenario)
      localStorage.clear();

      // When: Loading editor state
      const state = loadEditorState();

      // Then: Returns 50% split ratio (center divider)
      expect(state.splitRatio).toBe(50);
    });

    it('contains executable Rill code on first visit', () => {
      // Given: Clean localStorage (first visit scenario)
      localStorage.clear();

      // When: Loading editor state
      const state = loadEditorState();

      // Then: lastSource contains valid Rill syntax
      expect(state.lastSource).toContain('# Hello World example');
      expect(state.lastSource).toContain('"Hello, World!" -> log');
    });

    it('transitions from first visit to persisted state', () => {
      // Given: First visit scenario
      localStorage.clear();

      // When: Load defaults, modify, persist, reload
      const initial = loadEditorState();
      expect(initial.splitRatio).toBe(50);

      const modified: EditorState = {
        splitRatio: 70,
        lastSource: 'user code',
      };
      persistEditorState(modified);

      const reloaded = loadEditorState();

      // Then: Second load retrieves persisted state
      expect(reloaded).toEqual(modified);
    });
  });

  describe('Combined boundary scenarios', () => {
    it('handles corrupt data with out-of-range splitRatio', () => {
      // Given: Corrupt object with invalid splitRatio
      localStorage.setItem(
        'rill-fiddle-editor-state',
        JSON.stringify({
          splitRatio: 999, // Way out of range
          lastSource: 'test',
        })
      );

      // When: Loading editor state
      const state = loadEditorState();

      // Then: splitRatio clamped to maximum
      expect(state.splitRatio).toBeGreaterThanOrEqual(83);
      expect(state.splitRatio).toBeLessThanOrEqual(84);
    });

    it('handles valid splitRatio with missing other fields', () => {
      // Given: Partial object (only splitRatio)
      localStorage.setItem(
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

    it('handles empty object in localStorage', () => {
      // Given: Empty object
      localStorage.setItem('rill-fiddle-editor-state', '{}');

      // When: Loading editor state
      const state = loadEditorState();

      // Then: All fields use defaults
      expect(state.splitRatio).toBe(50);
      expect(state.lastSource).toContain('Hello, World!');
    });
  });
});
