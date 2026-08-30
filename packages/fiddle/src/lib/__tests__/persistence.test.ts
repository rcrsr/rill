/**
 * Tests for persistence module
 *
 * Coverage:
 * - persistEditorState serializes and persists state
 * - loadEditorState deserializes and returns defaults on failure
 * - localStorage unavailable falls back to defaults
 * - Corrupt JSON returns defaults
 * - splitRatio clamped to valid range
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
    window.localStorage.clear();
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
    // First visit (no localStorage key) returns defaults
    it('returns default state on first visit', () => {
      const state = loadEditorState();

      expect(state.splitRatio).toBe(50);
      expect(state.lastSource).toContain('Hello, World!');
    });

    // Persist and load round-trip preserves state
    it('loads persisted state correctly', () => {
      const testState: EditorState = {
        splitRatio: 60,
        lastSource: 'test code',
      };

      persistEditorState(testState);
      const loaded = loadEditorState();

      expect(loaded).toEqual(testState);
    });

    // Corrupt JSON returns default EditorState
    it('returns defaults when JSON is corrupt', () => {
      window.localStorage.setItem('rill-fiddle-editor-state', '{invalid json}');

      const state = loadEditorState();

      expect(state.splitRatio).toBe(50);
      expect(state.lastSource).toContain('Hello, World!');
    });

    // Corrupt JSON returns defaults (non-object JSON)
    it('returns defaults when stored value is not an object', () => {
      window.localStorage.setItem('rill-fiddle-editor-state', '"string value"');

      const state = loadEditorState();

      expect(state.splitRatio).toBe(50);
    });

    // Corrupt JSON returns defaults (null value)
    it('returns defaults when stored value is null', () => {
      window.localStorage.setItem('rill-fiddle-editor-state', 'null');

      const state = loadEditorState();

      expect(state.splitRatio).toBe(50);
    });

    // splitRatio out of range clamps to valid bounds (too low)
    it('clamps splitRatio to minimum when value is too low', () => {
      window.localStorage.setItem(
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

    // splitRatio out of range clamps to valid bounds (too high)
    it('clamps splitRatio to maximum when value is too high', () => {
      window.localStorage.setItem(
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

    // Valid splitRatio values pass through unchanged
    it('preserves valid splitRatio values', () => {
      const validRatios = [20, 30, 50, 70, 80];

      for (const ratio of validRatios) {
        window.localStorage.setItem(
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

    // Missing fields use defaults
    it('uses defaults for missing fields', () => {
      window.localStorage.setItem(
        'rill-fiddle-editor-state',
        JSON.stringify({
          // splitRatio and lastSource missing
        })
      );

      const state = loadEditorState();

      expect(state.splitRatio).toBe(50);
      expect(state.lastSource).toContain('Hello, World!');
    });

    // Wrong type for splitRatio uses default
    it('uses default splitRatio when type is wrong', () => {
      window.localStorage.setItem(
        'rill-fiddle-editor-state',
        JSON.stringify({
          splitRatio: 'not a number',
          lastSource: 'test',
        })
      );

      const state = loadEditorState();

      expect(state.splitRatio).toBe(50);
    });

    // Wrong type for lastSource uses default
    it('uses default lastSource when type is wrong', () => {
      window.localStorage.setItem(
        'rill-fiddle-editor-state',
        JSON.stringify({
          splitRatio: 50,
          lastSource: 123, // Should be string
        })
      );

      const state = loadEditorState();

      expect(state.lastSource).toContain('Hello, World!');
    });

    // localStorage unavailable (private browsing)
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
    // Serializes to JSON and writes single localStorage key
    it('persists state to localStorage', () => {
      const testState: EditorState = {
        splitRatio: 60,
        lastSource: 'test code',
      };

      persistEditorState(testState);

      const stored = window.localStorage.getItem('rill-fiddle-editor-state');
      expect(stored).not.toBeNull();

      const parsed = JSON.parse(stored!);
      expect(parsed).toEqual(testState);
    });

    // Uses single localStorage key for all editor state
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
      expect(window.localStorage.length).toBe(1);

      const loaded = loadEditorState();
      expect(loaded).toEqual(state2);
    });

    // localStorage unavailable falls back silently
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

    // Round-trip preserves all fields
    it('preserves all state fields through round-trip', () => {
      const testStates: EditorState[] = [
        { splitRatio: 30, lastSource: 'code 1' },
        { splitRatio: 70, lastSource: 'code 2' },
        { splitRatio: 50, lastSource: '' },
      ];

      for (const state of testStates) {
        window.localStorage.clear();
        persistEditorState(state);
        const loaded = loadEditorState();
        expect(loaded).toEqual(state);
      }
    });
  });

  describe('localStorage availability caching', () => {
    // Each test imports a fresh module instance so the module-level cache
    // starts uninitialized, isolating the probe count from other tests.
    it('probes localStorage at most once across repeated persistEditorState calls', async () => {
      vi.resetModules();
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

      const { persistEditorState: freshPersist } =
        await import('../persistence.js');

      const state: EditorState = { splitRatio: 55, lastSource: 'probe test' };

      for (let i = 0; i < 5; i++) {
        freshPersist(state);
      }

      const probeCalls = setItemSpy.mock.calls.filter(
        ([key]) => key === '__rill_fiddle_test__'
      );
      expect(probeCalls.length).toBeLessThanOrEqual(1);
    });

    // Caching also applies across loadEditorState calls
    it('probes localStorage at most once across repeated loadEditorState calls', async () => {
      vi.resetModules();
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

      const { loadEditorState: freshLoad } = await import('../persistence.js');

      for (let i = 0; i < 5; i++) {
        freshLoad();
      }

      const probeCalls = setItemSpy.mock.calls.filter(
        ([key]) => key === '__rill_fiddle_test__'
      );
      expect(probeCalls.length).toBeLessThanOrEqual(1);
    });
  });

  describe('integration', () => {
    // Complete persist/load cycle
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

    // Overwrites corrupt data on next persist
    it('recovers from corrupt data by overwriting on next persist', () => {
      // Corrupt the stored data
      window.localStorage.setItem('rill-fiddle-editor-state', '{invalid}');

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
