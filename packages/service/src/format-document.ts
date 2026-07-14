/**
 * Whole-document formatting for a parsed rill script.
 *
 * This is a conservative normalizer, not a full canonical pretty-printer:
 * well-formed regions have trailing per-line whitespace trimmed and CRLF
 * line endings normalized to LF; nothing else is rewritten (no re-spacing
 * of operators, no re-indentation). Malformed regions produced by parser
 * error recovery (`RecoveryErrorNode`, `PartialExpressionNode`) are spliced
 * back byte-for-byte from the original source and are never touched.
 *
 * This scope keeps the two hard constraints trivially provable: applying
 * the normalization twice is a no-op (idempotence), and every byte of the
 * original source is accounted for by either a normalized or a verbatim
 * segment (no content is ever dropped).
 */

import { walkAst } from '@rcrsr/rill';
import type { ASTNode, ParseResult } from '@rcrsr/rill';
import type { Position, TextEdit } from './types.js';

/** A byte-offset range identifying a malformed (unparseable) source region. */
interface MalformedRegion {
  readonly startOffset: number;
  readonly endOffset: number;
}

/**
 * Produces a single full-document `TextEdit` reformatting `source`.
 *
 * The returned edit's range always spans the entire original document
 * (line 0, character 0 through the document's final position), and its
 * `newText` is the whole formatted document, never a partial replacement.
 */
export function formatDocument(
  parsed: ParseResult,
  source: string
): TextEdit[] {
  return [
    {
      range: {
        start: { line: 0, character: 0 },
        end: documentEndPosition(source),
      },
      newText: renderFormattedSource(parsed.ast, source),
    },
  ];
}

/**
 * Rebuilds `source` by normalizing well-formed regions and splicing
 * malformed regions back verbatim, in source order.
 */
function renderFormattedSource(ast: ASTNode, source: string): string {
  const malformedRegions = collectMalformedRegions(ast);

  let result = '';
  let cursor = 0;
  for (const region of malformedRegions) {
    // A gap immediately preceding a malformed region does not end at a real
    // line boundary when it lacks a trailing `\n` (the malformed region
    // continues the same line). Trimming that gap's last "line" would strip
    // inline separator whitespace and fuse the gap to the malformed region.
    const gap = source.slice(cursor, region.startOffset);
    result += normalizeWhitespace(gap, gap.endsWith('\n'));
    result += source.slice(region.startOffset, region.endOffset);
    cursor = region.endOffset;
  }
  result += normalizeWhitespace(source.slice(cursor));
  return result;
}

/**
 * Walks `ast` and returns the merged, non-overlapping spans of every
 * `RecoveryErrorNode` and `PartialExpressionNode`, sorted by source order.
 * A malformed node's typed children (if any) are never surfaced as
 * separate regions: the entire malformed node's span is treated as one
 * opaque, verbatim block.
 *
 * Parser recovery can emit malformed nodes whose spans nest or partially
 * overlap (e.g. a `PartialExpressionNode` and the `RecoveryErrorNode` that
 * follows it sharing a boundary byte). Adjacent/overlapping regions are
 * merged into a single covering span so every malformed byte stays inside
 * exactly one verbatim block, rather than falling through to whitespace
 * normalization.
 */
function collectMalformedRegions(ast: ASTNode): MalformedRegion[] {
  const regions: MalformedRegion[] = [];
  walkAst(ast, (node) => {
    if (node.type === 'RecoveryError' || node.type === 'PartialExpression') {
      regions.push({
        startOffset: node.span.start.offset,
        endOffset: node.span.end.offset,
      });
    }
  });
  regions.sort((a, b) => a.startOffset - b.startOffset);

  const merged: MalformedRegion[] = [];
  for (const region of regions) {
    const last = merged[merged.length - 1];
    if (last !== undefined && region.startOffset <= last.endOffset) {
      if (region.endOffset > last.endOffset) {
        merged[merged.length - 1] = {
          startOffset: last.startOffset,
          endOffset: region.endOffset,
        };
      }
      continue;
    }
    merged.push(region);
  }
  return merged;
}

/**
 * Normalizes a well-formed text segment: CRLF line endings become LF, and
 * trailing spaces/tabs are trimmed from every line. Idempotent by
 * construction: neither transformation produces output that the other
 * pass would further change.
 *
 * When `trimLastLine` is `false`, the final line is left untouched. This is
 * used for gaps that end mid-line right before a malformed region: that
 * "line" isn't a real line boundary, so its trailing whitespace is inline
 * separator whitespace, not end-of-line whitespace, and must be preserved.
 */
function normalizeWhitespace(text: string, trimLastLine = true): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const lastIndex = lines.length - 1;
  return lines
    .map((line, index) =>
      index < lastIndex || trimLastLine ? line.replace(/[ \t]+$/, '') : line
    )
    .join('\n');
}

/** The 0-based end position (last line, last character) of `source`. */
function documentEndPosition(source: string): Position {
  const lines = source.split('\n');
  const lastLineIndex = lines.length - 1;
  return {
    line: lastLineIndex,
    character: lines[lastLineIndex]?.length ?? 0,
  };
}
