/**
 * Built-in Function Table Assembly
 *
 * Merges the 5 grouped built-in function records into a single ordered
 * table and validates the merge is exact: no cross-group name collisions,
 * no order-array entry without a definition, and no definition missing
 * from the order array.
 *
 * @internal - Not part of public API
 */

import type { RillFunction } from '../../../core/callable.js';

import { CORE_FUNCTIONS } from './core.js';
import { COLLECTION_FUNCTIONS } from './collections.js';
import { SLICING_FUNCTIONS } from './slicing.js';
import { TIME_DOMAIN_FUNCTIONS } from './time-domain.js';
import { TEMPORAL_FUNCTIONS } from './temporal.js';

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
