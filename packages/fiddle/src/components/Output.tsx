/**
 * Output Component
 *
 * Displays execution results with brand-aligned styling.
 * Shows idle state with pipe animation, running indicator,
 * success result, or structured error display.
 *
 * Features:
 * - AC-9: Formatted result display
 * - AC-10: "No output" for null results
 * - AC-12/13/14: Error display with line number and help links
 * - ARIA labels for screen reader support
 */

import type { JSX } from 'react';
import type { ExecutionState } from '../lib/execution.js';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

/**
 * Output component props
 */
export interface OutputProps {
  /** Current execution state */
  state: ExecutionState;
  /** ARIA label for screen readers */
  ariaLabel?: string;
}

// ============================================================
// OUTPUT COMPONENT
// ============================================================

export function Output({
  state,
  ariaLabel = 'Execution output',
}: OutputProps): JSX.Element {
  const { status, result, error, duration, logs } = state;
  const hasLogs = logs.length > 0;

  return (
    <div className="output-panel" aria-label={ariaLabel}>
      {/* Panel header */}
      <div className="output-header">
        <span className="output-header-label">Output</span>
        <div className="output-header-spacer" />
        {duration !== null && (
          <span className="output-header-duration">
            {status === 'error' ? 'failed' : 'ran'} in {duration.toFixed(1)}ms
          </span>
        )}
      </div>

      {/* Panel body */}
      <div className="output-body">
        {/* Idle: empty state */}
        {status === 'idle' && (
          <div className="output-idle">
            <div className="output-idle-pipe">
              {'->'} {'->'} {'->'}
            </div>
            <div className="output-idle-text">Run code to see output</div>
          </div>
        )}

        {/* Running: pipe flow indicator */}
        {status === 'running' && (
          <div className="output-running">
            <div className="output-running-indicator" />
          </div>
        )}

        {/* Success: formatted result with optional logs section */}
        {status === 'success' && (
          <>
            {hasLogs && (
              <div className="output-logs">
                <div className="output-logs-label">Log</div>
                <div className="output-logs-entries">
                  {logs.map((entry, index) => (
                    <div key={index} className="output-logs-entry">
                      {entry}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="output-result">
              {hasLogs && <div className="output-result-label">Result</div>}
              {result === 'null' ? 'No output' : result}
            </div>
          </>
        )}

        {/* Error: structured error display with optional logs above */}
        {status === 'error' && error !== null && (
          <>
            {hasLogs && (
              <div className="output-logs">
                <div className="output-logs-label">Log</div>
                <div className="output-logs-entries">
                  {logs.map((entry, index) => (
                    <div key={index} className="output-logs-entry">
                      {entry}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="output-error" role="alert">
              <div className="output-error-header">
                <span className="output-error-badge">
                  {error.category === 'lexer' && 'Syntax'}
                  {error.category === 'parse' && 'Parse'}
                  {error.category === 'runtime' && 'Runtime'}
                </span>
                {error.errorId && (
                  <span className="output-error-id">{error.errorId}</span>
                )}
              </div>

              <div className="output-error-message">{error.message}</div>

              {error.line !== null && (
                <div className="output-error-location">
                  line {error.line}
                  {error.column !== null && `, col ${error.column}`}
                </div>
              )}

              {error.cause && (
                <div className="output-error-cause">{error.cause}</div>
              )}

              {error.resolution && (
                <div className="output-error-resolution">
                  <strong>Fix:</strong> {error.resolution}
                </div>
              )}

              {error.helpUrl && (
                <div className="output-error-help">
                  <a
                    href={error.helpUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Docs {'->'}
                  </a>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
