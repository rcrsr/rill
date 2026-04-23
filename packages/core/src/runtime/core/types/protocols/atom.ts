/**
 * Atom Type Protocol Module
 *
 * Defines the TypeDefinition for the 'atom' primitive type.
 * Atoms are interned: resolveAtom returns one frozen RillAtom per name,
 * so identity-based equality (AC-3) is a reference check on atom.atom.
 *
 * Must NOT import from ../registrations.js (AC-4).
 */

import type { RillValue, RillAtomValue } from '../structures.js';
import type { TypeDefinition } from './types.js';
import { isAtom } from '../guards.js';
import { resolveAtom } from '../atom-registry.js';
import { throwTypeHalt } from '../halt.js';

// ============================================================
// FORMAT
// ============================================================

function formatCode(v: RillValue): string {
  const c = v as unknown as RillAtomValue;
  return `#${c.atom.name}`;
}

// ============================================================
// EQ
// ============================================================

/**
 * Atom equality uses interned reference comparison on the nested atom object.
 * AC-3: resolveAtom interns one frozen RillAtom per name, so identical names
 * share the same atom reference.
 */
function eqCode(a: RillValue, b: RillValue): boolean {
  if (!isAtom(a) || !isAtom(b)) return false;
  return a.atom === b.atom;
}

// ============================================================
// CONVERT-TO
// ============================================================

/**
 * Atom convertTo targets.
 * - atom -> string: bare atom name (no `#` sigil), matches `atomName`.
 */
const atomConvertTo: Record<string, (v: RillValue) => RillValue> = {
  string: (v: RillValue): RillValue =>
    (v as unknown as RillAtomValue).atom.name,
};

// ============================================================
// SERIALIZE
// ============================================================

/**
 * Serialize a `:atom` value as its bare uppercase atom name string.
 * The `#` sigil is a syntactic convenience, not part of the identity.
 */
function serializeAtom(v: RillValue): unknown {
  return (v as unknown as RillAtomValue).atom.name;
}

// ============================================================
// DESERIALIZE
// ============================================================

/**
 * Deserialize a string into a `:atom` value via `resolveAtom`.
 * Unregistered names resolve to `#R001` (EC-3) rather than throwing.
 */
function deserializeAtom(data: unknown): RillValue {
  if (typeof data !== 'string') {
    throwTypeHalt(
      { fn: 'deserialize-atom' },
      'INVALID_INPUT',
      `Cannot deserialize ${typeof data} as atom, expected string`,
      'runtime',
      { actualType: typeof data }
    );
  }
  const atom = resolveAtom(data);
  return { __rill_atom: true, atom } as unknown as RillValue;
}

// ============================================================
// TYPE DEFINITION
// ============================================================

export const atomType: TypeDefinition = {
  name: 'atom',
  identity: (v: RillValue): boolean => isAtom(v),
  isLeaf: true,
  immutable: true,
  methods: {},
  protocol: {
    format: formatCode,
    eq: eqCode,
    convertTo: atomConvertTo,
    serialize: serializeAtom,
    deserialize: deserializeAtom,
  },
};
