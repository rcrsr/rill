/**
 * Prefers `$fn` over `$fn($)` for closure invocation. When a ClosureCall's
 * single argument is a bare $, the pipe form `-> $fn` is preferred.
 */

import type { ASTNode, ClosureCallNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine, isBareReference } from './helpers.js';
import { registeredRules } from './rules-registry.js';

// ============================================================
// RULE
// ============================================================

export const implicitDollarClosure: Rule = {
  code: 'IMPLICIT_DOLLAR_CLOSURE',
  nodeTypes: ['ClosureCall'],
  defaultSeverity: 'info',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const closureCallNode = node as ClosureCallNode;

    if (closureCallNode.args.length === 0) {
      return [];
    }

    if (closureCallNode.args.length > 1) {
      return [];
    }

    const singleArg = closureCallNode.args[0];
    if (
      !singleArg ||
      singleArg.type === 'SpreadArg' ||
      !isBareReference(singleArg)
    ) {
      return [];
    }

    const closureName =
      closureCallNode.accessChain.length > 0
        ? `$${closureCallNode.name}.${closureCallNode.accessChain.join('.')}`
        : `$${closureCallNode.name}`;

    return [
      {
        code: 'IMPLICIT_DOLLAR_CLOSURE',
        message: `Prefer pipe syntax '-> ${closureName}' over explicit '${closureName}($)'`,
        severity: 'info',
        location: {
          line: closureCallNode.span.start.line,
          column: closureCallNode.span.start.column,
          offset: closureCallNode.span.start.offset,
        },
        context: extractContextLine(
          closureCallNode.span.start.line,
          context.source
        ),
        fix: null,
      },
    ];
  },
};

registeredRules.push(implicitDollarClosure);
