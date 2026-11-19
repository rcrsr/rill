/**
 * Element Selection by Dispatch
 *
 * A pipe that selects from a collection value (`"a" -> $d`, `0 -> $l`,
 * `list["a", "b"] -> $d`) finds its element with locateField and projects the
 * element's declared type with projectLocated, as every other access form
 * does. A selected held block runs with the selector as `$` and its result
 * takes its own type; any other element, a function included, is returned
 * uncalled. A `??` default takes its own type.
 *
 * Called from the variable pipe target in core.ts.
 *
 * @internal
 */

import type { BodyNode, SourceLocation } from '../../../../types.js';
import type { Carried } from '../../types/declared.js';
import type { RillValue, TypeStructure } from '../../types/structures.js';
import { isCallable } from '../../callable.js';
import { isOrdered, isTuple } from '../../types/guards.js';
import type { TypeHaltSite } from '../../types/halt.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import type { EvalState } from '../state.js';
import { invokeCallable } from './closures.js';
import { resolveSelected } from './code-block.js';
import { evaluateBodyExpression } from './control-flow.js';
import { matchesErrorId } from './core.js';
import { selectByBracketKey } from './variables.js';
import type { FieldKey } from './field-access.js';
import {
  bracketKey,
  projectLocated,
  throwBracketMiss,
  locateOrRecover,
} from './field-access.js';

// ============================================================
// SINGLE SELECTION
// ============================================================

/**
 * Select the element `key` names from a plain dict, a list, a tuple or an
 * ordered value.
 *
 * A tuple or ordered receiver selects exactly as bracket access does.
 *
 * A list key must be a number and a fractional one halts. A miss resolves to
 * `defaultValue` when given, otherwise halts. Only an absent string key or an
 * out-of-range list index recovers: a non-string key on a dict halts even with
 * a default. A selected held block runs with `key` as `$` and yields its
 * result; any other callable is returned uncalled.
 *
 * @param collection - Plain dict, list, tuple or ordered value to select from
 * @param key - Dispatch key (string dict field; list, tuple or ordered
 *   position)
 * @param declared - Declared type of `collection`, if any
 * @param defaultValue - Default body for a miss, or null
 * @param location - Source location for error reporting
 * @returns The element with its projected declared type
 * @throws RuntimeHaltSignal (catchable) on a non-number list key, a fractional
 *   index, a wrong-typed key, or a miss without a default
 */
export async function selectElement(
  s: EvalState,
  collection: RillValue,
  key: RillValue,
  declared: TypeStructure | undefined,
  defaultValue: BodyNode | null,
  location: SourceLocation | undefined
): Promise<Carried> {
  const site: TypeHaltSite = {
    location,
    sourceId: s.ctx.sourceId,
    fn: 'selectElement',
  };
  if (isTuple(collection) || isOrdered(collection)) {
    const selected = selectByBracketKey(
      collection,
      key,
      site,
      declared,
      defaultValue !== null
    );
    if (selected.value !== null || defaultValue === null) {
      return runSelected(s, selected, key, location);
    }
    return {
      value: await evaluateBodyExpression(s, defaultValue),
      declared: undefined,
    };
  }
  // A wrong-typed key is not a missing one and halts ahead of the lookup,
  // with the bracket read's message.
  const fieldKey: FieldKey = bracketKey(collection, key, site);
  const found = locateOrRecover(
    collection,
    fieldKey,
    defaultValue !== null,
    (miss) => throwBracketMiss(collection, fieldKey, miss, site)
  );
  if (found === undefined) {
    // locateOrRecover recovers only when a default was supplied.
    if (defaultValue === null) {
      return throwBracketMiss(collection, fieldKey, 'absent', site);
    }
    return {
      value: await evaluateBodyExpression(s, defaultValue),
      declared: undefined,
    };
  }
  return runSelected(
    s,
    { value: found.value, declared: projectLocated(declared, found) },
    key,
    location
  );
}

/**
 * Run a selected held block with the selector as `$`, and a host
 * property-style function with the selector as its pipe value; keep any other
 * element, a function included, as stored.
 */
async function runSelected(
  s: EvalState,
  selected: Carried,
  key: RillValue,
  location: SourceLocation | undefined
): Promise<Carried> {
  const resolved = await resolveSelected(
    s,
    selected.value,
    key,
    undefined,
    location
  );
  if (resolved.ran) return { value: resolved.value, declared: undefined };
  const { value } = selected;
  if (isCallable(value) && value.kind === 'application' && value.isProperty) {
    const savedPipeValue = s.ctx.pipeValue;
    s.ctx.pipeValue = key;
    try {
      return {
        value: await invokeCallable(s, value, [], location),
        declared: undefined,
      };
    } finally {
      s.ctx.pipeValue = savedPipeValue;
    }
  }
  return selected;
}

// ============================================================
// HIERARCHICAL DISPATCH
// ============================================================

/**
 * Navigate nested data structure using list of keys/indexes.
 *
 * Traverses through nested dicts and lists using a path of keys/indexes,
 * projecting the declared type one step at a time. Empty path returns target
 * unchanged. A held block selected at any step runs with $ = that step's key.
 *
 * @param s - Evaluator state
 * @param target - Already-evaluated dict/list to navigate, with its declaration
 * @param path - List of keys/indexes to traverse
 * @param defaultExpr - Optional default value if path not found
 * @param location - Source location for error reporting
 * @returns Final value at path with its projected declared type
 */
export async function evaluateHierarchicalDispatch(
  s: EvalState,
  target: Carried,
  path: RillValue[],
  defaultExpr?: BodyNode,
  location?: SourceLocation
): Promise<Carried> {
  const last = path.at(-1);
  if (last === undefined) return target;

  try {
    let current = target;
    for (const key of path.slice(0, -1)) {
      current = await traversePathStep(s, current, key, location);
    }
    return await traversePathStep(s, current, last, location);
  } catch (error) {
    // A missing key or index resolves to the default. Type errors and other
    // errors always propagate. matchesErrorId handles both the legacy and
    // halt forms of RILL-R009.
    if (
      defaultExpr &&
      matchesErrorId(
        error,
        ERROR_IDS.RILL_R009,
        ERROR_ATOMS[ERROR_IDS.RILL_R009]
      )
    ) {
      return {
        value: await evaluateBodyExpression(s, defaultExpr),
        declared: undefined,
      };
    }
    throw error;
  }
}

/**
 * Execute single path step: select `key` from the current value.
 *
 * A plain dict or stream takes a string key (any other type halts as a dict key type
 * mismatch) and a list a number key; any other combination is a type error.
 * A selected held block runs with the step key as `$`; any other element,
 * a function included, is returned uncalled.
 */
function traversePathStep(
  s: EvalState,
  current: Carried,
  key: RillValue,
  location?: SourceLocation
): Promise<Carried> {
  // Every value selects as the bracket read does, so a key the receiver
  // rejects, or a receiver that cannot be indexed, halts with the bracket
  // read's message.
  return selectElement(
    s,
    current.value,
    key,
    current.declared,
    null, // No default value for path steps
    location
  );
}
