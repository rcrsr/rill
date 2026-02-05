/**
 * Rill Value Types and Utilities
 *
 * Core value types that flow through Rill programs.
 * Public API for host applications.
 */

import type { RillTypeName } from '../../types.js';
import {
  callableEquals,
  isCallable,
  isDict,
  isScriptCallable,
} from './callable.js';

// Forward declaration - actual callable types defined in callable.ts
// This avoids circular dependency
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
export type RillValue =
  | string
  | number
  | boolean
  | null
  | RillValue[]
  | { [key: string]: RillValue }
  | CallableMarker
  | RillTuple;

/** Type guard for RillTuple (spread args) */
export function isTuple(value: RillValue): value is RillTuple {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rill_tuple' in value &&
    value.__rill_tuple === true
  );
}

/** Create tuple from a list (positional) */
export function createTupleFromList(list: RillValue[]): RillTuple {
  const entries = new Map<string | number, RillValue>();
  for (let i = 0; i < list.length; i++) {
    const val = list[i];
    if (val !== undefined) {
      entries.set(i, val);
    }
  }
  return { __rill_tuple: true, entries };
}

/** Create tuple from a dict (named) */
export function createTupleFromDict(
  dict: Record<string, RillValue>
): RillTuple {
  const entries = new Map<string | number, RillValue>();
  for (const [key, value] of Object.entries(dict)) {
    entries.set(key, value);
  }
  return { __rill_tuple: true, entries };
}

/** Infer the Rill type from a runtime value */
export function inferType(value: RillValue): RillTypeName {
  if (value === null) return 'string'; // null treated as empty string
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'bool';
  if (isTuple(value)) return 'tuple';
  if (Array.isArray(value)) return 'list';
  if (
    typeof value === 'object' &&
    '__type' in value &&
    value.__type === 'callable'
  ) {
    return 'closure';
  }
  if (typeof value === 'object') return 'dict';
  return 'string'; // fallback
}

/**
 * Check if a value is of the expected type.
 * Returns true if the value matches the expected type, false otherwise.
 */
export function checkType(value: RillValue, expected: RillTypeName): boolean {
  return inferType(value) === expected;
}

/** Check if a value is truthy in Rill semantics */
export function isTruthy(value: RillValue): boolean {
  if (value === null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.length > 0;
  if (isTuple(value)) return value.entries.size > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    if ('__type' in value && value.__type === 'callable') return true;
    return Object.keys(value).length > 0;
  }
  return true;
}

/** Check if a value is empty (inverse of truthy) */
export function isEmpty(value: RillValue): boolean {
  return !isTruthy(value);
}

/** Format a value for display */
export function formatValue(value: RillValue): string {
  if (value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (isTuple(value)) {
    const parts: string[] = [];
    for (const [key, val] of value.entries) {
      if (typeof key === 'number') {
        parts.push(formatValue(val));
      } else {
        parts.push(`${key}: ${formatValue(val)}`);
      }
    }
    return `*[${parts.join(', ')}]`;
  }
  if (
    typeof value === 'object' &&
    '__type' in value &&
    value.__type === 'callable'
  ) {
    // Basic callable formatting - full formatting in callable.ts
    return '(...) { ... }';
  }
  if (Array.isArray(value)) return JSON.stringify(value);
  return JSON.stringify(value);
}

/**
 * Deep structural equality for all Rill values.
 * - Primitives: value equality
 * - Tuples: length + recursive element equality
 * - Dicts: same keys + recursive value equality (order-independent)
 */
export function deepEquals(a: RillValue, b: RillValue): boolean {
  // Handle primitives and null
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  // Primitives (string, number, boolean) - covered by === above
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  // Both are non-null objects at this point
  const aObj = a as object;
  const bObj = b as object;

  // Check for tuples (spread args)
  const aIsTuple = isTuple(a);
  const bIsTuple = isTuple(b);
  if (aIsTuple !== bIsTuple) return false;
  if (aIsTuple && bIsTuple) {
    if (a.entries.size !== b.entries.size) return false;
    for (const [key, aVal] of a.entries) {
      const bVal = b.entries.get(key);
      if (bVal === undefined || !deepEquals(aVal, bVal)) return false;
    }
    return true;
  }

  // Check for arrays (lists)
  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) return false;
  if (aIsArray && bIsArray) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const aElem = a[i];
      const bElem = b[i];
      if (aElem === undefined || bElem === undefined) {
        if (aElem !== bElem) return false;
      } else if (!deepEquals(aElem, bElem)) {
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
    if (!('__type' in aObj) || !('__type' in bObj)) return false;
    if (aObj.__type !== 'callable' || bObj.__type !== 'callable') return false;

    // Script callables: structural equality
    if (isScriptCallable(a) && isScriptCallable(b)) {
      return callableEquals(a, b, deepEquals);
    }

    // Runtime/application callables: reference equality
    return a === b;
  }

  const aDict = a as Record<string, RillValue>;
  const bDict = b as Record<string, RillValue>;
  const aKeys = Object.keys(aDict);
  const bKeys = Object.keys(bDict);
  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (!(key in bDict)) return false;
    const aVal = aDict[key];
    const bVal = bDict[key];
    if (aVal === undefined || bVal === undefined) {
      if (aVal !== bVal) return false;
    } else if (!deepEquals(aVal, bVal)) {
      return false;
    }
  }
  return true;
}

/** Reserved dict method names that cannot be overridden */
export const RESERVED_DICT_METHODS = ['keys', 'values', 'entries'] as const;

/** Check if a key name is reserved */
export function isReservedMethod(name: string): boolean {
  return (RESERVED_DICT_METHODS as readonly string[]).includes(name);
}

/**
 * Check if a value is a Rill iterator (lazy sequence).
 * An iterator is a dict with:
 * - done: boolean - whether iteration is complete
 * - next: callable - function to get next iterator
 * - value: any (only required when not done) - current element
 */
export function isRillIterator(value: RillValue): boolean {
  if (!isDict(value)) return false;
  const dict = value as Record<string, RillValue>;
  if (!('done' in dict && typeof dict['done'] === 'boolean')) return false;
  if (!('next' in dict && isCallable(dict['next']))) return false;
  // 'value' field only required when not done
  if (!dict['done'] && !('value' in dict)) return false;
  return true;
}
