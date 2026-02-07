/**
 * Output Component
 *
 * Displays execution results with formatted output and error handling.
 * Shows result when status is "success".
 * Shows error alert with line number when status is "error".
 * Shows nothing when status is "idle" or "running".
 * ARIA labels for screen reader support.
 */

import type React from 'react';
import type { JSX } from 'react';
import type { ExecutionState } from '../lib/execution.js';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

/**
 * Theme variant for output styling
 */
export type OutputTheme = 'light' | 'dark';

/**
 * Output component props
 */
export interface OutputProps {
  /** Current execution state */
  state: ExecutionState;
  /** Theme variant */
  theme?: OutputTheme;
  /** ARIA label for screen readers */
  ariaLabel?: string;
}

// ============================================================
// OUTPUT COMPONENT
// ============================================================

/**
 * Output component for execution results
 *
 * Features:
 * - Displays formatted result when status is "success" (AC-9)
 * - Shows "No output" when result is null (AC-10)
 * - Clears previous output on re-execution (AC-11)
 * - Displays error alert with line number (AC-12, AC-13, AC-14)
 * - ARIA labels for accessibility
 * - Theme support (light/dark)
 */
export function Output({
  state,
  theme = 'light',
  ariaLabel = 'Execution output',
}: OutputProps): JSX.Element {
  const { status, result, error, duration } = state;

  // ============================================================
  // THEME STYLES
  // ============================================================

  const containerStyles: React.CSSProperties = {
    height: '100%',
    width: '100%',
    padding: '16px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '14px',
    overflowY: 'auto',
    backgroundColor: theme === 'light' ? '#ffffff' : '#1e1e1e',
    color: theme === 'light' ? '#1f2937' : '#d4d4d4',
  };

  const resultStyles: React.CSSProperties = {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    marginBottom: '16px',
  };

  const errorStyles: React.CSSProperties = {
    padding: '12px',
    borderRadius: '4px',
    backgroundColor: theme === 'light' ? '#fee2e2' : '#7f1d1d',
    color: theme === 'light' ? '#991b1b' : '#fecaca',
    marginBottom: '16px',
  };

  const errorHeaderStyles: React.CSSProperties = {
    fontWeight: 'bold',
    marginBottom: '8px',
  };

  const errorMessageStyles: React.CSSProperties = {
    marginBottom: '4px',
  };

  const errorLocationStyles: React.CSSProperties = {
    fontSize: '12px',
    opacity: 0.8,
  };

  const durationStyles: React.CSSProperties = {
    fontSize: '12px',
    opacity: 0.6,
    marginTop: '8px',
  };

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div className="output-container" aria-label={ariaLabel} style={containerStyles}>
      {/* AC-9, AC-10: Success status displays formatted result */}
      {status === 'success' && (
        <>
          <div className="output-result" style={resultStyles}>
            {result === 'null' ? 'No output' : result}
          </div>
          {duration !== null && (
            <div className="output-duration" style={durationStyles}>
              Executed in {duration.toFixed(2)}ms
            </div>
          )}
        </>
      )}

      {/* AC-12, AC-13, AC-14: Error status displays error alert with line number */}
      {status === 'error' && error !== null && (
        <>
          <div className="output-error" role="alert" style={errorStyles}>
            <div style={errorHeaderStyles}>
              {error.category === 'lexer' && 'Syntax Error'}
              {error.category === 'parse' && 'Parse Error'}
              {error.category === 'runtime' && 'Runtime Error'}
              {error.errorId && ` (${error.errorId})`}
            </div>
            <div style={errorMessageStyles}>{error.message}</div>
            {error.line !== null && (
              <div style={errorLocationStyles}>
                at line {error.line}
                {error.column !== null && `, column ${error.column}`}
              </div>
            )}
          </div>
          {duration !== null && (
            <div className="output-duration" style={durationStyles}>
              Failed after {duration.toFixed(2)}ms
            </div>
          )}
        </>
      )}
    </div>
  );
}
