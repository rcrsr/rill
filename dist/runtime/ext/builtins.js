/**
 * Built-in Functions and Methods
 *
 * Minimal set of built-in operations. Host applications provide
 * domain-specific functions via RuntimeContext.
 *
 * @internal - Not part of public API
 */
import { callable, isCallable, isDict } from '../core/callable.js';
import { RILL_ERROR_CODES, RuntimeError } from '../../types.js';
import { deepEquals, formatValue, inferType, isEmpty, isRillIterator, } from '../core/values.js';
import { parse as contentParse, parseJson, extractXmlTag, extractFenceByLang, extractAllFences, parseFrontmatter, parseChecklist, } from './content-parser.js';
// ============================================================
// BUILT-IN FUNCTIONS
// ============================================================
/** Recursively remove closures from a value for JSON serialization */
function stripClosures(value) {
    if (isCallable(value)) {
        return undefined; // Will be filtered out
    }
    if (Array.isArray(value)) {
        return value.filter((v) => !isCallable(v)).map(stripClosures);
    }
    if (isDict(value)) {
        const result = {};
        for (const [k, v] of Object.entries(value)) {
            if (!isCallable(v)) {
                result[k] = stripClosures(v);
            }
        }
        return result;
    }
    return value;
}
// ============================================================
// ITERATOR HELPERS
// ============================================================
/**
 * Create an iterator for a list at the given index.
 * Returns { value, done, next } dict.
 */
function makeListIterator(list, index) {
    if (index >= list.length) {
        return { done: true, next: callable(() => makeListIterator(list, index)) };
    }
    return {
        value: list[index],
        done: false,
        next: callable(() => makeListIterator(list, index + 1)),
    };
}
/**
 * Create an iterator for a string at the given index.
 * Returns { value, done, next } dict.
 */
function makeStringIterator(str, index) {
    if (index >= str.length) {
        return { done: true, next: callable(() => makeStringIterator(str, index)) };
    }
    return {
        value: str[index],
        done: false,
        next: callable(() => makeStringIterator(str, index + 1)),
    };
}
/**
 * Create an iterator for a dict at the given index.
 * Dict iteration yields { key, value } entries sorted by key.
 */
function makeDictIterator(dict, index) {
    const keys = Object.keys(dict).sort();
    if (index >= keys.length) {
        return {
            done: true,
            next: callable(() => makeDictIterator(dict, index)),
        };
    }
    const key = keys[index];
    return {
        value: { key, value: dict[key] },
        done: false,
        next: callable(() => makeDictIterator(dict, index + 1)),
    };
}
/**
 * Check if a value is a rill iterator (dict with value, done, next fields).
 */
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
    /** Convert any value to JSON string (errors on direct closure, skips closures in containers) */
    json: (args, _ctx, location) => {
        const value = args[0] ?? null;
        if (isCallable(value)) {
            throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, 'Cannot serialize closure to JSON', location);
        }
        return JSON.stringify(stripClosures(value));
    },
    /** Parse JSON string to value (with automatic repair) */
    parse_json: (args) => {
        const text = formatValue(args[0] ?? '');
        return parseJson(text) ?? {};
    },
    /** Auto-detect and parse structured content from text */
    parse_auto: (args) => {
        const text = formatValue(args[0] ?? '');
        const result = contentParse(text);
        return {
            type: result.type,
            data: result.data,
            raw: result.raw,
            confidence: result.confidence,
            repaired: result.repaired,
            repairs: result.repairs,
        };
    },
    /** Extract content from XML tags */
    parse_xml: (args, ctx) => {
        // Check if called with explicit args (args[0] !== ctx.pipeValue)
        // vs piped value auto-pushed to args (args[0] === ctx.pipeValue)
        const hasExplicitArg = args.length > 0 && ctx.pipeValue !== null && args[0] !== ctx.pipeValue;
        const text = hasExplicitArg
            ? formatValue(ctx.pipeValue ?? '')
            : formatValue(args[0] ?? '');
        const tag = hasExplicitArg ? formatValue(args[0] ?? '') : undefined;
        if (tag) {
            return extractXmlTag(text, tag) ?? '';
        }
        // Without tag, parse returns all tags as dict via contentParse
        const result = contentParse(text, { prefer: 'xml' });
        if (result.type === 'xml' && typeof result.data === 'object') {
            return result.data;
        }
        return {};
    },
    /** Extract content from fenced code block */
    parse_fence: (args, ctx) => {
        // Check if called with explicit args (args[0] !== ctx.pipeValue)
        // vs piped value auto-pushed to args (args[0] === ctx.pipeValue)
        const hasExplicitArg = args.length > 0 && ctx.pipeValue !== null && args[0] !== ctx.pipeValue;
        const text = hasExplicitArg
            ? formatValue(ctx.pipeValue ?? '')
            : formatValue(args[0] ?? '');
        const lang = hasExplicitArg ? formatValue(args[0] ?? '') : undefined;
        if (lang) {
            return extractFenceByLang(text, lang) ?? '';
        }
        // Without lang, extract first fence
        const fences = extractAllFences(text);
        return fences.length > 0 ? fences[0].content : '';
    },
    /** Extract all fenced code blocks */
    parse_fences: (args) => {
        const text = formatValue(args[0] ?? '');
        return extractAllFences(text);
    },
    /** Extract YAML frontmatter and body */
    parse_frontmatter: (args) => {
        const text = formatValue(args[0] ?? '');
        const result = parseFrontmatter(text);
        return result ?? { meta: {}, body: '' };
    },
    /** Parse checklist items */
    parse_checklist: (args) => {
        const text = formatValue(args[0] ?? '');
        const items = parseChecklist(text);
        // Return as list of [checked, text] tuples per spec
        return items.map((item) => [item.checked, item.text]);
    },
    /**
     * Enumerate a list or dict, returning list of indexed dicts.
     * List: enumerate([10, 20]) -> [[index: 0, value: 10], [index: 1, value: 20]]
     * Dict: enumerate([a: 1]) -> [[index: 0, key: "a", value: 1]]
     */
    enumerate: (args) => {
        const input = args[0] ?? null;
        if (Array.isArray(input)) {
            return input.map((value, index) => ({ index, value }));
        }
        if (isDict(input)) {
            const keys = Object.keys(input).sort();
            return keys.map((key, index) => ({
                index,
                key,
                value: input[key],
            }));
        }
        return [];
    },
    /**
     * Create an iterator that generates a sequence of numbers.
     * range(start, end, step=1) - generates [start, start+step, ...] up to (but not including) end
     */
    range: (args, _ctx, location) => {
        const start = typeof args[0] === 'number' ? args[0] : 0;
        const end = typeof args[1] === 'number' ? args[1] : 0;
        const step = typeof args[2] === 'number' ? args[2] : 1;
        if (step === 0) {
            throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, 'range step cannot be zero', location);
        }
        const makeRangeIterator = (current) => {
            const done = step > 0 ? current >= end : step < 0 ? current <= end : true;
            if (done) {
                return {
                    done: true,
                    next: callable(() => makeRangeIterator(current)),
                };
            }
            return {
                value: current,
                done: false,
                next: callable(() => makeRangeIterator(current + step)),
            };
        };
        return makeRangeIterator(start);
    },
    /**
     * Create an iterator that repeats a value n times.
     * repeat(value, count) - generates value repeated count times
     */
    repeat: (args, _ctx, location) => {
        const value = args[0] ?? '';
        const count = typeof args[1] === 'number' ? Math.floor(args[1]) : 0;
        if (count < 0) {
            throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, 'repeat count cannot be negative', location);
        }
        const makeRepeatIterator = (remaining) => {
            if (remaining <= 0) {
                return {
                    done: true,
                    next: callable(() => makeRepeatIterator(0)),
                };
            }
            return {
                value,
                done: false,
                next: callable(() => makeRepeatIterator(remaining - 1)),
            };
        };
        return makeRepeatIterator(count);
    },
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
    head: (receiver, _args, _ctx, location) => {
        if (Array.isArray(receiver)) {
            if (receiver.length === 0) {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, 'Cannot get head of empty list', location);
            }
            return receiver[0];
        }
        if (typeof receiver === 'string') {
            if (receiver.length === 0) {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, 'Cannot get head of empty string', location);
            }
            return receiver[0];
        }
        throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `head requires list or string, got ${inferType(receiver)}`, location);
    },
    /** Get last element of array or last char of string */
    tail: (receiver, _args, _ctx, location) => {
        if (Array.isArray(receiver)) {
            if (receiver.length === 0) {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, 'Cannot get tail of empty list', location);
            }
            return receiver[receiver.length - 1];
        }
        if (typeof receiver === 'string') {
            if (receiver.length === 0) {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, 'Cannot get tail of empty string', location);
            }
            return receiver[receiver.length - 1];
        }
        throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `tail requires list or string, got ${inferType(receiver)}`, location);
    },
    /** Get iterator at first position for any collection */
    first: (receiver, _args, _ctx, location) => {
        // For iterators, return as-is (identity)
        if (isRillIterator(receiver)) {
            return receiver;
        }
        // For lists
        if (Array.isArray(receiver)) {
            return makeListIterator(receiver, 0);
        }
        // For strings
        if (typeof receiver === 'string') {
            return makeStringIterator(receiver, 0);
        }
        // For dicts
        if (isDict(receiver)) {
            return makeDictIterator(receiver, 0);
        }
        throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `first requires list, string, dict, or iterator, got ${inferType(receiver)}`, location);
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
    // === String methods ===
    /** Check if string starts with prefix */
    starts_with: (receiver, args) => {
        const str = formatValue(receiver);
        const prefix = formatValue(args[0] ?? '');
        return str.startsWith(prefix);
    },
    /** Check if string ends with suffix */
    ends_with: (receiver, args) => {
        const str = formatValue(receiver);
        const suffix = formatValue(args[0] ?? '');
        return str.endsWith(suffix);
    },
    /** Convert string to lowercase */
    lower: (receiver) => formatValue(receiver).toLowerCase(),
    /** Convert string to uppercase */
    upper: (receiver) => formatValue(receiver).toUpperCase(),
    /** Replace first regex match */
    replace: (receiver, args) => {
        const str = formatValue(receiver);
        const pattern = formatValue(args[0] ?? '');
        const replacement = formatValue(args[1] ?? '');
        try {
            return str.replace(new RegExp(pattern), replacement);
        }
        catch {
            return str;
        }
    },
    /** Replace all regex matches */
    replace_all: (receiver, args) => {
        const str = formatValue(receiver);
        const pattern = formatValue(args[0] ?? '');
        const replacement = formatValue(args[1] ?? '');
        try {
            return str.replace(new RegExp(pattern, 'g'), replacement);
        }
        catch {
            return str;
        }
    },
    /** Check if string contains substring */
    contains: (receiver, args) => {
        const str = formatValue(receiver);
        const search = formatValue(args[0] ?? '');
        return str.includes(search);
    },
    /**
     * First regex match info, or empty dict if no match.
     * Returns: [matched: string, index: number, groups: []]
     */
    match: (receiver, args) => {
        const str = formatValue(receiver);
        const pattern = formatValue(args[0] ?? '');
        try {
            const m = new RegExp(pattern).exec(str);
            if (!m)
                return {};
            return {
                matched: m[0],
                index: m.index,
                groups: m.slice(1),
            };
        }
        catch {
            return {};
        }
    },
    /** True if regex matches anywhere in string */
    is_match: (receiver, args) => {
        const str = formatValue(receiver);
        const pattern = formatValue(args[0] ?? '');
        try {
            return new RegExp(pattern).test(str);
        }
        catch {
            return false;
        }
    },
    /** Position of first substring occurrence (-1 if not found) */
    index_of: (receiver, args) => {
        const str = formatValue(receiver);
        const search = formatValue(args[0] ?? '');
        return str.indexOf(search);
    },
    /** Repeat string n times */
    repeat: (receiver, args) => {
        const str = formatValue(receiver);
        const n = typeof args[0] === 'number' ? Math.max(0, Math.floor(args[0])) : 0;
        return str.repeat(n);
    },
    /** Pad start to length with fill string */
    pad_start: (receiver, args) => {
        const str = formatValue(receiver);
        const length = typeof args[0] === 'number' ? args[0] : str.length;
        const fill = typeof args[1] === 'string' ? args[1] : ' ';
        return str.padStart(length, fill);
    },
    /** Pad end to length with fill string */
    pad_end: (receiver, args) => {
        const str = formatValue(receiver);
        const length = typeof args[0] === 'number' ? args[0] : str.length;
        const fill = typeof args[1] === 'string' ? args[1] : ' ';
        return str.padEnd(length, fill);
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