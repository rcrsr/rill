/**
 * Test helpers for narrowing parser output.
 */

import type { PrimaryNode, ScriptNode, StatementNode } from '@rcrsr/rill';

/**
 * Return the first top-level statement of a parsed script, asserting that it
 * is a plain statement (not annotated, partial, or a recovery error node).
 */
function getFirstStatement(ast: ScriptNode): StatementNode {
  const stmt = ast.statements[0];
  if (stmt === undefined || stmt.type !== 'Statement') {
    throw new Error(`expected a plain Statement, got ${stmt?.type}`);
  }
  return stmt;
}

/**
 * Return the primary node heading the first statement's pipe chain,
 * asserting that the head is a plain postfix expression.
 */
export function getFirstPrimary(ast: ScriptNode): PrimaryNode {
  const head = getFirstStatement(ast).expression.head;
  if (head.type !== 'PostfixExpr') {
    throw new Error(`expected a PostfixExpr head, got ${head.type}`);
  }
  return head.primary;
}
