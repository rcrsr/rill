/**
 * String Handling Convention Rules
 * Enforces string handling best practices from docs/16_conventions.md:318-352.
 */

import type {
  ValidationRule,
  Diagnostic,
  ValidationContext,
} from '../types.js';
import type {
  ASTNode,
  StringLiteralNode,
  BinaryExprNode,
} from '../../types.js';
import { extractContextLine } from './helpers.js';

// ============================================================
// USE_EMPTY_METHOD RULE
// ============================================================

/**
 * Enforces .empty method for emptiness checks.
 * Direct string comparison with "" is not idiomatic and may not work
 * correctly in all contexts. Use .empty method instead.
 *
 * Detection:
 * - BinaryExpr with == or != operator
 * - One side is empty string literal ""
 * - Suggests using .empty method
 *
 * Valid patterns:
 * - $str -> .empty (check if empty)
 * - $str -> .empty ? "yes" ! "no" (conditional)
 *
 * Discouraged:
 * - $str == "" (direct comparison)
 * - $str != "" (direct comparison)
 *
 * References:
 * - docs/16_conventions.md:333-345
 */
export const USE_EMPTY_METHOD: ValidationRule = {
  code: 'USE_EMPTY_METHOD',
  category: 'strings',
  severity: 'warning',
  nodeTypes: ['BinaryExpr'],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const binaryNode = node as BinaryExprNode;

    // Only check equality operators
    if (binaryNode.op !== '==' && binaryNode.op !== '!=') {
      return [];
    }

    // left and right are PostfixExpr - check their primaries
    const left = binaryNode.left as any;
    const right = binaryNode.right as any;

    const leftIsEmpty =
      left.type === 'PostfixExpr' && isEmptyStringLiteral(left.primary);
    const rightIsEmpty =
      right.type === 'PostfixExpr' && isEmptyStringLiteral(right.primary);

    if (leftIsEmpty || rightIsEmpty) {
      const suggestedMethod = binaryNode.op === '==' ? '.empty' : '.empty -> !';

      return [
        {
          location: binaryNode.span.start,
          severity: 'warning',
          code: 'USE_EMPTY_METHOD',
          message: `Use ${suggestedMethod} for emptiness checks instead of comparing with ""`,
          context: extractContextLine(
            binaryNode.span.start.line,
            context.source
          ),
          fix: null, // Auto-fix would require expression reconstruction
        },
      ];
    }

    return [];
  },
};

/**
 * Check if a node is an empty string literal.
 */
function isEmptyStringLiteral(node: ASTNode): boolean {
  if (node.type !== 'StringLiteral') {
    return false;
  }

  const stringNode = node as StringLiteralNode;

  // Check if all parts are empty strings (no interpolations)
  if (stringNode.parts.length === 0) {
    return true;
  }

  if (stringNode.parts.length === 1) {
    const part = stringNode.parts[0];
    return typeof part === 'string' && part === '';
  }

  return false;
}
