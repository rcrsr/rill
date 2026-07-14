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
    // DEBT (drift tracking): this assumes `(node as ClosureNode).body` is
    // always a Block node whose span.end lands just past a literal `}`.
    // Ported verbatim from rill-cli, where closure bodies were always
    // block-shaped. In the current @rcrsr/rill core, a closure body can
    // also be a GroupedExprNode (e.g. `|x| ($x * 2)`), whose span.end lands
    // past a `)`, not a `}`. For such closures, closeEnd.column - 3 reads
    // the character before `)` rather than before `}`, so this rule may
    // over-fire (or mis-locate) on grouped-body closures relative to
    // rill-cli parity. Re-review if a future @rcrsr/rill core change alters
    // closure-body node shape (e.g. normalizes grouped bodies into Block)
    // or ClosureNode span semantics.
    const closeSpan =
      node.type === 'Closure' ? (node as ClosureNode).body.span : span;
    const closeEnd = closeSpan.end;
    const closeLineActual = lines[closeEnd.line - 1] ?? '';
    // closeEnd.column is 1-indexed and points AFTER the }, so:
    // - } is at 0-index: closeEnd.column - 2
    // - Character before } is at 0-index: closeEnd.column - 3
    const charBeforeClose = closeLineActual[closeEnd.column - 3];
    const isCloseOnOwnLine = /^\s*$/.test(
      closeLineActual.substring(0, closeEnd.column - 2)
    );
    if (charBeforeClose && !/\s/.test(charBeforeClose) && !isCloseOnOwnLine) {
      diagnostics.push({
        code: 'SPACING_BRACES',
        message: 'Space required before closing brace }',
        severity: 'info',
        location: span.end,
        context: extractContextLine(span.end.line, context.source),
        fix: null,
      });
    }

    return diagnostics;
  },
};

registeredRules.push(spacingBraces);
