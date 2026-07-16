/**
 * Enforces .empty method for emptiness checks.
 * Direct string comparison with "" is not idiomatic and may not work
 * correctly in all contexts. Use .empty method instead.
 *
 * Valid patterns:
 * - $str -> .empty (check if empty)
 * - $str -> .empty ? "yes" ! "no" (conditional)
 *
 * Discouraged:
 * - $str == "" (direct comparison)
 * - $str != "" (direct comparison)
 */

import type { ASTNode, BinaryExprNode, StringLiteralNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

/** Check if a node is an empty string literal. */
function isEmptyStringLiteral(node: ASTNode): boolean {
  if (node.type !== 'StringLiteral') {
    return false;
  }

  const stringNode = node as StringLiteralNode;

  if (stringNode.parts.length === 0) {
    return true;
  }

  if (stringNode.parts.length === 1) {
    const part = stringNode.parts[0];
    return typeof part === 'string' && part === '';
  }

  return false;
}

export const useEmptyMethod: Rule = {
  code: 'USE_EMPTY_METHOD',
  nodeTypes: ['BinaryExpr'],
  defaultSeverity: 'warning',
  category: 'strings',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const binaryNode = node as BinaryExprNode;

    if (binaryNode.op !== '==' && binaryNode.op !== '!=') {
      return [];
    }

    const { left, right } = binaryNode;

    const leftIsEmpty =
      left.type === 'PostfixExpr' && isEmptyStringLiteral(left.primary);
    const rightIsEmpty =
      right.type === 'PostfixExpr' && isEmptyStringLiteral(right.primary);

    if (leftIsEmpty || rightIsEmpty) {
      const suggestedMethod = binaryNode.op === '==' ? '.empty' : '.empty -> !';

      return [
        {
          code: 'USE_EMPTY_METHOD',
          message: `Use ${suggestedMethod} for emptiness checks instead of comparing with ""`,
          severity: 'warning',
          location: binaryNode.span.start,
          context: extractContextLine(
            binaryNode.span.start.line,
            context.source
          ),
          fix: null,
        },
      ];
    }

    return [];
  },
};

registeredRules.push(useEmptyMethod);
