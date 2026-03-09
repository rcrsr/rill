import { VALID_TYPE_NAMES } from './constants.js';

/** Rill type names for type annotations */
export type RillTypeName = (typeof VALID_TYPE_NAMES)[number];

/**
 * A reference to a type — either a static type name literal, a dynamic
 * variable holding a type value at runtime, or a union of multiple type refs.
 *
 * - `static`: a known RillTypeName literal (e.g. `string`, `number`), optionally
 *   parameterized with `args` (e.g. `list(string)`, `dict(key: string)`)
 * - `dynamic`: a variable name whose runtime value provides the type
 * - `union`: two or more type refs (flattened at parse time; no nested unions)
 *   Members preserve source order. `members.length >= 2`.
 */
export type TypeRef =
  | { kind: 'static'; typeName: RillTypeName; args?: TypeRefArg[] }
  | { kind: 'dynamic'; varName: string }
  | { kind: 'union'; members: TypeRef[] };

/**
 * A single argument in a parameterized type reference.
 *
 * - Named form:    `field: string` → `{ name: 'field', ref: { kind: 'static', typeName: 'string' } }`
 * - Positional form: `string`     → `{ ref: { kind: 'static', typeName: 'string' } }`
 */
export interface TypeRefArg {
  name?: string;
  ref: TypeRef;
}
