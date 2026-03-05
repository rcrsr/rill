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
  | 'type';

/**
 * A reference to a type — either a static type name literal or a dynamic
 * variable holding a type value at runtime.
 *
 * - `static`: a known RillTypeName literal (e.g. `string`, `number`)
 * - `dynamic`: a variable name whose runtime value provides the type
 */
export type TypeRef =
  | { kind: 'static'; typeName: RillTypeName }
  | { kind: 'dynamic'; varName: string };

/**
 * Return type declaration for host-provided and script functions.
 */
export type RillFunctionReturnType = RillTypeName;
