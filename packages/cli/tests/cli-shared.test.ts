/**
 * CLI Shared Utilities Tests
 * Tests for formatError, formatOutput, and determineExitCode functions
 */

import { describe, expect, it } from 'vitest';
import {
  formatError,
  formatOutput,
  determineExitCode,
  detectHelpVersionFlag,
} from '../src/cli-shared.js';
import { ParseError, RuntimeError, LexerError } from '@rcrsr/rill';

describe('cli-shared', () => {
  describe('formatError', () => {
    describe('Enriched error formatting [IC-12]', () => {
      it('calls enrichError when source is available', () => {
        const source = '$foo -> .len';
        const err = new RuntimeError(
          'RILL-R005',
          'Variable foo is not defined',
          { line: 1, column: 0, offset: 0 },
          { name: 'foo' }
        );
        const formatted = formatError(err, source);
        // Enriched format includes error ID in brackets
        expect(formatted).toContain('[RILL-R005]');
        expect(formatted).toContain('Variable foo is not defined');
      });

      it('includes source snippet when source is provided', () => {
        const source = '"hello"\n$undefined';
        const err = new RuntimeError(
          'RILL-R005',
          'Variable undefined is not defined',
          { line: 2, column: 0, offset: 8 }
        );
        const formatted = formatError(err, source);
        // Should include the error line in snippet
        expect(formatted).toContain('$undefined');
      });

      it('preserves backward compatibility when source is not provided', () => {
        const err = new RuntimeError('RILL-R001', 'Type mismatch', {
          line: 3,
          column: 5,
          offset: 20,
        });
        const formatted = formatError(err);
        expect(formatted).toBe('Runtime error at line 3: Type mismatch');
      });

      it('falls back to simple formatting for non-RillError types', () => {
        const source = 'some code';
        const err = new Error('Generic error');
        const formatted = formatError(err, source);
        expect(formatted).toBe('Generic error');
      });

      it('handles ParseError with source', () => {
        const source = '1 + +';
        const err = new ParseError('RILL-P002', 'Unexpected token', {
          line: 1,
          column: 4,
          offset: 4,
        });
        const formatted = formatError(err, source);
        expect(formatted).toContain('[RILL-P002]');
        expect(formatted).toContain('Unexpected token');
      });

      it('handles LexerError with source', () => {
        const source = '"unterminated';
        const err = new LexerError('RILL-L002', 'Unterminated string', {
          line: 1,
          column: 0,
          offset: 0,
        });
        const formatted = formatError(err, source);
        expect(formatted).toContain('[RILL-L002]');
        expect(formatted).toContain('Unterminated string');
      });

      it('accepts format options for compact output', () => {
        const source = '$foo';
        const err = new RuntimeError(
          'RILL-R005',
          'Variable foo is not defined',
          { line: 1, column: 0, offset: 0 }
        );
        const formatted = formatError(err, source, { format: 'compact' });
        // Compact format is single line
        expect(formatted).not.toContain('\n');
        expect(formatted).toContain('[RILL-R005]');
      });

      it('accepts scope info for suggestions', () => {
        const source = '$fo';
        const err = new RuntimeError(
          'RILL-R005',
          'Variable fo is not defined',
          { line: 1, column: 0, offset: 0 },
          { name: 'fo' }
        );
        const scope = {
          variableNames: ['foo', 'bar'],
          functionNames: ['baz'],
        };
        const formatted = formatError(err, source, undefined, scope);
        // Should include suggestion
        expect(formatted).toContain('help:');
      });

      it('falls back to simple formatting if enrichment throws', () => {
        // Pass invalid source type to trigger enrichment error
        const err = new RuntimeError('RILL-R001', 'Type error', {
          line: 1,
          column: 0,
          offset: 0,
        });
        // @ts-expect-error - Testing invalid input handling
        const formatted = formatError(err, 123); // Invalid source type
        // Should fall back to simple format
        expect(formatted).toBe('Runtime error at line 1: Type error');
      });
    });

    describe('RillError types', () => {
      it('formats ParseError as "Parse error at line N: message"', () => {
        const err = new ParseError('RILL-P001', 'Unexpected token', {
          line: 5,
          column: 10,
          offset: 50,
        });
        const formatted = formatError(err);
        expect(formatted).toBe('Parse error at line 5: Unexpected token');
      });

      it('formats RuntimeError as "Runtime error at line N: message"', () => {
        const err = new RuntimeError('RILL-R001', 'Type mismatch', {
          line: 3,
          column: 5,
          offset: 20,
        });
        const formatted = formatError(err);
        expect(formatted).toBe('Runtime error at line 3: Type mismatch');
      });

      it('formats LexerError as "Lexer error at line N: message"', () => {
        const err = new LexerError('RILL-L001', 'Unterminated string', {
          line: 2,
          column: 15,
          offset: 30,
        });
        const formatted = formatError(err);
        expect(formatted).toBe('Lexer error at line 2: Unterminated string');
      });

      it('removes location suffix from error message', () => {
        const err = new RuntimeError('RILL-R001', 'Type mismatch', {
          line: 3,
          column: 5,
          offset: 20,
        });
        // Simulate error message with location suffix
        Object.defineProperty(err, 'message', {
          value: 'Type mismatch at 3:5',
          writable: false,
        });
        const formatted = formatError(err);
        expect(formatted).toBe('Runtime error at line 3: Type mismatch');
      });

      it('handles RuntimeError without location', () => {
        const err = new RuntimeError('RILL-R001', 'Type mismatch');
        const formatted = formatError(err);
        expect(formatted).toBe('Runtime error: Type mismatch');
      });

      it('handles ParseError with minimal location', () => {
        const err = new ParseError('RILL-P001', 'Unexpected token', {
          line: 1,
          column: 1,
          offset: 0,
        });
        const formatted = formatError(err);
        expect(formatted).toContain('Parse error');
      });
    });

    describe('ENOENT errors [AC-4]', () => {
      it('formats as "File not found: {path}"', () => {
        const err = Object.assign(new Error(), {
          code: 'ENOENT',
          path: '/path/to/file.rill',
        });
        const formatted = formatError(err);
        expect(formatted).toBe('File not found: /path/to/file.rill');
      });

      it('formats ENOENT with relative path', () => {
        const err = Object.assign(new Error(), {
          code: 'ENOENT',
          path: './script.rill',
        });
        const formatted = formatError(err);
        expect(formatted).toBe('File not found: ./script.rill');
      });
    });

    describe('Module errors', () => {
      it('formats module not found errors', () => {
        const err = new Error("Cannot find module './missing.js'");
        const formatted = formatError(err);
        expect(formatted).toBe(
          "Module error: Cannot find module './missing.js'"
        );
      });

      it('formats ES module import errors', () => {
        const err = new Error('Cannot find module from /path/to/file');
        const formatted = formatError(err);
        expect(formatted).toBe(
          'Module error: Cannot find module from /path/to/file'
        );
      });
    });

    describe('Generic errors', () => {
      it('formats generic error with message only', () => {
        const err = new Error('Something went wrong');
        const formatted = formatError(err);
        expect(formatted).toBe('Something went wrong');
      });

      it('returns message for unknown error types', () => {
        const err = new Error('Custom error message');
        const formatted = formatError(err);
        expect(formatted).toBe('Custom error message');
      });
    });

    describe('No stack trace in output', () => {
      it('never includes JavaScript stack trace', () => {
        const err = new Error('Test error');
        err.stack =
          'Error: Test error\n    at foo (bar.js:10:5)\n    at baz (qux.js:20:10)';
        const formatted = formatError(err);
        expect(formatted).not.toContain('at foo');
        expect(formatted).not.toContain('bar.js');
        expect(formatted).not.toContain('at baz');
        expect(formatted).not.toContain('qux.js');
      });

      it('does not include stack trace for RillError', () => {
        const err = new RuntimeError('RILL-R001', 'Type error', {
          line: 5,
          column: 10,
          offset: 50,
        });
        err.stack =
          'RuntimeError: Type error\n    at evaluate (runtime.js:100:15)';
        const formatted = formatError(err);
        expect(formatted).not.toContain('at evaluate');
        expect(formatted).not.toContain('runtime.js');
      });

      it('removes error code from output', () => {
        const err = new ParseError('RILL-P001', 'Syntax error', {
          line: 1,
          column: 1,
          offset: 0,
        });
        const formatted = formatError(err);
        expect(formatted).not.toContain('RILL-P001');
      });
    });
  });

  describe('formatOutput', () => {
    it('formats string values', () => {
      expect(formatOutput('hello')).toBe('hello');
      expect(formatOutput('')).toBe('');
    });

    it('formats number values', () => {
      expect(formatOutput(42)).toBe('42');
      expect(formatOutput(0)).toBe('0');
      expect(formatOutput(-3.14)).toBe('-3.14');
    });

    it('formats boolean values', () => {
      expect(formatOutput(true)).toBe('true');
      expect(formatOutput(false)).toBe('false');
    });

    it('formats null value', () => {
      expect(formatOutput(null)).toBe('null');
    });

    it('formats arrays as JSON', () => {
      expect(formatOutput([1, 2, 3])).toBe('[\n  1,\n  2,\n  3\n]');
      expect(formatOutput([])).toBe('[]');
    });

    it('formats dicts as JSON', () => {
      const output = formatOutput({ a: 1, b: 2 });
      expect(output).toContain('"a": 1');
      expect(output).toContain('"b": 2');
    });
  });

  describe('determineExitCode', () => {
    it('returns 0 for true', () => {
      expect(determineExitCode(true)).toEqual({ code: 0 });
    });

    it('returns 1 for false', () => {
      expect(determineExitCode(false)).toEqual({ code: 1 });
    });

    it('returns 0 for non-empty string', () => {
      expect(determineExitCode('hello')).toEqual({ code: 0 });
      expect(determineExitCode('0')).toEqual({ code: 0 });
    });

    it('returns 1 for empty string', () => {
      expect(determineExitCode('')).toEqual({ code: 1 });
    });

    it('returns 0 with message for [0, "message"] tuple', () => {
      expect(determineExitCode([0, 'success'])).toEqual({
        code: 0,
        message: 'success',
      });
    });

    it('returns 1 with message for [1, "message"] tuple', () => {
      expect(determineExitCode([1, 'failure'])).toEqual({
        code: 1,
        message: 'failure',
      });
    });

    it('returns 0 for non-conforming arrays', () => {
      expect(determineExitCode([2, 'invalid'])).toEqual({ code: 0 });
      expect(determineExitCode(['not', 'valid'])).toEqual({ code: 0 });
    });

    it('returns 0 for other values', () => {
      expect(determineExitCode(42)).toEqual({ code: 0 });
      expect(determineExitCode({ key: 'value' })).toEqual({ code: 0 });
    });
  });

  describe('detectHelpVersionFlag', () => {
    describe('Help flag detection [AC-4]', () => {
      it('detects --help flag [IR-3]', () => {
        expect(detectHelpVersionFlag(['--help'])).toEqual({ mode: 'help' });
      });

      it('detects -h flag [IR-3]', () => {
        expect(detectHelpVersionFlag(['-h'])).toEqual({ mode: 'help' });
      });

      it('detects --help in any position [IR-3]', () => {
        expect(detectHelpVersionFlag(['file.rill', '--help'])).toEqual({
          mode: 'help',
        });
        expect(detectHelpVersionFlag(['--help', 'file.rill'])).toEqual({
          mode: 'help',
        });
        expect(
          detectHelpVersionFlag(['--verbose', '--help', 'file.rill'])
        ).toEqual({
          mode: 'help',
        });
      });

      it('help takes precedence over version [IR-3]', () => {
        expect(detectHelpVersionFlag(['--help', '--version'])).toEqual({
          mode: 'help',
        });
        expect(detectHelpVersionFlag(['--version', '--help'])).toEqual({
          mode: 'help',
        });
        expect(detectHelpVersionFlag(['-h', '-v'])).toEqual({ mode: 'help' });
        expect(detectHelpVersionFlag(['-v', '-h'])).toEqual({ mode: 'help' });
      });
    });

    describe('Version flag detection [AC-4]', () => {
      it('detects --version flag [IR-3]', () => {
        expect(detectHelpVersionFlag(['--version'])).toEqual({
          mode: 'version',
        });
      });

      it('detects -v flag [IR-3]', () => {
        expect(detectHelpVersionFlag(['-v'])).toEqual({ mode: 'version' });
      });

      it('detects --version in any position [IR-3]', () => {
        expect(detectHelpVersionFlag(['file.rill', '--version'])).toEqual({
          mode: 'version',
        });
        expect(detectHelpVersionFlag(['--version', 'file.rill'])).toEqual({
          mode: 'version',
        });
        expect(
          detectHelpVersionFlag(['--verbose', '--version', 'file.rill'])
        ).toEqual({ mode: 'version' });
      });
    });

    describe('No flag cases [EC-4, EC-5]', () => {
      it('returns null for empty array [EC-4]', () => {
        expect(detectHelpVersionFlag([])).toBeNull();
      });

      it('returns null for no flags [IR-3]', () => {
        expect(detectHelpVersionFlag(['file.rill'])).toBeNull();
        expect(detectHelpVersionFlag(['file.rill', 'arg1', 'arg2'])).toBeNull();
      });

      it('returns null for unknown flags [EC-5]', () => {
        expect(detectHelpVersionFlag(['--unknown'])).toBeNull();
        expect(detectHelpVersionFlag(['--verbose'])).toBeNull();
        expect(detectHelpVersionFlag(['-x'])).toBeNull();
      });

      it('returns null for flag-like arguments', () => {
        expect(detectHelpVersionFlag(['--format', 'json'])).toBeNull();
        expect(detectHelpVersionFlag(['file.rill', '--fix'])).toBeNull();
      });
    });
  });
});
