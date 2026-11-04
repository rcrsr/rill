/**
 * Test helpers for narrowing parser output.
 */

import type {
  ArithHead,
  PostfixExprNode,
  PrimaryNode,
  ScriptNode,
  StatementNode,
} from '@rcrsr/rill';

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

/**
 * Return the statement at `index` of a parsed script, asserting that it is a
 * plain statement (not annotated, partial, or a recovery error node).
 */
export function getStatementAt(ast: ScriptNode, index: number): StatementNode {
  const stmt = ast.statements[index];
  if (stmt === undefined || stmt.type !== 'Statement') {
    throw new Error(`expected a plain Statement, got ${stmt?.type}`);
  }
  return stmt;
}

/**
 * Narrow a pipe-chain head to a postfix expression, asserting its kind.
 */
export function asPostfixHead(head: ArithHead): PostfixExprNode {
  if (head.type !== 'PostfixExpr') {
    throw new Error(`expected a PostfixExpr head, got ${head.type}`);
  }
  return head;
}

/**
 * Structural view over any AST node for tests that probe node shapes by
 * discriminator and field name rather than by the declared union types.
 */
export interface AstView {
  readonly type: string;
  readonly head: AstView;
  readonly primary: AstView;
  readonly expression: AstView;
  readonly pipes: readonly AstView[];
  readonly statements: readonly AstView[];
  readonly entries: readonly AstView[];
  readonly elements: readonly AstView[];
  readonly methods: readonly AstView[];
  readonly args: readonly AstView[];
  readonly params: readonly AstView[];
  readonly value: AstView;
  readonly thenBranch: AstView;
  readonly body: AstView;
  readonly terminator: AstView | undefined;
  readonly returnTypeTarget: AstView | undefined;
  readonly key: unknown;
  readonly kind: unknown;
  readonly name: unknown;
  readonly constructorName: unknown;
  readonly typeName: unknown;
  readonly isPipeVar: unknown;
  readonly field: unknown;
}

/**
 * View any node object through AstView. Returns the same object.
 */
function asAstView(node: object): AstView {
  return node as AstView;
}

/**
 * View the statement at `index` of a parsed script through AstView.
 */
export function getStatementView(ast: ScriptNode, index = 0): AstView {
  const stmt = ast.statements[index];
  if (stmt === undefined) {
    throw new Error(`expected a statement at index ${index}`);
  }
  return asAstView(stmt);
}
