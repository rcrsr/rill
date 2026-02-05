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
  BinaryExprNode,
  CaptureNode,
  ConditionalNode,
  GroupedExprNode,
  EachExprNode,
  MapExprNode,
  FilterExprNode,
  FoldExprNode,
  PipeChainNode,
  PostfixExprNode,
  UnaryExprNode,
  WhileLoopNode,
  DoWhileLoopNode,
} from '@rcrsr/rill';
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
 * - Capture node (=> $var) where $var already exists in validation context
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
      const variableScope = context.variableScopes.get(varName) ?? null;

      // Get the current closure scope (if we're inside a closure)
      const currentClosureScope =
        context.scopeStack.length > 0
          ? context.scopeStack[context.scopeStack.length - 1]!
          : null;

      // Only warn if the variable is truly in the same scope or a parent scope
      // Variables in sibling closures are independent and should not trigger warnings
      const isInSameOrParentScope = isVariableInParentScope(
        variableScope,
        currentClosureScope,
        context.scopeStack
      );

      if (isInSameOrParentScope) {
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
    const binaryNode = node as BinaryExprNode;
    if (binaryNode.op === '&&' || binaryNode.op === '||') {
      count = 1;
    }

    count += countBooleanOperators(binaryNode.left);
    count += countBooleanOperators(binaryNode.right);
  }

  // Traverse other node types that might contain expressions
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

/**
 * Calculate maximum nesting depth of boolean operators.
 */
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

  // Traverse other node types
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

// ============================================================
// LOOP_OUTER_CAPTURE RULE
// ============================================================

/**
 * Detects attempts to modify outer-scope variables from inside loops.
 * This is a common LLM-generated anti-pattern that never works in Rill.
 *
 * Rill's scoping rules mean that captures inside loop bodies create LOCAL
 * variables that don't affect outer scope. This is a fundamental language
 * constraint, not a style preference.
 *
 * WRONG - this pattern NEVER works:
 *   0 => $count
 *   [1, 2, 3] -> each { $count + 1 => $count }  # creates LOCAL $count
 *   $count                                       # still 0!
 *
 * RIGHT - use accumulators:
 *   [1, 2, 3] -> fold(0) { $@ + 1 }             # returns 3
 *   [1, 2, 3] -> each(0) { $@ + 1 }             # returns [1, 2, 3]
 *
 * This rule catches captures inside loop/collection bodies where the
 * variable name matches an outer-scope variable.
 *
 * References:
 * - docs/99_llm-reference.txt (LOOP STATE PATTERNS)
 * - docs/03_variables.md (Scope Rules)
 */
export const LOOP_OUTER_CAPTURE: ValidationRule = {
  code: 'LOOP_OUTER_CAPTURE',
  category: 'anti-patterns',
  severity: 'warning',
  nodeTypes: [
    'EachExpr',
    'MapExpr',
    'FilterExpr',
    'FoldExpr',
    'WhileLoop',
    'DoWhileLoop',
  ],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // Get the loop body based on node type
    let body: ASTNode | null = null;
    switch (node.type) {
      case 'EachExpr':
        body = (node as EachExprNode).body;
        break;
      case 'MapExpr':
        body = (node as MapExprNode).body;
        break;
      case 'FilterExpr':
        body = (node as FilterExprNode).body;
        break;
      case 'FoldExpr':
        body = (node as FoldExprNode).body;
        break;
      case 'WhileLoop':
        body = (node as WhileLoopNode).body;
        break;
      case 'DoWhileLoop':
        body = (node as DoWhileLoopNode).body;
        break;
    }

    if (!body) return diagnostics;

    // Find all captures in the body
    const captures = findCapturesInBody(body);

    // Get the current closure scope (if we're inside a closure)
    const currentClosureScope =
      context.scopeStack.length > 0
        ? context.scopeStack[context.scopeStack.length - 1]!
        : null;

    // Check if any capture targets an outer-scope variable
    for (const capture of captures) {
      if (context.variables.has(capture.name)) {
        const outerLocation = context.variables.get(capture.name)!;
        const variableScope = context.variableScopes.get(capture.name) ?? null;

        // Only flag if the variable is in a parent scope, not a sibling closure
        // Variable is "outer" if:
        // 1. It was defined in script scope (variableScope === null), OR
        // 2. It was defined in a parent closure that contains the current closure
        const isOuterScope = isVariableInParentScope(
          variableScope,
          currentClosureScope,
          context.scopeStack
        );

        if (isOuterScope) {
          diagnostics.push({
            location: capture.span.start,
            severity: 'warning',
            code: 'LOOP_OUTER_CAPTURE',
            message:
              `Cannot modify outer variable '$${capture.name}' from inside loop. ` +
              `Captures inside loops create LOCAL variables. ` +
              `Use fold(init) with $@ accumulator, or pack state into $ as a dict. ` +
              `(Outer '$${capture.name}' defined at line ${outerLocation.line})`,
            context: extractContextLine(
              capture.span.start.line,
              context.source
            ),
            fix: null,
          });
        }
      }
    }

    return diagnostics;
  },
};

/**
 * Check if a variable's scope is in the parent scope chain.
 * Returns true if the variable is accessible from the current scope.
 *
 * A variable is "outer" (parent scope) if:
 * - It was defined at script level (variableScope === null), OR
 * - It was defined in the SAME closure as the loop (same scope), OR
 * - It was defined in a closure that is an ancestor of the current closure
 *
 * A variable is NOT outer (sibling scope) if:
 * - It was defined in a different closure that is not an ancestor
 */
function isVariableInParentScope(
  variableScope: ASTNode | null,
  currentClosureScope: ASTNode | null,
  scopeStack: ASTNode[]
): boolean {
  // Variable defined at script level is always outer
  if (variableScope === null) {
    return true;
  }

  // If we're not in a closure, variable can't be outer to us
  if (currentClosureScope === null) {
    return variableScope === null;
  }

  // Variable is outer if its scope is the same as current closure
  // (loop body creates new scope within the closure)
  if (variableScope === currentClosureScope) {
    return true;
  }

  // Variable is outer if its scope is in our parent chain
  // Check if variableScope appears in scopeStack before currentClosureScope
  const currentIndex = scopeStack.indexOf(currentClosureScope);
  const variableIndex = scopeStack.indexOf(variableScope);

  // If variable scope is not in stack, it's not accessible
  if (variableIndex === -1) {
    return false;
  }

  // Variable is outer if it appears before current scope in stack (ancestor)
  return variableIndex < currentIndex;
}

/**
 * Recursively find all Capture nodes in a loop body.
 */
function findCapturesInBody(node: ASTNode): CaptureNode[] {
  const captures: CaptureNode[] = [];

  function traverse(n: ASTNode): void {
    if (n.type === 'Capture') {
      captures.push(n as CaptureNode);
      return;
    }

    // Traverse children based on node type
    switch (n.type) {
      case 'Block':
        for (const stmt of n.statements) traverse(stmt);
        break;
      case 'Statement':
        traverse(n.expression);
        break;
      case 'AnnotatedStatement':
        traverse(n.statement);
        break;
      case 'PipeChain':
        traverse(n.head);
        for (const pipe of n.pipes) traverse(pipe as ASTNode);
        if (n.terminator) traverse(n.terminator);
        break;
      case 'PostfixExpr':
        traverse(n.primary);
        for (const method of n.methods) traverse(method);
        break;
      case 'BinaryExpr':
        traverse(n.left);
        traverse(n.right);
        break;
      case 'UnaryExpr':
        traverse(n.operand);
        break;
      case 'GroupedExpr':
        traverse(n.expression);
        break;
      case 'Conditional':
        if (n.input) traverse(n.input);
        if (n.condition) traverse(n.condition);
        traverse(n.thenBranch);
        if (n.elseBranch) traverse(n.elseBranch);
        break;
      case 'Closure':
        // Don't traverse into closures - they have their own scope
        break;
      // Nested loops - traverse their bodies too
      case 'WhileLoop':
        traverse(n.body);
        break;
      case 'DoWhileLoop':
        traverse(n.body);
        break;
      case 'EachExpr':
      case 'MapExpr':
      case 'FilterExpr':
      case 'FoldExpr':
        traverse(n.body);
        break;
    }
  }

  traverse(node);
  return captures;
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
      const groupedNode = n as GroupedExprNode;
      const newDepth = consecutiveDepth + 1;
      maxDepth = Math.max(maxDepth, newDepth);
      traverse(groupedNode.expression, newDepth);
    } else if (n.type === 'PipeChain') {
      // Treat simple PipeChain (head only) as transparent for nesting
      const pipeNode = n as PipeChainNode;
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
      const postfixNode = n as PostfixExprNode;
      if (
        postfixNode.primary &&
        (!postfixNode.methods || postfixNode.methods.length === 0)
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
