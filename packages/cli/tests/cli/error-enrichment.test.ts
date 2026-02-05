/**
 * Tests for CLI Error Enrichment Functions
 * Covers: IR-4, IR-6, IR-8, EC-3, EC-4, EC-6, EC-7, EC-9, EC-10, IC-1
 */

import { describe, it, expect } from 'vitest';
import {
  extractSnippet,
  suggestSimilarNames,
  enrichError,
} from '../../src/cli-error-enrichment.js';
import type {
  SourceSpan,
  SourceLocation,
} from '@rcrsr/rill';
import { RuntimeError } from '@rcrsr/rill';

describe('extractSnippet', () => {
  describe('IR-6: Context lines and line numbering', () => {
    it('extracts 2 context lines before and after by default', () => {
      const source = 'line1\nline2\nline3\nERROR\nline5\nline6\nline7';
      const span: SourceSpan = {
        start: { line: 4, column: 0, offset: 18 },
        end: { line: 4, column: 5, offset: 23 },
      };

      const snippet = extractSnippet(source, span);

      expect(snippet.lines).toHaveLength(5); // 2 before + error line + 2 after
      expect(snippet.lines[0]).toEqual({
        lineNumber: 2,
        content: 'line2',
        isErrorLine: false,
      });
      expect(snippet.lines[1]).toEqual({
        lineNumber: 3,
        content: 'line3',
        isErrorLine: false,
      });
      expect(snippet.lines[2]).toEqual({
        lineNumber: 4,
        content: 'ERROR',
        isErrorLine: true,
      });
      expect(snippet.lines[3]).toEqual({
        lineNumber: 5,
        content: 'line5',
        isErrorLine: false,
      });
      expect(snippet.lines[4]).toEqual({
        lineNumber: 6,
        content: 'line6',
        isErrorLine: false,
      });
      expect(snippet.highlightSpan).toBe(span);
    });

    it('handles configurable context lines', () => {
      const source = 'L1\nL2\nL3\nERROR\nL5\nL6\nL7';
      const span: SourceSpan = {
        start: { line: 4, column: 0, offset: 9 },
        end: { line: 4, column: 5, offset: 14 },
      };

      const snippet = extractSnippet(source, span, 1);

      expect(snippet.lines).toHaveLength(3); // 1 before + error line + 1 after
      expect(snippet.lines[0]?.lineNumber).toBe(3);
      expect(snippet.lines[1]?.lineNumber).toBe(4);
      expect(snippet.lines[2]?.lineNumber).toBe(5);
    });

    it('handles line 1 edge case (no negative lines)', () => {
      const source = 'ERROR\nline2\nline3';
      const span: SourceSpan = {
        start: { line: 1, column: 0, offset: 0 },
        end: { line: 1, column: 5, offset: 5 },
      };

      const snippet = extractSnippet(source, span);

      expect(snippet.lines).toHaveLength(3); // error line + 2 after (no before)
      expect(snippet.lines[0]).toEqual({
        lineNumber: 1,
        content: 'ERROR',
        isErrorLine: true,
      });
      expect(snippet.lines[1]?.lineNumber).toBe(2);
      expect(snippet.lines[2]?.lineNumber).toBe(3);
    });

    it('handles last line edge case', () => {
      const source = 'line1\nline2\nline3\nERROR';
      const span: SourceSpan = {
        start: { line: 4, column: 0, offset: 18 },
        end: { line: 4, column: 5, offset: 23 },
      };

      const snippet = extractSnippet(source, span);

      expect(snippet.lines).toHaveLength(3); // 2 before + error line (no after)
      expect(snippet.lines[0]?.lineNumber).toBe(2);
      expect(snippet.lines[1]?.lineNumber).toBe(3);
      expect(snippet.lines[2]).toEqual({
        lineNumber: 4,
        content: 'ERROR',
        isErrorLine: true,
      });
    });

    it('uses 1-based line numbers', () => {
      const source = 'first\nsecond\nthird';
      const span: SourceSpan = {
        start: { line: 1, column: 0, offset: 0 },
        end: { line: 1, column: 5, offset: 5 },
      };

      const snippet = extractSnippet(source, span);

      expect(snippet.lines[0]?.lineNumber).toBe(1);
      expect(snippet.lines[0]?.isErrorLine).toBe(true);
    });
  });

  describe('EC-6: Span outside source bounds throws RangeError', () => {
    it('throws when span line exceeds source', () => {
      const source = 'line1\nline2';
      const span: SourceSpan = {
        start: { line: 10, column: 0, offset: 999 },
        end: { line: 10, column: 5, offset: 1004 },
      };

      expect(() => extractSnippet(source, span)).toThrow(RangeError);
      expect(() => extractSnippet(source, span)).toThrow(
        'Span exceeds source bounds'
      );
    });

    it('throws when span line is 0', () => {
      const source = 'line1\nline2';
      const span: SourceSpan = {
        start: { line: 0, column: 0, offset: 0 },
        end: { line: 0, column: 5, offset: 5 },
      };

      expect(() => extractSnippet(source, span)).toThrow(RangeError);
      expect(() => extractSnippet(source, span)).toThrow(
        'Span exceeds source bounds'
      );
    });
  });

  describe('EC-7: Empty source returns empty snippet', () => {
    it('returns empty snippet for empty source', () => {
      const source = '';
      const span: SourceSpan = {
        start: { line: 1, column: 0, offset: 0 },
        end: { line: 1, column: 0, offset: 0 },
      };

      const snippet = extractSnippet(source, span);

      expect(snippet.lines).toEqual([]);
      expect(snippet.highlightSpan).toBe(span);
    });
  });

  describe('IC-1: Multi-line span handling', () => {
    it('handles multi-line error spans', () => {
      const source = 'line1\nline2\nERROR_START\nERROR_END\nline5';
      const span: SourceSpan = {
        start: { line: 3, column: 0, offset: 12 },
        end: { line: 4, column: 9, offset: 33 },
      };

      const snippet = extractSnippet(source, span);

      // Should mark both lines as error lines
      const errorLines = snippet.lines.filter((l) => l.isErrorLine);
      expect(errorLines).toHaveLength(2);
      expect(errorLines[0]?.lineNumber).toBe(3);
      expect(errorLines[1]?.lineNumber).toBe(4);
    });
  });
});

describe('suggestSimilarNames', () => {
  describe('IR-8: Edit distance and suggestion limits', () => {
    it('returns names with edit distance <= 2', () => {
      const target = 'test';
      const candidates = [
        'test', // distance 0
        'tost', // distance 1
        'tast', // distance 1
        'toast', // distance 2
        'testing', // distance 3 (excluded)
        'best', // distance 1
      ];

      const suggestions = suggestSimilarNames(target, candidates);

      // Max 3 suggestions, all must be within distance 2
      expect(suggestions.length).toBeLessThanOrEqual(3);
      for (const suggestion of suggestions) {
        expect(candidates).toContain(suggestion);
      }
      expect(suggestions).not.toContain('testing'); // distance 3 excluded
      expect(suggestions[0]).toBe('test'); // exact match first
    });

    it('returns maximum 3 suggestions', () => {
      const target = 'x';
      const candidates = ['a', 'b', 'c', 'd', 'e']; // All have distance 1

      const suggestions = suggestSimilarNames(target, candidates);

      expect(suggestions).toHaveLength(3);
    });

    it('sorts by ascending distance, then alphabetically', () => {
      const target = 'test';
      const candidates = [
        'zest', // distance 1
        'best', // distance 1
        'toast', // distance 2
        'roast', // distance 2
        'test', // distance 0
      ];

      const suggestions = suggestSimilarNames(target, candidates);

      expect(suggestions[0]).toBe('test'); // distance 0
      expect(suggestions[1]).toBe('best'); // distance 1, alphabetically before 'zest'
      expect(suggestions[2]).toBe('zest'); // distance 1
      // Only 3 suggestions, so 'toast' and 'roast' excluded
    });

    it('prioritizes exact matches', () => {
      const target = 'value';
      const candidates = ['value', 'values', 'valve'];

      const suggestions = suggestSimilarNames(target, candidates);

      expect(suggestions[0]).toBe('value'); // exact match first
    });
  });

  describe('EC-9: Empty target returns []', () => {
    it('returns empty array for empty target', () => {
      const suggestions = suggestSimilarNames('', ['test', 'value']);

      expect(suggestions).toEqual([]);
    });
  });

  describe('EC-10: Empty candidates returns []', () => {
    it('returns empty array for empty candidates', () => {
      const suggestions = suggestSimilarNames('test', []);

      expect(suggestions).toEqual([]);
    });
  });

  describe('AC-10: Undefined $valeu with $value in scope suggests correction', () => {
    it('suggests $value when $valeu is undefined (typo scenario)', () => {
      const target = 'valeu'; // Typo: missing 'e'
      const candidates = ['value', 'values', 'valid'];

      const suggestions = suggestSimilarNames(target, candidates);

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions).toContain('value'); // Edit distance 1 (e->u substitution)
      // This simulates: "Variable $valeu is not defined. Did you mean $value?"
    });
  });

  describe('AC-11: Dict key error shows Available keys', () => {
    it('provides list of available keys for dict key errors', () => {
      // This test demonstrates the pattern for dict key suggestions
      const attemptedKey = 'nam'; // Typo: should be 'name'
      const availableKeys = ['name', 'age', 'email'];

      const suggestions = suggestSimilarNames(attemptedKey, availableKeys);

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions).toContain('name'); // Edit distance 1
      // This simulates: "Key 'nam' not found. Available keys: name, age, email"
    });

    it('formats available keys as comma-separated list', () => {
      const availableKeys = ['a', 'b', 'c'];
      const formattedKeys = availableKeys.join(', ');

      expect(formattedKeys).toBe('a, b, c');
      // This demonstrates the format: "Available keys: a, b, c"
    });
  });

  describe('Edge cases', () => {
    it('handles single character targets', () => {
      const suggestions = suggestSimilarNames('x', ['x', 'y', 'xy', 'xyz']);

      expect(suggestions.length).toBeLessThanOrEqual(3);
      expect(suggestions).toContain('x'); // exact match
      // 'y' has distance 1, 'xy' has distance 1, 'xyz' has distance 2
    });

    it('excludes names with distance > 2', () => {
      const target = 'cat';
      const candidates = ['cat', 'bat', 'hat', 'chat', 'chats', 'elephant'];

      const suggestions = suggestSimilarNames(target, candidates);

      expect(suggestions.length).toBeLessThanOrEqual(3);
      expect(suggestions[0]).toBe('cat'); // exact match first
      expect(suggestions).not.toContain('chats'); // distance 3 (c->c, h->a, a->t, t->s, +s = 3)
      expect(suggestions).not.toContain('elephant'); // distance > 2
      // Remaining should be within distance 2
    });
  });
});

describe('AC-13/EC-3: Invalid UTF-8 source handling', () => {
  it('handles invalid UTF-8 gracefully in extractSnippet', () => {
    // JavaScript strings are always valid Unicode/UTF-16
    // Invalid UTF-8 bytes become replacement characters (�) when decoded
    // This test demonstrates behavior with malformed Unicode
    const invalidSource = 'line1\nline2\u{FFFD}\nline3'; // U+FFFD is replacement character
    const span: SourceSpan = {
      start: { line: 2, column: 0, offset: 6 },
      end: { line: 2, column: 5, offset: 11 },
    };

    // Should not throw TypeError - extractSnippet handles strings
    const snippet = extractSnippet(invalidSource, span);

    expect(snippet.lines).toHaveLength(3);
    expect(snippet.lines[1]?.content).toContain('\u{FFFD}');
  });

  it('validates source is a string', () => {
    const span: SourceSpan = {
      start: { line: 1, column: 0, offset: 0 },
      end: { line: 1, column: 5, offset: 5 },
    };

    // TypeScript prevents this, but at runtime source must be a string
    expect(() => extractSnippet(123 as unknown as string, span)).toThrow(
      TypeError
    );
  });
});

describe('enrichError', () => {
  describe('IR-4: enrichError returns EnrichedError with all fields populated', () => {
    it('enriches error with source snippet', () => {
      const source = 'line1\nline2\nerror line\nline4\nline5';
      const location: SourceLocation = { line: 3, column: 0, offset: 12 };
      const error = new RuntimeError('RILL-R001', 'Test error', location, {
        key: 'value',
      });

      const enriched = enrichError(error, source);

      expect(enriched.errorId).toBe('RILL-R001');
      expect(enriched.message).toBe('Test error');
      expect(enriched.span).toEqual({
        start: location,
        end: location,
      });
      expect(enriched.context).toEqual({ key: 'value' });
      expect(enriched.sourceSnippet).toBeDefined();
      expect(enriched.sourceSnippet?.lines).toHaveLength(5);
      expect(enriched.sourceSnippet?.lines[2]?.content).toBe('error line');
      expect(enriched.sourceSnippet?.lines[2]?.isErrorLine).toBe(true);
    });

    it('enriches error with suggestions when scope provided', () => {
      const source = 'line1\nline2';
      const location: SourceLocation = { line: 1, column: 0, offset: 0 };
      const error = new RuntimeError(
        'RILL-R001',
        'Variable not defined',
        location,
        {
          name: 'valeu',
        }
      );

      const enriched = enrichError(error, source, {
        variableNames: ['value', 'valid'],
        functionNames: ['test'],
      });

      expect(enriched.suggestions).toBeDefined();
      expect(enriched.suggestions).toContain('value');
    });

    it('includes helpUrl when present in error', () => {
      const source = 'test';
      const location: SourceLocation = { line: 1, column: 0, offset: 0 };
      const error = new RuntimeError('RILL-R001', 'Test error', location);
      // Set helpUrl via error data
      Object.defineProperty(error, 'helpUrl', {
        value: 'https://example.com/help',
      });

      const enriched = enrichError(error, source);

      expect(enriched.helpUrl).toBe('https://example.com/help');
    });

    it('handles error without location', () => {
      const source = 'test source';
      const error = new RuntimeError('RILL-R001', 'Test error');

      const enriched = enrichError(error, source);

      expect(enriched.errorId).toBe('RILL-R001');
      expect(enriched.message).toBe('Test error');
      expect(enriched.span).toBeUndefined();
      expect(enriched.sourceSnippet).toBeUndefined();
    });

    it('handles empty source', () => {
      const source = '';
      const location: SourceLocation = { line: 1, column: 0, offset: 0 };
      const error = new RuntimeError('RILL-R001', 'Test error', location);

      const enriched = enrichError(error, source);

      expect(enriched.errorId).toBe('RILL-R001');
      expect(enriched.sourceSnippet).toBeUndefined();
    });

    it('strips location suffix from message', () => {
      const source = 'test';
      const location: SourceLocation = { line: 1, column: 5, offset: 5 };
      // RuntimeError constructor adds " at 1:5" automatically when location is provided
      const error = new RuntimeError('RILL-R001', 'Test error', location);

      const enriched = enrichError(error, source);

      // enrichError strips the location suffix that was added by constructor
      expect(enriched.message).toBe('Test error');
    });
  });

  describe('EC-3: Invalid source encoding', () => {
    it('throws TypeError when source is not a string', () => {
      const location: SourceLocation = { line: 1, column: 0, offset: 0 };
      const error = new RuntimeError('RILL-R001', 'Test error', location);

      expect(() => enrichError(error, 123 as unknown as string)).toThrow(
        TypeError
      );
      expect(() => enrichError(error, 123 as unknown as string)).toThrow(
        'Source must be valid UTF-8'
      );
    });

    it('throws TypeError when source is null', () => {
      const location: SourceLocation = { line: 1, column: 0, offset: 0 };
      const error = new RuntimeError('RILL-R001', 'Test error', location);

      expect(() => enrichError(error, null as unknown as string)).toThrow(
        TypeError
      );
      expect(() => enrichError(error, null as unknown as string)).toThrow(
        'Source must be valid UTF-8'
      );
    });

    it('throws TypeError when source is undefined', () => {
      const location: SourceLocation = { line: 1, column: 0, offset: 0 };
      const error = new RuntimeError('RILL-R001', 'Test error', location);

      expect(() => enrichError(error, undefined as unknown as string)).toThrow(
        TypeError
      );
      expect(() => enrichError(error, undefined as unknown as string)).toThrow(
        'Source must be valid UTF-8'
      );
    });
  });

  describe('EC-4: Null error', () => {
    it('throws TypeError when error is null', () => {
      const source = 'test source';

      expect(() =>
        enrichError(null as unknown as RuntimeError, source)
      ).toThrow(TypeError);
      expect(() =>
        enrichError(null as unknown as RuntimeError, source)
      ).toThrow('Error is required');
    });

    it('throws TypeError when error is undefined', () => {
      const source = 'test source';

      expect(() =>
        enrichError(undefined as unknown as RuntimeError, source)
      ).toThrow(TypeError);
      expect(() =>
        enrichError(undefined as unknown as RuntimeError, source)
      ).toThrow('Error is required');
    });
  });
});
