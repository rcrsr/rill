/**
 * Toolbar Component
 *
 * Brand-aligned toolbar with neon accent run button, example selector,
 * and keyboard shortcut hint. Dark-only void aesthetic.
 *
 * Features:
 * - AC-5: Run button triggers execution
 * - AC-6: Example loading replaces editor content without auto-executing
 * - Keyboard accessible controls (WAI-ARIA patterns)
 */

import type React from 'react';
import type { JSX } from 'react';
import { loadExample, type CodeExample } from '../lib/examples.js';
import rillLogo from '../assets/rill-logo.png';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

/**
 * Toolbar component props
 */
export interface ToolbarProps {
  /** Callback when Run button is clicked */
  onRun: () => void;
  /** Callback when example is selected */
  onExampleSelect: (example: CodeExample) => void;
  /** Disable Run button during execution */
  disabled?: boolean;
  /** ARIA label for toolbar */
  ariaLabel?: string;
}

// ============================================================
// CONSTANTS
// ============================================================

const EXAMPLE_IDS = [
  'hello-world',
  'variables',
  'pipes',
  'functions',
  'conditionals',
] as const;

const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);

// ============================================================
// TOOLBAR COMPONENT
// ============================================================

/**
 * Toolbar with brand neon styling
 */
export function Toolbar({
  onRun,
  onExampleSelect,
  disabled = false,
  ariaLabel = 'Toolbar',
}: ToolbarProps): JSX.Element {
  const handleExampleChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const exampleId = event.target.value;
    if (!exampleId) return;

    const example = loadExample(exampleId);
    if (example) {
      onExampleSelect(example);
    }

    // Reset select to placeholder after loading
    event.target.value = '';
  };

  return (
    <div className="toolbar" role="toolbar" aria-label={ariaLabel}>
      {/* Brand logo */}
      <img src={rillLogo} alt="rill" className="toolbar-logo" />

      <div className="toolbar-separator" />

      {/* Run Button */}
      <button
        type="button"
        onClick={onRun}
        disabled={disabled}
        aria-label="Run code"
        className="toolbar-run"
      >
        <span className="toolbar-run-icon" />
        Run
      </button>

      {/* Example Selector */}
      <select
        onChange={handleExampleChange}
        disabled={disabled}
        aria-label="Select example"
        className="toolbar-select"
        defaultValue=""
      >
        <option value="" disabled>
          Examples
        </option>
        {EXAMPLE_IDS.map((id) => {
          const example = loadExample(id);
          return example ? (
            <option key={id} value={id}>
              {example.label}
            </option>
          ) : null;
        })}
      </select>

      {/* Spacer */}
      <div className="toolbar-spacer" />

      {/* Keyboard shortcut hint */}
      <span className="toolbar-shortcut">
        <kbd>{IS_MAC ? '\u2318' : 'Ctrl'}</kbd>+<kbd>Enter</kbd> to run
      </span>
    </div>
  );
}
