/** Rill type names for type annotations */
export type RillTypeName =
  | 'string'
  | 'number'
  | 'bool'
  | 'closure'
  | 'list'
  | 'dict'
  | 'tuple'
  | 'vector'
  | 'shape'
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
 * Subset of RillTypeName — excludes 'closure' and 'tuple' (not valid return types).
 * Limited to 6 primitive types plus 'any' (default).
 */
export type RillFunctionReturnType =
  | 'string'
  | 'number'
  | 'bool'
  | 'list'
  | 'dict'
  | 'vector'
  | 'any';
