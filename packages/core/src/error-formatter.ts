/**
 * Error Formatter
 *
 * Self-contained formatters for RillError display.
 * Produces human-readable and JSON error output with:
 * - Error header (code + message)
 * - Primary source snippet with caret
 * - Call stack frames with source snippets
 *
 * Rendering helpers are grouped here so a future colorizer can
 * wrap or replace individual render functions without touching
 * the layout logic.
 */

import type { RillError, CallFrame, RillErrorData } from './types.js';
import { getCallStack } from './runtime/core/context.js';

// ============================================================
// TYPES
// ============================================================

/** Source texts keyed by origin (script body, generated bindings, etc.) */
export type SourceMap = { script?: string; bindings?: string };

/** Options for the human-readable error formatter. */
export interface FormatErrorOptions {
  readonly verbose?: boolean;
  readonly maxStackDepth?: number;
  readonly filePath?: string;
  readonly sources?: SourceMap;
}

// ============================================================
// SOURCE LOOKUP
// ============================================================

interface SourceSnippet {
  label: string;
  sourceLine?: string;
}

function splitLines(text: string): string[] {
  return text.split('\n');
}

/**
 * Look up a source line by 1-based line number.
 * Returns the file label and (if found) the source text of that line.
 */
function resolveSourceSnippet(
  location: { line: number; column: number },
  sources: SourceMap,
  filePath?: string
): SourceSnippet {
  if (sources.script !== undefined) {
    const lines = splitLines(sources.script);
    const idx = location.line - 1;
    if (
      idx >= 0 &&
      idx < lines.length &&
      location.column <= lines[idx]!.length + 1
    ) {
      return {
        label: filePath ?? '<script>',
        ...(lines[idx] !== undefined ? { sourceLine: lines[idx] } : {}),
      };
    }
  }
  if (sources.bindings !== undefined) {
    const lines = splitLines(sources.bindings);
    const idx = location.line - 1;
    if (idx >= 0 && idx < lines.length) {
      return {
        label: '<generated bindings>',
        ...(lines[idx] !== undefined ? { sourceLine: lines[idx] } : {}),
      };
    }
  }
  return { label: filePath ?? '<unknown>' };
}

// ============================================================
// SNIPPET RENDERING
// ============================================================

/**
 * Render a source line with line number gutter and caret indicator.
 *
 * Example output:
 *   5 | |path| { $read("data", $path) } => $moar_reader
 *     |          ^
 */
function renderSnippet(
  lineNum: number,
  column: number,
  sourceLine: string,
  gutterWidth: number
): string[] {
  const gutter = String(lineNum).padStart(gutterWidth);
  const caretCol = Math.max(0, column - 1);
  return [
    `  ${gutter} | ${sourceLine}`,
    `  ${' '.repeat(gutterWidth)} | ${' '.repeat(caretCol)}^`,
  ];
}

// ============================================================
// HUMAN-READABLE FORMATTER
// ============================================================

/**
 * Format a RillError for human-readable terminal output.
 *
 * Output structure:
 * ```
 * error[RILL-R001]: file not found: test.txta
 *   at script.rill:5:10
 *
 *    5 | |path| { $read("data", $path) } => $moar_reader
 *      |          ^
 *
 *   called from:
 *   10 | $reader("test.txta")
 *      | ^
 * ```
 */
export function formatRillError(
  error: RillError,
  options: FormatErrorOptions = {}
): string {
  const { verbose = false, maxStackDepth = 10, filePath, sources } = options;

  const data = error.toData();
  const frames = getCallStack(error);
  const visibleFrames = frames.slice(0, maxStackDepth);
  const parts: string[] = [];

  // -- Error header ----------------------------------------------------------
  parts.push(`error[${data.errorId}]: ${data.message}`);

  // -- Primary location ------------------------------------------------------
  // Cross-module source text for snippet rendering (stored on error context)
  const crossModuleSource =
    data.context?.['sourceText'] !== undefined
      ? String(data.context['sourceText'])
      : undefined;

  if (data.sourceId !== undefined && data.location !== undefined) {
    parts.push(
      `  at ${data.sourceId}:${data.location.line}:${data.location.column}`
    );
    // Show source snippet from the cross-module source if available
    if (crossModuleSource !== undefined) {
      const crossSources: SourceMap = { script: crossModuleSource };
      const match = resolveSourceSnippet(
        data.location,
        crossSources,
        data.sourceId
      );
      if (match.sourceLine !== undefined) {
        const allLineNums = [
          data.location.line,
          ...visibleFrames.map((f) => f.location.start.line),
        ];
        const gutterWidth = String(Math.max(...allLineNums)).length;

        parts.push(
          ...renderSnippet(
            data.location.line,
            data.location.column,
            match.sourceLine,
            gutterWidth
          )
        );
      }
    }
  } else if (data.location !== undefined && sources !== undefined) {
    const match = resolveSourceSnippet(data.location, sources, filePath);
    parts.push(
      `  at ${match.label}:${data.location.line}:${data.location.column}`
    );
    if (match.sourceLine !== undefined) {
      const allLineNums = [
        data.location.line,
        ...visibleFrames.map((f) => f.location.start.line),
      ];
      const gutterWidth = String(Math.max(...allLineNums)).length;

      parts.push(
        ...renderSnippet(
          data.location.line,
          data.location.column,
          match.sourceLine,
          gutterWidth
        )
      );
    }
  } else if (data.location !== undefined) {
    parts.push(
      `  at line ${data.location.line}, column ${data.location.column}`
    );
  }

  // -- Verbose context -------------------------------------------------------
  if (
    verbose &&
    data.context !== undefined &&
    Object.keys(data.context).length > 0
  ) {
    const filtered = Object.fromEntries(
      Object.entries(data.context).filter(([k]) => k !== 'callStack')
    );
    if (Object.keys(filtered).length > 0) {
      parts.push(`  context: ${JSON.stringify(filtered, null, 2)}`);
    }
  }

  if (verbose && data.helpUrl !== undefined) {
    parts.push(`  help: ${data.helpUrl}`);
  }

  // -- Call stack with source snippets ---------------------------------------
  appendCallStack(parts, data, visibleFrames, sources, filePath);

  return parts.join('\n');
}

// ============================================================
// JSON FORMATTER
// ============================================================

/** Options for the JSON error formatter. */
export interface FormatErrorJsonOptions {
  readonly maxStackDepth?: number;
  readonly filePath?: string;
}

/**
 * Format a RillError as a machine-readable JSON string.
 *
 * Output includes errorId, message, location, context, helpUrl,
 * and callStack (when frames are present).
 */
export function formatRillErrorJson(
  error: RillError,
  options: FormatErrorJsonOptions = {}
): string {
  const { maxStackDepth = 10, filePath } = options;

  const data = error.toData();
  const frames = getCallStack(error);
  const visibleFrames = frames.slice(0, maxStackDepth);

  // Filter internal callStack from context
  const context =
    data.context !== undefined
      ? Object.fromEntries(
          Object.entries(data.context).filter(([k]) => k !== 'callStack')
        )
      : undefined;

  const json: Record<string, unknown> = {
    errorId: data.errorId,
    message: data.message,
  };

  if (filePath !== undefined) {
    json['file'] = filePath;
  }

  if (data.sourceId !== undefined) {
    json['sourceId'] = data.sourceId;
  }

  if (data.location !== undefined) {
    json['location'] = {
      line: data.location.line,
      column: data.location.column,
    };
  }

  if (data.helpUrl !== undefined) {
    json['helpUrl'] = data.helpUrl;
  }

  if (context !== undefined && Object.keys(context).length > 0) {
    json['context'] = context;
  }

  if (visibleFrames.length > 0) {
    json['callStack'] = visibleFrames.map((frame) => {
      const entry: Record<string, unknown> = {
        line: frame.location.start.line,
        column: frame.location.start.column,
      };
      if (frame.functionName !== undefined) {
        entry['functionName'] = frame.functionName;
      }
      if (frame.context !== undefined) {
        entry['context'] = frame.context;
      }
      if (frame.sourceId !== undefined) {
        entry['sourceId'] = frame.sourceId;
      }
      return entry;
    });
  }

  return JSON.stringify(json);
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

/**
 * Append call stack frames to the output parts array.
 * Deduplicates frames that match the primary error location.
 */
function appendCallStack(
  parts: string[],
  data: RillErrorData,
  visibleFrames: readonly CallFrame[],
  sources?: SourceMap,
  filePath?: string
): void {
  // Drop frames that duplicate the primary error location
  const dedupedFrames = visibleFrames.filter((frame) => {
    if (!data.location) return true;
    const loc = frame.location.start;
    // Frames from a different source never duplicate the primary location
    if (frame.sourceId && frame.sourceId !== data.sourceId) return true;
    return (
      loc.line !== data.location.line || loc.column !== data.location.column
    );
  });

  if (dedupedFrames.length === 0) return;

  if (sources !== undefined) {
    const allLineNums = [
      ...(data.location ? [data.location.line] : []),
      ...dedupedFrames.map((f) => f.location.start.line),
    ];
    const gutterWidth = String(Math.max(...allLineNums)).length;

    parts.push('');
    parts.push('  called from:');

    // When the error is cross-module, label root-script frames with filePath
    const isCrossModule = data.sourceId !== undefined;

    for (const frame of dedupedFrames) {
      const loc = frame.location.start;
      const frameFile =
        frame.sourceId ?? (isCrossModule ? filePath : undefined);
      if (!frame.sourceId) {
        // Frame from the root script — try to show source snippet
        const snippet = resolveSourceSnippet(
          { line: loc.line, column: loc.column },
          sources,
          filePath
        );
        if (snippet.sourceLine !== undefined) {
          // Show file:line:col label before snippet for cross-module errors
          if (frameFile) {
            parts.push(`  ${frameFile}:${loc.line}:${loc.column}`);
          }
          parts.push(
            ...renderSnippet(
              loc.line,
              loc.column,
              snippet.sourceLine,
              gutterWidth
            )
          );
        } else {
          const name =
            frame.functionName !== undefined ? ` in ${frame.functionName}` : '';
          if (frameFile) {
            parts.push(`  at ${frameFile}:${loc.line}:${loc.column}${name}`);
          } else {
            parts.push(`  at ${loc.line}:${loc.column}${name}`);
          }
        }
      } else {
        // Frame from a different source — show sourceId as file label
        const name =
          frame.functionName !== undefined ? ` in ${frame.functionName}` : '';
        parts.push(`  at ${frame.sourceId}:${loc.line}:${loc.column}${name}`);
      }
    }
  } else {
    parts.push('');
    parts.push('  called from:');
    for (const frame of dedupedFrames) {
      const loc = frame.location.start;
      const frameLabel = frame.sourceId;
      const name =
        frame.functionName !== undefined ? ` in ${frame.functionName}` : '';
      if (frameLabel) {
        parts.push(`  at ${frameLabel}:${loc.line}:${loc.column}${name}`);
      } else {
        parts.push(`  at ${loc.line}:${loc.column}${name}`);
      }
    }
  }
}
