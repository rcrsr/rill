/**
 * Evaluator Base Class
 *
 * Foundation for the class-based evaluator architecture.
 * Provides shared utilities and context access for all mixins.
 *
 * @internal
 */
import { AbortError, AutoExceptionError, RuntimeError, TimeoutError, } from '../../../types.js';
import { isCallable, isDict } from '../callable.js';
/**
 * Base class for the evaluator.
 * Contains shared utilities used by all mixins.
 * All internal methods are protected to enable mixin access.
 */
export class EvaluatorBase {
    ctx;
    constructor(ctx) {
        this.ctx = ctx;
    }
    /**
     * Get source location from an AST node.
     * Used for error reporting with precise location information.
     */
    getNodeLocation(node) {
        return node?.span.start;
    }
    /**
     * Check if execution has been aborted via AbortSignal.
     * Throws AbortError if signal is aborted.
     */
    checkAborted(node) {
        if (this.ctx.signal?.aborted) {
            throw new AbortError(this.getNodeLocation(node));
        }
    }
    /**
     * Check if the current pipe value matches any autoException pattern.
     * Only checks string values. Throws AutoExceptionError on match.
     */
    checkAutoExceptions(value, node) {
        if (typeof value !== 'string' || this.ctx.autoExceptions.length === 0) {
            return;
        }
        for (const pattern of this.ctx.autoExceptions) {
            if (pattern.test(value)) {
                throw new AutoExceptionError(pattern.source, value, this.getNodeLocation(node));
            }
        }
    }
    /**
     * Wrap a promise with a timeout.
     * Returns original promise if no timeout configured.
     */
    withTimeout(promise, timeoutMs, functionName, node) {
        if (timeoutMs === undefined) {
            return promise;
        }
        return Promise.race([
            promise,
            new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new TimeoutError(functionName, timeoutMs, this.getNodeLocation(node)));
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
    handleCapture(_capture, _value) {
        throw new Error('handleCapture requires full Evaluator composition with VariablesMixin');
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
    async accessDictField(value, field, location, allowMissing = false) {
        if (!isDict(value)) {
            throw new RuntimeError('RILL-R003', `Cannot access field '${field}' on non-dict`, location);
        }
        const dictValue = value[field];
        // Check if field exists
        if (dictValue === undefined || dictValue === null) {
            if (allowMissing) {
                return null;
            }
            throw new RuntimeError('RILL-R009', `Dict has no field '${field}'`, location);
        }
        // Property-style callable: auto-invoke when accessed
        if (isCallable(dictValue)) {
            if (dictValue.isProperty) {
                // ApplicationCallable: pass [dict] as args (no boundDict mechanism)
                // ScriptCallable: pass [] - dict is bound via boundDict -> pipeValue
                const args = dictValue.kind === 'script' ? [] : [value];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return await this.invokeCallable(dictValue, args, location);
            }
        }
        return dictValue;
    }
}
//# sourceMappingURL=base.js.map