/**
 * Theme Extension Tests
 *
 * Validates that createThemeExtension always produces the dark brand theme
 * and registers syntax highlighting.
 */

import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { highlightingFor } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { createThemeExtension } from '../theme.js';
import { measureP95 } from '../../../tests/helpers/measure.js';

// ============================================================
// THEME EXTENSION CREATION
// ============================================================

describe('createThemeExtension', () => {
  it('always produces a dark theme', () => {
    for (const flag of [true, false]) {
      const state = EditorState.create({
        extensions: createThemeExtension(flag),
      });
      expect(state.facet(EditorView.darkTheme)).toBe(true);
    }
  });

  it('registers syntax highlighting', () => {
    const state = EditorState.create({
      extensions: createThemeExtension(true),
    });
    const keyword = highlightingFor(state, [tags.keyword]);
    const string = highlightingFor(state, [tags.string]);
    expect(keyword).not.toBeNull();
    expect(keyword).not.toBe(string);
  });
});

// ============================================================
// PERFORMANCE
// ============================================================

describe('createThemeExtension performance', () => {
  describe('Theme creation performance', () => {
    it('completes theme creation within 100ms', () => {
      const darkP95 = measureP95(
        () => {
          createThemeExtension(true);
        },
        { samples: 50, warmup: 5 }
      );
      expect(darkP95).toBeLessThan(100);

      const lightP95 = measureP95(
        () => {
          createThemeExtension(false);
        },
        { samples: 50, warmup: 5 }
      );
      expect(lightP95).toBeLessThan(100);
    });
  });

  describe('Rapid theme creation calls', () => {
    it('completes 10 rapid createThemeExtension calls', () => {
      const p95 = measureP95(
        () => {
          for (let i = 0; i < 10; i++) {
            createThemeExtension(i % 2 === 0);
          }
        },
        { samples: 20, warmup: 3 }
      );

      // All 10 calls should complete within 1 second
      expect(p95).toBeLessThan(1000);
    });
  });
});
