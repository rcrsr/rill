/**
 * CLI Error Formatter
 * Format enriched errors for human-readable, JSON, or compact output
 */

import type { SourceSpan, CallFrame } from '@rcrsr/rill';
import type { EnrichedError } from './cli-error-enrichment.js';

// ============================================================
// PUBLIC TYPES
// ============================================================

export type { CallFrame, EnrichedError };

/**
 * Format options for error output.
 */
export interface FormatOptions {
  readonly format: 'human' | 'json' | 'compact';
  readonly verbose: boolean;
  readonly includeCallStack: boolean;
  readonly maxCallStackDepth: number;
}

// ============================================================
// ERROR FORMATTING
// ============================================================

/**
 * Format enriched error for output.
 *
 * Constraints:
 * - Human format: multi-line with snippet and caret underline
 * - JSON format: LSP Diagnostic compatible
 * - Compact format: single line for CI output
 *
 * @param error - Enriched error with context
 * @param options - Format options
 * @returns Formatted error string
 * @throws {TypeError} Unknown format
 */
export function formatError(
  error: EnrichedError,
  options: FormatOptions
): string {
  // EC-5: Unknown format throws TypeError
  if (
    options.format !== 'human' &&
    options.format !== 'json' &&
    options.format !== 'compact'
  ) {
    throw new TypeError(`Unknown format: ${options.format}`);
  }

  if (options.format === 'json') {
    return formatErrorJson(error, options);
  }

  if (options.format === 'compact') {
    return formatErrorCompact(error);
  }

  return formatErrorHuman(error, options);
}

/**
 * Format error in human-readable format.
 *
 * Output format:
 * ```
 * error[RILL-R005]: Variable foo is not defined
 *   --> script.rill:5:10
 *    |
 *  3 | "start" => $begin
 *  4 | $begin -> .upper => $upper
 *  5 | $foo -> .len
 *    |   ^^^^ undefined variable
 *    |
 *    = help: Did you mean `$begin`?
 * ```
 */
function formatErrorHuman(
  error: EnrichedError,
  options: FormatOptions
): string {
  const lines: string[] = [];

  // Header: error[RILL-XXXX]: message
  lines.push(`error[${error.errorId}]: ${error.message}`);

  // Location: --> script.rill:5:10
  if (error.span) {
    const location = `${error.span.start.line}:${error.span.start.column}`;
    lines.push(`  --> ${location}`);
  }

  // Source snippet with caret underline
  if (error.sourceSnippet && error.sourceSnippet.lines.length > 0) {
    lines.push('   |');

    // Calculate padding width for line numbers
    const maxLineNumber = Math.max(
      ...error.sourceSnippet.lines.map((l) => l.lineNumber)
    );
    const lineNumberWidth = String(maxLineNumber).length;

    for (const line of error.sourceSnippet.lines) {
      const lineNumStr = String(line.lineNumber).padStart(lineNumberWidth, ' ');
      lines.push(` ${lineNumStr} | ${line.content}`);

      // Add caret underline for error lines
      if (line.isErrorLine && error.span) {
        const caret = renderCaretUnderline(error.span, line.content);
        const padding = ' '.repeat(lineNumberWidth);
        lines.push(` ${padding} | ${caret}`);
      }
    }
    lines.push('   |');
  }

  // Suggestions: = help: Did you mean `$begin`?
  if (error.suggestions && error.suggestions.length > 0) {
    for (const suggestion of error.suggestions) {
      lines.push(`   = help: ${suggestion}`);
    }
  }

  // Help URL
  if (options.verbose && error.helpUrl) {
    lines.push(`   = see: ${error.helpUrl}`);
  }

  // Call stack
  if (
    options.includeCallStack &&
    error.callStack &&
    error.callStack.length > 0
  ) {
    lines.push('');
    lines.push('Call stack:');
    const depth = Math.min(error.callStack.length, options.maxCallStackDepth);
    for (let i = 0; i < depth; i++) {
      const frame = error.callStack[i]!;
      const location = `${frame.location.start.line}:${frame.location.start.column}`;
      const name = frame.functionName ?? '<anonymous>';
      const context = frame.context ? ` (${frame.context})` : '';
      lines.push(`  ${i + 1}. ${name}${context} at ${location}`);
    }
    if (error.callStack.length > depth) {
      lines.push(`  ... ${error.callStack.length - depth} more frames`);
    }
  }

  return lines.join('\n');
}

/**
 * Format error in JSON format (LSP Diagnostic compatible).
 */
function formatErrorJson(error: EnrichedError, options: FormatOptions): string {
  const diagnostic: {
    errorId: string;
    severity: number;
    message: string;
    range?: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    source: string;
    code: string;
    suggestions?: string[];
    callStack?: Array<{
      location: {
        start: { line: number; character: number };
        end: { line: number; character: number };
      };
      functionName?: string | undefined;
      context?: string | undefined;
    }>;
    helpUrl?: string;
  } = {
    errorId: error.errorId,
    severity: 1, // Error severity in LSP (1 = Error, 2 = Warning, 3 = Information, 4 = Hint)
    message: error.message,
    source: 'rill',
    code: error.errorId,
  };

  if (error.span) {
    diagnostic.range = {
      start: {
        line: error.span.start.line - 1, // LSP uses 0-based line numbers
        character: error.span.start.column,
      },
      end: {
        line: error.span.end.line - 1, // LSP uses 0-based line numbers
        character: error.span.end.column,
      },
    };
  }

  if (error.suggestions && error.suggestions.length > 0) {
    diagnostic.suggestions = error.suggestions;
  }

  if (
    options.includeCallStack &&
    error.callStack &&
    error.callStack.length > 0
  ) {
    const depth = Math.min(error.callStack.length, options.maxCallStackDepth);
    diagnostic.callStack = error.callStack.slice(0, depth).map((frame) => {
      const callFrame: {
        location: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        };
        functionName?: string | undefined;
        context?: string | undefined;
      } = {
        location: {
          start: {
            line: frame.location.start.line - 1,
            character: frame.location.start.column,
          },
          end: {
            line: frame.location.end.line - 1,
            character: frame.location.end.column,
          },
        },
      };
      if (frame.functionName !== undefined) {
        callFrame.functionName = frame.functionName;
      }
      if (frame.context !== undefined) {
        callFrame.context = frame.context;
      }
      return callFrame;
    });
  }

  if (options.verbose && error.helpUrl) {
    diagnostic.helpUrl = error.helpUrl;
  }

  return JSON.stringify(diagnostic, null, 2);
}

/**
 * Format error in compact format (single line for CI).
 */
function formatErrorCompact(error: EnrichedError): string {
  const parts: string[] = [`[${error.errorId}]`, error.message];

  if (error.span) {
    parts.push(`at ${error.span.start.line}:${error.span.start.column}`);
  }

  if (error.suggestions && error.suggestions.length > 0) {
    parts.push(`(hint: ${error.suggestions[0]})`);
  }

  return parts.join(' ');
}

// ============================================================
// CARET UNDERLINE
// ============================================================

/**
 * Render caret underline for error span.
 *
 * Constraints:
 * - Single-char: single ^
 * - Multi-char same line: ^^^^^ (length = span width)
 * - Multi-line: ^^^^^ (continues) on first line only
 *
 * @param span - Error span
 * @param lineContent - Content of the line
 * @returns Caret underline string
 * @throws {RangeError} Invalid span (start after end)
 */
export function renderCaretUnderline(
  span: SourceSpan,
  lineContent: string
): string {
  // EC-8: Invalid span throws RangeError
  if (
    span.start.line > span.end.line ||
    (span.start.line === span.end.line && span.start.column > span.end.column)
  ) {
    throw new RangeError('Span start must precede end');
  }

  // Calculate the width of the underline
  const startColumn = span.start.column;
  let endColumn: number;

  if (span.start.line === span.end.line) {
    // Single-line span: underline from start to end
    endColumn = span.end.column;
  } else {
    // Multi-line span: underline to end of first line
    endColumn = lineContent.length;
  }

  // Build underline: spaces before, carets for the span
  const padding = ' '.repeat(startColumn);
  const caretCount = Math.max(1, endColumn - startColumn);
  const carets = '^'.repeat(caretCount);

  return padding + carets;
}
