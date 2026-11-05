/**
 * Warns on complex nested boolean conditions. Conditions with several
 * chained boolean operators, deep boolean nesting, or excessive parenthetical
 * nesting are hard to read; extracting sub-conditions to named checks
 * clarifies intent.
 */

import type { ASTNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

// ============================================================
// HELPERS
// ============================================================

/** Count boolean operators (&&, ||) in an expression tree. */
function countBooleanOperators(node: ASTNode): number {
  let count = 0;

  if (node.type === 'BinaryExpr') {
    const binaryNode = node;
    if (binaryNode.op === '&&' || binaryNode.op === '||') {
      count = 1;
    }

    count += countBooleanOperators(binaryNode.left);
    count += countBooleanOperators(binaryNode.right);
  }

  switch (node.type) {
    case 'UnaryExpr': {
      const unaryNode = node;
      count += countBooleanOperators(unaryNode.operand);
      break;
    }

    case 'GroupedExpr': {
      const groupedNode = node;
      count += countBooleanOperators(groupedNode.expression);
      break;
    }

    case 'PipeChain': {
      const pipeNode = node;
      count += countBooleanOperators(pipeNode.head);
      for (const pipe of pipeNode.pipes) {
        count += countBooleanOperators(pipe);
      }
      break;
    }

    case 'PostfixExpr': {
      const postfixNode = node;
      count += countBooleanOperators(postfixNode.primary);
      break;
    }

    default:
      break;
  }

  return count;
}

/** Calculate maximum nesting depth of boolean operators. */
function getBooleanNestingDepth(node: ASTNode, currentDepth = 0): number {
  let maxDepth = currentDepth;

  if (node.type === 'BinaryExpr') {
    const binaryNode = node;
    const depth =
      binaryNode.op === '&&' || binaryNode.op === '||'
        ? currentDepth + 1
        : currentDepth;

    const leftDepth = getBooleanNestingDepth(binaryNode.left, depth);
    const rightDepth = getBooleanNestingDepth(binaryNode.right, depth);

    maxDepth = Math.max(maxDepth, leftDepth, rightDepth);
  }

  switch (node.type) {
    case 'UnaryExpr': {
      const unaryNode = node;
      maxDepth = Math.max(
        maxDepth,
        getBooleanNestingDepth(unaryNode.operand, currentDepth)
      );
      break;
    }

    case 'GroupedExpr': {
      const groupedNode = node;
      maxDepth = Math.max(
        maxDepth,
        getBooleanNestingDepth(groupedNode.expression, currentDepth)
      );
      break;
    }

    case 'PipeChain': {
      const pipeNode = node;
      maxDepth = Math.max(
        maxDepth,
        getBooleanNestingDepth(pipeNode.head, currentDepth)
      );
      for (const pipe of pipeNode.pipes) {
        maxDepth = Math.max(
          maxDepth,
          getBooleanNestingDepth(pipe, currentDepth)
        );
      }
      break;
    }

    case 'PostfixExpr': {
      const postfixNode = node;
      maxDepth = Math.max(
        maxDepth,
        getBooleanNestingDepth(postfixNode.primary, currentDepth)
      );
      break;
    }

    default:
      break;
  }

  return maxDepth;
}

/**
 * Calculate maximum consecutive GroupedExpr (parenthetical) nesting depth.
 * Counts chains of nested parentheses like ((($x))). Treats PipeChain
 * (single head) and PostfixExpr (primary only) as transparent wrappers.
 */
function getParenNestingDepth(node: ASTNode): number {
  let maxDepth = 0;

  function traverse(n: ASTNode, consecutiveDepth: number): void {
    if (n.type === 'GroupedExpr') {
      const groupedNode = n;
      const newDepth = consecutiveDepth + 1;
      maxDepth = Math.max(maxDepth, newDepth);
      traverse(groupedNode.expression, newDepth);
    } else if (n.type === 'PipeChain') {
      const pipeNode = n;
      if (pipeNode.pipes.length === 0) {
        traverse(pipeNode.head, consecutiveDepth);
      } else {
        traverse(pipeNode.head, 0);
        for (const pipe of pipeNode.pipes) {
          traverse(pipe, 0);
        }
      }
    } else if (n.type === 'PostfixExpr') {
      const postfixNode = n;
      if (postfixNode.methods.length === 0) {
        traverse(postfixNode.primary, consecutiveDepth);
      } else {
        traverse(postfixNode.primary, 0);
      }
    } else {
      if (n.type === 'BinaryExpr') {
        const binaryNode = n;
        traverse(binaryNode.left, 0);
        traverse(binaryNode.right, 0);
      } else if (n.type === 'UnaryExpr') {
        const unaryNode = n;
        traverse(unaryNode.operand, 0);
      }
    }
  }

  traverse(node, 0);
  return maxDepth;
}

// ============================================================
// RULE
// ============================================================

export const complexCondition: Rule = {
  code: 'COMPLEX_CONDITION',
  nodeTypes: ['Conditional'],
  defaultSeverity: 'info',
  category: 'anti-patterns',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (node.type !== 'Conditional') return [];
    const conditionalNode = node;
    const condition = conditionalNode.condition;

    if (condition === null) {
      return [];
    }

    let unwrappedCondition: ASTNode = condition;
    if (unwrappedCondition.type === 'GroupedExpr') {
      unwrappedCondition = unwrappedCondition.expression;
    }

    const operatorCount = countBooleanOperators(unwrappedCondition);
    const booleanDepth = getBooleanNestingDepth(unwrappedCondition);
    const parenDepth = getParenNestingDepth(unwrappedCondition);

    if (operatorCount >= 3 || booleanDepth > 2 || parenDepth > 2) {
      return [
        {
          code: 'COMPLEX_CONDITION',
          message:
            'Complex condition with multiple operators. Extract to named checks for clarity.',
          severity: 'info',
          location: conditionalNode.span.start,
          context: extractContextLine(
            conditionalNode.span.start.line,
            context.source
          ),
          fix: null,
        },
      ];
    }

    return [];
  },
};

registeredRules.push(complexCondition);
