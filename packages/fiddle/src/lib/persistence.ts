/**
 * Persistence module for editor state
 *
 * Provides localStorage-backed persistence with graceful fallback to in-memory defaults
 * when localStorage is unavailable (e.g., private browsing mode).
 *
 * Dark-only: theme is no longer persisted.
 */

import { MIN_PANEL_SIZE } from './constants.js';

const STORAGE_KEY = 'rill-fiddle-editor-state' as const;

// Default Hello World example
const DEFAULT_SOURCE = `# Hello World example
"Hello, World!" -> log` as const;

/**
 * Editor state persisted across sessions
 */
export interface EditorState {
  splitRatio: number;
  lastSource: string;
}

/**
 * Default editor state
 */
function getDefaultState(): EditorState {
  return {
    splitRatio: 50,
    lastSource: DEFAULT_SOURCE,
  };
}

/**
 * Calculate valid splitRatio bounds that enforce minimum panel width.
 *
 * Uses actual viewport width when available (browser context).
 * Falls back to 1200px for SSR/test contexts where window is unavailable.
 */
function clampSplitRatio(ratio: number): number {
  const viewportWidth =
    typeof window !== 'undefined' ? window.innerWidth : 1200;
  const MIN_RATIO = (MIN_PANEL_SIZE / viewportWidth) * 100;
  const MAX_RATIO = 100 - MIN_RATIO;

  return Math.max(MIN_RATIO, Math.min(MAX_RATIO, ratio));
}

/**
 * Check if localStorage is available
 */
function isLocalStorageAvailable(): boolean {
  try {
    const test = '__rill_fiddle_test__';
    localStorage.setItem(test, test);
    localStorage.removeItem(test);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load editor state from localStorage.
 *
 * Returns default state on:
 * - localStorage unavailable (EC-7)
 * - Corrupt JSON in localStorage (EC-8)
 * - Invalid state structure
 *
 * Clamps splitRatio to valid range (EC-9).
 */
export function loadEditorState(): EditorState {
  if (!isLocalStorageAvailable()) {
    return getDefaultState();
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);

    if (stored === null) {
      return getDefaultState();
    }

    const parsed: unknown = JSON.parse(stored);

    if (typeof parsed !== 'object' || parsed === null) {
      return getDefaultState();
    }

    const state = parsed as Record<string, unknown>;

    const splitRatio =
      typeof state['splitRatio'] === 'number'
        ? clampSplitRatio(state['splitRatio'])
        : 50;
    const lastSource =
      typeof state['lastSource'] === 'string'
        ? state['lastSource']
        : DEFAULT_SOURCE;

    return { splitRatio, lastSource };
  } catch {
    return getDefaultState();
  }
}

/**
 * Persist editor state to localStorage.
 *
 * Fails silently if localStorage is unavailable (EC-7).
 */
export function persistEditorState(state: EditorState): void {
  if (!isLocalStorageAvailable()) {
    return;
  }

  try {
    const serialized = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    return;
  }
}
