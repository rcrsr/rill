/**
 * CLI Error Enrichment
 * Functions for extracting source snippets and suggesting similar names
 */

import type { SourceSpan, RillError, CallFrame } from './types.js';

// ============================================================
// PUBLIC TYPES
// ============================================================

export interface SourceSnippet {
  readonly lines: SnippetLine[];
  readonly highlightSpan: SourceSpan;
}

export interface SnippetLine {
  readonly lineNumber: number;
  readonly content: string;
  readonly isErrorLine: boolean;
}

export interface ScopeInfo {
  readonly variableNames: string[];
  readonly functionNames: string[];
}

export interface EnrichedError {
  readonly errorId: string;
  readonly message: string;
  readonly span?: SourceSpan | undefined;
  readonly context?: Record<string, unknown> | undefined;
  readonly callStack?: CallFrame[] | undefined;
  readonly sourceSnippet?: SourceSnippet | undefined;
  readonly suggestions?: string[] | undefined;
  readonly helpUrl?: string | undefined;
}

// ============================================================
// SOURCE SNIPPET EXTRACTION
// ============================================================

/**
 * Extract source lines around error location.
 *
 * Constraints:
 * - Context lines: 2 before, 2 after (configurable)
 * - Line numbers: 1-based
 * - Handles edge cases: line 1, last line
 *
 * @param source - Full source text
 * @param span - Error location span
 * @param contextLines - Number of context lines before/after (default: 2)
 * @returns Snippet with context lines
 * @throws {RangeError} When span exceeds source bounds
 */
export function extractSnippet(
  source: string,
  span: SourceSpan,
  contextLines: number = 2
): SourceSnippet {
  // EC-7: Empty source returns empty snippet
  if (source === '') {
    return { lines: [], highlightSpan: span };
  }

  const lines = source.split('\n');
  const totalLines = lines.length;

  // EC-6: Validate span is within bounds (1-based line numbers)
  if (span.start.line < 1 || span.start.line > totalLines) {
    throw new RangeError('Span exceeds source bounds');
  }
  if (span.end.line < 1 || span.end.line > totalLines) {
    throw new RangeError('Span exceeds source bounds');
  }

  // Calculate context range
  const errorStartLine = span.start.line;
  const errorEndLine = span.end.line;
  const firstLine = Math.max(1, errorStartLine - contextLines);
  const lastLine = Math.min(totalLines, errorEndLine + contextLines);

  // Build snippet lines
  const snippetLines: SnippetLine[] = [];
  for (let lineNum = firstLine; lineNum <= lastLine; lineNum++) {
    const isErrorLine = lineNum >= errorStartLine && lineNum <= errorEndLine;
    snippetLines.push({
      lineNumber: lineNum,
      content: lines[lineNum - 1] ?? '', // Convert 1-based to 0-based index
      isErrorLine,
    });
  }

  return {
    lines: snippetLines,
    highlightSpan: span,
  };
}

// ============================================================
// NAME SUGGESTION
// ============================================================

/**
 * Find similar names using fuzzy matching.
 *
 * Constraints:
 * - Edit distance threshold: <= 2
 * - Max suggestions: 3
 * - Sort: ascending by distance, then alphabetically
 *
 * @param target - Name to match against
 * @param candidates - Available names
 * @returns Up to 3 similar names, sorted by distance then alphabetically
 */
export function suggestSimilarNames(
  target: string,
  candidates: string[]
): string[] {
  // EC-9: Empty target returns []
  if (target === '') {
    return [];
  }

  // EC-10: Empty candidates returns []
  if (candidates.length === 0) {
    return [];
  }

  // Calculate edit distance for each candidate
  const candidatesWithDistance = candidates
    .map((candidate) => ({
      name: candidate,
      distance: levenshteinDistance(target, candidate),
    }))
    .filter((item) => item.distance <= 2); // IR-8: Edit distance threshold

  // Sort: ascending by distance, then alphabetically
  candidatesWithDistance.sort((a, b) => {
    if (a.distance !== b.distance) {
      return a.distance - b.distance;
    }
    return a.name.localeCompare(b.name);
  });

  // IR-8: Max 3 suggestions
  return candidatesWithDistance.slice(0, 3).map((item) => item.name);
}

/**
 * Calculate Levenshtein distance between two strings.
 * Uses dynamic programming with O(m*n) time and O(min(m,n)) space.
 *
 * @param a - First string
 * @param b - Second string
 * @returns Edit distance (number of operations to transform a into b)
 */
function levenshteinDistance(a: string, b: string): number {
  // Ensure a is the shorter string for space optimization
  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  const m = a.length;
  const n = b.length;

  // Early exit for empty strings
  if (m === 0) return n;
  if (n === 0) return m;

  // Use rolling array optimization (only need previous row)
  let prevRow = Array.from({ length: m + 1 }, (_, i) => i);
  let currRow = new Array<number>(m + 1);

  for (let j = 1; j <= n; j++) {
    currRow[0] = j;

    for (let i = 1; i <= m; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[i] = Math.min(
        prevRow[i]! + 1, // deletion
        currRow[i - 1]! + 1, // insertion
        prevRow[i - 1]! + cost // substitution
      );
    }

    // Swap rows for next iteration
    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[m] ?? 0;
}

// ============================================================
// ERROR ENRICHMENT
// ============================================================

/**
 * Enrich RillError with source snippets and suggestions.
 *
 * Constraints:
 * - Source must be valid UTF-8
 * - Snippet extraction: 2 lines before, error line, 2 after
 * - Fuzzy matching: edit distance <= 2
 * - Max 3 suggestions
 *
 * @param error - RillError to enrich
 * @param source - Full source text
 * @param scope - Optional scope information for suggestions
 * @returns Enriched error with snippet and suggestions
 * @throws {TypeError} When source is not a string or error is null
 */
export function enrichError(
  error: RillError,
  source: string,
  scope?: ScopeInfo
): EnrichedError {
  // EC-4: Null error
  if (!error) {
    throw new TypeError('Error is required');
  }

  // EC-3: Invalid source encoding (JavaScript strings are always valid UTF-16)
  if (typeof source !== 'string') {
    throw new TypeError('Source must be valid UTF-8');
  }

  // Extract span from error location
  let span: SourceSpan | undefined;
  if (error.location) {
    // Create a minimal span from the location (single character)
    span = {
      start: error.location,
      end: error.location,
    };
  }

  // Extract source snippet if we have a span
  let sourceSnippet: SourceSnippet | undefined;
  if (span && source !== '') {
    try {
      sourceSnippet = extractSnippet(source, span);
    } catch {
      // If snippet extraction fails (e.g., invalid span), skip it
      sourceSnippet = undefined;
    }
  }

  // Generate suggestions if scope info is provided
  let suggestions: string[] | undefined;
  if (scope && error.context) {
    // Look for undefined variable names in context
    const undefinedName = error.context['name'] as string | undefined;
    if (undefinedName && typeof undefinedName === 'string') {
      const candidates = [...scope.variableNames, ...scope.functionNames];
      const similarNames = suggestSimilarNames(undefinedName, candidates);
      if (similarNames.length > 0) {
        suggestions = similarNames;
      }
    }
  }

  return {
    errorId: error.errorId,
    message: error.message.replace(/ at \d+:\d+$/, ''), // Strip location suffix
    span,
    context: error.context,
    callStack: undefined, // Call stack not part of base RillError
    sourceSnippet,
    suggestions,
    helpUrl: error.helpUrl,
  };
}
