/**
 * Shared Helper Functions
 * Common utilities used across validation rules.
 */

import type {
  ExpressionNode,
  PipeChainNode,
  PostfixExprNode,
  VariableNode,
} from '../../types.js';

/**
 * Extract source line at location for context display.
 * Splits source by newlines, retrieves the specified line (1-indexed), and trims it.
 */
export function extractContextLine(line: number, source: string): string {
  const lines = source.split('\n');
  const sourceLine = lines[line - 1];
  return sourceLine ? sourceLine.trim() : '';
}

/**
 * Detect if expression is a bare $ (pipe variable) reference.
 * Used by IMPLICIT_DOLLAR_* rules to detect replaceable patterns.
 *
 * Returns true only for single bare $, not $var or $.field or $[0].
 * O(1) depth traversal (max 3 node levels): PipeChain -> ArithHead -> PostfixExpr -> Variable.
 *
 * Distinct from containsBareReference() in closures.ts:
 * - isBareReference(): O(1) single-node check, answers "is this exact node a bare $?"
 * - containsBareReference(): Recursive AST walker, answers "does this subtree contain any bare $?"
 *
 * @param expr - Expression node to check
 * @returns true if expr is a bare $ reference, false otherwise
 */
export function isBareReference(
  expr: ExpressionNode | null | undefined
): boolean {
  // Defensive: handle null/undefined input
  if (!expr) {
    return false;
  }

  // Expression is PipeChain
  if (expr.type !== 'PipeChain') {
    return false;
  }

  const pipeChain = expr as PipeChainNode;

  // Must have no pipe targets (just the head)
  if (pipeChain.pipes.length > 0 || pipeChain.terminator !== null) {
    return false;
  }

  const head = pipeChain.head;

  // ArithHead can be BinaryExpr, UnaryExpr, or PostfixExpr
  // For bare $, we need PostfixExpr
  if (head.type !== 'PostfixExpr') {
    return false;
  }

  const postfix = head as PostfixExprNode;

  // Must have no method calls (just the primary)
  if (postfix.methods.length > 0) {
    return false;
  }

  const primary = postfix.primary;

  // Primary must be a Variable
  if (primary.type !== 'Variable') {
    return false;
  }

  const variable = primary as VariableNode;

  // Must be pipe variable ($) with no access chain, default value, or existence check
  return (
    variable.isPipeVar &&
    variable.name === null &&
    variable.accessChain.length === 0 &&
    variable.defaultValue === null &&
    variable.existenceCheck === null
  );
}
