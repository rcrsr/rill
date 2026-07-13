/**
 * Shared helper functions used by the rules engine orchestrator and by
 * individual rule modules.
 */

import type {
  ExpressionNode,
  PipeChainNode,
  PostfixExprNode,
  SourceSpan,
  VariableNode,
} from '@rcrsr/rill';

// ============================================================
// CONTEXT LINE EXTRACTION
// ============================================================

/**
 * Single-slot memoization for `source.split('\n')`. Rule modules call
 * `extractContextLine`/`extractSpanText` once per visited AST node against
 * the same `source` string for the lifetime of one `runRules` call;
 * re-splitting on every call turns a per-node lookup into an O(document
 * length) operation, which made the rules engine scale superlinearly on
 * large documents. Caching the most recently split source keeps repeated
 * calls O(1); the cache invalidates via value equality (`!==`) on the
 * source string whenever a different `source` is passed in.
 */
let cachedSplitSource: string | null = null;
let cachedSplitLines: string[] = [];

export function getSplitLines(source: string): string[] {
  if (source !== cachedSplitSource) {
    cachedSplitSource = source;
    cachedSplitLines = source.split('\n');
  }
  return cachedSplitLines;
}

/**
 * Extract source line at location for context display.
 * Splits source by newlines, retrieves the specified line (1-indexed), and
 * trims it.
 */
export function extractContextLine(line: number, source: string): string {
  const lines = getSplitLines(source);
  const sourceLine = lines[line - 1];
  return sourceLine ? sourceLine.trim() : '';
}

// ============================================================
// BARE $ REFERENCE DETECTION
// ============================================================

/**
 * Detect if expression is a bare $ (pipe variable) reference.
 * Used by IMPLICIT_DOLLAR_* rules to detect replaceable patterns.
 *
 * Returns true only for single bare $, not $var or $.field or $[0].
 * O(1) depth traversal (max 3 node levels): PipeChain -> ArithHead ->
 * PostfixExpr -> Variable.
 */
export function isBareReference(
  expr: ExpressionNode | null | undefined
): boolean {
  if (!expr) {
    return false;
  }

  if (expr.type !== 'PipeChain') {
    return false;
  }

  const pipeChain = expr as PipeChainNode;

  // Must have no pipe targets (just the head)
  if (pipeChain.pipes.length > 0 || pipeChain.terminator !== null) {
    return false;
  }

  const head = pipeChain.head;

  // ArithHead can be BinaryExpr, UnaryExpr, or PostfixExpr
  if (head.type !== 'PostfixExpr') {
    return false;
  }

  const postfix = head as PostfixExprNode;

  // Must have no method calls (just the primary)
  if (postfix.methods.length > 0) {
    return false;
  }

  const primary = postfix.primary;

  if (primary.type !== 'Variable') {
    return false;
  }

  const variable = primary as VariableNode;

  // Must be pipe variable ($) with no access chain, default value, or
  // existence check
  return (
    variable.isPipeVar &&
    variable.name === null &&
    variable.accessChain.length === 0 &&
    variable.defaultValue === null &&
    variable.existenceCheck === null
  );
}

// ============================================================
// SOURCE-SPAN TEXT EXTRACTION
// ============================================================

/**
 * Validate that a SourceSpan has valid coordinates.
 * Returns false if span, start, or end are missing, or if line/column
 * values are less than 1.
 */
export function isValidSpan(span: SourceSpan | null | undefined): boolean {
  if (!span) {
    return false;
  }
  if (!span.start || !span.end) {
    return false;
  }
  if (
    span.start.line < 1 ||
    span.start.column < 1 ||
    span.end.line < 1 ||
    span.end.column < 1
  ) {
    return false;
  }
  return true;
}

/**
 * Extract text from source using span coordinates. Runs in O(span length)
 * time: it slices the already-split lines directly, no scanning regex.
 */
export function extractSpanText(span: SourceSpan, source: string): string {
  const lines = getSplitLines(source);

  if (span.start.line === span.end.line) {
    const line = lines[span.start.line - 1];
    if (!line) return '';
    return line.substring(span.start.column - 1, span.end.column - 1);
  }

  const result: string[] = [];

  for (let i = span.start.line - 1; i < span.end.line; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    if (i === span.start.line - 1) {
      result.push(line.substring(span.start.column - 1));
    } else if (i === span.end.line - 1) {
      result.push(line.substring(0, span.end.column - 1));
    } else {
      result.push(line);
    }
  }

  return result.join('\n');
}

/**
 * Escape special regex characters so operator text can be embedded in a
 * dynamically built RegExp.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
