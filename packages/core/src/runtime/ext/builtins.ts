/**
 * Built-in Functions and Methods
 *
 * Minimal set of built-in operations. Host applications provide
 * domain-specific functions via RuntimeContext.
 *
 * @internal - Not part of public API
 */

import { populateBuiltinMethods } from '../core/types/registrations.js';
import { registerBuiltinFunctions } from '../core/builtin-registry.js';

import { BUILTIN_FUNCTIONS } from './builtins/functions/index.js';
import { BUILTIN_METHODS } from './builtins/methods/index.js';

export { BUILTIN_FUNCTIONS, BUILTIN_METHODS };

/**
 * Read-only view of the built-in function names.
 * Derived from the keys of the internal {@link BUILTIN_FUNCTIONS} record and
 * frozen at module load so consumers cannot mutate it at runtime.
 */
export const BUILTIN_FUNCTION_NAMES: readonly string[] = Object.freeze(
  Object.keys(BUILTIN_FUNCTIONS)
);

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
