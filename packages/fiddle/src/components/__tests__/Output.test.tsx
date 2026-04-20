/**
 * Output Component Tests
 *
 * Test coverage for Output component:
 * - IC-12: Component renders without errors
 * - AC-9: Log output capture
 * - AC-10: Empty result message
 * - AC-11: Re-execution clears previous output
 * - AC-12: Syntax error display
 * - AC-13: Parse error display
 * - AC-14: Runtime error display
 * - AC-65: errorId not in ERROR_REGISTRY renders basic error without enrichment fields
 * - Verbose error rendering (cause, resolution, help URL)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Output } from '../Output.js';
import type { ExecutionState, FiddleError } from '../../lib/execution.js';

describe('Output', () => {
  let idleState: ExecutionState;
  let successState: ExecutionState;
  let errorState: ExecutionState;

  beforeEach(() => {
    idleState = {
      status: 'idle',
      result: null,
      error: null,
      duration: null,
      logs: [],
    };

    successState = {
      status: 'success',
      result: 'hello world',
      error: null,
      duration: 42,
      logs: [],
    };

    errorState = {
      status: 'error',
      result: null,
      error: {
        message: 'Unexpected character',
        category: 'lexer',
        line: 1,
        column: 5,
        errorId: 'RILL-L001',
        statusCode: null,
        statusMessage: null,
        statusProvider: null,
        statusTrace: null,
      },
      duration: 10,
      logs: [],
    };
  });

  afterEach(() => {
    cleanup();
  });

  // ============================================================
  // IC-12: Component renders without errors
  // ============================================================

  describe('rendering', () => {
    it('renders without errors', () => {
      const { container } = render(<Output state={idleState} />);
      const output = container.querySelector('.output-panel');
      expect(output).toBeDefined();
    });

    it('applies ARIA label', () => {
      const { container } = render(
        <Output state={idleState} ariaLabel="Test output" />
      );
      const output = container.querySelector('[aria-label="Test output"]');
      expect(output).toBeDefined();
    });

    it('uses default ARIA label', () => {
      const { container } = render(<Output state={idleState} />);
      const output = container.querySelector('[aria-label="Execution output"]');
      expect(output).toBeDefined();
    });

    it('renders with dark brand theme', () => {
      const { container } = render(<Output state={idleState} />);
      const output = container.querySelector('.output-panel');
      expect(output).toBeDefined();
    });
  });

  // ============================================================
  // AC-9: Log output capture
  // ============================================================

  describe('log output', () => {
    it('LOG-1: script with 0 log() calls returns value - result renders, no logs section', () => {
      const stateNoLogs: ExecutionState = {
        status: 'success',
        result: 'hello world',
        error: null,
        duration: 50,
        logs: [],
      };
      const { container } = render(<Output state={stateNoLogs} />);
      const resultElement = container.querySelector('.output-result');
      const logsElement = container.querySelector('.output-logs');
      const resultLabel = container.querySelector('.output-result-label');

      expect(resultElement?.textContent).toContain('hello world');
      expect(logsElement).toBeNull();
      expect(resultLabel).toBeNull();
    });

    it('LOG-2: script with 1 log() call returns value - logs section with 1 entry, result section with value', () => {
      const stateWithOneLog: ExecutionState = {
        status: 'success',
        result: 'final result',
        error: null,
        duration: 50,
        logs: ['log line 1'],
      };
      const { container } = render(<Output state={stateWithOneLog} />);
      const logsElement = container.querySelector('.output-logs');
      const logsEntries = container.querySelectorAll('.output-logs-entry');
      const resultElement = container.querySelector('.output-result');
      const resultLabel = container.querySelector('.output-result-label');

      expect(logsElement).toBeDefined();
      expect(logsEntries.length).toBe(1);
      expect(logsEntries[0]?.textContent).toContain('log line 1');
      expect(resultElement?.textContent).toContain('final result');
      expect(resultLabel).toBeDefined();
    });

    it('LOG-3: script with 3 log() calls returns value - logs section with 3 entries in order', () => {
      const stateWithLogs: ExecutionState = {
        status: 'success',
        result: 'final result',
        error: null,
        duration: 50,
        logs: ['log line 1', 'log line 2', 'log line 3'],
      };
      const { container } = render(<Output state={stateWithLogs} />);
      const logsEntries = container.querySelectorAll('.output-logs-entry');
      const resultElement = container.querySelector('.output-result');

      expect(logsEntries.length).toBe(3);
      expect(logsEntries[0]?.textContent).toContain('log line 1');
      expect(logsEntries[1]?.textContent).toContain('log line 2');
      expect(logsEntries[2]?.textContent).toContain('log line 3');
      expect(resultElement?.textContent).toContain('final result');
    });

    it('LOG-4: script with log() calls and null result - logs section shows entries', () => {
      const stateLogsNullResult: ExecutionState = {
        status: 'success',
        result: 'null',
        error: null,
        duration: 30,
        logs: ['log output only'],
      };
      const { container } = render(<Output state={stateLogsNullResult} />);
      const logsEntries = container.querySelectorAll('.output-logs-entry');
      const resultElement = container.querySelector('.output-result');

      expect(logsEntries.length).toBe(1);
      expect(logsEntries[0]?.textContent).toContain('log output only');
      expect(resultElement?.textContent).toContain('No output');
    });

    it('LOG-5: script with log() calls that errors - logs shown above error', () => {
      const stateLogsWithError: ExecutionState = {
        status: 'error',
        result: null,
        error: {
          message: 'Runtime error',
          category: 'runtime',
          line: 5,
          column: 10,
          errorId: 'RILL-R001',
          statusCode: null,
          statusMessage: null,
          statusProvider: null,
          statusTrace: null,
        },
        duration: 30,
        logs: ['log before error', 'another log'],
      };
      const { container } = render(<Output state={stateLogsWithError} />);
      const logsElement = container.querySelector('.output-logs');
      const logsEntries = container.querySelectorAll('.output-logs-entry');
      const errorElement = container.querySelector('.output-error');

      expect(logsElement).toBeDefined();
      expect(logsEntries.length).toBe(2);
      expect(logsEntries[0]?.textContent).toContain('log before error');
      expect(logsEntries[1]?.textContent).toContain('another log');
      expect(errorElement).toBeDefined();
      expect(errorElement?.textContent).toContain('Runtime error');
    });

    it('LOG-E1: error before any log() - no logs section, error renders normally', () => {
      const stateErrorNoLogs: ExecutionState = {
        status: 'error',
        result: null,
        error: {
          message: 'Parse error',
          category: 'parse',
          line: 1,
          column: 1,
          errorId: 'RILL-P001',
          statusCode: null,
          statusMessage: null,
          statusProvider: null,
          statusTrace: null,
        },
        duration: 10,
        logs: [],
      };
      const { container } = render(<Output state={stateErrorNoLogs} />);
      const logsElement = container.querySelector('.output-logs');
      const errorElement = container.querySelector('.output-error');

      expect(logsElement).toBeNull();
      expect(errorElement).toBeDefined();
      expect(errorElement?.textContent).toContain('Parse error');
    });

    it('LOG-B2: log with multi-line value - preserves whitespace', () => {
      const stateMultilineLog: ExecutionState = {
        status: 'success',
        result: 'done',
        error: null,
        duration: 30,
        logs: ['line 1\nline 2\nline 3'],
      };
      const { container } = render(<Output state={stateMultilineLog} />);
      const logsEntry = container.querySelector('.output-logs-entry');

      expect(logsEntry?.textContent).toContain('line 1\nline 2\nline 3');
    });

    it('LOG-B3: re-execution replaces previous logs', () => {
      const stateWithLogs1: ExecutionState = {
        status: 'success',
        result: 'result 1',
        error: null,
        duration: 30,
        logs: ['old log'],
      };
      const stateWithLogs2: ExecutionState = {
        status: 'success',
        result: 'result 2',
        error: null,
        duration: 40,
        logs: ['new log'],
      };
      const { container, rerender } = render(<Output state={stateWithLogs1} />);

      let logsEntry = container.querySelector('.output-logs-entry');
      expect(logsEntry?.textContent).toContain('old log');

      rerender(<Output state={stateWithLogs2} />);

      logsEntry = container.querySelector('.output-logs-entry');
      expect(logsEntry?.textContent).toContain('new log');
      expect(logsEntry?.textContent).not.toContain('old log');
    });
  });

  // ============================================================
  // AC-10: Empty result message
  // ============================================================

  describe('empty result', () => {
    it('displays "No output" when result is null', () => {
      const stateWithNull: ExecutionState = {
        status: 'success',
        result: 'null',
        error: null,
        duration: 20,
        logs: [],
      };
      const { container } = render(<Output state={stateWithNull} />);
      const resultElement = container.querySelector('.output-result');
      expect(resultElement?.textContent).toContain('No output');
    });

    it('displays nothing when status is idle', () => {
      const { container } = render(<Output state={idleState} />);
      const resultElement = container.querySelector('.output-result');
      expect(resultElement).toBeNull();
    });

    it('displays nothing when status is running', () => {
      const runningState: ExecutionState = {
        status: 'running',
        result: null,
        error: null,
        duration: null,
        logs: [],
      };
      const { container } = render(<Output state={runningState} />);
      const resultElement = container.querySelector('.output-result');
      expect(resultElement).toBeNull();
    });
  });

  // ============================================================
  // AC-11: Re-execution clears previous output
  // ============================================================

  describe('re-execution', () => {
    it('clears previous output when state changes to idle', () => {
      const { container, rerender } = render(<Output state={successState} />);

      // Verify initial result
      let resultElement = container.querySelector('.output-result');
      expect(resultElement?.textContent).toContain('hello world');

      // Update to idle state (clears output)
      rerender(<Output state={idleState} />);

      // Verify output cleared
      resultElement = container.querySelector('.output-result');
      expect(resultElement).toBeNull();
    });

    it('clears previous output when state changes to running', () => {
      const { container, rerender } = render(<Output state={successState} />);

      // Verify initial result
      let resultElement = container.querySelector('.output-result');
      expect(resultElement?.textContent).toContain('hello world');

      // Update to running state (clears output)
      const runningState: ExecutionState = {
        status: 'running',
        result: null,
        error: null,
        duration: null,
        logs: [],
      };
      rerender(<Output state={runningState} />);

      // Verify output cleared
      resultElement = container.querySelector('.output-result');
      expect(resultElement).toBeNull();
    });

    it('replaces previous result with new result', () => {
      const { container, rerender } = render(<Output state={successState} />);

      // Verify initial result
      let resultElement = container.querySelector('.output-result');
      expect(resultElement?.textContent).toContain('hello world');

      // Update to new result
      const newState: ExecutionState = {
        status: 'success',
        result: 'new output',
        error: null,
        duration: 100,
        logs: [],
      };
      rerender(<Output state={newState} />);

      // Verify new result
      resultElement = container.querySelector('.output-result');
      expect(resultElement?.textContent).toContain('new output');
      expect(resultElement?.textContent).not.toContain('hello world');
    });
  });

  // ============================================================
  // AC-12: Syntax error display (LexerError)
  // ============================================================

  describe('syntax errors', () => {
    it('displays LexerError with line number', () => {
      const lexerError: FiddleError = {
        message: 'Unterminated string literal',
        category: 'lexer',
        line: 1,
        column: 10,
        errorId: 'RILL-L002',
        statusCode: null,
        statusMessage: null,
        statusProvider: null,
        statusTrace: null,
      };
      const lexerState: ExecutionState = {
        status: 'error',
        result: null,
        error: lexerError,
        duration: 5,
        logs: [],
      };
      const { container } = render(<Output state={lexerState} />);
      const errorElement = container.querySelector('.output-error');
      expect(errorElement?.textContent).toContain(
        'Unterminated string literal'
      );
      expect(errorElement?.textContent).toContain('line 1');
    });

    it('displays LexerError without line number', () => {
      const lexerError: FiddleError = {
        message: 'Invalid character',
        category: 'lexer',
        line: null,
        column: null,
        errorId: 'RILL-L001',
        statusCode: null,
        statusMessage: null,
        statusProvider: null,
        statusTrace: null,
      };
      const lexerState: ExecutionState = {
        status: 'error',
        result: null,
        error: lexerError,
        duration: 3,
        logs: [],
      };
      const { container } = render(<Output state={lexerState} />);
      const errorElement = container.querySelector('.output-error');
      expect(errorElement?.textContent).toContain('Invalid character');
      // No location element rendered when line is null
      const locationElement = container.querySelector('.output-error-location');
      expect(locationElement).toBeNull();
    });
  });

  // ============================================================
  // AC-13: Parse error display (ParseError)
  // ============================================================

  describe('parse errors', () => {
    it('displays ParseError with line reference', () => {
      const parseError: FiddleError = {
        message: 'Expected expression after pipe operator',
        category: 'parse',
        line: 3,
        column: 8,
        errorId: 'RILL-P001',
        statusCode: null,
        statusMessage: null,
        statusProvider: null,
        statusTrace: null,
      };
      const parseState: ExecutionState = {
        status: 'error',
        result: null,
        error: parseError,
        duration: 8,
        logs: [],
      };
      const { container } = render(<Output state={parseState} />);
      const errorElement = container.querySelector('.output-error');
      expect(errorElement?.textContent).toContain(
        'Expected expression after pipe operator'
      );
      expect(errorElement?.textContent).toContain('line 3');
    });

    it('displays ParseError without line reference', () => {
      const parseError: FiddleError = {
        message: 'Unexpected end of input',
        category: 'parse',
        line: null,
        column: null,
        errorId: 'RILL-P002',
        statusCode: null,
        statusMessage: null,
        statusProvider: null,
        statusTrace: null,
      };
      const parseState: ExecutionState = {
        status: 'error',
        result: null,
        error: parseError,
        duration: 5,
        logs: [],
      };
      const { container } = render(<Output state={parseState} />);
      const errorElement = container.querySelector('.output-error');
      expect(errorElement?.textContent).toContain('Unexpected end of input');
      const locationElement = container.querySelector('.output-error-location');
      expect(locationElement).toBeNull();
    });
  });

  // ============================================================
  // AC-14: Runtime error display (RuntimeError)
  // ============================================================

  describe('runtime errors', () => {
    it('displays RuntimeError with type mismatch message', () => {
      const runtimeError: FiddleError = {
        message: 'Type error: Cannot add string and number',
        category: 'runtime',
        line: 2,
        column: 12,
        errorId: 'RILL-R001',
        statusCode: null,
        statusMessage: null,
        statusProvider: null,
        statusTrace: null,
      };
      const runtimeState: ExecutionState = {
        status: 'error',
        result: null,
        error: runtimeError,
        duration: 15,
        logs: [],
      };
      const { container } = render(<Output state={runtimeState} />);
      const errorElement = container.querySelector('.output-error');
      expect(errorElement?.textContent).toContain(
        'Type error: Cannot add string and number'
      );
      expect(errorElement?.textContent).toContain('line 2');
    });

    it('displays RuntimeError without line number', () => {
      const runtimeError: FiddleError = {
        message: 'Variable not defined: $x',
        category: 'runtime',
        line: null,
        column: null,
        errorId: 'RILL-R002',
        statusCode: null,
        statusMessage: null,
        statusProvider: null,
        statusTrace: null,
      };
      const runtimeState: ExecutionState = {
        status: 'error',
        result: null,
        error: runtimeError,
        duration: 12,
        logs: [],
      };
      const { container } = render(<Output state={runtimeState} />);
      const errorElement = container.querySelector('.output-error');
      expect(errorElement?.textContent).toContain('Variable not defined: $x');
      const locationElement = container.querySelector('.output-error-location');
      expect(locationElement).toBeNull();
    });
  });

  // ============================================================
  // Error ID display
  // ============================================================

  describe('error ID display', () => {
    it('displays error ID when present', () => {
      const errorWithId: FiddleError = {
        message: 'Test error',
        category: 'runtime',
        line: 1,
        column: 1,
        errorId: 'RILL-R999',
        statusCode: null,
        statusMessage: null,
        statusProvider: null,
        statusTrace: null,
      };
      const errorState: ExecutionState = {
        status: 'error',
        result: null,
        error: errorWithId,
        duration: 10,
        logs: [],
      };
      const { container } = render(<Output state={errorState} />);
      const errorElement = container.querySelector('.output-error');
      expect(errorElement?.textContent).toContain('RILL-R999');
    });

    it('does not display error ID when null', () => {
      const errorWithoutId: FiddleError = {
        message: 'Test error',
        category: 'runtime',
        line: 1,
        column: 1,
        errorId: null,
        statusCode: null,
        statusMessage: null,
        statusProvider: null,
        statusTrace: null,
      };
      const errorState: ExecutionState = {
        status: 'error',
        result: null,
        error: errorWithoutId,
        duration: 10,
        logs: [],
      };
      const { container } = render(<Output state={errorState} />);
      const errorIdElement = container.querySelector('.output-error-id');
      expect(errorIdElement).toBeNull();
    });
  });

  // ============================================================
  // Verbose error rendering
  // ============================================================

  describe('verbose error rendering', () => {
    it('renders error cause when present', () => {
      const errorWithCause: FiddleError = {
        message: 'Variable foo is not defined',
        category: 'runtime',
        line: 5,
        column: 10,
        errorId: 'RILL-R005',
        helpUrl: undefined,
        cause: 'Variable referenced before assignment',
        resolution: undefined,
        examples: undefined,
        statusCode: null,
        statusMessage: null,
        statusProvider: null,
        statusTrace: null,
      };
      const stateWithCause: ExecutionState = {
        status: 'error',
        result: null,
        error: errorWithCause,
        duration: 100,
        logs: [],
      };
      const { container } = render(<Output state={stateWithCause} />);
      const causeElement = container.querySelector('.output-error-cause');
      expect(causeElement).toBeDefined();
      expect(causeElement?.textContent).toContain(
        'Variable referenced before assignment'
      );
    });

    it('renders error resolution when present', () => {
      const errorWithResolution: FiddleError = {
        message: 'Type mismatch in operation',
        category: 'runtime',
        line: 3,
        column: 8,
        errorId: 'RILL-R002',
        helpUrl: undefined,
        cause: undefined,
        resolution:
          'Ensure both operands are the same type before performing the operation',
        examples: undefined,
        statusCode: null,
        statusMessage: null,
        statusProvider: null,
        statusTrace: null,
      };
      const stateWithResolution: ExecutionState = {
        status: 'error',
        result: null,
        error: errorWithResolution,
        duration: 50,
        logs: [],
      };
      const { container } = render(<Output state={stateWithResolution} />);
      const resolutionElement = container.querySelector(
        '.output-error-resolution'
      );
      expect(resolutionElement).toBeDefined();
      expect(resolutionElement?.textContent).toContain('Fix:');
      expect(resolutionElement?.textContent).toContain(
        'Ensure both operands are the same type'
      );
    });

    it('renders help link when helpUrl is present', () => {
      const errorWithHelpUrl: FiddleError = {
        message: 'Syntax error',
        category: 'parse',
        line: 1,
        column: 1,
        errorId: 'RILL-P001',
        helpUrl: 'https://example.com/docs/errors/RILL-P001',
        cause: undefined,
        resolution: undefined,
        examples: undefined,
        statusCode: null,
        statusMessage: null,
        statusProvider: null,
        statusTrace: null,
      };
      const stateWithHelpUrl: ExecutionState = {
        status: 'error',
        result: null,
        error: errorWithHelpUrl,
        duration: 20,
        logs: [],
      };
      const { container } = render(<Output state={stateWithHelpUrl} />);
      const linkElement = container.querySelector(
        'a[href="https://example.com/docs/errors/RILL-P001"]'
      );
      expect(linkElement).toBeDefined();
      expect(linkElement?.getAttribute('target')).toBe('_blank');
      expect(linkElement?.getAttribute('rel')).toBe('noopener noreferrer');
      expect(linkElement?.textContent).toContain('Docs');
    });

    // AC-65: errorId not in ERROR_REGISTRY renders basic error without enrichment fields
    it('renders basic error without verbose fields', () => {
      const basicError: FiddleError = {
        message: 'Unexpected token',
        category: 'lexer',
        line: 2,
        column: 5,
        errorId: 'RILL-L001',
        helpUrl: undefined,
        cause: undefined,
        resolution: undefined,
        examples: undefined,
        statusCode: null,
        statusMessage: null,
        statusProvider: null,
        statusTrace: null,
      };
      const stateWithBasicError: ExecutionState = {
        status: 'error',
        result: null,
        error: basicError,
        duration: 15,
        logs: [],
      };
      const { container } = render(<Output state={stateWithBasicError} />);
      const errorElement = container.querySelector('.output-error');
      expect(errorElement?.textContent).toContain('Unexpected token');
      expect(container.querySelector('.output-error-cause')).toBeNull();
      expect(container.querySelector('.output-error-resolution')).toBeNull();
      expect(container.querySelector('a')).toBeNull();
    });
  });

  // ============================================================
  // Duration display
  // ============================================================

  describe('duration display', () => {
    it('displays execution duration for success', () => {
      const { container } = render(<Output state={successState} />);
      const durationElement = container.querySelector(
        '.output-header-duration'
      );
      expect(durationElement).toBeDefined();
      expect(durationElement?.textContent).toContain('42');
      expect(durationElement?.textContent).toContain('ms');
    });

    it('displays execution duration for error', () => {
      const { container } = render(<Output state={errorState} />);
      const durationElement = container.querySelector(
        '.output-header-duration'
      );
      expect(durationElement).toBeDefined();
      expect(durationElement?.textContent).toContain('10');
      expect(durationElement?.textContent).toContain('ms');
    });

    it('does not display duration when null', () => {
      const { container } = render(<Output state={idleState} />);
      const durationElement = container.querySelector(
        '.output-header-duration'
      );
      expect(durationElement).toBeNull();
    });
  });

  // ============================================================
  // Accessibility
  // ============================================================

  describe('accessibility', () => {
    it('has accessible container', () => {
      const { container } = render(<Output state={successState} />);
      const output = container.querySelector('[aria-label="Execution output"]');
      expect(output).toBeDefined();
    });

    it('error has role="alert"', () => {
      const { container } = render(<Output state={errorState} />);
      const errorElement = container.querySelector('[role="alert"]');
      expect(errorElement).toBeDefined();
    });

    it('result has appropriate ARIA attributes', () => {
      const { container } = render(<Output state={successState} />);
      const resultElement = container.querySelector('.output-result');
      expect(resultElement).toBeDefined();
    });
  });

  // ============================================================
  // AC-FDL-6: Invalid-value halt panel rendering
  // ============================================================

  describe('invalid-value halt rendering', () => {
    it('AC-FDL-6: halt panel renders #CODE with sigil when statusCode is set', () => {
      const haltState: ExecutionState = {
        status: 'error',
        result: null,
        error: {
          message:
            '#TYPE_MISMATCH: Type assertion failed: expected number, got string',
          category: 'runtime',
          line: null,
          column: null,
          errorId: null,
          statusCode: 'TYPE_MISMATCH',
          statusMessage: 'Type assertion failed: expected number, got string',
          statusProvider: 'runtime',
          statusTrace: [
            { kind: 'type', site: '<script>:1:20', fn: '', wrapped: {} },
            {
              kind: 'guard-caught',
              site: '<script>:1:1',
              fn: 'guard',
              wrapped: {},
            },
          ],
        },
        duration: 10,
        logs: [],
      };
      const { container } = render(<Output state={haltState} />);
      const statusCode = container.querySelector('.output-error-status-code');
      expect(statusCode).toBeDefined();
      expect(statusCode?.textContent).toContain('#TYPE_MISMATCH');
    });

    it('AC-FDL-6: halt panel renders statusMessage when present', () => {
      const haltState: ExecutionState = {
        status: 'error',
        result: null,
        error: {
          message: '#TYPE_MISMATCH: Type assertion failed',
          category: 'runtime',
          line: null,
          column: null,
          errorId: null,
          statusCode: 'TYPE_MISMATCH',
          statusMessage: 'Type assertion failed',
          statusProvider: 'runtime',
          statusTrace: [
            {
              kind: 'guard-caught',
              site: '<script>:1:1',
              fn: 'guard',
              wrapped: {},
            },
          ],
        },
        duration: 5,
        logs: [],
      };
      const { container } = render(<Output state={haltState} />);
      const msg = container.querySelector('.output-error-status-message');
      expect(msg).toBeDefined();
      expect(msg?.textContent).toContain('Type assertion failed');
    });

    it('AC-FDL-6: halt panel renders statusProvider when present', () => {
      const haltState: ExecutionState = {
        status: 'error',
        result: null,
        error: {
          message: '#TIMEOUT: timed out',
          category: 'runtime',
          line: null,
          column: null,
          errorId: null,
          statusCode: 'TIMEOUT',
          statusMessage: 'timed out',
          statusProvider: 'my-service',
          statusTrace: [
            { kind: 'host', site: '<host>', fn: 'my-service', wrapped: {} },
            {
              kind: 'guard-caught',
              site: '<script>:1:1',
              fn: 'guard',
              wrapped: {},
            },
          ],
        },
        duration: 200,
        logs: [],
      };
      const { container } = render(<Output state={haltState} />);
      const provider = container.querySelector('.output-error-status-provider');
      expect(provider).toBeDefined();
      expect(provider?.textContent).toContain('my-service');
    });

    // AC-FDL-8: trace frame panel renders kind, site, fn
    it('AC-FDL-8: trace frame panel renders kind, site, and fn for each frame', () => {
      const haltState: ExecutionState = {
        status: 'error',
        result: null,
        error: {
          message: '#TYPE_MISMATCH: Type assertion failed',
          category: 'runtime',
          line: null,
          column: null,
          errorId: null,
          statusCode: 'TYPE_MISMATCH',
          statusMessage: 'Type assertion failed',
          statusProvider: 'runtime',
          statusTrace: [
            { kind: 'type', site: '<script>:1:20', fn: 'check', wrapped: {} },
            {
              kind: 'guard-caught',
              site: '<script>:1:1',
              fn: 'guard',
              wrapped: {},
            },
          ],
        },
        duration: 8,
        logs: [],
      };
      const { container } = render(<Output state={haltState} />);
      const frames = container.querySelectorAll(
        '.output-error-status-trace-frame'
      );
      expect(frames.length).toBe(2);

      // First frame: type / <script>:1:20 / check
      const frame0 = frames[0];
      expect(
        frame0?.querySelector('.output-error-status-trace-kind')?.textContent
      ).toBe('type');
      expect(
        frame0?.querySelector('.output-error-status-trace-fn')?.textContent
      ).toBe('check');
      expect(
        frame0?.querySelector('.output-error-status-trace-site')?.textContent
      ).toBe('<script>:1:20');

      // Second frame: guard-caught / <script>:1:1 / guard
      const frame1 = frames[1];
      expect(
        frame1?.querySelector('.output-error-status-trace-kind')?.textContent
      ).toBe('guard-caught');
      expect(
        frame1?.querySelector('.output-error-status-trace-fn')?.textContent
      ).toBe('guard');
    });

    it('AC-FDL-8: frame with empty fn does not render fn element', () => {
      const haltState: ExecutionState = {
        status: 'error',
        result: null,
        error: {
          message: '#TYPE_MISMATCH: failed',
          category: 'runtime',
          line: null,
          column: null,
          errorId: null,
          statusCode: 'TYPE_MISMATCH',
          statusMessage: 'failed',
          statusProvider: '',
          statusTrace: [
            { kind: 'type', site: '<script>:1:5', fn: '', wrapped: {} },
          ],
        },
        duration: 3,
        logs: [],
      };
      const { container } = render(<Output state={haltState} />);
      const fnElement = container.querySelector(
        '.output-error-status-trace-fn'
      );
      // fn is empty string; Output.tsx gates render on frame.fn !== ''
      expect(fnElement).toBeNull();
    });

    // AC-FDL-B3: wrap frame with empty wrapped dict renders without crashing
    it('AC-FDL-B3: wrap frame with empty wrapped dict renders without error', () => {
      const haltState: ExecutionState = {
        status: 'error',
        result: null,
        error: {
          message: '#TYPE_MISMATCH: failed',
          category: 'runtime',
          line: null,
          column: null,
          errorId: null,
          statusCode: 'TYPE_MISMATCH',
          statusMessage: 'failed',
          statusProvider: '',
          statusTrace: [
            { kind: 'wrap', site: '<script>:1:1', fn: '', wrapped: {} },
            {
              kind: 'guard-caught',
              site: '<script>:1:1',
              fn: 'guard',
              wrapped: {},
            },
          ],
        },
        duration: 2,
        logs: [],
      };
      // Must not throw — wrap frame with empty fn renders without crash
      expect(() => render(<Output state={haltState} />)).not.toThrow();
      const { container } = render(<Output state={haltState} />);
      const frames = container.querySelectorAll(
        '.output-error-status-trace-frame'
      );
      expect(frames.length).toBe(2);
    });

    // AC-FDL-B1: valid final value uses existing success renderer unchanged
    it('AC-FDL-B1: valid final value does not render halt panel', () => {
      const { container } = render(<Output state={successState} />);
      // Status fields must not appear when result is valid
      expect(container.querySelector('.output-error-status-code')).toBeNull();
      expect(container.querySelector('.output-error-status-trace')).toBeNull();
      // Success renderer must still be present
      expect(container.querySelector('.output-result')).toBeDefined();
    });

    // AC-FDL-B2: trace with only origin frame (0 non-origin frames)
    it('AC-FDL-B2: trace with 1 frame (origin only) renders single frame without error', () => {
      const haltState: ExecutionState = {
        status: 'error',
        result: null,
        error: {
          message: '#TIMEOUT: timed out',
          category: 'runtime',
          line: null,
          column: null,
          errorId: null,
          statusCode: 'TIMEOUT',
          statusMessage: 'timed out',
          statusProvider: 'host',
          statusTrace: [
            { kind: 'host', site: '<host>', fn: 'call', wrapped: {} },
          ],
        },
        duration: 50,
        logs: [],
      };
      expect(() => render(<Output state={haltState} />)).not.toThrow();
      const { container } = render(<Output state={haltState} />);
      const frames = container.querySelectorAll(
        '.output-error-status-trace-frame'
      );
      expect(frames.length).toBe(1);
    });

    it('halt panel does not render trace section when statusTrace is null', () => {
      const noTraceState: ExecutionState = {
        status: 'error',
        result: null,
        error: {
          message: 'Some error',
          category: 'runtime',
          line: null,
          column: null,
          errorId: null,
          statusCode: null,
          statusMessage: null,
          statusProvider: null,
          statusTrace: null,
        },
        duration: 5,
        logs: [],
      };
      const { container } = render(<Output state={noTraceState} />);
      expect(container.querySelector('.output-error-status-trace')).toBeNull();
    });
  });
});
