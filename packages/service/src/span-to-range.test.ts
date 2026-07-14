import { describe, expect, it } from 'vitest';
import type { SourceSpan } from '@rcrsr/rill';
import { spanToRange } from './span-to-range.js';

describe('spanToRange', () => {
  it('converts a 1-based span at the document start to a 0-based range', () => {
    const span: SourceSpan = {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 3, column: 10, offset: 30 },
    };

    const range = spanToRange(span);

    expect(range).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 2, character: 9 },
    });
  });

  it('subtracts 1 from both line and column on start and end when values exceed 1', () => {
    // Invariant: core always emits 1-based line/column. This conversion is
    // exactly line-1/column-1; if core ever emitted 0-based coordinates this
    // test would need to change alongside the conversion.
    const span: SourceSpan = {
      start: { line: 5, column: 12, offset: 100 },
      end: { line: 7, column: 4, offset: 140 },
    };

    const range = spanToRange(span);

    expect(range.start).toEqual({ line: 4, character: 11 });
    expect(range.end).toEqual({ line: 6, character: 3 });
  });
});
