/**
 * Runtime Context Factory
 *
 * Creates and configures the runtime context for script execution.
 * Public API for host applications.
 */
import type { RuntimeContext, RuntimeOptions } from './types.js';
import { type RillValue } from './values.js';
/**
 * Create a runtime context for script execution.
 * This is the main entry point for configuring the Rill runtime.
 */
export declare function createRuntimeContext(options?: RuntimeOptions): RuntimeContext;
/**
 * Create a child context for block scoping.
 * Child inherits parent's functions, methods, callbacks, etc.
 * but has its own variables map. Variable lookups walk the parent chain.
 */
export declare function createChildContext(parent: RuntimeContext): RuntimeContext;
/**
 * Get a variable value, walking the parent chain.
 * Returns undefined if not found in any scope.
 */
export declare function getVariable(ctx: RuntimeContext, name: string): RillValue | undefined;
/**
 * Check if a variable exists in any scope.
 */
export declare function hasVariable(ctx: RuntimeContext, name: string): boolean;
/**
 * Extract call stack from RuntimeError.
 * Returns empty array if no call stack attached.
 *
 * Constraints:
 * - O(1) access (stored on error instance)
 * - Returns defensive copy (immutable)
 */
export declare function getCallStack(error: import('../../types.js').RillError): readonly import('../../types.js').CallFrame[];
/**
 * Push frame onto call stack before function/closure execution.
 *
 * Constraints:
 * - Stack depth limited by maxCallStackDepth option
 * - Older frames dropped when limit exceeded
 */
export declare function pushCallFrame(ctx: RuntimeContext, frame: import('../../types.js').CallFrame): void;
/**
 * Pop frame from call stack after function/closure returns.
 */
export declare function popCallFrame(ctx: RuntimeContext): void;
//# sourceMappingURL=context.d.ts.map