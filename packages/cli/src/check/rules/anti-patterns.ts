/**
 * Anti-Pattern Rules
 * Enforces best practices from docs/guide-conventions.md:411-462.
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
  ClosureCallNode,
  ClosureNode,
  ConditionalNode,
  GroupedExprNode,
  EachExprNode,
  MapExprNode,
  FilterExprNode,
  FoldExprNode,
  PipeChainNode,
  PostfixExprNode,
  ScriptNode,
  TypeConstructorNode,
  UnaryExprNode,
  VariableNode,
  WhileLoopNode,
  DoWhileLoopNode,
} from '@rcrsr/rill';
import { extractContextLine } from './helpers.js';
import { visitNode } from '../visitor.js';

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
 * - docs/guide-conventions.md:413-424
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
 * - docs/guide-conventions.md:451-461
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
 * - docs/ref-llm.txt (LOOP STATE PATTERNS)
 * - docs/topic-variables.md (Scope Rules)
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
 * Find all Capture nodes in a loop body, excluding closures.
 * Uses visitNode for full AST traversal with closure depth tracking
 * to skip captures inside nested closures (they have their own scope).
 */
function findCapturesInBody(node: ASTNode): CaptureNode[] {
  const captures: CaptureNode[] = [];
  let closureDepth = 0;
  const ctx = {} as ValidationContext;
  visitNode(node, ctx, {
    enter(n: ASTNode) {
      if (n.type === 'Closure') {
        closureDepth++;
        return;
      }
      if (n.type === 'Capture' && closureDepth === 0) {
        captures.push(n as CaptureNode);
      }
    },
    exit(n: ASTNode) {
      if (n.type === 'Closure') {
        closureDepth--;
      }
    },
  });
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

// ============================================================
// STREAM_PRE_ITERATION RULE
// ============================================================

/** Collection operator node types that consume a stream via iteration */
const ITERATION_NODE_TYPES = new Set([
  'EachExpr',
  'MapExpr',
  'FilterExpr',
  'FoldExpr',
]);

/**
 * Warns when a stream variable is invoked before any iteration consumes it.
 * Invoking a stream closure ($s()) before iterating ($s -> each { ... })
 * consumes chunks internally, leaving no data for iteration.
 *
 * Detection:
 * - Tracks variables captured from stream closures (returnTypeTarget = stream)
 *   or captured with explicit :stream type annotation
 * - Records first invocation (ClosureCall) and first iteration (each/map/filter/fold)
 * - Warns when invocation precedes iteration in source order
 *
 * No warning if:
 * - Iteration appears before invocation
 * - Variable is only iterated (never invoked before iteration)
 * - Variable is only invoked (no iteration to conflict)
 *
 * References:
 * - IR-15: Lint Warning for Pre-Iteration Invocation
 */
export const STREAM_PRE_ITERATION: ValidationRule = {
  code: 'STREAM_PRE_ITERATION',
  category: 'anti-patterns',
  severity: 'warning',
  nodeTypes: ['Script'],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const scriptNode = node as ScriptNode;
    const diagnostics: Diagnostic[] = [];

    // Phase 1: Collect stream variable names from capture sites
    const streamVars = new Set<string>();
    collectStreamVariables(scriptNode, streamVars);

    if (streamVars.size === 0) {
      return diagnostics;
    }

    // Phase 2: Find first invocation and first iteration for each stream variable
    const firstInvocation = new Map<string, ClosureCallNode>();
    const firstIteration = new Map<string, ASTNode>();
    collectStreamUsages(
      scriptNode,
      streamVars,
      firstInvocation,
      firstIteration
    );

    // Phase 3: Emit warning for each variable invoked before iteration
    for (const varName of streamVars) {
      const invocation = firstInvocation.get(varName);
      const iteration = firstIteration.get(varName);

      if (!invocation) {
        continue;
      }

      // Warn if invoked and no iteration exists, or invocation precedes iteration
      const invokedBeforeIteration =
        !iteration ||
        invocation.span.start.line < iteration.span.start.line ||
        (invocation.span.start.line === iteration.span.start.line &&
          invocation.span.start.column < iteration.span.start.column);

      if (invokedBeforeIteration) {
        diagnostics.push({
          location: invocation.span.start,
          severity: 'warning',
          code: 'STREAM_PRE_ITERATION',
          message: `Stream invoked before iteration; chunks consumed internally. '$${varName}' at line ${invocation.span.start.line}`,
          context: extractContextLine(
            invocation.span.start.line,
            context.source
          ),
          fix: null,
        });
      }
    }

    return diagnostics;
  },
};

/**
 * Collect variable names captured from stream closures or with :stream type.
 * Traverses AST to find PipeChains containing a Capture in their pipes where:
 * - The capture has typeRef with typeName 'stream'
 * - The PipeChain head is a stream-returning closure
 *
 * Note: Capture nodes appear in PipeChain.pipes (not .terminator).
 * Only Break/Return/Yield use the terminator slot.
 */
function collectStreamVariables(node: ASTNode, streamVars: Set<string>): void {
  const ctx = {} as ValidationContext;
  visitNode(node, ctx, {
    enter(n: ASTNode) {
      if (n.type !== 'PipeChain') return;

      const chain = n as PipeChainNode;

      // Find the last Capture in the pipes array
      const capture = findTrailingCapture(chain);
      if (!capture) return;

      const varName = capture.name;

      // Check 1: Capture with explicit :stream type annotation
      if (
        capture.typeRef &&
        capture.typeRef.kind === 'static' &&
        capture.typeRef.typeName === 'stream'
      ) {
        streamVars.add(varName);
        return;
      }

      // Check 2: Head is a closure with stream return type
      if (isStreamClosure(chain)) {
        streamVars.add(varName);
      }
    },
    exit() {},
  });
}

/**
 * Find the trailing Capture node in a PipeChain's pipes array.
 * Returns null if the last pipe element is not a Capture.
 */
function findTrailingCapture(chain: PipeChainNode): CaptureNode | null {
  const lastPipe = chain.pipes[chain.pipes.length - 1];
  if (lastPipe && lastPipe.type === 'Capture') {
    return lastPipe as CaptureNode;
  }
  return null;
}

/**
 * Check if a PipeChain's head (or piped result) is a stream-returning closure.
 * Detects closures with returnTypeTarget of stream type.
 */
function isStreamClosure(chain: PipeChainNode): boolean {
  const head = chain.head;
  if (head.type !== 'PostfixExpr') return false;

  const postfix = head as PostfixExprNode;
  if (postfix.primary.type !== 'Closure') return false;

  const closure = postfix.primary as ClosureNode;
  const returnType = closure.returnTypeTarget;
  if (!returnType) return false;

  // TypeConstructorNode: :stream(), :stream(number), :stream(number):string
  if ('type' in returnType && returnType.type === 'TypeConstructor') {
    return (returnType as TypeConstructorNode).constructorName === 'stream';
  }

  // TypeRef: :stream (simple form)
  if ('kind' in returnType && returnType.kind === 'static') {
    return returnType.typeName === 'stream';
  }

  return false;
}

/**
 * Collect first invocation and first iteration sites for stream variables.
 * Traverses AST in source order, recording only the first occurrence of each.
 */
function collectStreamUsages(
  node: ASTNode,
  streamVars: Set<string>,
  firstInvocation: Map<string, ClosureCallNode>,
  firstIteration: Map<string, ASTNode>
): void {
  const ctx = {} as ValidationContext;
  visitNode(node, ctx, {
    enter(n: ASTNode) {
      // Detect invocation: $s() as ClosureCall
      if (n.type === 'ClosureCall') {
        const call = n as ClosureCallNode;
        if (
          streamVars.has(call.name) &&
          call.accessChain.length === 0 &&
          !firstInvocation.has(call.name)
        ) {
          firstInvocation.set(call.name, call);
        }
        return;
      }

      // Detect iteration: $s -> each/map/filter/fold
      if (n.type === 'PipeChain') {
        const chain = n as PipeChainNode;
        const varName = getPipeHeadVariableName(chain);
        if (
          varName !== null &&
          streamVars.has(varName) &&
          !firstIteration.has(varName)
        ) {
          // Check if any pipe target is an iteration operator
          for (const pipe of chain.pipes) {
            if (ITERATION_NODE_TYPES.has(pipe.type)) {
              firstIteration.set(varName, pipe);
              break;
            }
          }
        }
      }
    },
    exit() {},
  });
}

/**
 * Extract the variable name from a PipeChain head if it's a simple variable reference.
 * Returns null for complex heads (binary expressions, host calls, etc.).
 */
function getPipeHeadVariableName(chain: PipeChainNode): string | null {
  const head = chain.head;
  if (head.type !== 'PostfixExpr') return null;

  const postfix = head as PostfixExprNode;
  if (postfix.primary.type !== 'Variable') return null;
  if (postfix.methods.length > 0) return null;

  const variable = postfix.primary as VariableNode;
  if (variable.isPipeVar || variable.name === null) return null;
  if (variable.accessChain.length > 0) return null;

  return variable.name;
}
