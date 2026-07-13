/**
 * Converts a core `SourceSpan` (1-based line/column) into a service `Range`
 * (0-based line/character), the canonical conversion used by all providers.
 */

import type { SourceSpan } from '@rcrsr/rill';
import type { Range } from './types.js';

/**
 * Maps a 1-based `SourceSpan` to a 0-based `Range`.
 *
 * Correctness depends on core always emitting 1-based `line`/`column` values;
 * the conversion is exactly `line - 1` / `column - 1` on both `start` and `end`.
 * This is a total function: any well-formed `SourceSpan` has both `start` and
 * `end` locations, so there is no error path.
 */
export function spanToRange(span: SourceSpan): Range {
  return {
    start: {
      line: span.start.line - 1,
      character: span.start.column - 1,
    },
    end: {
      line: span.end.line - 1,
      character: span.end.column - 1,
    },
  };
}
