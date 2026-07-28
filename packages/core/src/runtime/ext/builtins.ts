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
import { CORE_FUNCTIONS } from './builtins/functions/core.js';
import { COLLECTION_FUNCTIONS } from './builtins/functions/collections.js';
import { SLICING_FUNCTIONS } from './builtins/functions/slicing.js';
import { TIME_DOMAIN_FUNCTIONS } from './builtins/functions/time-domain.js';
import { TEMPORAL_FUNCTIONS } from './builtins/functions/temporal.js';

/**
 * Original declaration order of every built-in function name, interleaved
 * across the five grouped modules. `BUILTIN_FUNCTION_NAMES` derives from
 * `Object.keys(BUILTIN_FUNCTIONS)`, so this order is a public, observable
 * contract. Do not reorder without checking downstream consumers.
 */
const BUILTIN_FUNCTION_ORDER = [
  'identity',
  'log',
  'json',
  'enumerate',
  'range',
  'repeat',
  'chain',
  'seq',
  'fan',
  'acc',
  'fold',
  'filter',
  'datetime',
  'now',
  'duration',
  'sort',
  'take',
  'skip',
  'cycle',
  'batch',
  'window',
  'start_when',
  'stop_when',
  'iterate',
  'debounce',
  'throttle',
  'sample',
] as const;

export const BUILTIN_FUNCTIONS: Record<string, RillFunction> = (() => {
  const groups = [
    CORE_FUNCTIONS,
    COLLECTION_FUNCTIONS,
    SLICING_FUNCTIONS,
    TIME_DOMAIN_FUNCTIONS,
    TEMPORAL_FUNCTIONS,
  ];
  const merged: Record<string, RillFunction> = Object.assign({}, ...groups);
  // Spreading silently drops an earlier definition when two groups declare the
  // same name, which would leave the key count intact and slip past both checks
  // below. Compare against the summed group sizes so a collision halts instead.
  const declared = groups.reduce((n, g) => n + Object.keys(g).length, 0);
  if (declared !== Object.keys(merged).length) {
    throw new Error(
      `Built-in function groups declare ${declared} names but merged to ` +
        `${Object.keys(merged).length}; a name is defined in two groups.`
    );
  }
  const ordered: Record<string, RillFunction> = {};
  for (const name of BUILTIN_FUNCTION_ORDER) {
    const entry = merged[name];
    if (entry === undefined) {
      throw new Error(
        `BUILTIN_FUNCTION_ORDER references unknown builtin function: ${name}`
      );
    }
    ordered[name] = entry;
    delete merged[name];
  }
  const leftover = Object.keys(merged);
  if (leftover.length > 0) {
    throw new Error(
      `BUILTIN_FUNCTION_ORDER is missing builtin function(s): ${leftover.join(', ')}`
    );
  }
  return ordered;
})();

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
