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
 * - Computed key: $data.(expr)
 * - Alternatives: $data.(a || b)
 * - Existence checks (.?) locate without invoking anything
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

import type {
  ExpressionNode,
  SourceLocation,
  VariableNode,
} from '../../../../types.js';
import { isPipeChainNode } from '../../../../types.js';
import type { RillValue, TypeStructure } from '../../types/structures.js';
import type { Carried } from '../../types/declared.js';
import { projectElement } from '../../types/declared.js';
import { inferType } from '../../types/registrations.js';
import {
  isIterator,
  isOrdered,
  isStream,
  isTuple,
  isTypeValue,
} from '../../types/guards.js';
import { getVariable } from '../../context.js';
import {
  nonIntegerIndexMessage,
  throwIndexOutOfBounds,
} from '../../types/index-access.js';
import type { IndexKind } from '../../types/index-access.js';
import { isDict, isCallable } from '../../callable.js';
import {
  throwCatchableHostHalt,
  throwFatalHostHalt,
} from '../../types/halt.js';
import type { TypeHaltSite } from '../../types/halt.js';
import {
  readTypeProperty,
  throwMissingTypeProperty,
} from '../../types/type-properties.js';
import type { EvalState } from '../state.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import { getNodeLocation, isFieldReceiver, readOwnField } from '../shared.js';
import { getTypedKey, getTypedKeyMap } from '../../types/dict-keys.js';
import { evaluatePipeChain } from './core.js';
import { invokeCallable } from './closures.js';

// ============================================================
// TYPES
// ============================================================

/** A key that can address a field or position. */
export type FieldKey = string | number | boolean;

/** Why a lookup found nothing. */
type FieldMiss =
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
  /** Every alternative tried, reported when none exists. */
  readonly names?: readonly string[] | undefined;
}

// ============================================================
// LOCATE
// ============================================================

/** True for the value kinds that can key a field read. */
export function isFieldKey(value: RillValue): value is FieldKey {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
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
    if (isStream(receiver) || isIterator(receiver)) {
      return NOT_FOUND('not-indexable');
    }
    if (getTypedKeyMap(receiver) === undefined) {
      return NOT_FOUND('not-indexable');
    }
    const value = getTypedKey(receiver, key);
    return value === undefined || value === null
      ? NOT_FOUND('absent')
      : {
          found: true,
          value,
          key,
        };
  }
  return typeof key === 'string'
    ? NOT_FOUND('no-fields')
    : NOT_FOUND('not-indexable');
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
  site: TypeHaltSite,
  names?: readonly string[]
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
      const message =
        names !== undefined
          ? `Dict has none of the fields ${names.map((k) => `'${k}'`).join(', ')}`
          : isOrdered(receiver)
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
  const located = locateField(receiver, key);
  const site: TypeHaltSite = {
    location: request.location,
    sourceId: s.ctx.sourceId,
    fn: request.fn,
  };
  if (!located.found) {
    if (located.miss === 'non-integer' && typeof key === 'number') {
      return throwNonIntegerIndex(receiver, key, site);
    }
    if (request.allowMissing) return { value: null, declared: undefined };
    if (located.miss === 'absent' && isTypeValue(receiver)) {
      return throwMissingTypeProperty(
        site,
        receiver,
        request.names ?? String(key)
      );
    }
    return throwFieldMiss(receiver, key, located.miss, site, request.names);
  }

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

/** True when a bool or number key may address `receiver` through typed keys. */
function usesTypedKeys(receiver: RillValue): boolean {
  return isDict(receiver) && getTypedKeyMap(receiver) !== undefined;
}

function siteFor(s: EvalState, node: VariableNode, fn: string): TypeHaltSite {
  return { location: getNodeLocation(s, node), sourceId: s.ctx.sourceId, fn };
}

/**
 * Evaluate field access using a variable as the key.
 * Resolves the variable by name and reads the resulting string, number or
 * (for a dict with typed keys) bool key from the receiver.
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

  // A boolean key addresses only a dict that carries a typed-key sidecar;
  // on any other receiver it halts with the key-type error.
  if (
    isFieldKey(keyValue) &&
    (typeof keyValue !== 'boolean' || usesTypedKeys(value))
  ) {
    return await readField(s, value, keyValue, {
      allowMissing,
      location: getNodeLocation(s, node),
      fn,
      receiverDeclared,
    });
  }
  return throwCatchableHostHalt(
    siteFor(s, node, fn),
    ERROR_ATOMS[ERROR_IDS.RILL_R002],
    `Key must be string or number, got ${inferType(keyValue)}`
  );
}

/**
 * Evaluate field access using a computed expression as the key.
 * Evaluates the expression and reads the resulting string, number or (for a
 * dict with typed keys) bool key from the receiver.
 *
 * @param s - Evaluator state
 * @param access - The field access node with expression
 * @param value - The current value being accessed
 * @param node - The parent variable node for location info
 * @param allowMissing - Resolve a miss to null instead of halting
 * @param receiverDeclared - Declared type of the receiver, if any
 * @returns The field or element value, carrying the element type projected
 *   from the receiver's declared type
 * @throws RuntimeHaltSignal (catchable or fatal) if the expression result is
 *   the wrong type or the read misses without allowMissing
 */
export async function evaluateFieldAccessComputed(
  s: EvalState,
  access: {
    readonly kind: 'computed';
    readonly expression: ExpressionNode;
  },
  value: RillValue,
  node: VariableNode,
  allowMissing: boolean,
  receiverDeclared?: TypeStructure
): Promise<Carried> {
  const fn = 'evaluateFieldAccessComputed';
  // Evaluate the expression to get the key. Parsed inline while
  // building a live access chain (never via the statement-level
  // recovery path), so it only ever holds a PipeChainNode;
  // PartialExpressionNode is reserved for parser error recovery.
  if (!isPipeChainNode(access.expression)) {
    throwFatalHostHalt(
      siteFor(s, node, fn),
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      'Computed field access expression must be a pipe chain'
    );
  }
  const keyValue = await evaluatePipeChain(s, access.expression);

  if (isCallable(keyValue)) {
    throwCatchableHostHalt(
      siteFor(s, node, fn),
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Computed key evaluated to closure, expected string or number`
    );
  }
  if (isDict(keyValue)) {
    throwCatchableHostHalt(
      siteFor(s, node, fn),
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Computed key evaluated to dict, expected string or number`
    );
  }
  if (
    isFieldKey(keyValue) &&
    (typeof keyValue !== 'boolean' || usesTypedKeys(value))
  ) {
    return await readField(s, value, keyValue, {
      allowMissing,
      location: getNodeLocation(s, node),
      fn,
      receiverDeclared,
    });
  }
  if (typeof keyValue === 'boolean' || Array.isArray(keyValue)) {
    throwCatchableHostHalt(
      siteFor(s, node, fn),
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Computed key evaluated to ${inferType(keyValue)}, expected string or number`
    );
  }
  return throwCatchableHostHalt(
    siteFor(s, node, fn),
    ERROR_ATOMS[ERROR_IDS.RILL_R002],
    `Computed key evaluated to unexpected type`
  );
}

/**
 * Evaluate field access using alternatives (try keys left-to-right).
 * Reads the first key the receiver defines. When every key is missing it
 * halts, unless a `??` default or `.?` existence check permits a
 * coalescible null.
 *
 * @param s - Evaluator state
 * @param access - The field access node with alternatives array
 * @param value - The current value being accessed (dict, stream, ordered or type value)
 * @param node - The parent variable node for location info
 * @param allowMissing - If true, return null when every key is missing
 * @param receiverDeclared - Declared type of the receiver, if any
 * @returns The first found value with its projected declared type
 * @throws RuntimeHaltSignal (catchable) if the target cannot hold fields, or
 *   if all keys are missing without allowMissing
 */
export async function evaluateFieldAccessAlternatives(
  s: EvalState,
  access: {
    readonly kind: 'alternatives';
    readonly alternatives: string[];
  },
  value: RillValue,
  node: VariableNode,
  allowMissing = false,
  receiverDeclared?: TypeStructure
): Promise<Carried> {
  const fn = 'evaluateFieldAccessAlternatives';
  if (!isFieldReceiver(value) && !isOrdered(value) && !isTypeValue(value)) {
    throwCatchableHostHalt(
      siteFor(s, node, fn),
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Alternative access requires dict, got ${inferType(value)}`
    );
  }
  const request = {
    allowMissing,
    location: getNodeLocation(s, node),
    fn,
    receiverDeclared,
    names: access.alternatives,
  };

  // Short-circuit on the first alternative the receiver defines.
  for (const key of access.alternatives) {
    if (locateField(value, key).found) {
      return await readField(s, value, key, { ...request, allowMissing: true });
    }
  }
  return await readField(s, value, access.alternatives[0] ?? '', request);
}
