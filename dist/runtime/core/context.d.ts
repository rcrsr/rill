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
//# sourceMappingURL=context.d.ts.map