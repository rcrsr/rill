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
  | 'any';

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
