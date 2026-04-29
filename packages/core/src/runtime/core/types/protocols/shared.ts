/**
 * Shared Protocol Utilities
 *
 * Cross-type helpers used by per-type protocol modules.
 * Must NOT import from ../registrations.js to avoid circular dependencies (AC-4).
 *
 * Late-binding initializers wire up dispatch functions after registrations.ts
 * builds its dispatcher. Call initFormatNested and initDeepEquals once during
 * bootstrap (task 1.7) before any protocol function runs.
 *
 * [DEVIATION] Imports from ../guards.js (not in the original spec allowed-list).
 * serializeListElement requires isCallable, isTuple, isOrdered, isVector,
 * isTypeValue, isIterator, and isStream to classify nested values before
 * serializing. Importing from guards.js is the only way to access these
 * type guards without duplicating them.
 */

import type { RillValue } from '../structures.js';
import { RuntimeError } from '../../../../types.js';
import { formatRillLiteral } from '../operations.js';
import {
  isCallable,
  isTuple,
  isOrdered,
  isVector,
  isTypeValue,
  isIterator,
  isStream,
} from '../guards.js';
import { ERROR_IDS } from '../../../../error-registry.js';

// ============================================================
// LATE-BINDING: formatNested
// ============================================================

/**
 * Late-bound dispatcher: formats a nested value inside a container.
 * Strings are quoted via formatRillLiteral; other values delegate to formatValue.
 *
 * Wired by initFormatNested(formatValue) after registrations.ts builds the
 * formatValue dispatcher. Until then, calling formatNested throws at runtime.
 */
let _formatNested: ((v: RillValue) => string) | undefined;

export function initFormatNested(fn: (v: RillValue) => string): void {
  _formatNested = fn;
}

/**
 * Quote strings when nested inside containers for unambiguous display.
 * Mirrors the local formatNested behavior used in registrations.ts.
 */
export function formatNested(v: RillValue): string {
  if (typeof v === 'string') return formatRillLiteral(v);
  if (_formatNested === undefined) {
    throw new Error(
      'formatNested called before initFormatNested: bootstrap order violation'
    );
  }
  return _formatNested(v);
}

// ============================================================
// LATE-BINDING: deepEquals
// ============================================================

/**
 * Late-bound dispatcher for deep equality.
 * Wired by initDeepEquals(deepEquals) after registrations.ts builds the
 * deepEquals dispatcher.
 */
let _deepEquals: ((a: RillValue, b: RillValue) => boolean) | undefined;

export function initDeepEquals(
  fn: (a: RillValue, b: RillValue) => boolean
): void {
  _deepEquals = fn;
}

export function resolvedDeepEquals(a: RillValue, b: RillValue): boolean {
  if (_deepEquals === undefined) {
    throw new Error(
      'deepEquals comparator called before initDeepEquals: bootstrap order violation'
    );
  }
  return _deepEquals(a, b);
}

// ============================================================
// LATE-BINDING: compareValue
// ============================================================

/**
 * Late-bound dispatcher for per-value comparison.
 * Wired by initCompareValue(compareValue) after registrations.ts builds the
 * compareValue dispatcher. Returns undefined when the type has no compare
 * protocol or when the two values have incompatible types.
 */
let _compareValue:
  | ((a: RillValue, b: RillValue) => number | undefined)
  | undefined;

export function initCompareValue(
  fn: (a: RillValue, b: RillValue) => number | undefined
): void {
  _compareValue = fn;
}

export function resolvedCompareValue(
  a: RillValue,
  b: RillValue
): number | undefined {
  if (_compareValue === undefined) {
    throw new Error(
      'compareValue called before initCompareValue: bootstrap order violation'
    );
  }
  return _compareValue(a, b);
}

// ============================================================
// COMPARISON UTILITIES
// ============================================================

/**
 * Parameterized element-wise comparison for collections.
 * Replaces duplicated loops in eqTuple, eqList, eqOrdered.
 *
 * AC-40: Zero-length collections return true.
 * AC-19: eqTuple, eqList, eqOrdered delegate loop body here.
 */
export function compareElements(
  aEntries: readonly unknown[],
  bEntries: readonly unknown[],
  comparator: (a: unknown, b: unknown) => boolean
): boolean {
  if (aEntries.length !== bEntries.length) return false;
  for (let i = 0; i < aEntries.length; i++) {
    if (!comparator(aEntries[i], bEntries[i])) return false;
  }
  return true;
}

/** Element comparator for tuple and list entries: handles undefined, delegates to deepEquals. */
export function compareByDeepEquals(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return a === b;
  return resolvedDeepEquals(a as RillValue, b as RillValue);
}

/** Entry comparator for ordered: keys by identity, values by deepEquals. */
export function compareOrderedEntry(a: unknown, b: unknown): boolean {
  const aEntry = a as [string, RillValue] | undefined;
  const bEntry = b as [string, RillValue] | undefined;
  if (aEntry === undefined || bEntry === undefined) return false;
  if (aEntry[0] !== bEntry[0]) return false;
  return resolvedDeepEquals(aEntry[1], bEntry[1]);
}

// ============================================================
// SERIALIZE UTILITIES
// ============================================================

/**
 * Recursive serialization for list elements and dict values.
 * Used by both list and dict protocol modules to avoid duplication.
 * Mirrors serializeListElement in registrations.ts (lines 607-639).
 */
export function serializeListElement(v: RillValue): unknown {
  if (v === null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.map(serializeListElement);
  if (isCallable(v))
    throw new RuntimeError(
      ERROR_IDS.RILL_R067,
      'closures are not JSON-serializable'
    );
  if (isTuple(v))
    throw new RuntimeError(
      ERROR_IDS.RILL_R067,
      'tuples are not JSON-serializable'
    );
  if (isOrdered(v))
    throw new RuntimeError(
      ERROR_IDS.RILL_R067,
      'ordered values are not JSON-serializable'
    );
  if (isVector(v))
    throw new RuntimeError(
      ERROR_IDS.RILL_R067,
      'vectors are not JSON-serializable'
    );
  if (isTypeValue(v))
    throw new RuntimeError(
      ERROR_IDS.RILL_R067,
      'type values are not JSON-serializable'
    );
  if (isIterator(v))
    throw new RuntimeError(
      ERROR_IDS.RILL_R067,
      'iterators are not JSON-serializable'
    );
  if (isStream(v))
    throw new RuntimeError(
      ERROR_IDS.RILL_R067,
      'streams are not JSON-serializable'
    );
  // Plain dict
  const dict = v as Record<string, RillValue>;
  const result: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(dict)) {
    result[k] = serializeListElement(val);
  }
  return result;
}

// ============================================================
// NOT-SERIALIZABLE FACTORY
// ============================================================

/**
 * Returns a serializer that always throws RILL-R067 for the given type.
 * Mirrors throwNotSerializable in registrations.ts (lines 735-742).
 */
export function throwNotSerializable(
  typeName: string
): (v: RillValue) => never {
  return (_v: RillValue): never => {
    throw new RuntimeError(
      ERROR_IDS.RILL_R067,
      `${typeName}s are not JSON-serializable`
    );
  };
}
