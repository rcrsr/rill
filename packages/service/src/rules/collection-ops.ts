/**
 * Collection-op recognition helpers.
 * Collection operators (`seq`, `fan`, `fold`, `filter`, `acc`) parse as
 * ordinary HostCall nodes whose `name` is one of the five callable
 * builtins below. The closure argument may parse as either a bare-block
 * form (`seq({ body })`, primary is a BlockNode) or an explicit closure
 * (`seq(|x|(body))`, primary is a ClosureNode).
 */

import type {
  ASTNode,
  BlockNode,
  BodyNode,
  ClosureNode,
  HostCallNode,
} from '@rcrsr/rill';

// ============================================================
// COLLECTION-OP NAME SET
// ============================================================

const COLLECTION_OP_NAMES = new Set([
  'seq',
  'fan',
  'fold',
  'filter',
  'acc',
] as const);

export type CollectionOpName = 'seq' | 'fan' | 'fold' | 'filter' | 'acc';

const PARALLEL_OPS = new Set<CollectionOpName>(['fan', 'filter']);

// ============================================================
// RECOGNITION
// ============================================================

/** True when the node is a HostCall to one of the five collection callables. */
export function isCollectionOpCall(
  node: ASTNode
): node is HostCallNode & { name: CollectionOpName } {
  return (
    node.type === 'HostCall' &&
    COLLECTION_OP_NAMES.has(node.name as CollectionOpName)
  );
}

/**
 * Resolve the body argument of a collection-op call.
 * Each arg is wrapped in a `PipeChain` whose head is a `PostfixExpr` whose
 * primary is the actual value. Args are scanned left-to-right; the first
 * whose primary is a `Closure` or `Block` is returned. Returns null when
 * no such arg exists (e.g. `seq($fn)` where the arg is a Variable).
 */
export function getCollectionOpBody(
  node: HostCallNode
): ClosureNode | BlockNode | null {
  for (const arg of node.args) {
    if (arg.type !== 'PipeChain') continue;
    if (arg.pipes.length !== 0) continue;
    const head = arg.head;
    if (head.type !== 'PostfixExpr') continue;
    const primary = head.primary;
    if (primary.type === 'Closure' || primary.type === 'Block') {
      return primary;
    }
  }
  return null;
}

/** True for callables that execute the closure in parallel (`fan`, `filter`). */
export function isParallelOp(name: CollectionOpName): boolean {
  return PARALLEL_OPS.has(name);
}

/**
 * Resolve the body to inspect for a collection-op call.
 * - `seq({block})` - arg primary is a Block; that Block is inspected
 *   directly.
 * - `seq(|x|(expr))` - arg primary is a Closure; its `.body` is inspected.
 * Both return values are valid `BodyNode` shapes.
 */
export function resolveOpBody(node: HostCallNode): BodyNode | null {
  const arg = getCollectionOpBody(node);
  if (!arg) return null;
  if (arg.type === 'Closure') return arg.body;
  return arg;
}

// ============================================================
// BODY SHAPE INSPECTION
// ============================================================

/**
 * Unwrap a Block-with-single-Statement to the inner expression's head.
 * Collection-op bodies are always wrapped in `{...}`, so a literal `.empty`
 * arrives as Block -> Statement -> PipeChain -> PostfixExpr.
 */
function unwrapBlockToHead(body: BodyNode): ASTNode | null {
  if (body.type !== 'Block') return body;
  if (body.statements.length !== 1) return null;
  const stmt = body.statements[0];
  if (!stmt || stmt.type !== 'Statement') return null;
  const expr = stmt.expression;
  if (expr.type !== 'PipeChain') return null;
  if (expr.pipes.length !== 0) return null;
  return expr.head;
}

/**
 * Check if a body is a method shorthand (`.upper`, `.empty`, etc).
 * Matches both bare PostfixExpr and Block-wrapped shorthand.
 */
export function isMethodShorthand(body: BodyNode): boolean {
  const head = unwrapBlockToHead(body);
  if (!head) return false;
  if (head.type !== 'PostfixExpr') return false;
  if (head.methods.length !== 0) return false;
  return head.primary.type === 'MethodCall';
}

/**
 * Check if a body is a block wrapping a single method call on $.
 * Example: { $.upper() } when it could be .upper
 * Structure: Block -> Statement -> PipeChain -> PostfixExpr($) with methods
 */
export function isBlockWrappingMethod(body: BodyNode): boolean {
  if (body.type !== 'Block') return false;
  if (body.statements.length !== 1) return false;

  const stmt = body.statements[0];
  if (!stmt || stmt.type !== 'Statement') return false;

  const expr = stmt.expression;
  if (expr.type !== 'PipeChain') return false;

  // Should have no pipes (direct method call on head)
  if (expr.pipes.length !== 0) return false;

  const head = expr.head;
  if (head.type !== 'PostfixExpr') return false;

  // Primary should be pipe variable ($)
  if (head.primary.type !== 'Variable') return false;
  const variable = head.primary;
  if (!variable.isPipeVar) return false;

  // Should have exactly one method in the methods array
  if (head.methods.length !== 1) return false;
  if (head.methods[0]?.type !== 'MethodCall') return false;

  return true;
}

/**
 * Get method name from a closure body.
 * Handles both PostfixExpr shorthand (raw or block-wrapped) and the verbose
 * `{ $.method() }` block form.
 */
export function getMethodName(body: BodyNode): string | null {
  // Shorthand form: PostfixExpr with MethodCall primary (raw or block-wrapped)
  const head = unwrapBlockToHead(body);
  if (
    head &&
    head.type === 'PostfixExpr' &&
    head.methods.length === 0 &&
    head.primary.type === 'MethodCall'
  ) {
    return head.primary.name;
  }

  // Block form: $.method()
  if (isBlockWrappingMethod(body) && body.type === 'Block') {
    const stmt = body.statements[0];
    if (!stmt || stmt.type !== 'Statement') return null;

    const expr = stmt.expression;
    if (expr.type !== 'PipeChain') return null;

    const head2 = expr.head;
    if (head2.type !== 'PostfixExpr') return null;

    const method = head2.methods[0];
    if (method && method.type === 'MethodCall') {
      return method.name;
    }
  }

  return null;
}
