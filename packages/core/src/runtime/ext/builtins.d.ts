/**
 * Built-in Functions and Methods
 *
 * Minimal set of built-in operations. Host applications provide
 * domain-specific functions via RuntimeContext.
 *
 * @internal - Not part of public API
 */
import type { CallableFn } from '../core/callable.js';
import type { RillMethod } from '../core/types.js';
/**
 * Check if a value is a rill iterator (dict with value, done, next fields).
 */
export declare const BUILTIN_FUNCTIONS: Record<string, CallableFn>;
export declare const BUILTIN_METHODS: Record<string, RillMethod>;
//# sourceMappingURL=builtins.d.ts.map