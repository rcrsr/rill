/**
 * Collection-op recognition helpers.
 * Collection operators (`seq`, `fan`, `fold`, `filter`, `acc`) parse as
 * ordinary HostCall nodes whose `name` is one of the five callable
 * builtins below. The function argument may parse as either a bare-block
 * form (`seq({ body })`, primary is a BlockNode) or an explicit function
 * (`seq(fn(x) { body })`, primary is a ClosureNode). `sort` also takes a
 * function and is covered by the arity model below.
 */

import { codeBlockShape, unnamedParamsRead } from '@rcrsr/rill';
import type {
  ASTNode,
  BlockNode,
  BodyNode,
  ClosureNode,
  HostCallNode,
  PostfixExprNode,
} from '@rcrsr/rill';

// ============================================================
// COLLECTION-OP NAME SET
// ============================================================

const COLLECTION_OP_NAMES: ReadonlySet<string> = new Set([
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
  return node.type === 'HostCall' && COLLECTION_OP_NAMES.has(node.name);
}

/**
 * Unwrap a collection-op arg to its `PostfixExpr`.
 * Each arg is wrapped in a `PipeChain` whose head is a `PostfixExpr` whose
 * `.primary` holds the actual value. Returns null when the arg doesn't
 * match this shape (e.g. it has pipes).
 */
function unwrapArgPrimary(arg: ASTNode): PostfixExprNode | null {
  if (arg.type !== 'PipeChain' || arg.pipes.length > 0) return null;
  const head = arg.head;
  if (head.type !== 'PostfixExpr') return null;
  return head;
}

/**
 * Resolve the body argument of a collection-op call.
 * Args are scanned left-to-right; the first whose primary is a `Closure` or
 * `Block` is returned. Returns null when no such arg exists (e.g.
 * `seq($fn)` where the arg is a Variable).
 */
export function getCollectionOpBody(
  node: HostCallNode
): ClosureNode | BlockNode | null {
  for (const arg of node.args) {
    const head = unwrapArgPrimary(arg);
    if (!head) continue;
    const primary = head.primary;
    if (primary.type === 'Closure' || primary.type === 'Block') {
      return primary;
    }
  }
  return null;
}

/**
 * Resolve a bare zero-arg host call sitting in the body slot of a
 * collection-op call, e.g. `seq(foo)` where `foo` should have been
 * `seq({ foo($) })` or `seq(fn(x) { foo($x) })`.
 * Only the last arg is inspected: `fold`/`acc` take `(initial, body)`, and a
 * bare zero-arg call is legitimate in the initial slot (`fold(zero, ...)`).
 * Only the last arg is ever the body slot, so scanning earlier args would
 * misfire on that initial-value case.
 */
export function getBareCallableArg(node: HostCallNode): HostCallNode | null {
  const arg = node.args.at(-1);
  if (!arg) return null;
  const head = unwrapArgPrimary(arg);
  if (!head || head.methods.length > 0) return null;
  const primary = head.primary;
  if (primary.type !== 'HostCall' || primary.args.length > 0) return null;
  return primary;
}

/** True for callables that execute the function in parallel (`fan`, `filter`). */
export function isParallelOp(name: CollectionOpName): boolean {
  return PARALLEL_OPS.has(name);
}

/**
 * Resolve the body to inspect for a collection-op call.
 * - `seq({block})` - arg primary is a Block; that Block is inspected
 *   directly.
 * - `seq(fn(x) { expr })` - arg primary is a Closure; its `.body` is inspected.
 * Both return values are valid `BodyNode` shapes.
 */
export function resolveOpBody(node: HostCallNode): BodyNode | null {
  const arg = getCollectionOpBody(node);
  if (!arg) return null;
  if (arg.type === 'Closure') return arg.body;
  return arg;
}

// ============================================================
// ARGUMENT ARITY
// ============================================================

/** The operators whose function argument has an exact arity. */
export type ArityOpName = CollectionOpName | 'sort';

const OP_ARITY: Readonly<Record<ArityOpName, 1 | 2>> = {
  seq: 1,
  fan: 1,
  filter: 1,
  sort: 1,
  fold: 2,
  acc: 2,
};

/** True when the node is a HostCall to an operator with an exact function arity. */
export function isArityOpCall(
  node: ASTNode
): node is HostCallNode & { name: ArityOpName } {
  return node.type === 'HostCall' && Object.hasOwn(OP_ARITY, node.name);
}

/** The number of arguments the operator passes its function. */
export function opArity(name: ArityOpName): 1 | 2 {
  return OP_ARITY[name];
}

/** How many arguments a function argument takes: `required` of its `total`. */
export interface ArgumentArity {
  readonly total: number;
  readonly required: number;
}

/**
 * The arity of the last argument of an operator call when it is a block or an
 * fn literal, or null for any other argument (a variable, a call, no argument).
 * A block counts its params by the unnamed params it reads; an fn literal
 * counts its declared params.
 */
export function functionArgumentArity(
  node: HostCallNode
): { readonly arity: ArgumentArity; readonly arg: ASTNode } | null {
  const arg = node.args.at(-1);
  if (!arg) return null;
  const head = unwrapArgPrimary(arg);
  if (head?.primary.type === 'Closure' && head.methods.length === 0) {
    const params = head.primary.params;
    return {
      arg,
      arity: {
        total: params.length,
        required: params.filter((param) => param.defaultValue === null).length,
      },
    };
  }
  const shape = codeBlockShape(arg);
  if (shape === undefined) return null;
  const read = unnamedParamsRead(shape.block);
  return { arg, arity: { total: read, required: read } };
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
  if (expr.pipes.length > 0) return null;
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
  if (head.methods.length > 0) return false;
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
  if (expr.pipes.length > 0) return false;

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
