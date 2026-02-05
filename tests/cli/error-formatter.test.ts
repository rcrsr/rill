/**
 * Tests for CLI Error Formatter
 * Covers: IR-5, IR-7, EC-5, EC-8, IC-2
 */

import { describe, it, expect } from 'vitest';
import {
  formatError,
  renderCaretUnderline,
  type EnrichedError,
  type FormatOptions,
  type CallFrame,
} from '../../src/cli-error-formatter.js';
import type { SourceSpan, SourceLocation } from '../../src/types.js';
import type { SourceSnippet } from '../../src/cli-error-enrichment.js';

describe('formatError', () => {
  describe('IR-5: Human format with header and location', () => {
    it('formats error with header and location', () => {
      const error: EnrichedError = {
        errorId: 'RILL-R005',
        message: 'Variable foo is not defined',
        span: {
          start: { line: 5, column: 10, offset: 50 },
          end: { line: 5, column: 13, offset: 53 },
        },
      };

      const options: FormatOptions = {
        format: 'human',
        verbose: false,
        includeCallStack: false,
        maxCallStackDepth: 10,
      };

      const result = formatError(error, options);

      expect(result).toContain('error[RILL-R005]: Variable foo is not defined');
      expect(result).toContain('  --> 5:10');
    });

    it('formats error with source snippet and caret underline', () => {
      const error: EnrichedError = {
        errorId: 'RILL-R005',
        message: 'Variable foo is not defined',
        span: {
          start: { line: 3, column: 2, offset: 20 },
          end: { line: 3, column: 6, offset: 24 },
        },
        sourceSnippet: {
          lines: [
            { lineNumber: 1, content: '"start" => $begin', isErrorLine: false },
            {
              lineNumber: 2,
              content: '$begin -> .upper => $upper',
              isErrorLine: false,
            },
            { lineNumber: 3, content: '$foo -> .len', isErrorLine: true },
            { lineNumber: 4, content: 'end', isErrorLine: false },
          ],
          highlightSpan: {
            start: { line: 3, column: 2, offset: 20 },
            end: { line: 3, column: 6, offset: 24 },
          },
        },
      };

      const options: FormatOptions = {
        format: 'human',
        verbose: false,
        includeCallStack: false,
        maxCallStackDepth: 10,
      };

      const result = formatError(error, options);

      expect(result).toContain('error[RILL-R005]');
      expect(result).toContain('  --> 3:2');
      expect(result).toContain('   |');
      expect(result).toContain(' 1 | "start" => $begin');
      expect(result).toContain(' 2 | $begin -> .upper => $upper');
      expect(result).toContain(' 3 | $foo -> .len');
      expect(result).toContain('   |   ^^^^');
      expect(result).toContain(' 4 | end');
    });

    it('formats error with suggestions', () => {
      const error: EnrichedError = {
        errorId: 'RILL-R005',
        message: 'Variable foo is not defined',
        span: {
          start: { line: 3, column: 0, offset: 18 },
          end: { line: 3, column: 4, offset: 22 },
        },
        suggestions: ['Did you mean `$begin`?', 'Try declaring it first'],
      };

      const options: FormatOptions = {
        format: 'human',
        verbose: false,
        includeCallStack: false,
        maxCallStackDepth: 10,
      };

      const result = formatError(error, options);

      expect(result).toContain('   = help: Did you mean `$begin`?');
      expect(result).toContain('   = help: Try declaring it first');
    });

    it('includes help URL when verbose', () => {
      const error: EnrichedError = {
        errorId: 'RILL-R005',
        message: 'Variable foo is not defined',
        helpUrl: 'https://example.com/errors/R005',
      };

      const options: FormatOptions = {
        format: 'human',
        verbose: true,
        includeCallStack: false,
        maxCallStackDepth: 10,
      };

      const result = formatError(error, options);

      expect(result).toContain('   = see: https://example.com/errors/R005');
    });

    it('excludes help URL when not verbose', () => {
      const error: EnrichedError = {
        errorId: 'RILL-R005',
        message: 'Variable foo is not defined',
        helpUrl: 'https://example.com/errors/R005',
      };

      const options: FormatOptions = {
        format: 'human',
        verbose: false,
        includeCallStack: false,
        maxCallStackDepth: 10,
      };

      const result = formatError(error, options);

      expect(result).not.toContain('https://example.com/errors/R005');
    });

    it('formats error with call stack when enabled', () => {
      const callStack: CallFrame[] = [
        {
          location: {
            start: { line: 10, column: 5, offset: 100 },
            end: { line: 10, column: 15, offset: 110 },
          },
          functionName: 'myFunction',
          context: 'in each body',
        },
        {
          location: {
            start: { line: 5, column: 0, offset: 50 },
            end: { line: 5, column: 10, offset: 60 },
          },
          functionName: 'outer',
        },
      ];

      const error: EnrichedError = {
        errorId: 'RILL-R001',
        message: 'Runtime error occurred',
        callStack,
      };

      const options: FormatOptions = {
        format: 'human',
        verbose: false,
        includeCallStack: true,
        maxCallStackDepth: 10,
      };

      const result = formatError(error, options);

      expect(result).toContain('Call stack:');
      expect(result).toContain('  1. myFunction (in each body) at 10:5');
      expect(result).toContain('  2. outer at 5:0');
    });

    it('limits call stack depth', () => {
      const callStack: CallFrame[] = [
        {
          location: {
            start: { line: 1, column: 0, offset: 0 },
            end: { line: 1, column: 5, offset: 5 },
          },
          functionName: 'fn1',
        },
        {
          location: {
            start: { line: 2, column: 0, offset: 10 },
            end: { line: 2, column: 5, offset: 15 },
          },
          functionName: 'fn2',
        },
        {
          location: {
            start: { line: 3, column: 0, offset: 20 },
            end: { line: 3, column: 5, offset: 25 },
          },
          functionName: 'fn3',
        },
      ];

      const error: EnrichedError = {
        errorId: 'RILL-R001',
        message: 'Runtime error',
        callStack,
      };

      const options: FormatOptions = {
        format: 'human',
        verbose: false,
        includeCallStack: true,
        maxCallStackDepth: 2,
      };

      const result = formatError(error, options);

      expect(result).toContain('  1. fn1');
      expect(result).toContain('  2. fn2');
      expect(result).toContain('  ... 1 more frames');
      expect(result).not.toContain('fn3');
    });
  });

  describe('IR-5: JSON format with LSP structure', () => {
    it('formats error as JSON with LSP diagnostic structure', () => {
      const error: EnrichedError = {
        errorId: 'RILL-R005',
        message: 'Variable foo is not defined',
        span: {
          start: { line: 5, column: 10, offset: 50 },
          end: { line: 5, column: 13, offset: 53 },
        },
        suggestions: ['Did you mean `$begin`?'],
      };

      const options: FormatOptions = {
        format: 'json',
        verbose: false,
        includeCallStack: false,
        maxCallStackDepth: 10,
      };

      const result = formatError(error, options);
      const diagnostic = JSON.parse(result);

      expect(diagnostic.errorId).toBe('RILL-R005');
      expect(diagnostic.severity).toBe(1); // Error
      expect(diagnostic.message).toBe('Variable foo is not defined');
      expect(diagnostic.source).toBe('rill');
      expect(diagnostic.code).toBe('RILL-R005');
      expect(diagnostic.range).toEqual({
        start: { line: 4, character: 10 }, // LSP uses 0-based lines
        end: { line: 4, character: 13 },
      });
      expect(diagnostic.suggestions).toEqual(['Did you mean `$begin`?']);
    });

    it('includes call stack in JSON format when enabled', () => {
      const callStack: CallFrame[] = [
        {
          location: {
            start: { line: 10, column: 5, offset: 100 },
            end: { line: 10, column: 15, offset: 110 },
          },
          functionName: 'myFunction',
          context: 'in each body',
        },
      ];

      const error: EnrichedError = {
        errorId: 'RILL-R001',
        message: 'Runtime error',
        callStack,
      };

      const options: FormatOptions = {
        format: 'json',
        verbose: false,
        includeCallStack: true,
        maxCallStackDepth: 10,
      };

      const result = formatError(error, options);
      const diagnostic = JSON.parse(result);

      expect(diagnostic.callStack).toHaveLength(1);
      expect(diagnostic.callStack[0]).toEqual({
        location: {
          start: { line: 9, character: 5 }, // 0-based
          end: { line: 9, character: 15 },
        },
        functionName: 'myFunction',
        context: 'in each body',
      });
    });

    it('excludes call stack when not enabled', () => {
      const callStack: CallFrame[] = [
        {
          location: {
            start: { line: 10, column: 5, offset: 100 },
            end: { line: 10, column: 15, offset: 110 },
          },
        },
      ];

      const error: EnrichedError = {
        errorId: 'RILL-R001',
        message: 'Runtime error',
        callStack,
      };

      const options: FormatOptions = {
        format: 'json',
        verbose: false,
        includeCallStack: false,
        maxCallStackDepth: 10,
      };

      const result = formatError(error, options);
      const diagnostic = JSON.parse(result);

      expect(diagnostic.callStack).toBeUndefined();
    });

    it('includes help URL in JSON when verbose', () => {
      const error: EnrichedError = {
        errorId: 'RILL-R005',
        message: 'Variable foo is not defined',
        helpUrl: 'https://example.com/errors/R005',
      };

      const options: FormatOptions = {
        format: 'json',
        verbose: true,
        includeCallStack: false,
        maxCallStackDepth: 10,
      };

      const result = formatError(error, options);
      const diagnostic = JSON.parse(result);

      expect(diagnostic.helpUrl).toBe('https://example.com/errors/R005');
    });
  });

  describe('IR-5: Compact format single line', () => {
    it('formats error as single line', () => {
      const error: EnrichedError = {
        errorId: 'RILL-R005',
        message: 'Variable foo is not defined',
        span: {
          start: { line: 5, column: 10, offset: 50 },
          end: { line: 5, column: 13, offset: 53 },
        },
      };

      const options: FormatOptions = {
        format: 'compact',
        verbose: false,
        includeCallStack: false,
        maxCallStackDepth: 10,
      };

      const result = formatError(error, options);

      expect(result).toBe('[RILL-R005] Variable foo is not defined at 5:10');
      expect(result).not.toContain('\n');
    });

    it('includes first suggestion as hint', () => {
      const error: EnrichedError = {
        errorId: 'RILL-R005',
        message: 'Variable foo is not defined',
        suggestions: ['Did you mean `$begin`?', 'Another suggestion'],
      };

      const options: FormatOptions = {
        format: 'compact',
        verbose: false,
        includeCallStack: false,
        maxCallStackDepth: 10,
      };

      const result = formatError(error, options);

      expect(result).toBe(
        '[RILL-R005] Variable foo is not defined (hint: Did you mean `$begin`?)'
      );
    });

    it('formats without location when span absent', () => {
      const error: EnrichedError = {
        errorId: 'RILL-R001',
        message: 'Runtime error',
      };

      const options: FormatOptions = {
        format: 'compact',
        verbose: false,
        includeCallStack: false,
        maxCallStackDepth: 10,
      };

      const result = formatError(error, options);

      expect(result).toBe('[RILL-R001] Runtime error');
    });
  });

  describe('EC-5: Unknown format throws TypeError', () => {
    it('throws TypeError for unknown format', () => {
      const error: EnrichedError = {
        errorId: 'RILL-R001',
        message: 'Error message',
      };

      const options: FormatOptions = {
        format: 'xml' as 'human', // Force invalid format
        verbose: false,
        includeCallStack: false,
        maxCallStackDepth: 10,
      };

      expect(() => formatError(error, options)).toThrow(TypeError);
      expect(() => formatError(error, options)).toThrow('Unknown format: xml');
    });
  });
});

describe('renderCaretUnderline', () => {
  describe('IR-7: Single char shows ^', () => {
    it('renders single caret for single character span', () => {
      const span: SourceSpan = {
        start: { line: 1, column: 5, offset: 5 },
        end: { line: 1, column: 6, offset: 6 },
      };
      const lineContent = 'hello world';

      const result = renderCaretUnderline(span, lineContent);

      expect(result).toBe('     ^');
    });
  });

  describe('IR-7: Multi-char shows ^^^^^', () => {
    it('renders multiple carets for multi-character span', () => {
      const span: SourceSpan = {
        start: { line: 1, column: 2, offset: 2 },
        end: { line: 1, column: 6, offset: 6 },
      };
      const lineContent = '$foo -> .len';

      const result = renderCaretUnderline(span, lineContent);

      expect(result).toBe('  ^^^^'); // 2 spaces + 4 carets
    });

    it('handles zero-width span as single caret', () => {
      const span: SourceSpan = {
        start: { line: 1, column: 3, offset: 3 },
        end: { line: 1, column: 3, offset: 3 },
      };
      const lineContent = 'hello';

      const result = renderCaretUnderline(span, lineContent);

      expect(result).toBe('   ^'); // 3 spaces + 1 caret (minimum)
    });
  });

  describe('IR-7: Multi-line span continues on first line', () => {
    it('renders carets to end of line for multi-line span', () => {
      const span: SourceSpan = {
        start: { line: 1, column: 6, offset: 6 },
        end: { line: 3, column: 2, offset: 25 },
      };
      const lineContent = 'hello world';

      const result = renderCaretUnderline(span, lineContent);

      expect(result).toBe('      ^^^^^'); // 6 spaces + 5 carets (from col 6 to end)
    });
  });

  describe('EC-8: Invalid span throws RangeError', () => {
    it('throws when start line after end line', () => {
      const span: SourceSpan = {
        start: { line: 5, column: 0, offset: 50 },
        end: { line: 3, column: 0, offset: 30 },
      };
      const lineContent = 'content';

      expect(() => renderCaretUnderline(span, lineContent)).toThrow(RangeError);
      expect(() => renderCaretUnderline(span, lineContent)).toThrow(
        'Span start must precede end'
      );
    });

    it('throws when start column after end column on same line', () => {
      const span: SourceSpan = {
        start: { line: 1, column: 10, offset: 10 },
        end: { line: 1, column: 5, offset: 5 },
      };
      const lineContent = 'hello world';

      expect(() => renderCaretUnderline(span, lineContent)).toThrow(RangeError);
      expect(() => renderCaretUnderline(span, lineContent)).toThrow(
        'Span start must precede end'
      );
    });
  });

  describe('AC-20: Error at final character renders correctly', () => {
    it('renders caret at last character position', () => {
      const lineContent = 'hello world';
      const lastCharColumn = lineContent.length - 1; // Column of 'd'

      const span: SourceSpan = {
        start: { line: 1, column: lastCharColumn, offset: lastCharColumn },
        end: {
          line: 1,
          column: lineContent.length,
          offset: lineContent.length,
        },
      };

      const result = renderCaretUnderline(span, lineContent);

      expect(result).toBe('          ^'); // 10 spaces + 1 caret
      expect(result.length).toBe(lineContent.length); // Underline should align
    });

    it('renders caret at very end of line (past last char)', () => {
      const lineContent = 'test';
      const span: SourceSpan = {
        start: { line: 1, column: 4, offset: 4 }, // After 't' (column 4)
        end: { line: 1, column: 4, offset: 4 },
      };

      const result = renderCaretUnderline(span, lineContent);

      expect(result).toBe('    ^'); // 4 spaces + 1 caret
    });
  });

  describe('Edge cases', () => {
    it('handles span at start of line', () => {
      const span: SourceSpan = {
        start: { line: 1, column: 0, offset: 0 },
        end: { line: 1, column: 5, offset: 5 },
      };
      const lineContent = 'hello';

      const result = renderCaretUnderline(span, lineContent);

      expect(result).toBe('^^^^^'); // No padding, 5 carets
    });

    it('handles empty line content', () => {
      const span: SourceSpan = {
        start: { line: 1, column: 0, offset: 0 },
        end: { line: 1, column: 0, offset: 0 },
      };
      const lineContent = '';

      const result = renderCaretUnderline(span, lineContent);

      expect(result).toBe('^'); // Single caret (minimum)
    });

    it('handles span extending beyond line content', () => {
      const span: SourceSpan = {
        start: { line: 1, column: 3, offset: 3 },
        end: { line: 1, column: 10, offset: 10 },
      };
      const lineContent = 'hi'; // Only 2 chars, but span goes to col 10

      const result = renderCaretUnderline(span, lineContent);

      expect(result).toBe('   ^^^^^^^'); // 3 spaces + 7 carets
    });
  });
});

describe('IC-2: Type definitions present', () => {
  it('exports EnrichedError type', () => {
    const error: EnrichedError = {
      errorId: 'RILL-R001',
      message: 'Test',
    };

    expect(error.errorId).toBe('RILL-R001');
  });

  it('exports FormatOptions type', () => {
    const options: FormatOptions = {
      format: 'human',
      verbose: false,
      includeCallStack: false,
      maxCallStackDepth: 10,
    };

    expect(options.format).toBe('human');
  });

  it('exports CallFrame type', () => {
    const frame: CallFrame = {
      location: {
        start: { line: 1, column: 0, offset: 0 },
        end: { line: 1, column: 5, offset: 5 },
      },
    };

    expect(frame.location.start.line).toBe(1);
  });
});
