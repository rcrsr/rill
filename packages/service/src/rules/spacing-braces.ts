/**
 * Enforces space after { and before } in blocks.
 * Braces for blocks, closures, etc. should have internal spacing.
 */

import type { ASTNode, ClosureNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine, getSplitLines } from './helpers.js';
import { registeredRules } from './rules-registry.js';

export const spacingBraces: Rule = {
  code: 'SPACING_BRACES',
  nodeTypes: ['Block', 'Closure'],
  defaultSeverity: 'info',
  category: 'formatting',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const span = node.span;
    const lines = getSplitLines(context.source);

    const openLine = lines[span.start.line - 1] ?? '';

    // Check for opening brace without space after.
    // Only examine the opening line (from the { onward).
    // Use ^ anchor to only check the block's opening brace, not string
    // interpolation.
    const openFrom = openLine.substring(span.start.column - 1);
    if (/^\{[^\s\n]/.test(openFrom)) {
      diagnostics.push({
        code: 'SPACING_BRACES',
        message: 'Space required after opening brace {',
        severity: 'info',
        location: span.start,
        context: extractContextLine(span.start.line, context.source),
        fix: null,
      });
    }

    // Check for closing brace without space before.
    // For Closure nodes with return type annotations, span.end extends past
    // } to include the type annotation. Use body.span.end to find the
    // actual }.
    // A closure body is not always a Block whose span.end lands just past a
    // literal `}`: it can also be a GroupedExprNode (e.g. `|x| ($x * 2)`),
    // whose span.end lands past a `)`. The `closeChar === '}'` guard below
    // is what keeps those out of this check.
    const closeSpan =
      node.type === 'Closure' ? (node as ClosureNode).body.span : span;
    const closeEnd = closeSpan.end;
    const closeLineActual = lines[closeEnd.line - 1] ?? '';
    // closeEnd.column is 1-indexed and points AFTER the }, so:
    // - } is at 0-index: closeEnd.column - 2
    // - Character before } is at 0-index: closeEnd.column - 3
    const closeChar = closeLineActual[closeEnd.column - 2];
    const charBeforeClose = closeLineActual[closeEnd.column - 3];
    const isCloseOnOwnLine = /^\s*$/.test(
      closeLineActual.substring(0, closeEnd.column - 2)
    );
    // Only fire when the body span actually ends at a literal `}`. Grouped
    // closure bodies (e.g. `|x| ($x * 2)`) end at `)`, and closure return
    // type annotations push `span.end` past the annotation, neither of
    // which is a closing brace to space-check.
    if (
      closeChar === '}' &&
      charBeforeClose &&
      !/\s/.test(charBeforeClose) &&
      !isCloseOnOwnLine
    ) {
      diagnostics.push({
        code: 'SPACING_BRACES',
        message: 'Space required before closing brace }',
        severity: 'info',
        location: closeEnd,
        context: extractContextLine(closeEnd.line, context.source),
        fix: null,
      });
    }

    return diagnostics;
  },
};

registeredRules.push(spacingBraces);
