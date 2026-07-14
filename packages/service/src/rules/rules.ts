/**
 * Frozen rule registry.
 * Importing this module triggers every rule module's self-registration
 * side effect (each rule module pushes its `Rule` instances onto
 * `registeredRules` in `rules-registry.ts`), then snapshots and freezes the
 * resulting array as `RULES`. Order does not carry meaning to consumers:
 * diagnostics are sorted independently by `runRules`.
 */

// Import every rule module for its self-registration side effect. Order
// here has no consumer-visible meaning.
import './atom-unregistered.js';
import './avoid-reassignment.js';
import './break-in-parallel.js';
import './capture-before-branch.js';
import './capture-inline-chain.js';
import './closure-bare-dollar.js';
import './closure-braces.js';
import './closure-late-binding.js';
import './complex-condition.js';
import './condition-type.js';
import './filter-negation.js';
import './fold-intermediates.js';
import './guard-over-try-catch.js';
import './guard-retry.js';
import './implicit-dollar-closure.js';
import './implicit-dollar-function.js';
import './implicit-dollar-method.js';
import './indent-continuation.js';
import './loop-outer-capture.js';
import './loops.js';
import './method-shorthand.js';
import './naming.js';
import './prefer-map.js';
import './presence-over-null-guard.js';
import './spacing-braces.js';
import './spacing-brackets.js';
import './spacing-closure.js';
import './spacing-operator.js';
import './status-probe-no-field.js';
import './stream-pre-iteration.js';
import './throwaway-capture.js';
import './types-assertion.js';
import './use-default-operator.js';
import './use-empty-method.js';
import './use-expressions.js';
import './validate-external.js';

import type { Rule } from './types.js';
import { registeredRules } from './rules-registry.js';

/**
 * Frozen registry of all validation rules.
 * An immutability hardening over a mutable rule array: every rule module
 * above has already pushed its instances onto `registeredRules` by the
 * time this snapshot is taken, so `RULES` is fully populated and immune to
 * further mutation.
 */
export const RULES: readonly Rule[] = Object.freeze([...registeredRules]);
