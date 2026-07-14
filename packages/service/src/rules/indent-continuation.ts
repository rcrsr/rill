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

/**
 * Visual column width of an indent string, expanding tabs to the next
 * multiple of 4 columns rather than counting each tab as a single
 * character. A tab-indented continuation line is visibly indented even
 * though `indent.length` alone reports 1.
 */
function visualIndentWidth(indent: string, tabWidth = 4): number {
  let width = 0;
  for (const char of indent) {
    width =
      char === '\t' ? (Math.floor(width / tabWidth) + 1) * tabWidth : width + 1;
  }
  return width;
}

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
        // Should have at least 2 columns of indent. Tabs are expanded to a
        // column width before measuring, so `indent.length` (a character
        // count) doesn't under-count a tab-indented line as 1 column wide.
        if (line.trim().startsWith('->') && visualIndentWidth(indent) < 2) {
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
