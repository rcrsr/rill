/**
 * Built-in Functions and Methods
 *
 * Minimal set of built-in operations. Host applications provide
 * domain-specific functions via RuntimeContext.
 *
 * @internal - Not part of public API
 */

import type { RillFunction } from '../core/callable.js';
import { populateBuiltinMethods } from '../core/types/registrations.js';
import { registerBuiltinFunctions } from '../core/builtin-registry.js';

import {
  STRING_METHODS,
  LIST_METHODS,
  DICT_METHODS,
  NUMBER_METHODS,
  BOOL_METHODS,
  VECTOR_METHODS,
  DATETIME_METHODS,
  DURATION_METHODS,
} from './builtins/methods/tables.js';
import { BUILTIN_FUNCTIONS } from './builtins/functions/index.js';

export { BUILTIN_FUNCTIONS };

/**
 * Read-only view of the built-in function names.
 * Derived from the keys of the internal {@link BUILTIN_FUNCTIONS} record and
 * frozen at module load so consumers cannot mutate it at runtime.
 */
export const BUILTIN_FUNCTION_NAMES: readonly string[] = Object.freeze(
  Object.keys(BUILTIN_FUNCTIONS)
);

// ============================================================
// BUILT-IN METHODS
// ============================================================

export const BUILTIN_METHODS: {
  string: Record<string, RillFunction>;
  list: Record<string, RillFunction>;
  dict: Record<string, RillFunction>;
  number: Record<string, RillFunction>;
  bool: Record<string, RillFunction>;
  vector: Record<string, RillFunction>;
  datetime: Record<string, RillFunction>;
  duration: Record<string, RillFunction>;
} = {
  string: null as unknown as Record<string, RillFunction>,
  list: null as unknown as Record<string, RillFunction>,
  dict: null as unknown as Record<string, RillFunction>,
  number: null as unknown as Record<string, RillFunction>,
  bool: null as unknown as Record<string, RillFunction>,
  vector: null as unknown as Record<string, RillFunction>,
  datetime: null as unknown as Record<string, RillFunction>,
  duration: null as unknown as Record<string, RillFunction>,
};

BUILTIN_METHODS.string = STRING_METHODS;
BUILTIN_METHODS.list = LIST_METHODS;
BUILTIN_METHODS.dict = DICT_METHODS;
BUILTIN_METHODS.number = NUMBER_METHODS;
BUILTIN_METHODS.bool = BOOL_METHODS;
BUILTIN_METHODS.vector = VECTOR_METHODS;
BUILTIN_METHODS.datetime = DATETIME_METHODS;
BUILTIN_METHODS.duration = DURATION_METHODS;

// Populate registration methods from BUILTIN_METHODS at module load time.
// No circular dependency: type-registrations.ts does not import builtins.ts.
populateBuiltinMethods(BUILTIN_METHODS);

// Built-in functions that are genuinely variadic and must skip arg validation.
// log: tests call log("msg", extraValue) — extra args are silently ignored.
// chain: pipe form sends 1 arg when signature declares 2 (pipeValue is the first).
// iterate: pipe form sends 1 arg when signature declares 2 (pipeValue is the seed).
const UNTYPED_BUILTINS = new Set(['log', 'chain', 'iterate']);

// Register the function table with core at module load time. Core cannot
// import this module (layer rule: core must not depend on ext), so the
// dependency is inverted through the registry.
registerBuiltinFunctions(BUILTIN_FUNCTIONS, UNTYPED_BUILTINS);
