/**
 * Evaluation Public API
 *
 * Public API for AST evaluation using the class-based Evaluator architecture.
 * Provides functional wrappers around Evaluator methods for backward compatibility.
 *
 * @internal
 */

import type {
  AnnotatedStatementNode,
  ASTNode,
  SourceLocation,
  StatementNode,
} from '../../../types.js';
import type { RillCallable } from '../callable.js';
import type { RuntimeContext } from '../types/runtime.js';
import type { RillValue } from '../types/structures.js';
import { getEvaluator } from './evaluator.js';

/**
 * Check if execution has been aborted via AbortSignal.
 * Throws RuntimeHaltSignal (code=#DISPOSED, catchable=false) if signal is aborted.
 */
export function checkAborted(ctx: RuntimeContext, node?: ASTNode): void {
  const evaluator = getEvaluator(ctx);
  // Access protected method via type assertion
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (evaluator as any).checkAborted(node);
}

/**
 * Check if the current pipe value matches any autoException pattern.
 * Only checks string values. Throws RuntimeHaltSignal (code=#R999, catchable=false) on match.
 */
export function checkAutoExceptions(
  value: RillValue,
  ctx: RuntimeContext,
  node?: ASTNode
): void {
  const evaluator = getEvaluator(ctx);
  // Access protected method via type assertion
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (evaluator as any).checkAutoExceptions(value, node);
}

/**
 * Execute a statement and return the result.
 * Handles annotations and observability events.
 */
export async function executeStatement(
  stmt: StatementNode | AnnotatedStatementNode,
  ctx: RuntimeContext
): Promise<RillValue> {
  const evaluator = getEvaluator(ctx);
  return evaluator.executeStatement(stmt);
}

/**
 * Invoke any callable (script, runtime, or application) with positional arguments.
 *
 * Dispatches to the evaluator's invokeCallable which handles all callable kinds:
 * - ScriptCallable: executes the Rill closure body in a new scope
 * - RuntimeCallable: calls the native fn directly
 * - ApplicationCallable: calls the native fn with optional validation
 *
 * @param callable - The callable to invoke
 * @param args - Positional arguments
 * @param ctx - The runtime context
 * @param location - Optional call site location for error reporting
 */
export async function invokeCallable(
  callable: RillCallable,
  args: RillValue[],
  ctx: RuntimeContext,
  location?: SourceLocation
): Promise<RillValue> {
  const evaluator = getEvaluator(ctx);
  // Access protected method via type assertion (same pattern as checkAborted, etc.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (evaluator as any).invokeCallable(callable, args, location);
}
