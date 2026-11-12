import { BUILTIN_ATOM_NAMES } from '../../../constants.js';
import type { RillAtomValue } from './structures.js';
/**
 * Atoms: symbols identified and compared by name.
 *
 * RillAtom is a frozen `{ __rill_atom, name }` pair authored in scripts
 * as `#NAME`. Any valid name is an atom; nothing is registered and no
 * name falls back to another atom. Two atoms are equal when their names
 * are equal.
 *
 * Builtin names (see `BUILTIN_ATOM_NAMES` in constants.ts) resolve to one
 * shared frozen object, which status codes rely on for identity checks.
 * Every other name resolves to a fresh frozen object, so compare atoms
 * by `.name`, never by reference.
 */

// ============================================================
// VALIDATION
// ============================================================

/**
 * Atom name pattern: a letter or underscore, then letters, digits, or
 * underscores. Mirrors the lexer's identifier rule in lexer/helpers.ts;
 * the runtime may not import the lexer, so the pattern is repeated here.
 */
const ATOM_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Returns true when `name` is a valid atom name. */
export function isValidAtomName(name: string): boolean {
  return typeof name === 'string' && ATOM_NAME_REGEX.test(name);
}

// ============================================================
// TYPES
// ============================================================

/**
 * Frozen atom. `name` carries the bare form without the `#` sigil.
 */
export interface RillAtom {
  readonly __rill_atom: true;
  readonly name: string;
}

function makeAtom(name: string): RillAtom {
  return Object.freeze({ __rill_atom: true as const, name });
}

// ============================================================
// BUILTIN ATOMS
// ============================================================

const BUILTIN_ATOMS: ReadonlyMap<string, RillAtom> = new Map(
  BUILTIN_ATOM_NAMES.map((name): [string, RillAtom] => [name, makeAtom(name)])
);

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Resolves a name to an atom.
 *
 * Builtin names return their shared frozen object; any other valid name
 * returns a fresh frozen atom.
 *
 * @throws Error when `name` is not a valid atom name.
 */
export function resolveAtom(name: string): RillAtom {
  const builtin = BUILTIN_ATOMS.get(name);
  if (builtin !== undefined) return builtin;
  if (!isValidAtomName(name)) {
    throw new Error(`Invalid atom name '${String(name)}'`);
  }
  return makeAtom(name);
}

/**
 * Returns the bare name of an atom (no `#` sigil).
 *
 * Backs the `-> name` conversion on `:atom` values.
 */
export function atomName(atom: RillAtom): string {
  return atom.name;
}

/**
 * Returns the shared `#ok` atom.
 *
 * Used by status.ts to build the frozen empty-status singleton.
 */
export function okAtom(): RillAtom {
  return resolveAtom('ok');
}

/** Internal: wrap an atom as a `:atom` script value. */
export function toAtomValue(atom: RillAtom): RillAtomValue {
  return { __rill_atom: true, atom };
}
