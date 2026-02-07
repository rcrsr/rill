/**
 * Toolbar Component
 *
 * Provides Run button, example selector dropdown, and theme toggle.
 * Run button triggers executeRill with current editor content.
 * Example dropdown lists all CodeExamples; selecting one replaces editor content without auto-executing (AC-6).
 * Theme toggle switches dark/light and persists via persistEditorState (AC-7).
 * Keyboard accessible controls (WAI-ARIA patterns).
 */

import type React from 'react';
import type { JSX } from 'react';
import { loadExample, type CodeExample } from '../lib/examples.js';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

/**
 * Theme variant for toolbar styling
 */
export type ToolbarTheme = 'light' | 'dark';

/**
 * Toolbar component props
 */
export interface ToolbarProps {
  /** Callback when Run button is clicked */
  onRun: () => void;
  /** Callback when example is selected */
  onExampleSelect: (example: CodeExample) => void;
  /** Callback when theme toggle is clicked */
  onThemeToggle: () => void;
  /** Current theme variant */
  theme?: ToolbarTheme;
  /** Disable Run button during execution */
  disabled?: boolean;
  /** ARIA label for toolbar */
  ariaLabel?: string;
}

// ============================================================
// CONSTANTS
// ============================================================

/**
 * Available examples in dropdown order
 */
const EXAMPLE_IDS = [
  'hello-world',
  'variables',
  'pipes',
  'functions',
  'conditionals',
] as const;

// ============================================================
// TOOLBAR COMPONENT
// ============================================================

/**
 * Toolbar component for Rill Fiddle
 *
 * Features:
 * - Run button triggers execution (AC-5)
 * - Example selector loads predefined examples (AC-6)
 * - Theme toggle switches dark/light mode (AC-7)
 * - Keyboard accessible controls (WAI-ARIA patterns)
 * - Disabled state during execution
 */
export function Toolbar({
  onRun,
  onExampleSelect,
  onThemeToggle,
  theme = 'light',
  disabled = false,
  ariaLabel = 'Toolbar',
}: ToolbarProps): JSX.Element {
  // ============================================================
  // EVENT HANDLERS
  // ============================================================

  /**
   * Handle example selection from dropdown
   */
  const handleExampleChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const exampleId = event.target.value;
    if (!exampleId) return;

    const example = loadExample(exampleId);
    if (example) {
      onExampleSelect(example);
    }
  };

  // ============================================================
  // THEME STYLES
  // ============================================================

  const containerStyles: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    backgroundColor: theme === 'light' ? '#f3f4f6' : '#2d2d2d',
    borderBottom: `1px solid ${theme === 'light' ? '#e5e7eb' : '#404040'}`,
  };

  const buttonStyles: React.CSSProperties = {
    padding: '8px 16px',
    fontSize: '14px',
    fontWeight: '500',
    borderRadius: '4px',
    border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    backgroundColor: disabled
      ? theme === 'light'
        ? '#d1d5db'
        : '#4b5563'
      : theme === 'light'
        ? '#3b82f6'
        : '#2563eb',
    color: '#ffffff',
    opacity: disabled ? 0.6 : 1,
    transition: 'background-color 0.2s',
  };

  const selectStyles: React.CSSProperties = {
    padding: '8px 12px',
    fontSize: '14px',
    borderRadius: '4px',
    border: `1px solid ${theme === 'light' ? '#d1d5db' : '#4b5563'}`,
    backgroundColor: theme === 'light' ? '#ffffff' : '#374151',
    color: theme === 'light' ? '#1f2937' : '#d4d4d4',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  };

  const themeButtonStyles: React.CSSProperties = {
    padding: '8px 12px',
    fontSize: '14px',
    fontWeight: '500',
    borderRadius: '4px',
    border: `1px solid ${theme === 'light' ? '#d1d5db' : '#4b5563'}`,
    backgroundColor: theme === 'light' ? '#ffffff' : '#374151',
    color: theme === 'light' ? '#1f2937' : '#d4d4d4',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  };

  const spacerStyles: React.CSSProperties = {
    flex: 1,
  };

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div className="toolbar-container" role="toolbar" aria-label={ariaLabel} style={containerStyles}>
      {/* Run Button */}
      <button
        type="button"
        onClick={onRun}
        disabled={disabled}
        aria-label="Run code"
        className="toolbar-run-button"
        style={buttonStyles}
        onMouseEnter={(e) => {
          if (!disabled) {
            (e.target as HTMLButtonElement).style.backgroundColor =
              theme === 'light' ? '#2563eb' : '#1d4ed8';
          }
        }}
        onMouseLeave={(e) => {
          if (!disabled) {
            (e.target as HTMLButtonElement).style.backgroundColor =
              theme === 'light' ? '#3b82f6' : '#2563eb';
          }
        }}
      >
        Run
      </button>

      {/* Example Selector */}
      <select
        onChange={handleExampleChange}
        disabled={disabled}
        aria-label="Select example"
        className="toolbar-example-select"
        style={selectStyles}
        defaultValue=""
      >
        <option value="" disabled>
          Load Example...
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
      <div style={spacerStyles} />

      {/* Theme Toggle */}
      <button
        type="button"
        onClick={onThemeToggle}
        aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
        className="toolbar-theme-toggle"
        style={themeButtonStyles}
        onMouseEnter={(e) => {
          (e.target as HTMLButtonElement).style.backgroundColor =
            theme === 'light' ? '#f9fafb' : '#4b5563';
        }}
        onMouseLeave={(e) => {
          (e.target as HTMLButtonElement).style.backgroundColor =
            theme === 'light' ? '#ffffff' : '#374151';
        }}
      >
        {theme === 'light' ? '🌙 Dark' : '☀️ Light'}
      </button>
    </div>
  );
}
