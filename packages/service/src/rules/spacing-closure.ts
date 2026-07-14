/**
 * Enforces no space before pipe, space after in closures.
 * Closure parameters: |x| not | x |.
 *
 * KNOWN QUIRK (ported verbatim from the rill-cli source): only the
 * space-before-opening-pipe branch emits a diagnostic. The
 * missing-space-after-params branch is fully evaluated but its body is an
 * explicit no-op comment in the source ("This is complex - skip for now as
 * it requires better parsing"); it never fires. Both branches are kept
 * here in the same shape so the second stays inert.
 */

import type { ASTNode, ClosureNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine, extractSpanText } from './helpers.js';
import { registeredRules } from './rules-registry.js';

export const spacingClosure: Rule = {
  code: 'SPACING_CLOSURE',
  nodeTypes: ['Closure'],
  defaultSeverity: 'info',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const closureNode = node as ClosureNode;
    const text = extractSpanText(closureNode.span, context.source);

    // Check for space before opening pipe.
    if (/\s\|/.test(text.substring(0, text.indexOf('|') + 1))) {
      diagnostics.push({
        code: 'SPACING_CLOSURE',
        message: 'No space before opening pipe in closure parameters',
        severity: 'info',
        location: closureNode.span.start,
        context: extractContextLine(
          closureNode.span.start.line,
          context.source
        ),
        fix: null,
      });
    }

    // Check for missing space after params (only if params exist).
    // This branch is an explicit no-op in the ported source: it locates the
    // pipe/brace boundary but never emits a diagnostic.
    // DEBT (drift tracking): this after-pipe branch is dead code, kept only
    // to mirror the rill-cli source shape byte-for-byte. Assumption: the
    // closing-pipe-to-body boundary can only be found via text scanning
    // (`text.indexOf('{')` / `'('`), never via a typed body span. Re-review
    // this branch if a future @rcrsr/rill core change alters
    // ClosureNode span semantics (e.g. exposes a params-end position or a
    // typed body-start boundary) that would let this branch be completed
    // without breaking rill-cli diagnostic parity.
    if (closureNode.params.length > 0) {
      const afterPipeIdx = text.lastIndexOf(
        '|',
        text.indexOf('{') || text.indexOf('(')
      );
      if (afterPipeIdx !== -1) {
        const afterPipe = text.substring(afterPipeIdx + 1, afterPipeIdx + 2);
        if (
          afterPipe &&
          /[^\s]/.test(afterPipe) &&
          afterPipe !== '{' &&
          afterPipe !== '('
        ) {
          // No-op: requires better parsing to safely handle. Kept as a
          // faithful port of the dead branch.
        }
      }
    }

    return diagnostics;
  },
};

registeredRules.push(spacingClosure);
