/**
 * Persistence module for editor state
 *
 * Provides localStorage-backed persistence with graceful fallback to in-memory defaults
 * when localStorage is unavailable (e.g., private browsing mode).
 */

const STORAGE_KEY = 'rill-fiddle-editor-state' as const;

// Minimum panel width in pixels for splitRatio bounds calculation
const MIN_PANEL_WIDTH = 200 as const;

// Default Hello World example
const DEFAULT_SOURCE = `# Hello World example
"Hello, World!" -> log` as const;

/**
 * Editor state persisted across sessions
 */
export interface EditorState {
  theme: 'dark' | 'light';
  splitRatio: number;
  lastSource: string;
}

/**
 * Default editor state
 */
function getDefaultState(): EditorState {
  return {
    theme: 'dark',
    splitRatio: 50,
    lastSource: DEFAULT_SOURCE,
  };
}

/**
 * Calculate valid splitRatio bounds that enforce minimum panel width.
 *
 * Assumes a 1200px default viewport width for bounds calculation.
 * At runtime, UI components should enforce actual bounds based on container width.
 */
function clampSplitRatio(ratio: number): number {
  const MIN_RATIO = (MIN_PANEL_WIDTH / 1200) * 100; // ~16.67%
  const MAX_RATIO = 100 - MIN_RATIO; // ~83.33%

  return Math.max(MIN_RATIO, Math.min(MAX_RATIO, ratio));
}

/**
 * Validate theme value against allowed enum
 */
function isValidTheme(value: unknown): value is 'dark' | 'light' {
  return value === 'dark' || value === 'light';
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
  // EC-7: localStorage unavailable (private browsing)
  if (!isLocalStorageAvailable()) {
    return getDefaultState();
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);

    // First visit: no stored state
    if (stored === null) {
      return getDefaultState();
    }

    // EC-8: Corrupt JSON in localStorage
    const parsed: unknown = JSON.parse(stored);

    // Validate structure
    if (typeof parsed !== 'object' || parsed === null) {
      return getDefaultState();
    }

    const state = parsed as Record<string, unknown>;

    // Validate and extract fields
    const theme = isValidTheme(state['theme']) ? state['theme'] : 'dark';
    const splitRatio =
      typeof state['splitRatio'] === 'number'
        ? clampSplitRatio(state['splitRatio']) // EC-9: Clamp out-of-range values
        : 50;
    const lastSource =
      typeof state['lastSource'] === 'string'
        ? state['lastSource']
        : DEFAULT_SOURCE;

    return { theme, splitRatio, lastSource };
  } catch {
    // EC-8: JSON.parse throws on corrupt data
    return getDefaultState();
  }
}

/**
 * Persist editor state to localStorage.
 *
 * Fails silently if localStorage is unavailable (EC-7).
 */
export function persistEditorState(state: EditorState): void {
  // EC-7: localStorage unavailable (private browsing)
  if (!isLocalStorageAvailable()) {
    return;
  }

  try {
    const serialized = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    // Fail silently on quota exceeded or other errors
    return;
  }
}
