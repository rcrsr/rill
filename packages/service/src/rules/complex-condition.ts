/**
 * Warns on complex nested boolean conditions. Conditions with several
 * chained boolean operators, deep boolean nesting, or excessive parenthetical
 * nesting are hard to read; extracting sub-conditions to named checks
 * clarifies intent.
 */

import type {
  ASTNode,
  BinaryExprNode,
  ConditionalNode,
  GroupedExprNode,
  PipeChainNode,
  PostfixExprNode,
  UnaryExprNode,
} from '@rcrsr/rill';
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
    const binaryNode = node as BinaryExprNode;
    if (binaryNode.op === '&&' || binaryNode.op === '||') {
      count = 1;
    }

    count += countBooleanOperators(binaryNode.left);
    count += countBooleanOperators(binaryNode.right);
  }

  switch (node.type) {
    case 'UnaryExpr': {
      const unaryNode = node as UnaryExprNode;
      count += countBooleanOperators(unaryNode.operand);
      break;
    }

    case 'GroupedExpr': {
      const groupedNode = node as GroupedExprNode;
      count += countBooleanOperators(groupedNode.expression);
      break;
    }

    case 'PipeChain': {
      const pipeNode = node as PipeChainNode;
      if (pipeNode.head) count += countBooleanOperators(pipeNode.head);
      if (pipeNode.pipes) {
        for (const pipe of pipeNode.pipes) {
          count += countBooleanOperators(pipe);
        }
      }
      break;
    }

    case 'PostfixExpr': {
      const postfixNode = node as PostfixExprNode;
      if (postfixNode.primary)
        count += countBooleanOperators(postfixNode.primary);
      break;
    }
  }

  return count;
}

/** Calculate maximum nesting depth of boolean operators. */
function getBooleanNestingDepth(node: ASTNode, currentDepth = 0): number {
  let maxDepth = currentDepth;

  if (node.type === 'BinaryExpr') {
    const binaryNode = node as BinaryExprNode;
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
      const unaryNode = node as UnaryExprNode;
      maxDepth = Math.max(
        maxDepth,
        getBooleanNestingDepth(unaryNode.operand, currentDepth)
      );
      break;
    }

    case 'GroupedExpr': {
      const groupedNode = node as GroupedExprNode;
      maxDepth = Math.max(
        maxDepth,
        getBooleanNestingDepth(groupedNode.expression, currentDepth)
      );
      break;
    }

    case 'PipeChain': {
      const pipeNode = node as PipeChainNode;
      if (pipeNode.head) {
        maxDepth = Math.max(
          maxDepth,
          getBooleanNestingDepth(pipeNode.head, currentDepth)
        );
      }
      if (pipeNode.pipes) {
        for (const pipe of pipeNode.pipes) {
          maxDepth = Math.max(
            maxDepth,
            getBooleanNestingDepth(pipe, currentDepth)
          );
        }
      }
      break;
    }

    case 'PostfixExpr': {
      const postfixNode = node as PostfixExprNode;
      if (postfixNode.primary) {
        maxDepth = Math.max(
          maxDepth,
          getBooleanNestingDepth(postfixNode.primary, currentDepth)
        );
      }
      break;
    }
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
      const groupedNode = n as GroupedExprNode;
      const newDepth = consecutiveDepth + 1;
      maxDepth = Math.max(maxDepth, newDepth);
      traverse(groupedNode.expression, newDepth);
    } else if (n.type === 'PipeChain') {
      const pipeNode = n as PipeChainNode;
      if (pipeNode.head && (!pipeNode.pipes || pipeNode.pipes.length === 0)) {
        traverse(pipeNode.head, consecutiveDepth);
      } else {
        if (pipeNode.head) traverse(pipeNode.head, 0);
        if (pipeNode.pipes) {
          for (const pipe of pipeNode.pipes) {
            traverse(pipe, 0);
          }
        }
      }
    } else if (n.type === 'PostfixExpr') {
      const postfixNode = n as PostfixExprNode;
      if (
        postfixNode.primary &&
        (!postfixNode.methods || postfixNode.methods.length === 0)
      ) {
        traverse(postfixNode.primary, consecutiveDepth);
      } else {
        if (postfixNode.primary) traverse(postfixNode.primary, 0);
      }
    } else {
      if (n.type === 'BinaryExpr') {
        const binaryNode = n as BinaryExprNode;
        traverse(binaryNode.left, 0);
        traverse(binaryNode.right, 0);
      } else if (n.type === 'UnaryExpr') {
        const unaryNode = n as UnaryExprNode;
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

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const conditionalNode = node as ConditionalNode;
    const condition = conditionalNode.condition;

    if (!condition) {
      return [];
    }

    let unwrappedCondition: ASTNode = condition;
    if (unwrappedCondition.type === 'GroupedExpr') {
      unwrappedCondition = (unwrappedCondition as GroupedExprNode).expression;
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
