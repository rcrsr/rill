/**
 * Anti-Pattern Rules
 * Enforces best practices from docs/16_conventions.md:411-462.
 */

import type {
  ValidationRule,
  Diagnostic,
  ValidationContext,
} from '../types.js';
import type {
  ASTNode,
  CaptureNode,
  ConditionalNode,
  GroupedExprNode,
} from '../../types.js';
import { extractContextLine } from './helpers.js';

// ============================================================
// AVOID_REASSIGNMENT RULE
// ============================================================

/**
 * Warns on variable reassignment patterns.
 * Variables lock to their first type, and reassignment suggests confusing
 * flow control. Prefer functional style or new variables.
 *
 * Detection:
 * - Capture node (:> $var) where $var already exists in validation context
 * - Tracks variables seen during validation pass
 *
 * Valid alternatives:
 * - Use new variable: $result1, $result2
 * - Functional chains: value -> op1 -> op2
 *
 * References:
 * - docs/16_conventions.md:413-424
 */
export const AVOID_REASSIGNMENT: ValidationRule = {
  code: 'AVOID_REASSIGNMENT',
  category: 'anti-patterns',
  severity: 'warning',
  nodeTypes: ['Capture'],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const captureNode = node as CaptureNode;
    const varName = captureNode.name;

    // Check if this variable was already captured before
    if (context.variables.has(varName)) {
      const firstLocation = context.variables.get(varName)!;

      return [
        {
          location: captureNode.span.start,
          severity: 'warning',
          code: 'AVOID_REASSIGNMENT',
          message: `Variable reassignment detected: '$${varName}' first defined at line ${firstLocation.line}. Prefer new variable or functional style.`,
          context: extractContextLine(
            captureNode.span.start.line,
            context.source
          ),
          fix: null, // Cannot auto-fix without understanding intent
        },
      ];
    }

    return [];
  },
};

// ============================================================
// COMPLEX_CONDITION RULE
// ============================================================

/**
 * Warns on complex nested boolean conditions.
 * Complex conditions with multiple nested operators are hard to read.
 * Extract to named variables for clarity.
 *
 * Detection:
 * - Conditional nodes with conditions containing 3+ boolean operators (&&, ||)
 * - Nesting depth > 2 for boolean expressions
 *
 * Valid alternatives:
 * - Extract sub-conditions to named variables
 * - Split complex checks into multiple smaller checks
 *
 * References:
 * - docs/16_conventions.md:451-461
 */
export const COMPLEX_CONDITION: ValidationRule = {
  code: 'COMPLEX_CONDITION',
  category: 'anti-patterns',
  severity: 'info',
  nodeTypes: ['Conditional'],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const conditionalNode = node as ConditionalNode;
    const condition = conditionalNode.condition;

    if (!condition) {
      return [];
    }

    // Unwrap GroupedExpr to get to the actual condition
    let unwrappedCondition: ASTNode = condition;
    if (unwrappedCondition.type === 'GroupedExpr') {
      unwrappedCondition = (unwrappedCondition as GroupedExprNode).expression;
    }

    // Count boolean operators, boolean nesting depth, and parenthetical nesting
    const operatorCount = countBooleanOperators(unwrappedCondition);
    const booleanDepth = getBooleanNestingDepth(unwrappedCondition);
    const parenDepth = getParenNestingDepth(unwrappedCondition);

    // Flag if 3+ operators, boolean nesting > 2, or excessive parentheses (> 2)
    if (operatorCount >= 3 || booleanDepth > 2 || parenDepth > 2) {
      return [
        {
          location: conditionalNode.span.start,
          severity: 'info',
          code: 'COMPLEX_CONDITION',
          message:
            'Complex condition with multiple operators. Extract to named checks for clarity.',
          context: extractContextLine(
            conditionalNode.span.start.line,
            context.source
          ),
          fix: null, // Auto-fix would require semantic understanding
        },
      ];
    }

    return [];
  },
};

/**
 * Count boolean operators (&&, ||) in an expression tree.
 */
function countBooleanOperators(node: ASTNode): number {
  let count = 0;

  if (node.type === 'BinaryExpr') {
    const binaryNode = node as any;
    if (binaryNode.op === '&&' || binaryNode.op === '||') {
      count = 1;
    }

    count += countBooleanOperators(binaryNode.left);
    count += countBooleanOperators(binaryNode.right);
  }

  // Traverse other node types that might contain expressions
  switch (node.type) {
    case 'UnaryExpr': {
      const unaryNode = node as any;
      count += countBooleanOperators(unaryNode.operand);
      break;
    }

    case 'GroupedExpr': {
      const groupedNode = node as any;
      count += countBooleanOperators(groupedNode.expression);
      break;
    }

    case 'PipeChain': {
      const pipeNode = node as any;
      if (pipeNode.head) count += countBooleanOperators(pipeNode.head);
      if (pipeNode.pipes) {
        for (const pipe of pipeNode.pipes) {
          count += countBooleanOperators(pipe);
        }
      }
      break;
    }

    case 'PostfixExpr': {
      const postfixNode = node as any;
      if (postfixNode.primary)
        count += countBooleanOperators(postfixNode.primary);
      break;
    }
  }

  return count;
}

/**
 * Calculate maximum nesting depth of boolean operators.
 */
function getBooleanNestingDepth(node: ASTNode, currentDepth = 0): number {
  let maxDepth = currentDepth;

  if (node.type === 'BinaryExpr') {
    const binaryNode = node as any;
    const depth =
      binaryNode.op === '&&' || binaryNode.op === '||'
        ? currentDepth + 1
        : currentDepth;

    const leftDepth = getBooleanNestingDepth(binaryNode.left, depth);
    const rightDepth = getBooleanNestingDepth(binaryNode.right, depth);

    maxDepth = Math.max(maxDepth, leftDepth, rightDepth);
  }

  // Traverse other node types
  switch (node.type) {
    case 'UnaryExpr': {
      const unaryNode = node as any;
      maxDepth = Math.max(
        maxDepth,
        getBooleanNestingDepth(unaryNode.operand, currentDepth)
      );
      break;
    }

    case 'GroupedExpr': {
      const groupedNode = node as any;
      maxDepth = Math.max(
        maxDepth,
        getBooleanNestingDepth(groupedNode.expression, currentDepth)
      );
      break;
    }

    case 'PipeChain': {
      const pipeNode = node as any;
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
      const postfixNode = node as any;
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
 * Counts chains of nested parentheses like ((($x))).
 * Treats PipeChain (single head) and PostfixExpr (primary only) as transparent wrappers.
 */
function getParenNestingDepth(node: ASTNode): number {
  let maxDepth = 0;

  function traverse(n: ASTNode, consecutiveDepth: number): void {
    if (n.type === 'GroupedExpr') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const groupedNode = n as any;
      const newDepth = consecutiveDepth + 1;
      maxDepth = Math.max(maxDepth, newDepth);
      traverse(groupedNode.expression, newDepth);
    } else if (n.type === 'PipeChain') {
      // Treat simple PipeChain (head only) as transparent for nesting
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pipeNode = n as any;
      if (pipeNode.head && (!pipeNode.pipes || pipeNode.pipes.length === 0)) {
        // Transparent: pass through consecutive depth
        traverse(pipeNode.head, consecutiveDepth);
      } else {
        // Complex pipe chain: reset depth but continue traversing
        if (pipeNode.head) traverse(pipeNode.head, 0);
        if (pipeNode.pipes) {
          for (const pipe of pipeNode.pipes) {
            traverse(pipe, 0);
          }
        }
      }
    } else if (n.type === 'PostfixExpr') {
      // Treat simple PostfixExpr (primary only) as transparent for nesting
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const postfixNode = n as any;
      if (
        postfixNode.primary &&
        (!postfixNode.accessChain || postfixNode.accessChain.length === 0)
      ) {
        // Transparent: pass through consecutive depth
        traverse(postfixNode.primary, consecutiveDepth);
      } else {
        // Complex postfix: reset depth
        if (postfixNode.primary) traverse(postfixNode.primary, 0);
      }
    } else {
      // Reset consecutive depth when we hit a structural node
      // but continue traversing children
      if (n.type === 'BinaryExpr') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const binaryNode = n as any;
        traverse(binaryNode.left, 0);
        traverse(binaryNode.right, 0);
      } else if (n.type === 'UnaryExpr') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const unaryNode = n as any;
        traverse(unaryNode.operand, 0);
      }
    }
  }

  traverse(node, 0);
  return maxDepth;
}
