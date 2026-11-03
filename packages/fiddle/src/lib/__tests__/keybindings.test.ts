/**
 * Tests for keybindings module
 *
 * Validates Tab and Shift-Tab key binding configuration.
 */

import { describe, it, expect } from 'vitest';
import { insertTab, indentLess } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { createTabKeyBinding } from '../keybindings.js';

describe('createTabKeyBinding', () => {
  describe('return value structure', () => {
    it('returns array with exactly 2 key bindings', () => {
      const bindings = createTabKeyBinding();
      expect(Array.isArray(bindings)).toBe(true);
      expect(bindings).toHaveLength(2);
    });

    it('never throws exception', () => {
      expect(() => createTabKeyBinding()).not.toThrow();
    });
  });

  describe('Tab binding configuration', () => {
    it('has key property set to "Tab"', () => {
      const bindings = createTabKeyBinding();
      const tabBinding = bindings.find((b) => b.key === 'Tab');

      expect(tabBinding).toBeDefined();
      expect(tabBinding?.key).toBe('Tab');
    });

    it('calls insertTab command', () => {
      const bindings = createTabKeyBinding();
      const tabBinding = bindings.find((b) => b.key === 'Tab');

      expect(tabBinding?.run).toBe(insertTab);
    });

    it('sets preventDefault to true', () => {
      const bindings = createTabKeyBinding();
      const tabBinding = bindings.find((b) => b.key === 'Tab');

      expect(tabBinding?.preventDefault).toBe(true);
    });
  });

  describe('Shift-Tab binding configuration', () => {
    it('has key property set to "Shift-Tab"', () => {
      const bindings = createTabKeyBinding();
      const shiftTabBinding = bindings.find((b) => b.key === 'Shift-Tab');

      expect(shiftTabBinding).toBeDefined();
      expect(shiftTabBinding?.key).toBe('Shift-Tab');
    });

    it('calls indentLess command', () => {
      const bindings = createTabKeyBinding();
      const shiftTabBinding = bindings.find((b) => b.key === 'Shift-Tab');

      expect(shiftTabBinding?.run).toBe(indentLess);
    });

    it('sets preventDefault to true', () => {
      const bindings = createTabKeyBinding();
      const shiftTabBinding = bindings.find((b) => b.key === 'Shift-Tab');

      expect(shiftTabBinding?.preventDefault).toBe(true);
    });
  });

  describe('Escape key accessibility', () => {
    it('does not include Escape key binding', () => {
      const bindings = createTabKeyBinding();
      const escapeBinding = bindings.find(
        (b) => b.key === 'Escape' || b.key === 'Esc'
      );

      expect(escapeBinding).toBeUndefined();
    });

    it('only includes Tab and Shift-Tab keys', () => {
      const bindings = createTabKeyBinding();
      const keys = bindings.map((b) => b.key);

      expect(keys).toEqual(['Tab', 'Shift-Tab']);
    });
  });

  describe('multiple invocations', () => {
    it('returns consistent bindings on repeated calls', () => {
      const bindings1 = createTabKeyBinding();
      const bindings2 = createTabKeyBinding();

      expect(bindings1).toHaveLength(2);
      expect(bindings2).toHaveLength(2);
      expect(bindings1[0]?.key).toBe(bindings2[0]?.key);
      expect(bindings1[1]?.key).toBe(bindings2[1]?.key);
    });
  });
});

// ============================================================
// BEHAVIOR IN A LIVE EDITOR VIEW
// ============================================================

describe('Tab key binding behavior', () => {
  function runBinding(
    key: string,
    doc: string,
    cursor: number
  ): { doc: string; handled: boolean } {
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: cursor },
        extensions: [indentUnit.of('  ')],
      }),
    });
    const binding = createTabKeyBinding().find((b) => b.key === key);
    const handled = binding?.run?.(view) ?? false;
    const result = view.state.doc.toString();
    view.destroy();
    return { doc: result, handled };
  }

  it('Tab inserts indentation at the cursor', () => {
    const result = runBinding('Tab', 'ab', 1);

    expect(result.handled).toBe(true);
    expect(result.doc).toBe('a\tb');
  });

  it('Shift-Tab removes one indent level from the line', () => {
    const result = runBinding('Shift-Tab', '    x', 5);

    expect(result.handled).toBe(true);
    expect(result.doc).toBe('  x');
  });
});
