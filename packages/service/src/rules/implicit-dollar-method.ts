/**
 * Detects explicit $.method() patterns replaceable with the implicit
 * .method form. Flags method calls where the receiver is a bare $ (pipe
 * variable) and the method is first in the chain.
 *
 * `MethodCallNode.receiverSpan` is a `SourceSpan` (position range), not an
 * AST node, so bare-$ detection here reads raw source characters at fixed
 * offsets rather than traversing a subtree. This is O(1) per node -
 * constant-size character comparisons, no regex - and stays linear-time
 * over the whole source.
 */

import type { ASTNode, MethodCallNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

// ============================================================
// RULE
// ============================================================

export const implicitDollarMethod: Rule = {
  code: 'IMPLICIT_DOLLAR_METHOD',
  nodeTypes: ['MethodCall'],
  defaultSeverity: 'info',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const methodNode = node as MethodCallNode;

    // No receiverSpan means implicit receiver (already correct form).
    if (methodNode.receiverSpan === null) {
      return [];
    }

    // Detect bare $ receiver by analyzing the receiverSpan. For bare $, the
    // span is either zero-width or a single-char span covering just $.
    const receiverSpan = methodNode.receiverSpan;
    const spanLength = receiverSpan.end.offset - receiverSpan.start.offset;

    // Filters out chains like $.trim().upper() where the second method has
    // a receiverSpan covering "$.trim()."
    if (spanLength > 1) {
      return [];
    }

    const offset = receiverSpan.start.offset;
    const charAtOffset = context.source[offset];
    const nextChar = context.source[offset + 1];

    // Must be '$' followed by '.' (method call), distinguishing $.method()
    // from $var.method().
    if (charAtOffset !== '$' || nextChar !== '.') {
      return [];
    }

    const suggestedCode =
      methodNode.args.length === 0
        ? `.${methodNode.name}`
        : `.${methodNode.name}()`;

    return [
      {
        code: 'IMPLICIT_DOLLAR_METHOD',
        message: `Prefer implicit '${suggestedCode}' over explicit '$.${methodNode.name}()'`,
        severity: 'info',
        location: {
          line: methodNode.span.start.line,
          column: methodNode.span.start.column,
          offset: methodNode.span.start.offset,
        },
        context: extractContextLine(methodNode.span.start.line, context.source),
        fix: null,
      },
    ];
  },
};

registeredRules.push(implicitDollarMethod);
