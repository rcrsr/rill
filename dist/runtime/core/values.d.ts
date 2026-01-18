/**
 * Rill Value Types and Utilities
 *
 * Core value types that flow through Rill programs.
 * Public API for host applications.
 */
import type { RillTypeName } from '../../types.js';
interface CallableMarker {
    readonly __type: 'callable';
}
/**
 * Tuple type - represents unpacked arguments for closure invocation.
 * Created by the * (spread) operator from lists or dicts.
 * Entries are keyed by position (number) or name (string).
 *
 * Note: In Rill, "tuple" refers to fixed-size argument packing (like function signatures),
 * while "list" refers to dynamic ordered collections ([1, 2, 3]).
 */
export interface RillTuple {
    readonly __rill_tuple: true;
    readonly entries: Map<string | number, RillValue>;
}
/** Any value that can flow through Rill */
export type RillValue = string | number | boolean | null | RillValue[] | {
    [key: string]: RillValue;
} | CallableMarker | RillTuple;
/** Type guard for RillTuple (spread args) */
export declare function isTuple(value: RillValue): value is RillTuple;
/** Create tuple from a list (positional) */
export declare function createTupleFromList(list: RillValue[]): RillTuple;
/** Create tuple from a dict (named) */
export declare function createTupleFromDict(dict: Record<string, RillValue>): RillTuple;
/** Infer the Rill type from a runtime value */
export declare function inferType(value: RillValue): RillTypeName;
/**
 * Check if a value is of the expected type.
 * Returns true if the value matches the expected type, false otherwise.
 */
export declare function checkType(value: RillValue, expected: RillTypeName): boolean;
/** Check if a value is truthy in Rill semantics */
export declare function isTruthy(value: RillValue): boolean;
/** Check if a value is empty (inverse of truthy) */
export declare function isEmpty(value: RillValue): boolean;
/** Format a value for display */
export declare function formatValue(value: RillValue): string;
/**
 * Deep structural equality for all Rill values.
 * - Primitives: value equality
 * - Tuples: length + recursive element equality
 * - Dicts: same keys + recursive value equality (order-independent)
 */
export declare function deepEquals(a: RillValue, b: RillValue): boolean;
/** Reserved dict method names that cannot be overridden */
export declare const RESERVED_DICT_METHODS: readonly ["keys", "values", "entries"];
/** Check if a key name is reserved */
export declare function isReservedMethod(name: string): boolean;
/**
 * Check if a value is a Rill iterator (lazy sequence).
 * An iterator is a dict with:
 * - done: boolean - whether iteration is complete
 * - next: callable - function to get next iterator
 * - value: any (only required when not done) - current element
 */
export declare function isRillIterator(value: RillValue): boolean;
export {};
//# sourceMappingURL=values.d.ts.map