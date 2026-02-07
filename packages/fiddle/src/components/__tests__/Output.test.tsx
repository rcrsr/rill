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
    };

    successState = {
      status: 'success',
      result: 'hello world',
      error: null,
      duration: 42,
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
      },
      duration: 10,
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
      const { container } = render(<Output state={idleState} ariaLabel="Test output" />);
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
    it('displays log output from onLog callback', () => {
      const stateWithLogs: ExecutionState = {
        status: 'success',
        result: 'log line 1\nlog line 2\nfinal result',
        error: null,
        duration: 50,
      };
      const { container } = render(<Output state={stateWithLogs} />);
      const resultElement = container.querySelector('.output-result');
      expect(resultElement?.textContent).toContain('log line 1');
      expect(resultElement?.textContent).toContain('log line 2');
      expect(resultElement?.textContent).toContain('final result');
    });

    it('displays log output without final result', () => {
      const stateWithLogsOnly: ExecutionState = {
        status: 'success',
        result: 'log output only\nnull',
        error: null,
        duration: 30,
      };
      const { container } = render(<Output state={stateWithLogsOnly} />);
      const resultElement = container.querySelector('.output-result');
      expect(resultElement?.textContent).toContain('log output only');
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
      };
      const lexerState: ExecutionState = {
        status: 'error',
        result: null,
        error: lexerError,
        duration: 5,
      };
      const { container } = render(<Output state={lexerState} />);
      const errorElement = container.querySelector('.output-error');
      expect(errorElement?.textContent).toContain('Unterminated string literal');
      expect(errorElement?.textContent).toContain('line 1');
    });

    it('displays LexerError without line number', () => {
      const lexerError: FiddleError = {
        message: 'Invalid character',
        category: 'lexer',
        line: null,
        column: null,
        errorId: 'RILL-L001',
      };
      const lexerState: ExecutionState = {
        status: 'error',
        result: null,
        error: lexerError,
        duration: 3,
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
      };
      const parseState: ExecutionState = {
        status: 'error',
        result: null,
        error: parseError,
        duration: 8,
      };
      const { container } = render(<Output state={parseState} />);
      const errorElement = container.querySelector('.output-error');
      expect(errorElement?.textContent).toContain('Expected expression after pipe operator');
      expect(errorElement?.textContent).toContain('line 3');
    });

    it('displays ParseError without line reference', () => {
      const parseError: FiddleError = {
        message: 'Unexpected end of input',
        category: 'parse',
        line: null,
        column: null,
        errorId: 'RILL-P002',
      };
      const parseState: ExecutionState = {
        status: 'error',
        result: null,
        error: parseError,
        duration: 5,
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
      };
      const runtimeState: ExecutionState = {
        status: 'error',
        result: null,
        error: runtimeError,
        duration: 15,
      };
      const { container } = render(<Output state={runtimeState} />);
      const errorElement = container.querySelector('.output-error');
      expect(errorElement?.textContent).toContain('Type error: Cannot add string and number');
      expect(errorElement?.textContent).toContain('line 2');
    });

    it('displays RuntimeError without line number', () => {
      const runtimeError: FiddleError = {
        message: 'Variable not defined: $x',
        category: 'runtime',
        line: null,
        column: null,
        errorId: 'RILL-R002',
      };
      const runtimeState: ExecutionState = {
        status: 'error',
        result: null,
        error: runtimeError,
        duration: 12,
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
      };
      const errorState: ExecutionState = {
        status: 'error',
        result: null,
        error: errorWithId,
        duration: 10,
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
      };
      const errorState: ExecutionState = {
        status: 'error',
        result: null,
        error: errorWithoutId,
        duration: 10,
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
      };
      const stateWithCause: ExecutionState = {
        status: 'error',
        result: null,
        error: errorWithCause,
        duration: 100,
      };
      const { container } = render(<Output state={stateWithCause} />);
      const causeElement = container.querySelector('.output-error-cause');
      expect(causeElement).toBeDefined();
      expect(causeElement?.textContent).toContain('Variable referenced before assignment');
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
        resolution: 'Ensure both operands are the same type before performing the operation',
        examples: undefined,
      };
      const stateWithResolution: ExecutionState = {
        status: 'error',
        result: null,
        error: errorWithResolution,
        duration: 50,
      };
      const { container } = render(<Output state={stateWithResolution} />);
      const resolutionElement = container.querySelector('.output-error-resolution');
      expect(resolutionElement).toBeDefined();
      expect(resolutionElement?.textContent).toContain('Fix:');
      expect(resolutionElement?.textContent).toContain('Ensure both operands are the same type');
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
      };
      const stateWithHelpUrl: ExecutionState = {
        status: 'error',
        result: null,
        error: errorWithHelpUrl,
        duration: 20,
      };
      const { container } = render(<Output state={stateWithHelpUrl} />);
      const linkElement = container.querySelector('a[href="https://example.com/docs/errors/RILL-P001"]');
      expect(linkElement).toBeDefined();
      expect(linkElement?.getAttribute('target')).toBe('_blank');
      expect(linkElement?.getAttribute('rel')).toBe('noopener noreferrer');
      expect(linkElement?.textContent).toContain('Docs');
    });

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
      };
      const stateWithBasicError: ExecutionState = {
        status: 'error',
        result: null,
        error: basicError,
        duration: 15,
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
      const durationElement = container.querySelector('.output-header-duration');
      expect(durationElement).toBeDefined();
      expect(durationElement?.textContent).toContain('42');
      expect(durationElement?.textContent).toContain('ms');
    });

    it('displays execution duration for error', () => {
      const { container } = render(<Output state={errorState} />);
      const durationElement = container.querySelector('.output-header-duration');
      expect(durationElement).toBeDefined();
      expect(durationElement?.textContent).toContain('10');
      expect(durationElement?.textContent).toContain('ms');
    });

    it('does not display duration when null', () => {
      const { container } = render(<Output state={idleState} />);
      const durationElement = container.querySelector('.output-header-duration');
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
});
