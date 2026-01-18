/**
 * Rill Value Types and Utilities
 *
 * Core value types that flow through Rill programs.
 * Public API for host applications.
 */
import { callableEquals, isScriptCallable } from './callable.js';
/** Type guard for RillArgs */
export function isArgs(value) {
    return (typeof value === 'object' &&
        value !== null &&
        '__rill_args' in value &&
        value.__rill_args === true);
}
/** Create args from a tuple (positional) */
export function createArgsFromTuple(tuple) {
    const entries = new Map();
    for (let i = 0; i < tuple.length; i++) {
        const val = tuple[i];
        if (val !== undefined) {
            entries.set(i, val);
        }
    }
    return { __rill_args: true, entries };
}
/** Create args from a dict (named) */
export function createArgsFromDict(dict) {
    const entries = new Map();
    for (const [key, value] of Object.entries(dict)) {
        entries.set(key, value);
    }
    return { __rill_args: true, entries };
}
/** Infer the Rill type from a runtime value */
export function inferType(value) {
    if (value === null)
        return 'string'; // null treated as empty string
    if (typeof value === 'string')
        return 'string';
    if (typeof value === 'number')
        return 'number';
    if (typeof value === 'boolean')
        return 'bool';
    if (isArgs(value))
        return 'args';
    if (Array.isArray(value))
        return 'tuple';
    if (typeof value === 'object' && '__type' in value && value.__type === 'callable') {
        return 'closure';
    }
    if (typeof value === 'object')
        return 'dict';
    return 'string'; // fallback
}
/** Check if a value is truthy in Rill semantics */
export function isTruthy(value) {
    if (value === null)
        return false;
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'number')
        return value !== 0;
    if (typeof value === 'string')
        return value.length > 0;
    if (isArgs(value))
        return value.entries.size > 0;
    if (Array.isArray(value))
        return value.length > 0;
    if (typeof value === 'object') {
        if ('__type' in value && value.__type === 'callable')
            return true;
        return Object.keys(value).length > 0;
    }
    return true;
}
/** Check if a value is empty (inverse of truthy) */
export function isEmpty(value) {
    return !isTruthy(value);
}
/** Format a value for display */
export function formatValue(value) {
    if (value === null)
        return '';
    if (typeof value === 'string')
        return value;
    if (typeof value === 'number')
        return String(value);
    if (typeof value === 'boolean')
        return value ? 'true' : 'false';
    if (isArgs(value)) {
        const parts = [];
        for (const [key, val] of value.entries) {
            if (typeof key === 'number') {
                parts.push(formatValue(val));
            }
            else {
                parts.push(`${key}: ${formatValue(val)}`);
            }
        }
        return `*[${parts.join(', ')}]`;
    }
    if (typeof value === 'object' && '__type' in value && value.__type === 'callable') {
        // Basic callable formatting - full formatting in callable.ts
        return '(...) { ... }';
    }
    if (Array.isArray(value))
        return JSON.stringify(value);
    return JSON.stringify(value);
}
/**
 * Deep structural equality for all Rill values.
 * - Primitives: value equality
 * - Tuples: length + recursive element equality
 * - Dicts: same keys + recursive value equality (order-independent)
 */
export function deepEquals(a, b) {
    // Handle primitives and null
    if (a === b)
        return true;
    if (a === null || b === null)
        return false;
    if (typeof a !== typeof b)
        return false;
    // Primitives (string, number, boolean) - covered by === above
    if (typeof a !== 'object' || typeof b !== 'object')
        return false;
    // Both are non-null objects at this point
    const aObj = a;
    const bObj = b;
    // Check for args
    const aIsArgs = isArgs(a);
    const bIsArgs = isArgs(b);
    if (aIsArgs !== bIsArgs)
        return false;
    if (aIsArgs && bIsArgs) {
        if (a.entries.size !== b.entries.size)
            return false;
        for (const [key, aVal] of a.entries) {
            const bVal = b.entries.get(key);
            if (bVal === undefined || !deepEquals(aVal, bVal))
                return false;
        }
        return true;
    }
    // Check for arrays (tuples)
    const aIsArray = Array.isArray(a);
    const bIsArray = Array.isArray(b);
    if (aIsArray !== bIsArray)
        return false;
    if (aIsArray && bIsArray) {
        if (a.length !== b.length)
            return false;
        for (let i = 0; i < a.length; i++) {
            const aElem = a[i];
            const bElem = b[i];
            if (aElem === undefined || bElem === undefined) {
                if (aElem !== bElem)
                    return false;
            }
            else if (!deepEquals(aElem, bElem)) {
                return false;
            }
        }
        return true;
    }
    // Both are dicts (plain objects) or callables
    // For script callables, use structural equality (params + body AST + captured values)
    // For runtime/application callables, use reference equality
    if ('__type' in aObj || '__type' in bObj) {
        // Both must be callables to be equal
        if (!('__type' in aObj) || !('__type' in bObj))
            return false;
        if (aObj.__type !== 'callable' || bObj.__type !== 'callable')
            return false;
        // Script callables: structural equality
        if (isScriptCallable(a) && isScriptCallable(b)) {
            return callableEquals(a, b, deepEquals);
        }
        // Runtime/application callables: reference equality
        return a === b;
    }
    const aDict = a;
    const bDict = b;
    const aKeys = Object.keys(aDict);
    const bKeys = Object.keys(bDict);
    if (aKeys.length !== bKeys.length)
        return false;
    for (const key of aKeys) {
        if (!(key in bDict))
            return false;
        const aVal = aDict[key];
        const bVal = bDict[key];
        if (aVal === undefined || bVal === undefined) {
            if (aVal !== bVal)
                return false;
        }
        else if (!deepEquals(aVal, bVal)) {
            return false;
        }
    }
    return true;
}
/** Reserved dict method names that cannot be overridden */
export const RESERVED_DICT_METHODS = ['keys', 'values', 'entries'];
/** Check if a key name is reserved */
export function isReservedMethod(name) {
    return RESERVED_DICT_METHODS.includes(name);
}
//# sourceMappingURL=values.js.map