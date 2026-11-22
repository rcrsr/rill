/**
 * Reports a space between a control keyword and its option list.
 *
 * `retry (attempts: 3) { ... }` parses as `retry(attempts: 3) { ... }`, as a
 * space before a call's parentheses does. Nothing else in the toolchain
 * reports the spaced form, so this rule is the only signal, at info level.
 *
 * Covers `guard`, `retry`, `timeout`, `pass`, and the loop keyword `do`.
 * Only same-line gaps are checked.
 */

import type { ASTNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { advancePosition, extractContextLine, isValidSpan } from './helpers.js';
import { registeredRules } from './rules-registry.js';

const CODE = 'SPACING_OPTIONS';

/** The keyword, then same-line spaces or tabs, ending right before the `(`. */
const KEYWORD_BEFORE_OPTIONS =
  /(?<![\w$.])(guard|retry|timeout|pass|do)([ \t]+)$/;

export const spacingOptions: Rule = {
  code: CODE,
  nodeTypes: [
    'GuardBlock',
    'RetryBlock',
    'TimeoutBlock',
    'PassBlock',
    'WhileLoop',
    'DoWhileLoop',
  ],
  defaultSeverity: 'info',
  category: 'formatting',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (
      node.type !== 'GuardBlock' &&
      node.type !== 'RetryBlock' &&
      node.type !== 'TimeoutBlock' &&
      node.type !== 'PassBlock' &&
      node.type !== 'WhileLoop' &&
      node.type !== 'DoWhileLoop'
    ) {
      return [];
    }
    const options = node.options;
    if (options === null || !isValidSpan(options.span)) return [];

    const opener = options.span.start.offset;
    const before = KEYWORD_BEFORE_OPTIONS.exec(
      context.source.slice(Math.max(0, opener - 32), opener)
    );
    if (before === null) return [];

    const keyword = before[1] ?? '';
    const gapStart = opener - (before[2] ?? '').length;
    const start = advancePosition(node.span.start, context.source, gapStart);
    return [
      {
        code: CODE,
        message: `No space between '${keyword}' and '(': write '${keyword}(...)'`,
        severity: 'info',
        location: start,
        context: extractContextLine(start.line, context.source),
        fix: {
          description: 'Remove the space before the option list',
          applicable: true,
          range: { start, end: options.span.start },
          replacement: '',
        },
      },
    ];
  },
};

registeredRules.push(spacingOptions);
