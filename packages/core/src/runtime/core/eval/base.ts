/**
 * Evaluator Base Class
 *
 * Foundation for the class-based evaluator architecture.
 * Provides shared utilities and context access for all mixins.
 *
 * @internal
 */

import type { ASTNode, CaptureNode, SourceLocation } from '../../../types.js';
import type { EvaluatorInterface } from './interface.js';
import { TimeoutError } from '../../../types.js';
import type { RuntimeContext } from '../types/runtime.js';
import { isCallable, isDict } from '../callable.js';
import type { RillCallable } from '../callable.js';
import type { RillValue } from '../types/structures.js';
import {
  throwAbortHalt,
  throwAutoExceptionHalt,
  throwCatchableHostHalt,
  type TypeHaltSite,
} from '../types/halt.js';

/**
 * Base class for the evaluator.
 * Contains shared utilities used by all mixins.
 * All internal methods are protected to enable mixin access.
 */
export class EvaluatorBase {
  constructor(protected ctx: RuntimeContext) {}

  /**
   * Get source location from an AST node.
   * Used for error reporting with precise location information.
   */
  protected getNodeLocation(node?: ASTNode): SourceLocation | undefined {
    return node?.span.start;
  }

  /**
   * Check if execution has been aborted via AbortSignal.
   * Throws a non-catchable RuntimeHaltSignal via throwAbortHalt (IR-1)
   * when the signal is aborted.
   */
  protected checkAborted(node?: ASTNode): void {
    if (this.ctx.signal?.aborted) {
      const site: TypeHaltSite = {
        location: this.getNodeLocation(node),
        sourceId: this.ctx.sourceId,
        fn: 'checkAborted',
      };
      throwAbortHalt(site);
    }
  }

  /**
   * Check if the current pipe value matches any autoException pattern.
   * Only checks string values. Throws a non-catchable RuntimeHaltSignal
   * via throwAutoExceptionHalt (IR-2) on match.
   */
  protected checkAutoExceptions(value: RillValue, node?: ASTNode): void {
    if (typeof value !== 'string' || this.ctx.autoExceptions.length === 0) {
      return;
    }

    for (const pattern of this.ctx.autoExceptions) {
      if (pattern.test(value)) {
        const site: TypeHaltSite = {
          location: this.getNodeLocation(node),
          sourceId: this.ctx.sourceId,
          fn: 'checkAutoExceptions',
        };
        throwAutoExceptionHalt(site, pattern.source, value);
      }
    }
  }

  /**
   * Wrap a promise with a timeout.
   * Returns original promise if no timeout configured.
   */
  protected withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number | undefined,
    functionName: string,
    node?: ASTNode
  ): Promise<T> {
    if (timeoutMs === undefined) {
      return promise;
    }

    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new TimeoutError(
              functionName,
              timeoutMs,
              this.getNodeLocation(node)
            )
          );
        }, timeoutMs);
      }),
    ]);
  }

  /**
   * Handle statement capture: set variable and fire observability event.
   * Returns capture info if a capture occurred.
   *
   * NOTE: Stub implementation - actual implementation requires VariablesMixin.
   * This method will only be called after full mixin composition in Phase 4.
   * Phase 1-3 use the functional evaluator which has its own handleCapture.
   */
  protected handleCapture(
    _capture: CaptureNode | null,
    _value: RillValue
  ): Promise<{ name: string; value: RillValue } | undefined> {
    // AC-13: Intentional raw throw - internal mixin guard, not user-reachable.
    // This stub only runs if mixin composition is incomplete (programming error).
    throw new Error(
      'handleCapture requires full Evaluator composition with VariablesMixin'
    );
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
  protected async accessDictField(
    value: RillValue,
    field: string,
    location?: SourceLocation,
    allowMissing = false
  ): Promise<RillValue> {
    if (!isDict(value)) {
      throwCatchableHostHalt(
        { location, sourceId: this.ctx.sourceId, fn: 'accessDictField' },
        'RILL_R003',
        `Cannot access field '${field}' on non-dict`
      );
    }

    const dictValue = (value as Record<string, RillValue>)[field];

    // Check if field exists
    if (dictValue === undefined || dictValue === null) {
      if (allowMissing) {
        return null;
      }
      throwCatchableHostHalt(
        { location, sourceId: this.ctx.sourceId, fn: 'accessDictField' },
        'RILL_R009',
        `Dict has no field '${field}'`
      );
    }

    // Property-style callable: auto-invoke when accessed
    if (isCallable(dictValue)) {
      if (dictValue.isProperty) {
        // ApplicationCallable: pass [dict] as args (no boundDict mechanism)
        // ScriptCallable: pass [] - dict is bound via boundDict -> pipeValue
        const args = dictValue.kind === 'script' ? [] : [value];
        return await (this as unknown as EvaluatorInterface).invokeCallable(
          dictValue as RillCallable,
          args,
          location
        );
      }
    }

    return dictValue;
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
