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
const SPACED_KEYWORD = /^(list|dict|tuple|ordered)([ \t]+)\[/;

const DOCUMENT_START = { line: 1, column: 1, offset: 0 } as const;

const BRACKET_VALUES: ReadonlySet<string> = new Set([
  'ListLiteral',
  'Dict',
  'DictLiteral',
  'TupleLiteral',
  'OrderedLiteral',
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
const KEYWORD_BEFORE_OPENER = /(?<![\w$.])(list|dict|tuple|ordered)([ \t]+)$/;

function checkKeywordLiteral(
  node: ASTNode,
  context: RuleContext
): Diagnostic[] {
  const startOffset = node.span.start.offset;
  let keyword: string;
  let gapStart: number;
  let gapEnd: number;
  const atStart = SPACED_KEYWORD.exec(
    context.source.slice(startOffset, startOffset + 64)
  );
  if (atStart !== null) {
    keyword = atStart[1] ?? '';
    gapStart = startOffset + keyword.length;
    gapEnd = gapStart + (atStart[2] ?? '').length;
  } else {
    const opener = openerOffset(node, context.source);
    if (opener < 0) return [];
    const before = KEYWORD_BEFORE_OPENER.exec(
      context.source.slice(Math.max(0, opener - 64), opener)
    );
    if (before === null) return [];
    keyword = before[1] ?? '';
    gapEnd = opener;
    gapStart = opener - (before[2] ?? '').length;
  }
  return [
    diagnostic(
      node,
      context,
      gapStart,
      gapEnd,
      '',
      `No space between '${keyword}' and '[': write '${keyword}[...]'`
    ),
  ];
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
        return checkKeywordLiteral(node, context);
      default:
        return [];
    }
  },
};

registeredRules.push(spacingDeclaration);
