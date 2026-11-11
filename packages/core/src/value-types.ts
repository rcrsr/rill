import type { AnnotationArg, LiteralNode } from './ast-nodes.js';
import { VALID_TYPE_NAMES } from './constants.js';

/** Rill type names for type annotations */
export type RillTypeName = (typeof VALID_TYPE_NAMES)[number];

/** Narrow a string to a RillTypeName when it is a registered type name. */
export function isRillTypeName(name: string): name is RillTypeName {
  const validNames: readonly string[] = VALID_TYPE_NAMES;
  return validNames.includes(name);
}

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
  annotations?: AnnotationArg[];
}

/**
 * A reference to a type — either a static type name literal, a dynamic
 * variable holding a type value at runtime, or a union of multiple type refs.
 *
 * - `static`: a known RillTypeName literal (e.g. `string`, `number`), optionally
 *   parameterized with `args` (e.g. `list(string)`, `dict(key: string)`)
 * - `dynamic`: a variable name whose runtime value provides the type
 * - `literal`: a string, number, or bool value used as a union member
 *   (e.g. `"wired"|"wireless"`); matches by value equality, no coercion
 * - `union`: two or more type refs (flattened at parse time; no nested unions)
 *   Members preserve source order. `members.length >= 2`.
 */
export type TypeRef =
  | { kind: 'static'; typeName: RillTypeName; args?: FieldArg[] }
  | { kind: 'dynamic'; varName: string }
  | { kind: 'literal'; value: string | number | boolean }
  | { kind: 'union'; members: TypeRef[] };
