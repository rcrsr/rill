/**
 * Prefers `foo` over `foo($)` for host function calls. When a HostCall's
 * single argument is a bare $, the pipe form `-> foo` is preferred.
 */

import type { ASTNode, HostCallNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { bareDollarSingleArgDiagnostic, isBareReference } from './helpers.js';
import { registeredRules } from './rules-registry.js';

// ============================================================
// RULE
// ============================================================

export const implicitDollarFunction: Rule = {
  code: 'IMPLICIT_DOLLAR_FUNCTION',
  nodeTypes: ['HostCall'],
  defaultSeverity: 'info',
  category: 'formatting',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const hostCallNode = node as HostCallNode;

    if (hostCallNode.args.length === 0) {
      return [];
    }

    if (hostCallNode.args.length > 1) {
      return [];
    }

    const singleArg = hostCallNode.args[0];
    if (
      !singleArg ||
      singleArg.type === 'SpreadArg' ||
      !isBareReference(singleArg)
    ) {
      return [];
    }

    return bareDollarSingleArgDiagnostic(
      'IMPLICIT_DOLLAR_FUNCTION',
      hostCallNode.name,
      hostCallNode,
      context
    );
  },
};

registeredRules.push(implicitDollarFunction);
