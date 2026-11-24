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
