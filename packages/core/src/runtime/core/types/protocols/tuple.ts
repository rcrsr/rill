/**
 * Tuple Protocol Module
 *
 * TypeDefinition for the 'tuple' built-in type.
 * Allowed imports: ../structures.js, ../guards.js, ./shared.js,
 * ../operations.js, ../callable.js, ../constructors.js, ../../../types.js
 *
 * MUST NOT import from ../registrations.js or sibling protocols/*.
 */

import type { RillValue, RillTuple } from '../structures.js';
import type { TypeDefinition } from './types.js';
import { isTuple } from '../guards.js';
import { throwTypeHalt } from '../halt.js';
import {
  formatNested,
  compareElements,
  compareByDeepEquals,
  throwNotSerializable,
  resolvedCompareValue,
} from './shared.js';

// ============================================================
// FORMAT
// ============================================================

function formatTuple(v: RillValue): string {
  const t = v as unknown as RillTuple;
  return `tuple[${t.entries.map(formatNested).join(', ')}]`;
}

// ============================================================
// COMPARE
// ============================================================

/**
 * Lexicographic tuple comparison (IR-10).
 *
 * Preconditions (halts with #TYPE_MISMATCH on violation):
 *   - Both tuples must have the same length (EC-4).
 *   - Each positional slot pair must share a type that supports compare (EC-4).
 *
 * Empty tuples compare equal (length 0 == length 0).
 */
function compareTuple(a: RillValue, b: RillValue): number {
  const ta = a as unknown as RillTuple;
  const tb = b as unknown as RillTuple;

  if (ta.entries.length !== tb.entries.length) {
    throwTypeHalt(
      { fn: 'compareTuple' },
      'TYPE_MISMATCH',
      `Cannot compare tuples of different lengths: ${ta.entries.length} vs ${tb.entries.length}`,
      'runtime'
    );
  }

  for (let i = 0; i < ta.entries.length; i++) {
    const av = ta.entries[i] as RillValue;
    const bv = tb.entries[i] as RillValue;
    const cmp = resolvedCompareValue(av, bv);
    if (cmp === undefined) {
      throwTypeHalt(
        { fn: 'compareTuple' },
        'TYPE_MISMATCH',
        `Cannot compare tuple slot ${i}: incompatible or non-orderable types`,
        'runtime'
      );
    }
    if (cmp !== 0) return cmp;
  }

  return 0;
}

// ============================================================
// EQ
// ============================================================

function eqTuple(a: RillValue, b: RillValue): boolean {
  if (!isTuple(a) || !isTuple(b)) return false;
  // Tuple entries are positional and always present; undefined cannot arise here,
  // unlike dict values which may be absent from deserialization.
  return compareElements(a.entries, b.entries, compareByDeepEquals);
}

// ============================================================
// CONVERT-TO
// ============================================================

const tupleConvertTo: Record<string, (v: RillValue) => RillValue> = {
  list: (v: RillValue): RillValue => (v as unknown as RillTuple).entries,
  string: (v: RillValue): RillValue => formatTuple(v),
};

// ============================================================
// TYPE DEFINITION
// ============================================================

export const tupleType: TypeDefinition = {
  name: 'tuple',
  identity: (v: RillValue): boolean => isTuple(v),
  isLeaf: false,
  immutable: true,
  methods: {},
  protocol: {
    format: formatTuple,
    eq: eqTuple,
    compare: compareTuple,
    convertTo: tupleConvertTo,
    serialize: throwNotSerializable('tuple'),
  },
};
