/**
 * Callable Types
 *
 * Unified representation for all callable values in Rill:
 * - ScriptCallable: Closures parsed from Rill source code
 * - RuntimeCallable: Rill's built-in functions (type, log, json, identity)
 * - ApplicationCallable: Host application-provided functions
 *
 * Public API for host applications.
 */
import type { BodyNode, SourceLocation } from '../../types.js';
import type { RillValue } from './values.js';
interface RuntimeContextLike {
    readonly parent?: RuntimeContextLike | undefined;
    readonly variables: Map<string, RillValue>;
    pipeValue: RillValue;
}
/**
 * Callable function signature.
 * Used for both host-provided functions and runtime callables.
 */
export type CallableFn = (args: RillValue[], ctx: RuntimeContextLike, location?: SourceLocation) => RillValue | Promise<RillValue>;
/** Parameter definition for script closures */
export interface CallableParam {
    readonly name: string;
    readonly typeName: 'string' | 'number' | 'bool' | null;
    readonly defaultValue: RillValue | null;
}
/** Common fields for all callable types */
interface CallableBase {
    readonly __type: 'callable';
    /**
     * Property-style callable: auto-invoked when accessed from a dict.
     * For script callables, $ is bound to the containing dict.
     * For runtime callables, the dict is passed as first argument.
     */
    readonly isProperty: boolean;
    /** Reference to containing dict (set when stored in a dict) */
    boundDict?: Record<string, RillValue>;
}
/** Script callable - parsed from Rill source code */
export interface ScriptCallable extends CallableBase {
    readonly kind: 'script';
    readonly params: CallableParam[];
    readonly body: BodyNode;
    /** Reference to the scope where this closure was defined (late binding) */
    readonly definingScope: RuntimeContextLike;
}
/** Runtime callable - Rill's built-in functions (type, log, json, identity) */
export interface RuntimeCallable extends CallableBase {
    readonly kind: 'runtime';
    readonly fn: CallableFn;
}
/** Application callable - host application-provided functions */
export interface ApplicationCallable extends CallableBase {
    readonly kind: 'application';
    readonly fn: CallableFn;
}
/** Union of all callable types */
export type RillCallable = ScriptCallable | RuntimeCallable | ApplicationCallable;
/** Type guard for any callable */
export declare function isCallable(value: RillValue): value is RillCallable;
/** Type guard for script callable */
export declare function isScriptCallable(value: RillValue): value is ScriptCallable;
/** Type guard for runtime callable */
export declare function isRuntimeCallable(value: RillValue): value is RuntimeCallable;
/** Type guard for application callable */
export declare function isApplicationCallable(value: RillValue): value is ApplicationCallable;
/**
 * Create an application callable from a host function.
 * @param fn The function to wrap
 * @param isProperty If true, auto-invokes when accessed from dict (property-style)
 */
export declare function callable(fn: CallableFn, isProperty?: boolean): ApplicationCallable;
/** Type guard for dict (plain object, not array, not callable, not tuple) */
export declare function isDict(value: RillValue): value is Record<string, RillValue>;
/** Format a callable for display */
export declare function formatCallable(callable: RillCallable): string;
/**
 * Deep equality for script callables.
 * Compares params, body AST structure, and defining scope.
 *
 * Two closures are equal if:
 * 1. Same parameter names, types, and default values
 * 2. Structurally identical body AST (ignoring source locations)
 * 3. Same defining scope (reference equality)
 */
export declare function callableEquals(a: ScriptCallable, b: ScriptCallable, valueEquals?: (a: RillValue, b: RillValue) => boolean): boolean;
export {};
//# sourceMappingURL=callable.d.ts.map