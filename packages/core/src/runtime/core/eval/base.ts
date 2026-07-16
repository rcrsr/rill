/**
 * Evaluator Base Class
 *
 * Foundation for the class-based evaluator architecture.
 * Provides shared utilities and context access for all mixins.
 *
 * @internal
 */

import type { ASTNode, CaptureNode, SourceLocation } from '../../../types.js';
import type { RuntimeContext } from '../types/runtime.js';
import type { RillValue } from '../types/structures.js';
import type { EvalState } from './state.js';
import {
  getNodeLocation,
  checkAborted,
  checkAutoExceptions,
  withTimeout,
  handleCapture,
  accessDictField,
} from './shared.js';

/**
 * Base class for the evaluator.
 * Contains shared utilities used by all mixins.
 * All internal methods are protected to enable mixin access.
 */
export class EvaluatorBase {
  constructor(public ctx: RuntimeContext) {}

  /**
   * Get source location from an AST node.
   * Used for error reporting with precise location information.
   */
  getNodeLocation(node?: ASTNode): SourceLocation | undefined {
    return getNodeLocation(this as unknown as EvalState, node);
  }

  /**
   * Check if execution has been aborted via AbortSignal.
   * Throws a non-catchable RuntimeHaltSignal via throwAbortHalt (IR-1)
   * when the signal is aborted.
   */
  checkAborted(node?: ASTNode): void {
    return checkAborted(this as unknown as EvalState, node);
  }

  /**
   * Check if the current pipe value matches any autoException pattern.
   * Only checks string values. Throws a non-catchable RuntimeHaltSignal
   * via throwAutoExceptionHalt (IR-2) on match.
   */
  checkAutoExceptions(value: RillValue, node?: ASTNode): void {
    return checkAutoExceptions(this as unknown as EvalState, value, node);
  }

  /**
   * Wrap a promise with a timeout.
   * Returns original promise if no timeout configured.
   */
  withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number | undefined,
    functionName: string,
    node?: ASTNode
  ): Promise<T> {
    return withTimeout(
      this as unknown as EvalState,
      promise,
      timeoutMs,
      functionName,
      node
    );
  }

  /**
   * Handle statement capture: set variable and fire observability event.
   * Returns capture info if a capture occurred.
   *
   * NOTE: Stub implementation - actual implementation requires VariablesMixin.
   * This method will only be called after full mixin composition in Phase 4.
   * Phase 1-3 use the functional evaluator which has its own handleCapture.
   */
  handleCapture(
    capture: CaptureNode | null,
    value: RillValue
  ): Promise<{ name: string; value: RillValue } | undefined> {
    return handleCapture(this as unknown as EvalState, capture, value);
  }

  /**
   * Access a field on a dict value with property-style callable auto-invocation.
   * Shared by ClosuresMixin and VariablesMixin for consistent property access.
   *
   * @param value - The dict to access
   * @param field - The field name
   * @param location - Source location for error reporting
   * @param allowMissing - If true, returns null for missing fields instead of throwing
   * @returns The field value
   * @throws RuntimeError if value is not a dict or field is missing (unless allowMissing)
   */
  accessDictField(
    value: RillValue,
    field: string,
    location?: SourceLocation,
    allowMissing = false
  ): Promise<RillValue> {
    return accessDictField(
      this as unknown as EvalState,
      value,
      field,
      location,
      allowMissing
    );
  }
}

/**
 * Structural capability type for EvaluatorBase.
 *
 * Lists all base-class members (including those declared `protected`) using
 * plain method signatures, stripping the class access modifier. External
 * wrapper functions in index.ts cast to EvaluatorInterface (which intersects
 * this type) so they can call `checkAborted` and `checkAutoExceptions` without
 * a TS2445 error.
 *
 * Runtime behaviour is unchanged: `protected` is enforced at the class
 * declaration site, not at every cast-target reference.
 */
export type EvaluatorBaseCapability = {
  ctx: RuntimeContext;
  getNodeLocation(node?: ASTNode): SourceLocation | undefined;
  checkAborted(node?: ASTNode): void;
  checkAutoExceptions(value: RillValue, node?: ASTNode): void;
  withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number | undefined,
    functionName: string,
    node?: ASTNode
  ): Promise<T>;
  handleCapture(
    capture: CaptureNode | null,
    value: RillValue
  ): Promise<{ name: string; value: RillValue } | undefined>;
  accessDictField(
    value: RillValue,
    field: string,
    location?: SourceLocation,
    allowMissing?: boolean
  ): Promise<RillValue>;
};
