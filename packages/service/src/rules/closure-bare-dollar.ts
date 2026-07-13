/**
 * Warns on bare $ in stored closures without parameters. Bare $ in a
 * zero-parameter stored closure has ambiguous binding: it refers to the pipe
 * value at invocation time, not definition time.
 */

import type { ASTNode, ClosureNode, VariableNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';
import { traverseForRules } from './traversal.js';
import { isCollectionOpCall } from './collection-ops.js';

// ============================================================
// HELPERS
// ============================================================

/**
 * Check if a node tree contains bare $ variable references. Treats both
 * Closure literals and collection-op HostCalls as scopes: inside
 * `seq/fan/fold/filter/acc` the bare `$` is the iteration element, not the
 * outer closure's pipe value.
 */
function containsBareReference(node: ASTNode): boolean {
  let found = false;
  let scopeDepth = 0;
  traverseForRules(node, {
    enter(n: ASTNode) {
      if (n.type === 'Closure' || isCollectionOpCall(n)) {
        scopeDepth++;
        return;
      }
      if (scopeDepth > 0) return;
      if (n.type === 'Variable' && (n as VariableNode).isPipeVar) {
        found = true;
      }
    },
    exit(n: ASTNode) {
      if (n.type === 'Closure' || isCollectionOpCall(n)) {
        scopeDepth--;
      }
    },
  });
  return found;
}

// ============================================================
// RULE
// ============================================================

export const closureBareDollar: Rule = {
  code: 'CLOSURE_BARE_DOLLAR',
  nodeTypes: ['Closure'],
  defaultSeverity: 'warning',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const closureNode = node as ClosureNode;

    if (closureNode.params.length > 0) {
      return [];
    }

    const hasBareReference = containsBareReference(closureNode.body);

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
