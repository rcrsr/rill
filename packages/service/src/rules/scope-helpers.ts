/**
 * Shared closure-scope helpers used by rules that reason about variable
 * capture location relative to the engine-owned scope stack.
 */

import type { ASTNode, CaptureNode } from '@rcrsr/rill';
import { traverseForRules } from './traversal.js';

// ============================================================
// PARENT-SCOPE CHECK
// ============================================================

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
export function isVariableInParentScope(
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

// ============================================================
// CAPTURE COLLECTION
// ============================================================

/**
 * Find all Capture nodes in a loop/collection-op body, excluding captures
 * nested inside closures (they have their own scope). Reuses the shared
 * AST traversal so descent mirrors the engine-owned walk exactly.
 */
export function findCapturesInBody(node: ASTNode): CaptureNode[] {
  const captures: CaptureNode[] = [];
  let closureDepth = 0;

  traverseForRules(node, {
    enter(n: ASTNode) {
      if (n.type === 'Closure') {
        closureDepth++;
        return;
      }
      if (n.type === 'Capture' && closureDepth === 0) {
        captures.push(n);
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
