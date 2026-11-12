/**
 * Atom Type Protocol Module
 *
 * Defines the TypeDefinition for the 'atom' primitive type.
 * Atoms are identified by name: two atoms are equal when their names are
 * equal.
 *
 * Must NOT import from ../registrations.js.
 */

import type { RillValue } from '../structures.js';
import type { TypeDefinition } from './types.js';
import { isAtom } from '../guards.js';
import { isValidAtomName, resolveAtom, toAtomValue } from '../atom-registry.js';
import { throwTypeHalt } from '../halt.js';
import { requireReceiver } from './shared.js';

// ============================================================
// FORMAT
// ============================================================

function formatCode(v: RillValue): string {
  const c = isAtom(v)
    ? v
    : requireReceiver(v, isAtom, { fn: 'format-atom' }, 'atom');
  return `#${c.atom.name}`;
}

// ============================================================
// EQ
// ============================================================

/** Atom equality compares the names of the nested atoms. */
function eqCode(a: RillValue, b: RillValue): boolean {
  if (!isAtom(a) || !isAtom(b)) return false;
  return a.atom.name === b.atom.name;
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
    (isAtom(v)
      ? v
      : requireReceiver(v, isAtom, { fn: 'atom-to-string' }, 'atom')
    ).atom.name,
};

// ============================================================
// SERIALIZE
// ============================================================

/**
 * Serialize a `:atom` value as its bare atom name string.
 * The `#` sigil is a syntactic convenience, not part of the identity.
 */
function serializeAtom(v: RillValue): unknown {
  return (
    isAtom(v) ? v : requireReceiver(v, isAtom, { fn: 'serialize-atom' }, 'atom')
  ).atom.name;
}

// ============================================================
// DESERIALIZE
// ============================================================

/**
 * Deserialize a string into a `:atom` value via `resolveAtom`.
 * A name that is not a valid atom name halts with `#INVALID_INPUT`.
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
  if (!isValidAtomName(data)) {
    throwTypeHalt(
      { fn: 'deserialize-atom' },
      'INVALID_INPUT',
      `Cannot deserialize "${data}" as atom: not a valid atom name`,
      'runtime',
      { actualValue: data }
    );
  }
  return toAtomValue(resolveAtom(data));
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
