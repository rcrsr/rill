/** Rill type names for type annotations */
export type RillTypeName =
  | 'string'
  | 'number'
  | 'bool'
  | 'closure'
  | 'list'
  | 'dict'
  | 'tuple'
  | 'ordered'
  | 'vector'
  | 'any'
  | 'type'
  | 'iterator';

/**
 * A reference to a type — either a static type name literal or a dynamic
 * variable holding a type value at runtime.
 *
 * - `static`: a known RillTypeName literal (e.g. `string`, `number`), optionally
 *   parameterized with `args` (e.g. `list(string)`, `dict(key: string)`)
 * - `dynamic`: a variable name whose runtime value provides the type
 */
export type TypeRef =
  | { kind: 'static'; typeName: RillTypeName; args?: TypeRefArg[] }
  | { kind: 'dynamic'; varName: string };

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

/**
 * Return type declaration for host-provided and script functions.
 */
export type RillFunctionReturnType = RillTypeName;
