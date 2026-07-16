/**
 * Evaluation Public API
 *
 * eval/ is a set of plain module-level functions operating over a shared
 * EvalState struct. There are no classes or `this`-based state anywhere
 * in this directory. This file exposes the external wrapper surface
 * (checkAborted, checkAutoExceptions, executeStatement, invokeCallable)
 * that resolves EvalState via getEvalState(ctx) and threads that state
 * into the individual handler functions.
 *
 * Handler files import each other directly. Circular ESM imports between
 * handler files are safe because every cross-handler call happens during
 * evaluation, never at module-init time.
 *
 * See internal/review-evaluator-mixin-architecture-2026-07-15.md for
 * migration history.
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
import { getEvalState } from './state.js';
import {
  checkAborted as checkAbortedState,
  checkAutoExceptions as checkAutoExceptionsState,
} from './shared.js';
import { executeStatement as executeStatementState } from './handlers/annotations.js';
import { invokeCallable as invokeCallableState } from './handlers/closures.js';

/**
 * Check if execution has been aborted via AbortSignal.
 * Throws RuntimeHaltSignal (code=#DISPOSED, catchable=false) if signal is aborted.
 */
export function checkAborted(ctx: RuntimeContext, node?: ASTNode): void {
  const state = getEvalState(ctx);
  checkAbortedState(state, node);
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
  const state = getEvalState(ctx);
  checkAutoExceptionsState(state, value, node);
}

/**
 * Execute a statement and return the result.
 * Handles annotations and observability events.
 */
export async function executeStatement(
  stmt: StatementNode | AnnotatedStatementNode,
  ctx: RuntimeContext
): Promise<RillValue> {
  const state = getEvalState(ctx);
  return executeStatementState(state, stmt);
}

/**
 * Invoke any callable (script, runtime, or application) with positional arguments.
 *
 * Dispatches to invokeCallable which handles all callable kinds:
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
  const state = getEvalState(ctx);
  return invokeCallableState(state, callable, args, location);
}
