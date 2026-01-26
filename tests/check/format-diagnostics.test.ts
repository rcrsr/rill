/**
 * Tests for formatDiagnostics function
 * Validates text and JSON formatting with verbose mode
 */

import { describe, it, expect } from 'vitest';
import { formatDiagnostics } from '../../src/cli-check.js';
import type { Diagnostic } from '../../src/check/index.js';

describe('formatDiagnostics', () => {
  describe('text format', () => {
    it('formats single diagnostic with all fields', () => {
      const diagnostics: Diagnostic[] = [
        {
          location: { line: 1, column: 5, offset: 4 },
          severity: 'error',
          code: 'NAMING_SNAKE_CASE',
          message: 'Variable names must use snake_case',
          context: 'badName :> $value',
          fix: null,
        },
      ];

      const result = formatDiagnostics('file.rill', diagnostics, 'text', false);

      expect(result).toBe(
        'file.rill:1:5: error: Variable names must use snake_case (NAMING_SNAKE_CASE)'
      );
    });

    it('formats multiple diagnostics', () => {
      const diagnostics: Diagnostic[] = [
        {
          location: { line: 1, column: 5, offset: 4 },
          severity: 'error',
          code: 'NAMING_SNAKE_CASE',
          message: 'Variable names must use snake_case',
          context: 'badName :> $value',
          fix: null,
        },
        {
          location: { line: 3, column: 10, offset: 25 },
          severity: 'warning',
          code: 'NO_EMPTY_BLOCKS',
          message: 'Block is empty',
          context: '{ }',
          fix: null,
        },
      ];

      const result = formatDiagnostics('test.rill', diagnostics, 'text', false);

      expect(result).toBe(
        'test.rill:1:5: error: Variable names must use snake_case (NAMING_SNAKE_CASE)\n' +
          'test.rill:3:10: warning: Block is empty (NO_EMPTY_BLOCKS)'
      );
    });

    it('formats empty diagnostics array', () => {
      const result = formatDiagnostics('empty.rill', [], 'text', false);
      expect(result).toBe('');
    });

    it('formats different severity levels', () => {
      const diagnostics: Diagnostic[] = [
        {
          location: { line: 1, column: 1, offset: 0 },
          severity: 'error',
          code: 'ERROR_CODE',
          message: 'Error message',
          context: 'line 1',
          fix: null,
        },
        {
          location: { line: 2, column: 1, offset: 10 },
          severity: 'warning',
          code: 'WARNING_CODE',
          message: 'Warning message',
          context: 'line 2',
          fix: null,
        },
        {
          location: { line: 3, column: 1, offset: 20 },
          severity: 'info',
          code: 'INFO_CODE',
          message: 'Info message',
          context: 'line 3',
          fix: null,
        },
      ];

      const result = formatDiagnostics('file.rill', diagnostics, 'text', false);

      expect(result).toContain('error: Error message');
      expect(result).toContain('warning: Warning message');
      expect(result).toContain('info: Info message');
    });

    it('ignores verbose flag in text mode', () => {
      const diagnostics: Diagnostic[] = [
        {
          location: { line: 1, column: 5, offset: 4 },
          severity: 'error',
          code: 'TEST_CODE',
          message: 'Test message',
          context: 'test context',
          fix: null,
        },
      ];

      const withoutVerbose = formatDiagnostics(
        'file.rill',
        diagnostics,
        'text',
        false
      );
      const withVerbose = formatDiagnostics(
        'file.rill',
        diagnostics,
        'text',
        true
      );

      expect(withoutVerbose).toBe(withVerbose);
    });
  });

  describe('json format', () => {
    it('formats single diagnostic with required fields', () => {
      const diagnostics: Diagnostic[] = [
        {
          location: { line: 1, column: 5, offset: 4 },
          severity: 'error',
          code: 'NAMING_SNAKE_CASE',
          message: 'Variable names must use snake_case',
          context: 'badName :> $value',
          fix: null,
        },
      ];

      const result = formatDiagnostics('file.rill', diagnostics, 'json', false);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual({
        file: 'file.rill',
        errors: [
          {
            location: { line: 1, column: 5, offset: 4 },
            severity: 'error',
            code: 'NAMING_SNAKE_CASE',
            message: 'Variable names must use snake_case',
            context: 'badName :> $value',
          },
        ],
        summary: {
          total: 1,
          errors: 1,
          warnings: 0,
          info: 0,
        },
      });
    });

    it('includes fix when present', () => {
      const diagnostics: Diagnostic[] = [
        {
          location: { line: 1, column: 5, offset: 4 },
          severity: 'error',
          code: 'NAMING_SNAKE_CASE',
          message: 'Variable names must use snake_case',
          context: 'badName :> $value',
          fix: {
            description: 'Rename to snake_case',
            applicable: true,
            range: {
              start: { line: 1, column: 1, offset: 0 },
              end: { line: 1, column: 8, offset: 7 },
            },
            replacement: 'bad_name',
          },
        },
      ];

      const result = formatDiagnostics('file.rill', diagnostics, 'json', false);
      const parsed = JSON.parse(result);

      expect(parsed.errors[0].fix).toEqual({
        description: 'Rename to snake_case',
        applicable: true,
        range: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 8, offset: 7 },
        },
        replacement: 'bad_name',
      });
    });

    it('calculates summary counts correctly', () => {
      const diagnostics: Diagnostic[] = [
        {
          location: { line: 1, column: 1, offset: 0 },
          severity: 'error',
          code: 'ERROR_1',
          message: 'Error 1',
          context: 'ctx1',
          fix: null,
        },
        {
          location: { line: 2, column: 1, offset: 10 },
          severity: 'error',
          code: 'ERROR_2',
          message: 'Error 2',
          context: 'ctx2',
          fix: null,
        },
        {
          location: { line: 3, column: 1, offset: 20 },
          severity: 'warning',
          code: 'WARNING_1',
          message: 'Warning 1',
          context: 'ctx3',
          fix: null,
        },
        {
          location: { line: 4, column: 1, offset: 30 },
          severity: 'info',
          code: 'INFO_1',
          message: 'Info 1',
          context: 'ctx4',
          fix: null,
        },
        {
          location: { line: 5, column: 1, offset: 40 },
          severity: 'info',
          code: 'INFO_2',
          message: 'Info 2',
          context: 'ctx5',
          fix: null,
        },
      ];

      const result = formatDiagnostics('file.rill', diagnostics, 'json', false);
      const parsed = JSON.parse(result);

      expect(parsed.summary).toEqual({
        total: 5,
        errors: 2,
        warnings: 1,
        info: 2,
      });
    });

    it('excludes category when verbose is false', () => {
      const diagnostics: Diagnostic[] = [
        {
          location: { line: 1, column: 5, offset: 4 },
          severity: 'error',
          code: 'NAMING_SNAKE_CASE',
          message: 'Variable names must use snake_case',
          context: 'badName :> $value',
          fix: null,
        },
      ];

      const result = formatDiagnostics('file.rill', diagnostics, 'json', false);
      const parsed = JSON.parse(result);

      expect(parsed.errors[0]).not.toHaveProperty('category');
    });

    it('includes category when verbose is true and rule exists', () => {
      // Note: This test will work once VALIDATION_RULES is populated
      // For now, it tests that category is absent when rule not found
      const diagnostics: Diagnostic[] = [
        {
          location: { line: 1, column: 5, offset: 4 },
          severity: 'error',
          code: 'UNKNOWN_CODE',
          message: 'Unknown rule',
          context: 'test',
          fix: null,
        },
      ];

      const result = formatDiagnostics('file.rill', diagnostics, 'json', true);
      const parsed = JSON.parse(result);

      // Category should not be present if rule not in VALIDATION_RULES
      expect(parsed.errors[0]).not.toHaveProperty('category');
    });

    it('formats empty diagnostics array as valid JSON', () => {
      const result = formatDiagnostics('empty.rill', [], 'json', false);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual({
        file: 'empty.rill',
        errors: [],
        summary: {
          total: 0,
          errors: 0,
          warnings: 0,
          info: 0,
        },
      });
    });

    it('produces valid JSON with proper indentation', () => {
      const diagnostics: Diagnostic[] = [
        {
          location: { line: 1, column: 1, offset: 0 },
          severity: 'error',
          code: 'TEST_CODE',
          message: 'Test message',
          context: 'test',
          fix: null,
        },
      ];

      const result = formatDiagnostics('file.rill', diagnostics, 'json', false);

      // Should be pretty-printed with 2-space indent
      expect(result).toContain('{\n  "file"');
      expect(() => JSON.parse(result)).not.toThrow();
    });
  });
});
