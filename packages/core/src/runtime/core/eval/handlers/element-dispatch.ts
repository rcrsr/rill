/**
 * Element Selection by Dispatch
 *
 * A pipe that selects from a collection value (`"a" -> $d`, `0 -> $l`,
 * `list["a", "b"] -> $d`) finds its element with locateField and projects the
 * element's declared type with projectLocated, as every other access form
 * does. A selected callable is then invoked and its result takes its own type;
 * a `??` default takes its own type.
 *
 * Called from the variable pipe target in core.ts.
 *
 * @internal
 */

import type { BodyNode, SourceLocation } from '../../../../types.js';
import type { Carried } from '../../types/declared.js';
import type { RillValue, TypeStructure } from '../../types/structures.js';
import type { RillCallable } from '../../callable.js';
import { declaredParams, isCallable } from '../../callable.js';
import { formatValue, inferType } from '../../types/registrations.js';
import { isOrdered, isPlainDict, isTuple } from '../../types/guards.js';
import { throwCatchableHostHalt } from '../../types/halt.js';
import type { TypeHaltSite } from '../../types/halt.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import type { EvalState } from '../state.js';
import { invokeCallable } from './closures.js';
import { evaluateBodyExpression } from './control-flow.js';
import { matchesErrorId } from './core.js';
import { selectByBracketKey } from './variables.js';
import {
  isFieldKey,
  projectLocated,
  throwFieldMiss,
  locateOrRecover,
} from './field-access.js';

// ============================================================
// SINGLE SELECTION
// ============================================================

/**
 * Select the element `key` names from a plain dict, a list, a tuple or an
 * ordered value.
 *
 * A tuple or ordered receiver selects exactly as bracket access does, and the
 * stored value is returned as is, never invoked.
 *
 * A list key must be a number and a fractional one halts. A miss resolves to
 * `defaultValue` when given, otherwise halts. Only an absent string key or an
 * out-of-range list index recovers: a number or bool key on a dict, and a key
 * that is not a string, number or bool, halt even with a default. With `resolve` set to `'keep'` a
 * selected callable is returned as stored for the caller to resolve; otherwise
 * it is invoked with `key` as its input.
 *
 * @param collection - Plain dict, list, tuple or ordered value to select from
 * @param key - Dispatch key (dict field or typed key; list, tuple or ordered position)
 * @param declared - Declared type of `collection`, if any
 * @param defaultValue - Default body for a miss, or null
 * @param location - Source location for error reporting
 * @param resolve - Whether a selected callable is invoked; applies to dict and
 *   list only, since a tuple or ordered value returns the stored element as is
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
  location: SourceLocation | undefined,
  resolve: 'invoke' | 'keep'
): Promise<Carried> {
  const isList = Array.isArray(collection);
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
    if (selected.value !== null || defaultValue === null) return selected;
    return {
      value: await evaluateBodyExpression(s, defaultValue),
      declared: undefined,
    };
  }
  if (isList && typeof key !== 'number') {
    throwCatchableHostHalt(
      site,
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `List dispatch requires number index, got ${typeof key}`,
      { input: key, expectedType: 'number' }
    );
  }

  const haltDispatchMiss = (): never =>
    throwCatchableHostHalt(
      site,
      ERROR_ATOMS[ERROR_IDS.RILL_R009],
      `Dict dispatch: key '${formatValue(key)}' not found`,
      { key }
    );
  // A key that cannot address a field is a wrong key, not a missing one.
  if (!isFieldKey(key)) return haltDispatchMiss();
  const found = locateOrRecover(
    collection,
    key,
    defaultValue !== null,
    (miss) =>
      // A fractional or list-position miss names its own container; any
      // other miss on a dict names the dispatch key.
      miss === 'non-integer' || isList
        ? throwFieldMiss(collection, key, miss, site)
        : haltDispatchMiss()
  );
  if (found === undefined) {
    // locateOrRecover recovers only when a default was supplied.
    if (defaultValue === null) return haltDispatchMiss();
    return {
      value: await evaluateBodyExpression(s, defaultValue),
      declared: undefined,
    };
  }
  if (resolve === 'invoke' && isCallable(found.value)) {
    const value = await invokeSelected(s, found.value, key, location);
    return { value, declared: undefined };
  }
  return {
    value: found.value,
    declared: projectLocated(declared, found),
  };
}

/**
 * Halt when a selected script closure declares user-named params: dispatch
 * provides only the key, which a block-closure (`$` param) accepts.
 */
export function rejectParameterizedClosure(
  s: EvalState,
  value: RillCallable,
  location: SourceLocation | undefined,
  fn: string
): void {
  const firstParam = value.kind === 'script' ? value.params[0] : undefined;
  if (firstParam !== undefined && firstParam.name !== '$') {
    throwCatchableHostHalt(
      { location, sourceId: s.ctx.sourceId, fn },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      'Dispatch does not provide arguments for parameterized closure'
    );
  }
}

/**
 * Invoke a callable selected by dispatch. A callable with params receives the
 * key as its argument; a zero-param callable runs with the key as `$`.
 */
export async function invokeSelected(
  s: EvalState,
  callable: RillCallable,
  key: RillValue,
  location: SourceLocation | undefined
): Promise<RillValue> {
  const hasParams =
    (callable.kind === 'script' && callable.params.length > 0) ||
    (callable.kind === 'application' &&
      declaredParams(callable).length > 0 &&
      !callable.isProperty);
  if (hasParams) {
    return await invokeCallable(s, callable, [key], location);
  }
  const savedPipeValue = s.ctx.pipeValue;
  s.ctx.pipeValue = key;
  try {
    return await invokeCallable(s, callable, [], location);
  } finally {
    s.ctx.pipeValue = savedPipeValue;
  }
}

// ============================================================
// HIERARCHICAL DISPATCH
// ============================================================

/**
 * Navigate nested data structure using list of keys/indexes.
 *
 * Traverses through nested dicts and lists using a path of keys/indexes,
 * projecting the declared type one step at a time. Empty path returns target
 * unchanged. Terminal closures receive $ = final path key.
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
      current = await traversePathStep(s, current, key, false, location);
    }
    const step = await traversePathStep(s, current, last, true, location);
    // Resolve terminal value (handles terminal closures with $ = last key)
    return await resolveTerminalValue(s, step, last, location);
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
 * A string key selects from a dict and a number key from a list; any other
 * combination is a type error. A non-terminal closure is resolved via
 * resolveIntermediateClosure. A terminal closure is left for the caller,
 * which invokes it with $ = key.
 */
async function traversePathStep(
  s: EvalState,
  current: Carried,
  key: RillValue,
  isTerminal: boolean,
  location?: SourceLocation
): Promise<Carried> {
  const value = current.value;
  if (
    (isPlainDict(value) && typeof key === 'string') ||
    (Array.isArray(value) && !isTuple(value) && typeof key === 'number')
  ) {
    const result = await selectElement(
      s,
      value,
      key,
      current.declared,
      null, // No default value for intermediate steps
      location,
      'keep' // Closures are resolved here, not by selection
    );
    if (!isTerminal && isCallable(result.value)) {
      return {
        value: await resolveIntermediateClosure(s, result.value, location),
        declared: undefined,
      };
    }
    return result;
  }

  // Type mismatch: throw error
  const currentType = Array.isArray(value)
    ? isTuple(value)
      ? 'tuple'
      : 'list'
    : inferType(value);
  const keyType = typeof key;

  return throwCatchableHostHalt(
    {
      location,
      sourceId: s.ctx.sourceId,
      fn: 'traversePathStep',
    },
    ERROR_ATOMS[ERROR_IDS.RILL_R002],
    `Hierarchical dispatch type mismatch: cannot use ${keyType} key with ${currentType} value`,
    { currentType, keyType, key }
  );
}

/**
 * Resolve closure encountered at non-terminal path position.
 *
 * Auto-invokes zero-param closures with args = [].
 * Throws error for parameterized closures (no args available at intermediate position).
 * Returns non-callable values unchanged.
 *
 * @param s - Evaluator state
 * @param value - Value to resolve (may be callable or regular value)
 * @param location - Source location for error reporting
 * @returns Resolved value (invoked result or original value)
 * @throws RuntimeHaltSignal (catchable, RILL-R002) if parameterized closure
 */
async function resolveIntermediateClosure(
  s: EvalState,
  value: RillValue,
  location?: SourceLocation
): Promise<RillValue> {
  if (!isCallable(value)) {
    return value;
  }

  // Check for parameterized closure (explicit user-defined params)
  // Note: Block-closures have exactly 1 param named '$'
  // Parameterized closures have 1+ params with user-defined names
  const firstParam = value.kind === 'script' ? value.params[0] : undefined;
  if (value.kind === 'script' && firstParam !== undefined) {
    // Check if first param is '$' (block-closure) or user-defined (parameterized)
    if (firstParam.name !== '$') {
      // Parameterized closures cannot be auto-invoked at an intermediate path position.
      throwCatchableHostHalt(
        {
          location,
          sourceId: s.ctx.sourceId,
          fn: 'resolveIntermediateClosure',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        'Cannot invoke parameterized closure at intermediate path position'
      );
    }
  }

  // Zero-param closure or block-closure: auto-invoke with args = []
  return await invokeCallable(s, value, [], location);
}

/**
 * Resolve terminal value in hierarchical dispatch: auto-invoke closures with finalKey.
 * Used when navigating to a final path element.
 *
 * Behavior:
 * - Block-closures (params.length > 0, first param is '$'): invoke with args = [finalKey]
 * - Zero-param closures: invoke with pipeValue = finalKey
 * - Parameterized closures: throw error (dispatch does not provide args)
 * - Non-callable: return unchanged
 *
 * @param s - Evaluator state
 * @param step - Value at terminal path position, with its declaration
 * @param finalKey - Final key from path (becomes $ or first arg)
 * @param location - Source location for error reporting
 * @returns Resolved value (invoked, taking its own type, or unchanged)
 * @throws RuntimeHaltSignal (catchable, RILL-R002) if parameterized closure
 */
async function resolveTerminalValue(
  s: EvalState,
  step: Carried,
  finalKey: RillValue,
  location?: SourceLocation
): Promise<Carried> {
  const value = step.value;
  if (!isCallable(value)) {
    return step;
  }

  rejectParameterizedClosure(s, value, location, 'resolveTerminalValue');

  return {
    value: await invokeSelected(s, value, finalKey, location),
    declared: undefined,
  };
}
