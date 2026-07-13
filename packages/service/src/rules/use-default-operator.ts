/**
 * Suggests using ?? for defaults instead of verbose conditionals. The `??`
 * operator is more concise than a conditional that branches on an existence
 * check just to pick between the checked value and a fallback.
 */

import type { ASTNode, ConditionalNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

// ============================================================
// HELPERS
// ============================================================

/** Check if a node tree contains an existence check (.?field). */
function hasExistenceCheck(node: ASTNode): boolean {
  if (!node || typeof node !== 'object') return false;

  if (
    node.type === 'Variable' &&
    'existenceCheck' in node &&
    node.existenceCheck !== null
  ) {
    return true;
  }

  for (const key of Object.keys(node)) {
    const value = (node as unknown as Record<string, unknown>)[key];
    if (value && typeof value === 'object') {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (hasExistenceCheck(item as ASTNode)) return true;
        }
      } else {
        if (hasExistenceCheck(value as ASTNode)) return true;
      }
    }
  }

  return false;
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
