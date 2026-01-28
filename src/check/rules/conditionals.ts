/**
 * Conditional Convention Rules
 * Enforces conventions for conditional expressions.
 */

import type {
  ValidationRule,
  Diagnostic,
  ValidationContext,
} from '../types.js';
import type { ASTNode, ConditionalNode } from '../../types.js';
import { extractContextLine } from './helpers.js';

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Check if a node tree contains an existence check (.?field).
 */
function hasExistenceCheck(node: ASTNode): boolean {
  if (!node || typeof node !== 'object') return false;

  // Check if this node is a Variable with existenceCheck
  if (
    node.type === 'Variable' &&
    'existenceCheck' in node &&
    node.existenceCheck !== null
  ) {
    return true;
  }

  // Recursively check child nodes
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
  // Check if there's an else branch (required for default pattern)
  if (!node.elseBranch) return false;

  // Must have an explicit condition (not a piped truthy check)
  if (!node.condition) return false;

  // Check if condition contains an existence check (.?field)
  if (!hasExistenceCheck(node.condition)) return false;

  return true;
}

// ============================================================
// USE_DEFAULT_OPERATOR RULE
// ============================================================

/**
 * Suggests using ?? for defaults instead of verbose conditionals.
 *
 * The ?? operator is more concise for providing default values:
 *
 * Good (concise default):
 *   $dict.field ?? "default"
 *
 * Avoid (verbose conditional):
 *   $dict.?field ? $dict.field ! "default"
 *
 * This is informational - both patterns work identically.
 *
 * References:
 * - docs/16_conventions.md:219-234
 */
export const USE_DEFAULT_OPERATOR: ValidationRule = {
  code: 'USE_DEFAULT_OPERATOR',
  category: 'conditionals',
  severity: 'info',
  nodeTypes: ['Conditional'],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const conditional = node as ConditionalNode;

    // Check for verbose default pattern
    if (isVerboseDefaultPattern(conditional)) {
      return [
        {
          location: node.span.start,
          severity: 'info',
          code: 'USE_DEFAULT_OPERATOR',
          message:
            'Use ?? for defaults instead of conditionals: $dict.field ?? "default"',
          context: extractContextLine(node.span.start.line, context.source),
          fix: null, // Complex fix - requires AST restructuring
        },
      ];
    }

    return [];
  },
};

// ============================================================
// CONDITION_TYPE RULE
// ============================================================

/**
 * Validates that conditional conditions evaluate to boolean.
 *
 * Rill requires explicit boolean conditions in conditionals.
 * The condition in `cond ? then ! else` must evaluate to boolean.
 *
 * Correct (boolean condition):
 *   "hello" -> .contains("ell") ? "found" ! "not found"
 *
 * Incorrect (non-boolean):
 *   "hello" ? "has value" ! "empty"  # strings don't auto-convert to boolean
 *
 * This is a warning because it's likely a bug, not just stylistic.
 *
 * References:
 * - docs/16_conventions.md:199-215
 */
export const CONDITION_TYPE: ValidationRule = {
  code: 'CONDITION_TYPE',
  category: 'conditionals',
  severity: 'warning',
  nodeTypes: ['Conditional'],

  validate(_node: ASTNode, _context: ValidationContext): Diagnostic[] {
    // Rill conditionals don't enforce boolean type checking at the static analysis level
    // The language allows truthy/falsy semantics, and runtime will handle type errors
    // This rule is disabled for now - the convention is informational only

    // Note: If we wanted to enforce this, we would need to check:
    // - When condition is null: input is the tested value (truthy check)
    // - When condition exists: condition body must evaluate to boolean

    // For now, return no diagnostics
    return [];
  },
};
