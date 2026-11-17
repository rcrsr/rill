/**
 * Field Access Evaluation
 *
 * One locator and one projection serve every form that selects an element by
 * key or position. locateField decides whether a key selects an element and
 * returns it with the key a declared type projects from; projectLocated
 * projects that type through projectElement.
 *
 * Forms that read through readField (a variable chain and the method-chain
 * read of a bare field):
 * - Literal key: $data.field
 * - Variable key: $data.$key
 * - Existence checks (.?) locate without invoking anything
 *
 * A dict is keyed by strings only. dictSelectorKey is the one place that rule
 * is written: every form that selects from a plain dict by an evaluated
 * selector (variable key, bracket, `.?` checks, pipe selection) validates it
 * there, before any lookup, so a `??` default never masks a wrong-typed key.
 *
 * Forms that validate their own key and locate directly: bracket index
 * (variables.ts), pipe selection (element-dispatch.ts), literal list
 * dispatch (list-dispatch.ts), destructure (extraction.ts), and the own-field
 * method read (methods.ts).
 *
 * Callers, by concern:
 * - field forms and `.?`: evaluateVariableCarried and evaluateExistenceCheck
 *   in variables.ts
 * - bracket index: applyBracketIndexCarried in variables.ts
 * - own-field method read: evaluateMethod and locateOwnFieldRead in methods.ts
 * - pipe selection and hierarchical dispatch: element-dispatch.ts
 * - literal list dispatch: list-dispatch.ts
 * - destructure: extraction.ts
 * - legacy closure-call property chain: calls.ts
 *
 * @internal
 */

import type { SourceLocation, VariableNode } from '../../../../types.js';
import type { RillValue, TypeStructure } from '../../types/structures.js';
import type { Carried } from '../../types/declared.js';
import { projectElement } from '../../types/declared.js';
import { inferType } from '../../types/registrations.js';
import {
  isIterator,
  isOrdered,
  isPlainDict,
  isTuple,
  isTypeValue,
} from '../../types/guards.js';
import { getVariable } from '../../context.js';
import {
  nonIntegerIndexMessage,
  throwIndexOutOfBounds,
} from '../../types/index-access.js';
import type { IndexKind } from '../../types/index-access.js';
import { isCallable } from '../../callable.js';
import { throwCatchableHostHalt, throwTypeHalt } from '../../types/halt.js';
import type { TypeHaltSite } from '../../types/halt.js';
import {
  readTypeProperty,
  throwMissingTypeProperty,
} from '../../types/type-properties.js';
import type { EvalState } from '../state.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import { getNodeLocation, isFieldReceiver, readOwnField } from '../shared.js';
import { invokeCallable } from './closures.js';

// ============================================================
// TYPES
// ============================================================

/** A key that can address a field or position. */
export type FieldKey = string | number | boolean;

/** Why a lookup found nothing. */
export type FieldMiss =
  | 'absent'
  | 'out-of-range'
  | 'no-fields'
  | 'not-indexable'
  | 'non-integer';

/**
 * A located element. `key` is what a declared type projects from: the field
 * name, or the resolved non-negative position (a negative index already counted
 * from the end of the value). It is undefined where no declaration projects
 * (a type value's property).
 */
export interface FoundField {
  readonly found: true;
  readonly value: RillValue;
  readonly key: FieldKey | undefined;
}

/** Outcome of locating a key on a receiver. */
export type FieldLocation =
  | FoundField
  | { readonly found: false; readonly miss: FieldMiss };

/** Options for one field read. */
export interface FieldReadRequest {
  /** Resolve a miss to a coalescible null instead of halting. */
  readonly allowMissing: boolean;
  readonly location: SourceLocation | undefined;
  /** Name of the calling evaluator, recorded on every halt. */
  readonly fn: string;
  /** Declared type of the receiver, used to project the element's type. */
  readonly receiverDeclared?: TypeStructure | undefined;
  /** Report a miss with the bracket read's halt, for `.$k`. */
  readonly bracketMiss?: boolean | undefined;
}

// ============================================================
// LOCATE
// ============================================================

/**
 * Validate a selector against a plain dict: only a string selects a field. Any
 * other type halts with a catchable type mismatch, ahead of the lookup, so a
 * `??` default cannot recover it.
 */
export function dictSelectorKey(
  selector: RillValue,
  site: TypeHaltSite
): string {
  if (typeof selector === 'string') return selector;
  return throwTypeHalt(
    site,
    'TYPE_MISMATCH',
    `Dict key must be string, got ${inferType(selector)}`,
    'runtime',
    { expectedType: 'string', actualType: inferType(selector) }
  );
}

/**
 * Validate a bracket key against its receiver. Lists and tuples take a number,
 * ordered values a string or number, dicts a string; every other receiver, and
 * an iterator, cannot be indexed.
 */
export function bracketKey(
  receiver: RillValue,
  indexValue: RillValue,
  site: TypeHaltSite
): FieldKey {
  const reject = (message: string): never =>
    throwCatchableHostHalt(site, ERROR_ATOMS[ERROR_IDS.RILL_R002], message);
  const got = inferType(indexValue);
  if (Array.isArray(receiver)) {
    return typeof indexValue === 'number'
      ? indexValue
      : reject(`List index must be number, got ${got}`);
  }
  if (isOrdered(receiver)) {
    return typeof indexValue === 'string' || typeof indexValue === 'number'
      ? indexValue
      : reject(`Ordered index must be string or number, got ${got}`);
  }
  if (isTuple(receiver)) {
    return typeof indexValue === 'number'
      ? indexValue
      : reject(`Tuple index must be number, got ${got}`);
  }
  // Must precede the dict case: an iterator is structurally a dict.
  if (isIterator(receiver)) return reject('Cannot index iterator');
  if (isPlainDict(receiver)) return dictSelectorKey(indexValue, site);
  if (isFieldReceiver(receiver)) {
    return typeof indexValue === 'string'
      ? indexValue
      : reject(`Dict key must be string, got ${got}`);
  }
  return reject(`Cannot index ${inferType(receiver)}`);
}

const NOT_FOUND = (miss: FieldMiss): FieldLocation => ({ found: false, miss });

function locatePosition(
  key: number,
  length: number,
  at: (position: number) => RillValue | undefined
): FieldLocation {
  if (!Number.isInteger(key)) return NOT_FOUND('non-integer');
  const position = key < 0 ? length + key : key;
  const value = position >= 0 && position < length ? at(position) : undefined;
  return value === undefined
    ? NOT_FOUND('out-of-range')
    : { found: true, value, key: position };
}

function locateOwnField(
  receiver: Record<string, RillValue>,
  key: string
): FieldLocation {
  const value = readOwnField(receiver, key);
  return value === undefined || value === null
    ? NOT_FOUND('absent')
    : { found: true, value, key };
}

/**
 * Find `key` on `receiver` without halting or invoking anything.
 *
 * Type values, ordered values and iterators resolve before the generic dict
 * rules, since each is also structurally a dict. A property-style callable is
 * returned as stored.
 */
export function locateField(receiver: RillValue, key: FieldKey): FieldLocation {
  if (isTypeValue(receiver)) {
    if (typeof key !== 'string') return NOT_FOUND('not-indexable');
    const property = readTypeProperty(receiver, key);
    return property === undefined
      ? NOT_FOUND('absent')
      : { found: true, value: property, key: undefined };
  }
  if (isOrdered(receiver)) {
    const entries = receiver.entries;
    if (typeof key === 'string') {
      const entry = entries.find(([name]) => name === key);
      return entry === undefined
        ? NOT_FOUND('absent')
        : { found: true, value: entry[1], key };
    }
    if (typeof key === 'number') {
      return locatePosition(key, entries.length, (i) => entries[i]?.[1]);
    }
    return NOT_FOUND('not-indexable');
  }
  if (Array.isArray(receiver)) {
    if (typeof key === 'string') return NOT_FOUND('no-fields');
    if (typeof key === 'number') {
      return locatePosition(key, receiver.length, (i) => receiver[i]);
    }
    return NOT_FOUND('not-indexable');
  }
  if (isTuple(receiver)) {
    const entries = receiver.entries;
    if (typeof key === 'string') return NOT_FOUND('no-fields');
    if (typeof key === 'number') {
      return locatePosition(key, entries.length, (i) => entries[i]);
    }
    return NOT_FOUND('not-indexable');
  }
  if (isFieldReceiver(receiver)) {
    if (typeof key === 'string') return locateOwnField(receiver, key);
    return NOT_FOUND('not-indexable');
  }
  return typeof key === 'string'
    ? NOT_FOUND('no-fields')
    : NOT_FOUND('not-indexable');
}

/**
 * Locate `key` on `receiver`, or settle the miss. The one place that decides
 * whether a lookup miss recovers.
 *
 * Returns the found element. When `allowMissing` is set and the miss is
 * recoverable, returns undefined so the caller applies its default. Any other
 * miss goes to `onMiss`, which must halt.
 *
 * A miss recovers unless it is a fractional index, or the receiver is a dict
 * or stream read with a number or bool key. Such a key is a wrong key, not an
 * absent one, so only an absent string key recovers on those receivers.
 */
export function locateOrRecover(
  receiver: RillValue,
  key: FieldKey,
  allowMissing: boolean,
  onMiss: (miss: FieldMiss) => never
): FoundField | undefined {
  const located = locateField(receiver, key);
  if (located.found) return located;
  const recovers =
    located.miss !== 'non-integer' &&
    (!isFieldReceiver(receiver) || typeof key === 'string');
  if (allowMissing && recovers) return undefined;
  return onMiss(located.miss);
}

// ============================================================
// READ
// ============================================================

/** Container kind and length of a positionally indexed receiver. */
function indexTarget(
  receiver: RillValue
): { readonly kind: IndexKind; readonly length: number } | undefined {
  if (Array.isArray(receiver)) {
    return { kind: 'List', length: receiver.length };
  }
  if (isOrdered(receiver)) {
    return { kind: 'Ordered', length: receiver.entries.length };
  }
  if (isTuple(receiver)) {
    return { kind: 'Tuple', length: receiver.entries.length };
  }
  return undefined;
}

function throwNotIndexable(receiver: RillValue, site: TypeHaltSite): never {
  return throwCatchableHostHalt(
    site,
    ERROR_ATOMS[ERROR_IDS.RILL_R002],
    `Cannot index ${isIterator(receiver) ? 'iterator' : inferType(receiver)}`
  );
}

/** Halt with the invalid-input error for a fractional or non-finite index. */
export function throwNonIntegerIndex(
  receiver: RillValue,
  key: number,
  site: TypeHaltSite
): never {
  const target = indexTarget(receiver);
  if (target === undefined) return throwNotIndexable(receiver, site);
  return throwCatchableHostHalt(
    site,
    'INVALID_INPUT',
    nonIntegerIndexMessage(target.kind, key)
  );
}

/** Halt for a miss other than a type-value property. */
export function throwFieldMiss(
  receiver: RillValue,
  key: FieldKey,
  miss: FieldMiss,
  site: TypeHaltSite
): never {
  const target = indexTarget(receiver);
  switch (miss) {
    case 'non-integer':
      return typeof key === 'number'
        ? throwNonIntegerIndex(receiver, key, site)
        : throwNotIndexable(receiver, site);
    case 'out-of-range':
      if (typeof key === 'number' && target !== undefined) {
        return throwIndexOutOfBounds(key, target.length, target.kind, site);
      }
      return throwNotIndexable(receiver, site);
    case 'no-fields':
      return throwCatchableHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R003],
        `Cannot access field '${key}' on non-dict`
      );
    case 'absent': {
      const message = isOrdered(receiver)
        ? `Undefined ordered key: ${key}`
        : typeof key === 'string'
          ? `Dict has no field '${key}'`
          : `Undefined dict key: ${key}`;
      return throwCatchableHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R009],
        message
      );
    }
    default:
      return throwNotIndexable(receiver, site);
  }
}

/** Halt for an absent dict key, as the bracket read words it. */
export function throwUndefinedDictKey(
  key: FieldKey,
  site: TypeHaltSite
): never {
  return throwCatchableHostHalt(
    site,
    ERROR_ATOMS[ERROR_IDS.RILL_R009],
    `Undefined dict key: ${key}`
  );
}

/**
 * Halt for a miss in a bracket read. A dict names a missing key `Undefined
 * dict key`, whatever the key type; any other receiver halts as throwFieldMiss.
 * Every form that selects by key reports its miss through this function.
 */
export function throwBracketMiss(
  receiver: RillValue,
  key: FieldKey,
  miss: FieldMiss,
  site: TypeHaltSite
): never {
  if (isFieldReceiver(receiver)) return throwUndefinedDictKey(key, site);
  return throwFieldMiss(receiver, key, miss, site);
}

/** Declared type of a located element, projected from its receiver's type. */
export function projectLocated(
  receiverDeclared: TypeStructure | undefined,
  located: FoundField
): TypeStructure | undefined {
  return located.key === undefined
    ? undefined
    : projectElement(receiverDeclared, located.key);
}

/**
 * Read `key` from `receiver`, with the receiver's own halts on a miss.
 *
 * A property-style callable held in a dict field is invoked and its result
 * takes its own type. Any other found value reports the element type projected
 * from the receiver's declared type; a type value's property projects nothing.
 */
export async function readField(
  s: EvalState,
  receiver: RillValue,
  key: FieldKey,
  request: FieldReadRequest
): Promise<Carried> {
  const site: TypeHaltSite = {
    location: request.location,
    sourceId: s.ctx.sourceId,
    fn: request.fn,
  };
  const located = locateOrRecover(
    receiver,
    key,
    request.allowMissing,
    (miss) => {
      if (request.bracketMiss === true) {
        return throwBracketMiss(receiver, key, miss, site);
      }
      if (miss === 'absent' && isTypeValue(receiver)) {
        return throwMissingTypeProperty(site, receiver, String(key));
      }
      return throwFieldMiss(receiver, key, miss, site);
    }
  );
  if (located === undefined) return { value: null, declared: undefined };

  const stored = located.value;
  if (
    typeof key === 'string' &&
    isFieldReceiver(receiver) &&
    isCallable(stored) &&
    stored.isProperty
  ) {
    // ApplicationCallable: pass [dict] as args (no boundDict mechanism)
    // ScriptCallable: pass [] - dict is bound via boundDict -> pipeValue
    const args = stored.kind === 'script' ? [] : [receiver];
    return {
      value: await invokeCallable(s, stored, args, request.location),
      declared: undefined,
    };
  }
  return {
    value: stored,
    declared: projectLocated(request.receiverDeclared, located),
  };
}

// ============================================================
// FORMS
// ============================================================

function siteFor(s: EvalState, node: VariableNode, fn: string): TypeHaltSite {
  return { location: getNodeLocation(s, node), sourceId: s.ctx.sourceId, fn };
}

/**
 * Evaluate field access using a variable as the key.
 * Resolves the variable by name and reads the resulting key from the
 * receiver. The key is validated and a miss reported exactly as the
 * bracket read `[$k]` does.
 *
 * @param s - Evaluator state
 * @param access - The field access node with variable name
 * @param value - The current value being accessed
 * @param node - The parent variable node for location info
 * @param allowMissing - Resolve a miss to null instead of halting
 * @param receiverDeclared - Declared type of the receiver, if any
 * @returns The field or element value with its projected declared type
 * @throws RuntimeHaltSignal (catchable) if the variable is undefined, the
 *   key has the wrong type, or the read misses without allowMissing
 */
export async function evaluateFieldAccessVariable(
  s: EvalState,
  access: {
    readonly kind: 'variable';
    readonly variableName: string | null;
  },
  value: RillValue,
  node: VariableNode,
  allowMissing: boolean,
  receiverDeclared?: TypeStructure
): Promise<Carried> {
  const fn = 'evaluateFieldAccessVariable';
  let keyValue: RillValue | undefined;
  if (access.variableName === null) {
    // .$ (pipe variable as key)
    keyValue = s.ctx.pipeValue ?? undefined;
    if (keyValue === undefined) {
      throwCatchableHostHalt(
        siteFor(s, node, fn),
        ERROR_ATOMS[ERROR_IDS.RILL_R005],
        `Pipe variable '$' is undefined`
      );
    }
  } else {
    // .$variable (named variable as key)
    keyValue = getVariable(s.ctx, access.variableName);
    if (keyValue === undefined) {
      throwCatchableHostHalt(
        siteFor(s, node, fn),
        ERROR_ATOMS[ERROR_IDS.RILL_R005],
        `Variable '${access.variableName}' is undefined`
      );
    }
  }

  const key = bracketKey(value, keyValue, siteFor(s, node, fn));
  return await readField(s, value, key, {
    allowMissing,
    location: getNodeLocation(s, node),
    fn,
    receiverDeclared,
    bracketMiss: true,
  });
}
