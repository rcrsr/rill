/**
 * Warns on bare $ in stored closures without parameters. Bare $ in a
 * zero-parameter stored closure has ambiguous binding: it refers to the pipe
 * value at invocation time, not definition time.
 */

import type { ASTNode, ClosureNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

// ============================================================
// RULE
// ============================================================

export const closureBareDollar: Rule = {
  code: 'CLOSURE_BARE_DOLLAR',
  nodeTypes: ['Closure'],
  defaultSeverity: 'warning',
  category: 'closures',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const closureNode = node as ClosureNode;

    if (closureNode.params.length > 0) {
      return [];
    }

    const hasBareReference =
      context.facts.bySubtree.get(closureNode.body)?.hasBareDollar === true;

    if (hasBareReference) {
      return [
        {
          code: 'CLOSURE_BARE_DOLLAR',
          message:
            'Bare $ in stored closure has ambiguous binding. Use explicit capture: $ => $item',
          severity: 'warning',
          location: closureNode.span.start,
          context: extractContextLine(
            closureNode.span.start.line,
            context.source
          ),
          fix: null,
        },
      ];
    }

    return [];
  },
};

registeredRules.push(closureBareDollar);
