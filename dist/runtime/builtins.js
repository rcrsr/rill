/**
 * Built-in Functions and Methods
 *
 * Minimal set of built-in operations. Host applications provide
 * domain-specific functions via RuntimeContext.
 *
 * @internal - Not part of public API
 */
import { isDict } from './callable.js';
import { deepEquals, formatValue, inferType, isEmpty } from './values.js';
// ============================================================
// BUILT-IN FUNCTIONS
// ============================================================
export const BUILTIN_FUNCTIONS = {
    /** Identity function - returns its argument */
    identity: (args) => args[0] ?? null,
    /** Return the type name of a value */
    type: (args) => inferType(args[0] ?? null),
    /** Log a value and return it unchanged (passthrough) */
    log: (args, ctx) => {
        const value = args[0] ?? null;
        // ctx is RuntimeContext but CallableFn uses a minimal interface
        ctx.callbacks.onLog(value);
        return value;
    },
    /** Convert any value to JSON string */
    json: (args) => JSON.stringify(args[0] ?? null),
};
// ============================================================
// BUILT-IN METHODS
// ============================================================
/** Factory for comparison methods (lt, gt, le, ge) */
function createComparisonMethod(compare) {
    return (receiver, args) => {
        const arg = args[0];
        if (typeof receiver === 'number' && typeof arg === 'number') {
            return compare(receiver, arg);
        }
        return compare(formatValue(receiver), formatValue(arg ?? ''));
    };
}
export const BUILTIN_METHODS = {
    // === Conversion methods ===
    /** Convert value to string */
    str: (receiver) => formatValue(receiver),
    /** Convert value to number */
    num: (receiver) => {
        if (typeof receiver === 'number')
            return receiver;
        if (typeof receiver === 'string') {
            const n = parseFloat(receiver);
            if (!isNaN(n))
                return n;
        }
        if (typeof receiver === 'boolean')
            return receiver ? 1 : 0;
        return 0;
    },
    /** Get length of string or array */
    len: (receiver) => {
        if (typeof receiver === 'string')
            return receiver.length;
        if (Array.isArray(receiver))
            return receiver.length;
        if (receiver && typeof receiver === 'object') {
            return Object.keys(receiver).length;
        }
        return 0;
    },
    /** Trim whitespace from string */
    trim: (receiver) => formatValue(receiver).trim(),
    // === Element access methods ===
    /** Get first element of array or first char of string */
    first: (receiver) => {
        if (Array.isArray(receiver))
            return receiver[0] ?? null;
        if (typeof receiver === 'string')
            return receiver[0] ?? '';
        return null;
    },
    /** Get last element of array or last char of string */
    last: (receiver) => {
        if (Array.isArray(receiver))
            return receiver[receiver.length - 1] ?? null;
        if (typeof receiver === 'string') {
            return receiver[receiver.length - 1] ?? '';
        }
        return null;
    },
    /** Get element at index */
    at: (receiver, args) => {
        const idx = typeof args[0] === 'number' ? args[0] : 0;
        if (Array.isArray(receiver))
            return receiver[idx] ?? null;
        if (typeof receiver === 'string')
            return receiver[idx] ?? '';
        return null;
    },
    // === String operations ===
    /** Split string by separator (default: newline) */
    split: (receiver, args) => {
        const str = formatValue(receiver);
        const sep = typeof args[0] === 'string' ? args[0] : '\n';
        return str.split(sep);
    },
    /** Join array elements with separator (default: comma) */
    join: (receiver, args) => {
        const sep = typeof args[0] === 'string' ? args[0] : ',';
        if (!Array.isArray(receiver))
            return formatValue(receiver);
        return receiver.map(formatValue).join(sep);
    },
    /** Split string into lines (same as .split but newline only) */
    lines: (receiver) => {
        const str = formatValue(receiver);
        return str.split('\n');
    },
    // === Utility methods ===
    /** Check if value is empty */
    empty: (receiver) => isEmpty(receiver),
    // === Pattern matching methods ===
    /** Check if string contains substring */
    contains: (receiver, args) => {
        const str = formatValue(receiver);
        const search = formatValue(args[0] ?? '');
        return str.includes(search);
    },
    /** Match regex pattern and return capture groups as tuple. Empty tuple = no match. */
    matches: (receiver, args) => {
        const str = formatValue(receiver);
        const pattern = formatValue(args[0] ?? '');
        try {
            const match = new RegExp(pattern).exec(str);
            if (!match)
                return [];
            // Return capture groups (index 1+), or full match if no groups
            const groups = match.slice(1);
            return groups.length > 0 ? groups : [match[0]];
        }
        catch {
            return [];
        }
    },
    // === Comparison methods ===
    /** Equality check (deep structural comparison) */
    eq: (receiver, args) => deepEquals(receiver, args[0] ?? null),
    /** Inequality check (deep structural comparison) */
    ne: (receiver, args) => !deepEquals(receiver, args[0] ?? null),
    /** Less than */
    lt: createComparisonMethod((a, b) => a < b),
    /** Greater than */
    gt: createComparisonMethod((a, b) => a > b),
    /** Less than or equal */
    le: createComparisonMethod((a, b) => a <= b),
    /** Greater than or equal */
    ge: createComparisonMethod((a, b) => a >= b),
    // === Dict methods (reserved) ===
    /** Get all keys of a dict as a tuple of strings */
    keys: (receiver) => {
        if (isDict(receiver)) {
            return Object.keys(receiver);
        }
        return [];
    },
    /** Get all values of a dict as a tuple */
    values: (receiver) => {
        if (isDict(receiver)) {
            return Object.values(receiver);
        }
        return [];
    },
    /** Get all entries of a dict as a tuple of [key, value] pairs */
    entries: (receiver) => {
        if (isDict(receiver)) {
            return Object.entries(receiver).map(([k, v]) => [k, v]);
        }
        return [];
    },
};
//# sourceMappingURL=builtins.js.map