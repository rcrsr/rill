/**
 * Suggests using ?? for defaults instead of verbose conditionals. The `??`
 * operator is more concise than a conditional that branches on an existence
 * check just to pick between the checked value and a fallback.
 */

import type { ASTNode, ConditionalNode } from '@rcrsr/rill';
import { walkAst } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

// ============================================================
// HELPERS
// ============================================================

/**
 * Check if a node tree contains an existence check (.?field). Walks via
 * the exported `walkAst` (an iterative, explicit-stack traversal) rather
 * than recursing over `Object.keys` - the previous implementation risked
 * a `RangeError` on deeply nested ASTs and revisited every enumerable key
 * of every node, which is quadratic in subtree size.
 */
function hasExistenceCheck(node: ASTNode): boolean {
  let found = false;
  walkAst(node, (visited) => {
    if (found) return;
    if (visited.type === 'Variable' && visited.existenceCheck !== null) {
      found = true;
    }
  });
  return found;
}

/**
 * Check if a conditional is using the ?? pattern with .? check.
 * Pattern: $dict.?field ? $dict.field ! "default"
 * This should be simplified to: $dict.field ?? "default"
 */
function isVerboseDefaultPattern(node: ConditionalNode): boolean {
  if (!node.elseBranch) return false;
  if (!node.condition) return false;
  if (!hasExistenceCheck(node.condition)) return false;
  return true;
}

// ============================================================
// RULE
// ============================================================

export const useDefaultOperator: Rule = {
  code: 'USE_DEFAULT_OPERATOR',
  nodeTypes: ['Conditional'],
  defaultSeverity: 'info',
  category: 'conditionals',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const conditional = node as ConditionalNode;

    if (isVerboseDefaultPattern(conditional)) {
      return [
        {
          code: 'USE_DEFAULT_OPERATOR',
          message:
            'Use ?? for defaults instead of conditionals: $dict.field ?? "default"',
          severity: 'info',
          location: node.span.start,
          context: extractContextLine(node.span.start.line, context.source),
          fix: null,
        },
      ];
    }

    return [];
  },
};

registeredRules.push(useDefaultOperator);
