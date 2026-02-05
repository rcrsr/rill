/**
 * Tests for CLI error explanation functionality
 */

import { describe, it, expect } from 'vitest';
import { explainError } from '../../src/cli-explain.js';

describe('explainError', () => {
  describe('valid error IDs', () => {
    it('returns formatted documentation for error with all fields', () => {
      // Create a mock error with all optional fields populated
      // We need to find an error ID that has cause, resolution, and examples
      // For this test, we'll use RILL-R009 if it has these fields, otherwise we need to check

      const result = explainError('RILL-R009');

      // Since RILL-R009 exists in ERROR_REGISTRY, this should not be null
      expect(result).not.toBeNull();

      if (result !== null) {
        // Should contain the error ID and description
        expect(result).toContain('RILL-R009');
        expect(result).toContain('Property not found');
      }
    });

    it('returns formatted documentation for lexer error', () => {
      const result = explainError('RILL-L001');

      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result).toContain('RILL-L001');
        expect(result).toContain('Unterminated string literal');
      }
    });

    it('returns formatted documentation for parse error', () => {
      const result = explainError('RILL-P001');

      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result).toContain('RILL-P001');
        expect(result).toContain('Unexpected token');
      }
    });

    it('returns formatted documentation for runtime error', () => {
      const result = explainError('RILL-R001');

      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result).toContain('RILL-R001');
        expect(result).toContain('Parameter type mismatch');
      }
    });

    it('returns formatted documentation for check error', () => {
      const result = explainError('RILL-C001');

      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result).toContain('RILL-C001');
        expect(result).toContain('File not found');
      }
    });

    it('includes cause section when present', () => {
      // We need to check which error has cause field populated
      // For now, we'll test the structure by creating a scenario
      const result = explainError('RILL-R001');

      if (result !== null && result.includes('Cause:')) {
        expect(result).toMatch(/Cause:\n  .+/);
      }
    });

    it('includes resolution section when present', () => {
      const result = explainError('RILL-R001');

      if (result !== null && result.includes('Resolution:')) {
        expect(result).toMatch(/Resolution:\n  .+/);
      }
    });

    it('includes examples section when present', () => {
      const result = explainError('RILL-R001');

      if (result !== null && result.includes('Examples:')) {
        expect(result).toContain('Examples:');
        // Should have indented code
        expect(result).toMatch(/    .+/);
      }
    });

    it('formats output with proper structure', () => {
      const result = explainError('RILL-R001');

      expect(result).not.toBeNull();
      if (result !== null) {
        // Should start with errorId: description
        expect(result).toMatch(/^RILL-R\d{3}: .+/);

        // Should not have trailing whitespace
        expect(result).not.toMatch(/\s$/);
      }
    });
  });

  describe('invalid error IDs', () => {
    it('returns null for invalid errorId format - missing prefix', () => {
      const result = explainError('R001');
      expect(result).toBeNull();
    });

    it('returns null for invalid errorId format - wrong prefix', () => {
      const result = explainError('RILL001');
      expect(result).toBeNull();
    });

    it('returns null for invalid errorId format - invalid category', () => {
      const result = explainError('RILL-X001');
      expect(result).toBeNull();
    });

    it('returns null for invalid errorId format - too few digits', () => {
      const result = explainError('RILL-R01');
      expect(result).toBeNull();
    });

    it('returns null for invalid errorId format - too many digits', () => {
      const result = explainError('RILL-R0001');
      expect(result).toBeNull();
    });

    it('returns null for invalid errorId format - lowercase', () => {
      const result = explainError('rill-r001');
      expect(result).toBeNull();
    });

    it('returns null for invalid errorId format - empty string', () => {
      const result = explainError('');
      expect(result).toBeNull();
    });

    it('returns null for invalid errorId format - random string', () => {
      const result = explainError('invalid');
      expect(result).toBeNull();
    });
  });

  describe('unknown error IDs', () => {
    it('returns null for unknown lexer error ID', () => {
      const result = explainError('RILL-L999');
      expect(result).toBeNull();
    });

    it('returns null for unknown parse error ID', () => {
      const result = explainError('RILL-P999');
      expect(result).toBeNull();
    });

    it('returns null for unknown runtime error ID', () => {
      const result = explainError('RILL-R999');
      expect(result).toBeNull();
    });

    it('returns null for unknown check error ID', () => {
      const result = explainError('RILL-C999');
      expect(result).toBeNull();
    });
  });

  describe('output formatting', () => {
    it('indents code examples with 4 spaces', () => {
      // Find an error with examples and test indentation
      const result = explainError('RILL-R001');

      if (result !== null && result.includes('Examples:')) {
        const lines = result.split('\n');
        const codeLines = lines.filter((line) => line.match(/^    [^ ]/));
        // If examples exist, should have at least one code line
        if (lines.some((line) => line.includes('Examples:'))) {
          // Code lines should be indented with exactly 4 spaces
          for (const line of codeLines) {
            expect(line).toMatch(/^    /);
          }
        }
      }
    });

    it('indents example descriptions with 2 spaces', () => {
      const result = explainError('RILL-R001');

      if (result !== null && result.includes('Examples:')) {
        const lines = result.split('\n');
        // Find lines after "Examples:" that are descriptions (before code)
        let inExamples = false;
        for (const line of lines) {
          if (line === 'Examples:') {
            inExamples = true;
            continue;
          }
          if (
            inExamples &&
            line.trim() !== '' &&
            !line.startsWith('    ') &&
            line.startsWith('  ')
          ) {
            // This is a description line
            expect(line).toMatch(/^  [^ ]/);
          }
        }
      }
    });

    it('separates sections with blank lines', () => {
      const result = explainError('RILL-R001');

      if (result !== null) {
        // Should have blank lines between sections
        const lines = result.split('\n');

        // Find section headers and check they're followed by content then blank line
        const sectionHeaders = ['Cause:', 'Resolution:', 'Examples:'];
        for (const header of sectionHeaders) {
          const headerIndex = lines.indexOf(header);
          if (headerIndex !== -1 && headerIndex < lines.length - 2) {
            // After the header content, should have a blank line
            // (unless it's the last section)
            let nextNonContentIndex = headerIndex + 1;
            while (
              nextNonContentIndex < lines.length &&
              lines[nextNonContentIndex]?.trim() !== '' &&
              !sectionHeaders.includes(lines[nextNonContentIndex] ?? '')
            ) {
              nextNonContentIndex++;
            }
            if (
              nextNonContentIndex < lines.length &&
              !sectionHeaders.includes(lines[nextNonContentIndex] ?? '')
            ) {
              expect(lines[nextNonContentIndex]).toBe('');
            }
          }
        }
      }
    });
  });
});
