/**
 * Enforces 2-space indent for continued lines.
 * Pipe chains should indent continuation lines by 2 spaces.
 *
 * KNOWN QUIRK (ported verbatim from the rill-cli source): the diagnostic
 * location is synthetic - `{ line: span.start.line + i, column: 1, offset: 0 }`
 * - rather than a real span-derived offset, and `context` is the trimmed
 * continuation line directly rather than routed through
 * `extractContextLine`. Both are preserved exactly.
 *
 * KNOWN LIMITATION (also ported from the source): this rule validates
 * multi-line pipe chains where the pipe operator (`->`) and its target
 * appear on the same line. The parser requires pipe targets to be on the
 * same line as the `->` operator, so patterns like `value ->\n  .method()`
 * are invalid rill syntax.
 */

import type { ASTNode, PipeChainNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractSpanText } from './helpers.js';
import { registeredRules } from './rules-registry.js';

export const indentContinuation: Rule = {
  code: 'INDENT_CONTINUATION',
  nodeTypes: ['PipeChain'],
  defaultSeverity: 'info',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const pipeNode = node as PipeChainNode;

    // Single-line chain: nothing to check.
    if (pipeNode.span.start.line === pipeNode.span.end.line) {
      return [];
    }

    const text = extractSpanText(pipeNode.span, context.source);
    const lines = text.split('\n');

    if (lines.length > 1) {
      // Check each continuation line (skip first line which establishes
      // baseline).
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];

        // Empty continuation line: skip.
        if (!line) continue;

        const indent = line.match(/^(\s*)/)?.[1] || '';

        // Continuation = line starting with -> (after whitespace).
        // Should have at least 2 spaces for continuation.
        if (line.trim().startsWith('->') && indent.length < 2) {
          diagnostics.push({
            code: 'INDENT_CONTINUATION',
            message: 'Continuation lines should be indented by 2 spaces',
            severity: 'info',
            location: {
              line: pipeNode.span.start.line + i,
              column: 1,
              offset: 0,
            },
            context: line.trim(),
            fix: null,
          });
        }
      }
    }

    return diagnostics;
  },
};

registeredRules.push(indentContinuation);
