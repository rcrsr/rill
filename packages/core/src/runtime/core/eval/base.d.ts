/**
 * Evaluator Base Class
 *
 * Foundation for the class-based evaluator architecture.
 * Provides shared utilities and context access for all mixins.
 *
 * @internal
 */
import type { ASTNode, CaptureNode, SourceLocation } from '../../../types.js';
import type { RuntimeContext } from '../types.js';
import type { RillValue } from '../values.js';
/**
 * Base class for the evaluator.
 * Contains shared utilities used by all mixins.
 * All internal methods are protected to enable mixin access.
 */
export declare class EvaluatorBase {
    protected ctx: RuntimeContext;
    constructor(ctx: RuntimeContext);
    /**
     * Get source location from an AST node.
     * Used for error reporting with precise location information.
     */
    protected getNodeLocation(node?: ASTNode): SourceLocation | undefined;
    /**
     * Check if execution has been aborted via AbortSignal.
     * Throws AbortError if signal is aborted.
     */
    protected checkAborted(node?: ASTNode): void;
    /**
     * Check if the current pipe value matches any autoException pattern.
     * Only checks string values. Throws AutoExceptionError on match.
     */
    protected checkAutoExceptions(value: RillValue, node?: ASTNode): void;
    /**
     * Wrap a promise with a timeout.
     * Returns original promise if no timeout configured.
     */
    protected withTimeout<T>(promise: Promise<T>, timeoutMs: number | undefined, functionName: string, node?: ASTNode): Promise<T>;
    /**
     * Handle statement capture: set variable and fire observability event.
     * Returns capture info if a capture occurred.
     *
     * NOTE: Stub implementation - actual implementation requires VariablesMixin.
     * This method will only be called after full mixin composition in Phase 4.
     * Phase 1-3 use the functional evaluator which has its own handleCapture.
     */
    protected handleCapture(_capture: CaptureNode | null, _value: RillValue): {
        name: string;
        value: RillValue;
    } | undefined;
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
    protected accessDictField(value: RillValue, field: string, location?: SourceLocation, allowMissing?: boolean): Promise<RillValue>;
}
//# sourceMappingURL=base.d.ts.map