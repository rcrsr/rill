/**
 * Tests for persistence module
 *
 * Coverage:
 * - IR-4: persistEditorState serializes and persists state
 * - IR-5: loadEditorState deserializes and returns defaults on failure
 * - EC-7: localStorage unavailable falls back to defaults
 * - EC-8: Corrupt JSON returns defaults
 * - EC-9: splitRatio clamped to valid range
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadEditorState,
  persistEditorState,
  type EditorState,
} from '../persistence.js';

describe('persistence', () => {
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

  describe('loadEditorState', () => {
    // IR-5: First visit (no localStorage key) returns defaults
    it('returns default state on first visit', () => {
      const state = loadEditorState();

      expect(state.splitRatio).toBe(50);
      expect(state.lastSource).toContain('Hello, World!');
    });

    // IR-4: Persist and load round-trip preserves state
    it('loads persisted state correctly', () => {
      const testState: EditorState = {
        splitRatio: 60,
        lastSource: 'test code',
      };

      persistEditorState(testState);
      const loaded = loadEditorState();

      expect(loaded).toEqual(testState);
    });

    // EC-8: Corrupt JSON returns default EditorState
    it('returns defaults when JSON is corrupt', () => {
      localStorage.setItem('rill-fiddle-editor-state', '{invalid json}');

      const state = loadEditorState();

      expect(state.splitRatio).toBe(50);
      expect(state.lastSource).toContain('Hello, World!');
    });

    // EC-8: Corrupt JSON returns defaults (non-object JSON)
    it('returns defaults when stored value is not an object', () => {
      localStorage.setItem('rill-fiddle-editor-state', '"string value"');

      const state = loadEditorState();

      expect(state.splitRatio).toBe(50);
    });

    // EC-8: Corrupt JSON returns defaults (null value)
    it('returns defaults when stored value is null', () => {
      localStorage.setItem('rill-fiddle-editor-state', 'null');

      const state = loadEditorState();

      expect(state.splitRatio).toBe(50);
    });

    // EC-9: splitRatio out of range clamps to valid bounds (too low)
    it('clamps splitRatio to minimum when value is too low', () => {
      localStorage.setItem(
        'rill-fiddle-editor-state',
        JSON.stringify({
          splitRatio: 5, // Below minimum (~16.67%)
          lastSource: 'test',
        })
      );

      const state = loadEditorState();

      expect(state.splitRatio).toBeGreaterThanOrEqual(16);
      expect(state.splitRatio).toBeLessThanOrEqual(17);
    });

    // EC-9: splitRatio out of range clamps to valid bounds (too high)
    it('clamps splitRatio to maximum when value is too high', () => {
      localStorage.setItem(
        'rill-fiddle-editor-state',
        JSON.stringify({
          splitRatio: 95, // Above maximum (~83.33%)
          lastSource: 'test',
        })
      );

      const state = loadEditorState();

      expect(state.splitRatio).toBeGreaterThanOrEqual(83);
      expect(state.splitRatio).toBeLessThanOrEqual(84);
    });

    // EC-9: Valid splitRatio values pass through unchanged
    it('preserves valid splitRatio values', () => {
      const validRatios = [20, 30, 50, 70, 80];

      for (const ratio of validRatios) {
        localStorage.setItem(
          'rill-fiddle-editor-state',
          JSON.stringify({
            splitRatio: ratio,
            lastSource: 'test',
          })
        );

        const state = loadEditorState();
        expect(state.splitRatio).toBe(ratio);
      }
    });

    // IR-5: Missing fields use defaults
    it('uses defaults for missing fields', () => {
      localStorage.setItem(
        'rill-fiddle-editor-state',
        JSON.stringify({
          // splitRatio and lastSource missing
        })
      );

      const state = loadEditorState();

      expect(state.splitRatio).toBe(50);
      expect(state.lastSource).toContain('Hello, World!');
    });

    // IR-5: Wrong type for splitRatio uses default
    it('uses default splitRatio when type is wrong', () => {
      localStorage.setItem(
        'rill-fiddle-editor-state',
        JSON.stringify({
          splitRatio: 'not a number',
          lastSource: 'test',
        })
      );

      const state = loadEditorState();

      expect(state.splitRatio).toBe(50);
    });

    // IR-5: Wrong type for lastSource uses default
    it('uses default lastSource when type is wrong', () => {
      localStorage.setItem(
        'rill-fiddle-editor-state',
        JSON.stringify({
          splitRatio: 50,
          lastSource: 123, // Should be string
        })
      );

      const state = loadEditorState();

      expect(state.lastSource).toContain('Hello, World!');
    });

    // EC-7: localStorage unavailable (private browsing)
    it('falls back to defaults when localStorage is unavailable', () => {
      // Mock localStorage to throw on getItem
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('localStorage unavailable');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('localStorage unavailable');
      });

      const state = loadEditorState();

      expect(state.splitRatio).toBe(50);
      expect(state.lastSource).toContain('Hello, World!');
    });
  });

  describe('persistEditorState', () => {
    // IR-4: Serializes to JSON and writes single localStorage key
    it('persists state to localStorage', () => {
      const testState: EditorState = {
        splitRatio: 60,
        lastSource: 'test code',
      };

      persistEditorState(testState);

      const stored = localStorage.getItem('rill-fiddle-editor-state');
      expect(stored).not.toBeNull();

      const parsed = JSON.parse(stored!);
      expect(parsed).toEqual(testState);
    });

    // IR-4: Uses single localStorage key for all editor state
    it('overwrites previous state on subsequent persist', () => {
      const state1: EditorState = {
        splitRatio: 50,
        lastSource: 'first',
      };
      const state2: EditorState = {
        splitRatio: 70,
        lastSource: 'second',
      };

      persistEditorState(state1);
      persistEditorState(state2);

      // Only one key should exist
      expect(localStorage.length).toBe(1);

      const loaded = loadEditorState();
      expect(loaded).toEqual(state2);
    });

    // EC-7: localStorage unavailable falls back silently
    it('fails silently when localStorage is unavailable', () => {
      // Mock localStorage to throw on setItem
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('localStorage unavailable');
      });

      const testState: EditorState = {
        splitRatio: 60,
        lastSource: 'test code',
      };

      // Should not throw
      expect(() => persistEditorState(testState)).not.toThrow();
    });

    // IR-4: Round-trip preserves all fields
    it('preserves all state fields through round-trip', () => {
      const testStates: EditorState[] = [
        { splitRatio: 30, lastSource: 'code 1' },
        { splitRatio: 70, lastSource: 'code 2' },
        { splitRatio: 50, lastSource: '' },
      ];

      for (const state of testStates) {
        localStorage.clear();
        persistEditorState(state);
        const loaded = loadEditorState();
        expect(loaded).toEqual(state);
      }
    });
  });

  describe('integration', () => {
    // IR-4 + IR-5: Complete persist/load cycle
    it('handles complete lifecycle: first visit -> persist -> load', () => {
      // First visit: returns defaults
      const initial = loadEditorState();
      expect(initial.splitRatio).toBe(50);

      // User changes state
      const updated: EditorState = {
        splitRatio: 65,
        lastSource: 'updated code',
      };

      // Persist changes
      persistEditorState(updated);

      // Reload (simulates page refresh)
      const reloaded = loadEditorState();
      expect(reloaded).toEqual(updated);
    });

    // EC-8: Overwrites corrupt data on next persist
    it('recovers from corrupt data by overwriting on next persist', () => {
      // Corrupt the stored data
      localStorage.setItem('rill-fiddle-editor-state', '{invalid}');

      // Load returns defaults
      const loaded = loadEditorState();
      expect(loaded.splitRatio).toBe(50);

      // User makes changes and persists
      const newState: EditorState = {
        splitRatio: 55,
        lastSource: 'recovered',
      };
      persistEditorState(newState);

      // Subsequent load works correctly
      const recovered = loadEditorState();
      expect(recovered).toEqual(newState);
    });
  });
});
