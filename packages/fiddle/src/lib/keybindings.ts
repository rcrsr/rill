/**
 * Key Bindings Module
 *
 * Creates CodeMirror key binding configurations for editor interactions.
 * Provides Tab and Shift-Tab bindings for indentation control.
 */

import { insertTab, indentLess } from '@codemirror/commands';
import type { KeyBinding } from '@codemirror/view';

// ============================================================
// PUBLIC FUNCTIONS
// ============================================================

/**
 * Creates key bindings for Tab and Shift-Tab
 *
 * Tab: Inserts 2 spaces at cursor position or indents selected lines
 * Shift-Tab: Reduces indentation by 2 spaces
 * Escape: Remains unmapped for focus navigation accessibility
 *
 * @returns Array of 2 key bindings (Tab, Shift-Tab)
 */
export function createTabKeyBinding(): KeyBinding[] {
  return [
    {
      key: 'Tab',
      preventDefault: true,
      run: insertTab,
    },
    {
      key: 'Shift-Tab',
      preventDefault: true,
      run: indentLess,
    },
  ];
}
