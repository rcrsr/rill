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
import { astEquals } from './equals.js';
import { formatValue, isTuple } from './values.js';
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
 * @param fn The function to wrap
 * @param isProperty If true, auto-invokes when accessed from dict (property-style)
 */
export function callable(fn, isProperty = false) {
    return { __type: 'callable', kind: 'application', fn, isProperty };
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
 * Deep equality for script callables.
 * Compares params, body AST structure, and defining scope.
 *
 * Two closures are equal if:
 * 1. Same parameter names, types, and default values
 * 2. Structurally identical body AST (ignoring source locations)
 * 3. Same defining scope (reference equality)
 */
export function callableEquals(a, b, valueEquals = (x, y) => formatValue(x) === formatValue(y)) {
    // Compare params (name, type, default)
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
    }
    // Compare body by AST structure (ignoring source locations)
    if (!astEquals(a.body, b.body)) {
        return false;
    }
    // Compare defining scope by reference (same scope = same closure context)
    if (a.definingScope !== b.definingScope)
        return false;
    return true;
}
//# sourceMappingURL=callable.js.map