/**
 * Provisional rule registry.
 * Single source of truth that individual rule modules append their `Rule`
 * instances to. `runRules` consumes this array directly. The final,
 * frozen `RULES` export and its barrel re-export are assembled once every
 * rule module has registered itself.
 */

import type { Rule } from './types.js';

/**
 * Mutable collection of registered rules. Rule modules push their `Rule`
 * instances here as a side effect of import.
 */
export const registeredRules: Rule[] = [];
