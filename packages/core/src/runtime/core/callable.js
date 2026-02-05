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
import { RuntimeError } from '../../types.js';
import { astEquals } from './equals.js';
import { formatValue, inferType, isTuple } from './values.js';
/** Type guard for any callable */
export function isCallable(value) {
    return (typeof value === 'object' &&
        value !== null &&
        '__type' in value &&
        value.__type === 'callable');
}
/** Type guard for script callable */
export function isScriptCallable(value) {
    return isCallable(value) && value.kind === 'script';
}
/** Type guard for runtime callable */
export function isRuntimeCallable(value) {
    return isCallable(value) && value.kind === 'runtime';
}
/** Type guard for application callable */
export function isApplicationCallable(value) {
    return isCallable(value) && value.kind === 'application';
}
/**
 * Create an application callable from a host function.
 * Creates an untyped callable (params: undefined) that skips validation.
 * @param fn The function to wrap
 * @param isProperty If true, auto-invokes when accessed from dict (property-style)
 */
export function callable(fn, isProperty = false) {
    return {
        __type: 'callable',
        kind: 'application',
        params: undefined,
        fn,
        isProperty,
    };
}
/** Type guard for dict (plain object, not array, not callable, not tuple) */
export function isDict(value) {
    return (typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        !isCallable(value) &&
        !isTuple(value));
}
/** Format a callable for display */
export function formatCallable(callable) {
    if (callable.kind === 'script') {
        const paramStr = callable.params.map((p) => p.name).join(', ');
        return `(${paramStr}) { ... }`;
    }
    return '(...) { [native] }';
}
/**
 * Compare two annotation records for equality.
 * Returns true if both records have the same keys and values.
 */
function annotationsEqual(a, b, valueEquals) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length)
        return false;
    for (const key of keysA) {
        if (!(key in b))
            return false;
        if (!valueEquals(a[key], b[key]))
            return false;
    }
    return true;
}
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
export function callableEquals(a, b, valueEquals = (x, y) => formatValue(x) === formatValue(y)) {
    // Compare params (name, type, default, annotations)
    if (a.params.length !== b.params.length)
        return false;
    for (let i = 0; i < a.params.length; i++) {
        const ap = a.params[i];
        const bp = b.params[i];
        if (ap === undefined || bp === undefined)
            return false;
        if (ap.name !== bp.name)
            return false;
        if (ap.typeName !== bp.typeName)
            return false;
        if (!valueEquals(ap.defaultValue ?? null, bp.defaultValue ?? null)) {
            return false;
        }
        if (!annotationsEqual(ap.annotations, bp.annotations, valueEquals)) {
            return false;
        }
    }
    // Compare body by AST structure (ignoring source locations)
    if (!astEquals(a.body, b.body)) {
        return false;
    }
    // Compare defining scope by reference (same scope = same closure context)
    if (a.definingScope !== b.definingScope)
        return false;
    // Compare closure-level annotations
    if (!annotationsEqual(a.annotations, b.annotations, valueEquals)) {
        return false;
    }
    // Compare parameter-level annotations
    const paramNamesA = Object.keys(a.paramAnnotations);
    const paramNamesB = Object.keys(b.paramAnnotations);
    if (paramNamesA.length !== paramNamesB.length)
        return false;
    for (const paramName of paramNamesA) {
        if (!(paramName in b.paramAnnotations))
            return false;
        const annotsA = a.paramAnnotations[paramName];
        const annotsB = b.paramAnnotations[paramName];
        if (annotsA === undefined || annotsB === undefined)
            return false;
        if (!annotationsEqual(annotsA, annotsB, valueEquals)) {
            return false;
        }
    }
    return true;
}
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
export function validateDefaultValueType(param, _functionName) {
    if (param.defaultValue === undefined)
        return;
    const actualType = inferType(param.defaultValue);
    const expectedType = param.type;
    if (actualType !== expectedType) {
        throw new Error(`Invalid defaultValue for parameter '${param.name}': expected ${expectedType}, got ${actualType}`);
    }
}
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
export function validateReturnType(returnType, functionName) {
    const validTypes = [
        'string',
        'number',
        'bool',
        'list',
        'dict',
        'any',
    ];
    if (!validTypes.includes(returnType)) {
        throw new Error(`Invalid returnType for function '${functionName}': expected one of string, number, bool, list, dict, any`);
    }
}
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
export function validateHostFunctionArgs(args, params, functionName, location) {
    // Check for excess arguments
    if (args.length > params.length) {
        throw new RuntimeError('RILL-R001', `Function '${functionName}' expects ${params.length} arguments, got ${args.length}`, location, {
            functionName,
            expectedCount: params.length,
            actualCount: args.length,
        });
    }
    // Validate each parameter
    for (let i = 0; i < params.length; i++) {
        const param = params[i];
        if (param === undefined)
            continue;
        let arg = args[i];
        // Handle missing argument
        if (arg === undefined) {
            if (param.defaultValue !== undefined) {
                // Substitute default value (already validated at registration)
                arg = param.defaultValue;
                args[i] = arg;
            }
            else {
                // Missing required argument
                throw new RuntimeError('RILL-R001', `Missing required argument '${param.name}' for function '${functionName}'`, location, {
                    functionName,
                    paramName: param.name,
                });
            }
        }
        // Validate argument type
        const actualType = inferType(arg);
        const expectedType = param.type;
        if (actualType !== expectedType) {
            throw new RuntimeError('RILL-R001', `Type mismatch in ${functionName}: parameter '${param.name}' expects ${expectedType}, got ${actualType}`, location, {
                functionName,
                paramName: param.name,
                expectedType,
                actualType,
            });
        }
    }
}
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
export function validateCallableArgs(args, params, functionName, location) {
    // Check for excess arguments
    if (args.length > params.length) {
        throw new RuntimeError('RILL-R001', `Function '${functionName}' expects ${params.length} arguments, got ${args.length}`, location, {
            functionName,
            expectedCount: params.length,
            actualCount: args.length,
        });
    }
    // Validate each parameter
    for (let i = 0; i < params.length; i++) {
        const param = params[i];
        if (param === undefined)
            continue;
        let arg = args[i];
        // Handle missing argument
        if (arg === undefined) {
            if (param.defaultValue !== null) {
                // Substitute default value
                arg = param.defaultValue;
                args[i] = arg;
            }
            else {
                // Missing required argument
                throw new RuntimeError('RILL-R001', `Missing required argument '${param.name}' for function '${functionName}'`, location, {
                    functionName,
                    paramName: param.name,
                });
            }
        }
        // Validate argument type (only for typed parameters)
        if (param.typeName !== null) {
            const actualType = inferType(arg);
            const expectedType = param.typeName;
            if (actualType !== expectedType) {
                throw new RuntimeError('RILL-R001', `Type mismatch in ${functionName}: parameter '${param.name}' expects ${expectedType}, got ${actualType}`, location, {
                    functionName,
                    paramName: param.name,
                    expectedType,
                    actualType,
                });
            }
        }
    }
}
//# sourceMappingURL=callable.js.map