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

// ============================================================
// HELPERS
// ============================================================

const EDITOR_STATE_KEY = 'rill-fiddle-editor-state';
const PROBE_KEY = '__rill_fiddle_test__';

interface FakeStorageOptions {
  readonly seed?: Record<string, string> | undefined;
  readonly failSetItem?: ((key: string) => boolean) | undefined;
  readonly failGetItem?: boolean | undefined;
}

interface FakeStorage extends Storage {
  readonly writes: string[];
  readonly data: Map<string, string>;
}

/** Build an in-memory Storage that records writes and can fail on demand. */
function createFakeStorage(options: FakeStorageOptions = {}): FakeStorage {
  const data = new Map<string, string>(Object.entries(options.seed ?? {}));
  const writes: string[] = [];

  return {
    writes,
    data,
    get length(): number {
      return data.size;
    },
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => {
      if (options.failGetItem === true) {
        throw new Error('localStorage unavailable');
      }
      return data.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      writes.push(key);
      if (options.failSetItem?.(key) === true) {
        throw new Error('localStorage unavailable');
      }
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

/** Import a persistence module whose availability cache starts empty. */
async function importFreshPersistence(): Promise<
  typeof import('../persistence.js')
> {
  vi.resetModules();
  return import('../persistence.js');
}

describe('persistence', () => {
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
    it('falls back to defaults when localStorage is unavailable', async () => {
      const fake = createFakeStorage({
        seed: {
          [EDITOR_STATE_KEY]: JSON.stringify({
            splitRatio: 70,
            lastSource: 'seeded',
          }),
        },
        failSetItem: () => true,
      });
      vi.stubGlobal('localStorage', fake);
      const fresh = await importFreshPersistence();

      const state = fresh.loadEditorState();

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

    // Write failure is swallowed
    it('fails silently when the state write throws', async () => {
      const fake = createFakeStorage({
        failSetItem: (key) => key === EDITOR_STATE_KEY,
      });
      vi.stubGlobal('localStorage', fake);
      const fresh = await importFreshPersistence();

      expect(() =>
        fresh.persistEditorState({ splitRatio: 60, lastSource: 'test code' })
      ).not.toThrow();
      expect(fake.writes).toContain(EDITOR_STATE_KEY);
      expect(fake.data.has(EDITOR_STATE_KEY)).toBe(false);
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
    it('probes localStorage once across repeated persistEditorState calls', async () => {
      const fake = createFakeStorage();
      vi.stubGlobal('localStorage', fake);
      const fresh = await importFreshPersistence();
      const state: EditorState = { splitRatio: 55, lastSource: 'probe test' };

      for (let i = 0; i < 5; i++) {
        fresh.persistEditorState(state);
      }

      expect(fake.writes.filter((key) => key === PROBE_KEY)).toHaveLength(1);
    });

    it('probes localStorage once across repeated loadEditorState calls', async () => {
      const fake = createFakeStorage();
      vi.stubGlobal('localStorage', fake);
      const fresh = await importFreshPersistence();

      for (let i = 0; i < 5; i++) {
        fresh.loadEditorState();
      }

      expect(fake.writes.filter((key) => key === PROBE_KEY)).toHaveLength(1);
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
