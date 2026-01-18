/**
 * Rill Value Types and Utilities
 *
 * Core value types that flow through Rill programs.
 * Public API for host applications.
 */
import type { RillTypeName } from '../types.js';
interface CallableMarker {
    readonly __type: 'callable';
}
/**
 * Args type - represents unpacked arguments for closure invocation.
 * Created by the * (spread) operator from tuples or dicts.
 * Entries are keyed by position (number) or name (string).
 */
export interface RillArgs {
    readonly __rill_args: true;
    readonly entries: Map<string | number, RillValue>;
}
/** Any value that can flow through Rill */
export type RillValue = string | number | boolean | null | RillValue[] | {
    [key: string]: RillValue;
} | CallableMarker | RillArgs;
/** Type guard for RillArgs */
export declare function isArgs(value: RillValue): value is RillArgs;
/** Create args from a tuple (positional) */
export declare function createArgsFromTuple(tuple: RillValue[]): RillArgs;
/** Create args from a dict (named) */
export declare function createArgsFromDict(dict: Record<string, RillValue>): RillArgs;
/** Infer the Rill type from a runtime value */
export declare function inferType(value: RillValue): RillTypeName;
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
export {};
//# sourceMappingURL=values.d.ts.map