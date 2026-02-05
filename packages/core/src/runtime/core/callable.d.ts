/**
 * Callable Types
 *
 * Unified representation for all callable values in Rill:
 * - ScriptCallable: Closures parsed from Rill source code
 * - RuntimeCallable: Rill's built-in functions (type, log, json, identity)
 * - ApplicationCallable: Host application-provided functions
 *
 * Public API for host applications.
 *
 * ## Implementation Notes
 *
 * [DEVIATION] EC-1 Error Context Fields
 * - Spec defines error context as { functionName, paramName, expectedType, actualType }
 * - EC-1 (excess arguments) uses { functionName, expectedCount, actualCount }
 * - Rationale: Excess arguments is an arity check, not a type check
 *
 * [ASSUMPTION] validateDefaultValueType _functionName Parameter
 * - Parameter accepted but unused (prefixed with _ to satisfy eslint)
 * - Kept for API consistency with validateHostFunctionArgs signature
 *
 * [ASSUMPTION] validateHostFunctionArgs Args Array Mutation
 * - args array mutated in-place when substituting default values
 * - Per spec algorithm: "Apply default values for missing arguments before validation"
 * - Mutation occurs before host function receives args, maintaining immutability contract
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
/**
 * Parameter definition for script closures.
 *
 * Annotations are captured at closure creation time and stored as evaluated values.
 * Empty object ({}) when no annotations present.
 */
export interface CallableParam {
    readonly name: string;
    readonly typeName: 'string' | 'number' | 'bool' | 'list' | 'dict' | null;
    readonly defaultValue: RillValue | null;
    /** Evaluated parameter-level annotations (e.g., ^(cache: true)) */
    readonly annotations: Record<string, RillValue>;
    /** Human-readable parameter description (optional, from host functions) */
    readonly description?: string;
}
/**
 * Return type declaration for host-provided functions.
 * Limited to 5 primitive types plus 'any' (default).
 */
export type RillFunctionReturnType = 'string' | 'number' | 'bool' | 'list' | 'dict' | 'any';
/**
 * Parameter metadata for host-provided functions.
 *
 * Parameters without defaultValue are required.
 * Parameters with defaultValue are optional.
 */
export interface HostFunctionParam {
    /** Parameter name (for error messages and documentation) */
    readonly name: string;
    /** Expected type: limited to 5 primitive types */
    readonly type: 'string' | 'number' | 'bool' | 'list' | 'dict';
    /** Default value if argument omitted. Makes parameter optional. */
    readonly defaultValue?: RillValue;
    /** Human-readable parameter description (optional) */
    readonly description?: string;
}
/**
 * Host function with required parameter type declarations.
 *
 * Runtime validates arguments before invocation.
 */
export interface HostFunctionDefinition {
    /** Parameter declarations (required) */
    readonly params: readonly HostFunctionParam[];
    /** Function implementation (receives validated args) */
    readonly fn: CallableFn;
    /** Human-readable function description (optional) */
    readonly description?: string;
    /** Declared return type (default: 'any') */
    readonly returnType?: RillFunctionReturnType;
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
/**
 * Script callable - parsed from Rill source code.
 *
 * Carries closure-level and parameter-level annotations captured at creation time.
 * Both annotation fields default to empty objects ({}) when no annotations present.
 */
export interface ScriptCallable extends CallableBase {
    readonly kind: 'script';
    readonly params: CallableParam[];
    readonly body: BodyNode;
    /** Reference to the scope where this closure was defined (late binding) */
    readonly definingScope: RuntimeContextLike;
    /** Evaluated closure-level annotations (e.g., ^(timeout: 30)) */
    readonly annotations: Record<string, RillValue>;
    /** Evaluated parameter annotations keyed by parameter name */
    readonly paramAnnotations: Record<string, Record<string, RillValue>>;
}
/** Runtime callable - Rill's built-in functions (type, log, json, identity) */
export interface RuntimeCallable extends CallableBase {
    readonly kind: 'runtime';
    readonly fn: CallableFn;
}
/** Application callable - host application-provided functions */
export interface ApplicationCallable extends CallableBase {
    readonly kind: 'application';
    readonly params: CallableParam[] | undefined;
    readonly fn: CallableFn;
    /** Human-readable function description (optional, from host functions) */
    readonly description?: string;
    /** Return type declaration (optional, from host functions) */
    readonly returnType?: RillFunctionReturnType;
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
 * Creates an untyped callable (params: undefined) that skips validation.
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
 * Compares params, body AST structure, defining scope, and annotations.
 *
 * Two closures are equal if:
 * 1. Same parameter names, types, default values, and annotations
 * 2. Structurally identical body AST (ignoring source locations)
 * 3. Same defining scope (reference equality)
 * 4. Same closure-level annotations
 * 5. Same parameter-level annotations
 */
export declare function callableEquals(a: ScriptCallable, b: ScriptCallable, valueEquals?: (a: RillValue, b: RillValue) => boolean): boolean;
/**
 * Validate defaultValue type matches declared parameter type.
 *
 * Called at registration time to catch configuration errors early.
 * Throws Error (not RuntimeError) to indicate registration failure.
 *
 * @param param - Parameter with defaultValue to validate
 * @param _functionName - Function name (unused, kept for API consistency)
 * @throws Error if defaultValue type doesn't match param.type
 */
export declare function validateDefaultValueType(param: HostFunctionParam, _functionName: string): void;
/**
 * Validate returnType is a valid RillFunctionReturnType literal.
 *
 * Called at registration time to catch configuration errors early.
 * Throws Error (not RuntimeError) to indicate registration failure.
 *
 * @param returnType - Return type value to validate
 * @param functionName - Function name for error messages
 * @throws Error if returnType is not a valid literal
 */
export declare function validateReturnType(returnType: unknown, functionName: string): void;
/**
 * Validate host function arguments against parameter declarations.
 *
 * Called before function invocation to enforce type contracts.
 * Throws RuntimeError on validation failure.
 *
 * @param args - Evaluated arguments from call site
 * @param params - Parameter declarations from function definition
 * @param functionName - Function name for error messages
 * @param location - Source location for error reporting
 * @throws RuntimeError with RUNTIME_TYPE_ERROR on validation failure
 */
export declare function validateHostFunctionArgs(args: RillValue[], params: readonly HostFunctionParam[], functionName: string, location?: SourceLocation): void;
/**
 * Validate arguments against CallableParam[] for ApplicationCallable.
 *
 * Similar to validateHostFunctionArgs but works with CallableParam[] (used in ApplicationCallable).
 * Validates argument count, applies defaults, and checks types for primitive parameters.
 *
 * @param args - Arguments array (mutated in-place when defaults applied)
 * @param params - Parameter definitions
 * @param functionName - Function name for error messages
 * @param location - Source location for error reporting
 * @throws RuntimeError with RUNTIME_TYPE_ERROR on validation failure
 */
export declare function validateCallableArgs(args: RillValue[], params: readonly CallableParam[], functionName: string, location?: SourceLocation): void;
export {};
//# sourceMappingURL=callable.d.ts.map