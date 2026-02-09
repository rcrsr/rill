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
import rillIconColor from '../assets/rill-icon-color.png';

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
  /** Callback when Copy Link button is clicked */
  onCopyLink?: () => void;
  /** Feedback state for copy link button */
  copyLinkState?: 'idle' | 'copied' | 'error';
  /** Disable Run button during execution */
  disabled?: boolean;
  /** ARIA label for toolbar */
  ariaLabel?: string;
  /** Link destination for logo (defaults to "/") */
  logoHref?: string;
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
  'fold',
  'fizzbuzz',
  'dispatch',
  'closures',
  'collection-pipeline',
  'destructuring',
  'slicing',
  'type-checking',
  'string-processing',
  'dict-methods',
  'state-machine',
  'spread',
] as const;

const IS_MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);

// ============================================================
// TOOLBAR COMPONENT
// ============================================================

/**
 * Toolbar with brand neon styling
 */
export function Toolbar({
  onRun,
  onExampleSelect,
  onCopyLink,
  copyLinkState = 'idle',
  disabled = false,
  ariaLabel = 'Toolbar',
  logoHref = '/',
}: ToolbarProps): JSX.Element {
  const handleExampleChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ): void => {
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
      <a href={logoHref} className="toolbar-logo-link">
        <img src={rillIconColor} alt="rill" className="toolbar-logo" />
      </a>

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

      {/* Copy Link Button */}
      {onCopyLink && (
        <>
          <div className="toolbar-separator" />
          <button
            type="button"
            onClick={onCopyLink}
            disabled={disabled}
            aria-label="Copy shareable link"
            className="toolbar-share"
          >
            <svg
              className="toolbar-share-icon"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 8L10 2M10 2H6M10 2V6M10 10H2V4" />
            </svg>
            {copyLinkState === 'copied'
              ? 'Copied!'
              : copyLinkState === 'error'
                ? 'Error'
                : 'Share'}
          </button>
        </>
      )}

      {/* Spacer */}
      <div className="toolbar-spacer" />

      {/* Keyboard shortcut hint */}
      <span className="toolbar-shortcut">
        <kbd>{IS_MAC ? '\u2318' : 'Ctrl'}</kbd>+<kbd>Enter</kbd> to run
      </span>
    </div>
  );
}
