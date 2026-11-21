/**
 * Enforces the preferred spacing between a written type and its value.
 *
 * A space between a collection keyword and its bracket, or between a written
 * type and its value, parses: `list [1]` is `list[1]`, and
 * `list(number) [1]` is `list(number)[1]`. Nothing else in the toolchain
 * reports the spaced forms, so this rule is the only signal, at info level.
 *
 * Preferred spacing:
 * - no space before `[`: `list[1]`, `list(number)[1]`;
 * - exactly one space before a scalar or atom value: `string "x"`,
 *   `union(#a, #b) #a`.
 *
 * Only same-line gaps are checked; a newline ends the statement, so a type
 * and a value on separate lines never form a declaration.
 */

import type { ASTNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { advancePosition, extractContextLine, isValidSpan } from './helpers.js';
import { registeredRules } from './rules-registry.js';

const CODE = 'SPACING_DECLARATION';

/** A keyword collection literal separated from its bracket by spaces or tabs. */
const SPACED_KEYWORD = /^(list|dict|tuple|ordered|map)([ \t]+)\[/;

const DOCUMENT_START = { line: 1, column: 1, offset: 0 } as const;

const BRACKET_VALUES: ReadonlySet<string> = new Set([
  'ListLiteral',
  'Dict',
  'DictLiteral',
  'TupleLiteral',
  'OrderedLiteral',
  'MapLiteral',
]);

function diagnostic(
  node: ASTNode,
  context: RuleContext,
  gapStart: number,
  gapEnd: number,
  replacement: string,
  message: string
): Diagnostic {
  // List, tuple and ordered spans start after their opener, so a gap before
  // the opener lies behind the node start; walk from the document start then.
  const anchor =
    node.span.start.offset <= gapStart ? node.span.start : DOCUMENT_START;
  const start = advancePosition(anchor, context.source, gapStart);
  const end = advancePosition(anchor, context.source, gapEnd);
  return {
    code: CODE,
    message,
    severity: 'info',
    location: start,
    context: extractContextLine(start.line, context.source),
    fix: {
      description:
        replacement === ''
          ? 'Remove the space before the bracket'
          : 'Use one space before the value',
      applicable: true,
      range: { start, end },
      replacement,
    },
  };
}

/**
 * Offset of the `[` that opens a collection literal. List, tuple and ordered
 * literal spans start after their opener, so the opener is the nearest `[`
 * at or before the span start.
 */
function openerOffset(node: ASTNode, source: string): number {
  const start = node.span.start.offset;
  return source.charAt(start) === '[' ? start : source.lastIndexOf('[', start);
}

/** Keyword, then same-line spaces or tabs, ending right before the opener. */
const KEYWORD_BEFORE_OPENER =
  /(?<![\w$.])(list|dict|tuple|ordered|map)([ \t]+)$/;

/**
 * Candidate openers for a keyword literal whose span starts after its opener.
 * When the first element is itself a bracket, the span start sits on that
 * element's `[`, so the literal's own opener is the `[` before the start.
 */
function candidateOpeners(node: ASTNode, source: string): number[] {
  const start = node.span.start.offset;
  const found: number[] = [];
  if (source.charAt(start) === '[') found.push(start);
  let i = start - 1;
  while (i >= 0 && /[ \t]/.test(source.charAt(i))) i--;
  if (i >= 0 && source.charAt(i) === '[') found.push(i);
  else {
    const last = source.lastIndexOf('[', start);
    if (last >= 0 && !found.includes(last)) found.push(last);
  }
  return found;
}

/** Gap offsets already reported in one run, so a gap is reported once. */
const reportedGaps = new WeakMap<RuleContext, Set<number>>();

function checkKeywordLiteral(
  node: ASTNode,
  context: RuleContext
): Diagnostic[] {
  const startOffset = node.span.start.offset;
  const gaps: { keyword: string; gapStart: number; gapEnd: number }[] = [];
  if (node.type === 'Dict' || node.type === 'MapLiteral') {
    const atStart = SPACED_KEYWORD.exec(
      context.source.slice(startOffset, startOffset + 64)
    );
    if (atStart !== null) {
      const keyword = atStart[1] ?? '';
      const gapStart = startOffset + keyword.length;
      gaps.push({
        keyword,
        gapStart,
        gapEnd: gapStart + (atStart[2] ?? '').length,
      });
    }
  } else {
    for (const opener of candidateOpeners(node, context.source)) {
      const before = KEYWORD_BEFORE_OPENER.exec(
        context.source.slice(Math.max(0, opener - 64), opener)
      );
      if (before === null) continue;
      gaps.push({
        keyword: before[1] ?? '',
        gapStart: opener - (before[2] ?? '').length,
        gapEnd: opener,
      });
    }
  }
  let seen = reportedGaps.get(context);
  if (seen === undefined) {
    seen = new Set<number>();
    reportedGaps.set(context, seen);
  }
  const out: Diagnostic[] = [];
  for (const { keyword, gapStart, gapEnd } of gaps) {
    if (seen.has(gapStart)) continue;
    seen.add(gapStart);
    out.push(
      diagnostic(
        node,
        context,
        gapStart,
        gapEnd,
        '',
        `No space between '${keyword}' and '[': write '${keyword}[...]'`
      )
    );
  }
  return out;
}

function checkDeclaration(
  node: Extract<ASTNode, { type: 'Declaration' }>,
  context: RuleContext
): Diagnostic[] {
  const gapStart = node.typeExpr.span.end.offset;
  const bracketValue = BRACKET_VALUES.has(node.value.type);
  const gapEnd = bracketValue
    ? openerOffset(node.value, context.source)
    : node.value.span.start.offset;
  if (gapEnd < gapStart) return [];
  const gap = context.source.slice(gapStart, gapEnd);
  // Only plain same-line whitespace is judged; anything else is not a gap
  // this rule understands.
  if (!/^[ \t]*$/.test(gap)) return [];
  if (bracketValue) {
    if (gap === '') return [];
    return [
      diagnostic(
        node,
        context,
        gapStart,
        gapEnd,
        '',
        "No space between a type and its '[': write 'type[...]'"
      ),
    ];
  }
  if (gap === ' ') return [];
  return [
    diagnostic(
      node,
      context,
      gapStart,
      gapEnd,
      ' ',
      'Use exactly one space between a type and its value'
    ),
  ];
}

export const spacingDeclaration: Rule = {
  code: CODE,
  nodeTypes: [
    'Declaration',
    'ListLiteral',
    'Dict',
    'DictLiteral',
    'TupleLiteral',
    'OrderedLiteral',
    'MapLiteral',
  ],
  defaultSeverity: 'info',
  category: 'formatting',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (!isValidSpan(node.span)) return [];
    switch (node.type) {
      case 'Declaration':
        return checkDeclaration(node, context);
      case 'ListLiteral':
      case 'Dict':
      case 'DictLiteral':
      case 'TupleLiteral':
      case 'OrderedLiteral':
      case 'MapLiteral':
        return checkKeywordLiteral(node, context);
      default:
        return [];
    }
  },
};

registeredRules.push(spacingDeclaration);
