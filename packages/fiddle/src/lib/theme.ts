/**
 * Theme Extension Module
 *
 * Provides CodeMirror theme extension using the rill brand neon spectrum.
 * Dark-only. Colors map to the brand guide syntax highlighting section.
 *
 * This module is framework-agnostic and contains no React dependencies.
 */

import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

// ============================================================
// BRAND COLORS — Neon Spectrum on Void
// ============================================================

/**
 * Brand color scheme from internal/brand/brand-guide.html
 *
 * Syntax token mapping:
 *   Keywords  → neon-cyan   #22d3ee
 *   Operators → neon-yellow #d4e157
 *   Strings   → neon-green  #4ade80
 *   Numbers   → neon-indigo #818cf8
 *   Booleans  → neon-cyan   #22d3ee
 *   Comments  → text-dim    #555568  (italic)
 *   Variables → neon-blue   #60a5fa
 *   Functions → neon-purple #a78bfa
 *   Punctuation → text-secondary #8888a0
 *   Brackets  → text-primary #e8e8f0
 *   Meta      → text-dim    #555568
 *
 * Background depths:
 *   void      → #0a0a0e (editor bg)
 *   raised    → #111117 (gutters)
 *   border    → #1e1e2a (gutter border)
 */
const COLORS = {
  // Background depths
  void: '#0a0a0e',
  raised: '#111117',
  card: '#16161e',
  border: '#1e1e2a',

  // Text hierarchy
  textPrimary: '#e8e8f0',
  textSecondary: '#8888a0',
  textDim: '#555568',

  // Neon spectrum syntax
  keyword: '#22d3ee', // neon-cyan
  operator: '#d4e157', // neon-yellow
  string: '#4ade80', // neon-green
  number: '#818cf8', // neon-indigo
  bool: '#22d3ee', // neon-cyan
  comment: '#555568', // text-dim
  variableName: '#60a5fa', // neon-blue
  punctuation: '#8888a0', // text-secondary
  bracket: '#e8e8f0', // text-primary
  meta: '#555568', // text-dim

  // Editor chrome
  selection: '#264f78',
  activeLine: '#111117',
  cursor: '#22d3ee',
  gutterText: '#555568',
} as const;

// ============================================================
// THEME EXTENSION
// ============================================================

/**
 * Create CodeMirror theme extension with brand neon spectrum.
 *
 * Dark-only. The darkMode parameter is retained for API compatibility
 * with existing Editor component but always produces the brand dark theme.
 *
 * @param _darkMode - Ignored. Always produces dark theme.
 * @returns CodeMirror Extension with brand theme styles
 */
export function createThemeExtension(_darkMode: boolean): Extension {
  // Create HighlightStyle for syntax highlighting
  const highlightStyle = HighlightStyle.define([
    { tag: tags.keyword, color: COLORS.keyword },
    { tag: tags.operator, color: COLORS.operator },
    { tag: tags.string, color: COLORS.string },
    { tag: tags.number, color: COLORS.number },
    { tag: tags.bool, color: COLORS.bool },
    { tag: tags.comment, color: COLORS.comment, fontStyle: 'italic' },
    { tag: tags.variableName, color: COLORS.variableName },
    { tag: tags.punctuation, color: COLORS.punctuation },
    { tag: tags.bracket, color: COLORS.bracket },
    { tag: tags.meta, color: COLORS.meta },
  ]);

  // Create editor chrome theme
  const chromeTheme = EditorView.theme(
    {
      '&': {
        backgroundColor: COLORS.void,
        color: COLORS.textPrimary,
      },
      '.cm-content': {
        caretColor: COLORS.cursor,
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: COLORS.cursor,
      },
      '.cm-selectionBackground, .cm-selectionMatch': {
        backgroundColor: COLORS.selection,
      },
      '&.cm-focused .cm-selectionBackground': {
        backgroundColor: COLORS.selection,
      },
      '.cm-activeLine': {
        backgroundColor: COLORS.activeLine,
      },
      '.cm-gutters': {
        backgroundColor: COLORS.raised,
        color: COLORS.gutterText,
        borderRight: `1px solid ${COLORS.border}`,
      },
      '.cm-activeLineGutter': {
        backgroundColor: COLORS.card,
        color: COLORS.textSecondary,
      },
    },
    { dark: true }
  );

  return [chromeTheme, syntaxHighlighting(highlightStyle)];
}
