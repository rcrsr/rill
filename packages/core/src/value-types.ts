import type { LiteralNode } from './ast-nodes.js';
import { VALID_TYPE_NAMES } from './constants.js';

/** Rill type names for type annotations */
export type RillTypeName = (typeof VALID_TYPE_NAMES)[number];

/**
 * A single argument in a parameterized type reference or type constructor.
 *
 * - Named form:    `field: string` → `{ name: 'field', value: { kind: 'static', typeName: 'string' } }`
 * - Positional form: `string`     → `{ value: { kind: 'static', typeName: 'string' } }`
 *
 * Named vs positional discrimination: `arg.name !== undefined`.
 */
export interface FieldArg {
  name?: string;
  value: TypeRef;
  defaultValue?: LiteralNode;
}

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
  | { kind: 'static'; typeName: RillTypeName; args?: FieldArg[] }
  | { kind: 'dynamic'; varName: string }
  | { kind: 'union'; members: TypeRef[] };
