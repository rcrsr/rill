/**
 * Callable Types
 *
 * Unified representation for all callable values in Rill:
 * - ScriptCallable: Closures parsed from Rill source code
 * - RuntimeCallable: Rill's built-in functions (type, log, json, identity)
 * - ApplicationCallable: Host application-provided functions
 *
 * Public API for host applications.
 *
 * ## Implementation Notes
 *
 * [DEVIATION] Excess-argument error context fields
 * - Spec defines error context as { functionName, paramName, expectedType, actualType }
 * - Excess arguments instead uses { functionName, expectedCount, actualCount }
 * - Rationale: Excess arguments is an arity check, not a type check
 *
 * [ASSUMPTION] validateDefaultValueType _functionName Parameter
 * - Parameter accepted but unused (prefixed with _ to satisfy eslint)
 * - Kept for API consistency with marshalArgs signature
 */

import type { BodyNode, SourceLocation } from '../../types.js';
import { RuntimeError } from '../../types.js';
import { astEquals } from './equals.js';
import {
  isAtom,
  isCallable as _isCallableGuard,
  isDatetime,
  isDict,
  isDuration,
  isIterator,
  isOrdered,
  isStream,
  isTuple,
  isTypeValue,
  isVector,
} from './types/guards.js';
import type {
  TypeStructure,
  RillTypeValue,
  RillValue,
} from './types/structures.js';
import type {
  DictStructure,
  TupleStructure,
  OrderedStructure,
} from './types/operations.js';
import { formatValue, inferType } from './types/registrations.js';
import {
  formatStructure,
  structureEquals,
  structureMatches,
} from './types/operations.js';
import {
  createOrdered,
  copyValue,
  emptyForType,
} from './types/constructors.js';
import { hasCollectionFields } from './values.js';
import { copyTypedKeys, setDictField } from './types/dict-keys.js';
import { ERROR_IDS } from '../../error-registry.js';

// Forward reference to RuntimeContext (defined in types.ts)
// Using a minimal interface to avoid circular dependency
interface RuntimeContextLike {
  readonly parent?: RuntimeContextLike | undefined;
  readonly variables: Map<string, RillValue>;
  pipeValue: RillValue;
  readonly metadata?: Record<string, string> | undefined;
  readonly hostContext: Record<string, unknown>;
}

/**
 * Callable function signature.
 * Used for both host-provided functions and runtime callables.
 */
export type CallableFn = (
  args: Record<string, RillValue>,
  ctx: RuntimeContextLike,
  location?: SourceLocation
) => RillValue | Promise<RillValue>;

/**
 * Unified parameter definition for all callable types (script closures and host functions).
 *
 * - type: undefined means the parameter accepts any type (any-typed).
 * - defaultValue: undefined means the parameter is required.
 * - annotations: evaluated key-value pairs; empty object ({}) when no annotations present.
 * - Description lives at annotations.description — no separate description field.
 */
export interface RillParam {
  readonly name: string;
  readonly type: TypeStructure | undefined;
  readonly defaultValue: RillValue | undefined;
  readonly annotations: Record<string, RillValue>;
}

/**
 * Unified host function definition using RillParam for parameter declarations.
 *
 * Replaces HostFunctionDefinition. Runtime does NOT validate return values
 * against returnType at call time.
 */
export interface RillFunction {
  readonly params: readonly RillParam[];
  readonly fn: CallableFn;
  readonly annotations?: Record<string, RillValue>;
  readonly returnType: RillTypeValue;
  /** When true, RILL-R003 generic receiver validation is skipped for this method. */
  readonly skipReceiverValidation?: boolean;
}

/** Common fields for all callable types */
interface CallableBase {
  readonly __type: 'callable';
  /**
   * Property-style callable: auto-invoked when accessed from a dict.
   * For script callables, $ is bound to the containing dict.
   * For runtime callables, the dict is passed as first argument.
   */
  readonly isProperty: boolean;
  readonly params: readonly RillParam[];
  readonly annotations: Record<string, RillValue>;
  readonly returnType: RillTypeValue;
  /** Reference to containing dict (set when stored in a dict) */
  boundDict?: Record<string, RillValue>;
}

/**
 * Script callable - parsed from Rill source code.
 *
 * Carries closure-level annotations captured at creation time.
 * Per-parameter annotations are accessible via params[i].annotations.
 */
export interface ScriptCallable extends CallableBase {
  readonly kind: 'script';
  readonly body: BodyNode;
  /** Reference to the scope where this closure was defined (late binding) */
  readonly definingScope: RuntimeContextLike;
}

/** Runtime callable - Rill's built-in functions (type, log, json, identity) */
export interface RuntimeCallable extends CallableBase {
  readonly kind: 'runtime';
  readonly fn: CallableFn;
}

/** Application callable - host application-provided functions */
export interface ApplicationCallable extends CallableBase {
  readonly kind: 'application';
  readonly fn: CallableFn;
}

/** Union of all callable types */
export type RillCallable =
  | ScriptCallable
  | RuntimeCallable
  | ApplicationCallable;

/** Type guard for any callable (delegates to types/guards.ts) */
export const isCallable = _isCallableGuard as (
  value: RillValue
) => value is RillCallable;

/** Type guard for script callable */
export function isScriptCallable(value: RillValue): value is ScriptCallable {
  return isCallable(value) && value.kind === 'script';
}

/** Type guard for runtime callable */
export function isRuntimeCallable(value: RillValue): value is RuntimeCallable {
  return isCallable(value) && value.kind === 'runtime';
}

/** Type guard for application callable */
export function isApplicationCallable(
  value: RillValue
): value is ApplicationCallable {
  return isCallable(value) && value.kind === 'application';
}

export { callable } from './callable-factory.js';

/**
 * Convert a RillFunction to an ApplicationCallable.
 *
 * Validates the input and produces a callable value accepted by the loader.
 * Pure function with no side effects.
 *
 * @param def - Host function definition to convert
 * @returns ApplicationCallable with __type, kind, isProperty, and preserved annotations
 */
export function toCallable(
  def: RillFunction,
  isProperty = false
): ApplicationCallable {
  if (def === null || def === undefined) {
    throw new TypeError('RillFunction cannot be null or undefined');
  }
  if (typeof def.fn !== 'function') {
    throw new TypeError('RillFunction.fn must be a function');
  }
  if (!Array.isArray(def.params)) {
    throw new TypeError('RillFunction.params must be an array');
  }
  return {
    __type: 'callable',
    kind: 'application',
    isProperty,
    fn: def.fn,
    params: def.params,
    returnType: def.returnType,
    annotations: def.annotations ?? {},
  };
}

// isDict imported from ./types/guards.js and re-exported
export { isDict };

/**
 * Compare two annotation records for equality.
 * Returns true if both records have the same keys and values.
 */
function annotationsEqual(
  a: Record<string, RillValue>,
  b: Record<string, RillValue>,
  valueEquals: (a: RillValue, b: RillValue) => boolean
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!(key in b)) return false;
    if (!valueEquals(a[key] as RillValue, b[key] as RillValue)) return false;
  }

  return true;
}

/**
 * Deep equality for script callables.
 * Compares params, declared return type, body AST structure, defining scope,
 * and annotations.
 *
 * Two closures are equal if:
 * 1. Same parameter names, types, default values, and annotations
 * 2. Structurally identical declared return type (`:T` suffix)
 * 3. Structurally identical body AST (ignoring source locations)
 * 4. Same defining scope (reference equality)
 * 5. Same closure-level annotations
 * 6. Same parameter-level annotations
 */
export function callableEquals(
  a: ScriptCallable,
  b: ScriptCallable,
  valueEquals: (a: RillValue, b: RillValue) => boolean = (x, y) =>
    formatValue(x) === formatValue(y)
): boolean {
  // Compare params (name, type, default, annotations)
  if (a.params.length !== b.params.length) return false;
  for (let i = 0; i < a.params.length; i++) {
    const ap = a.params[i];
    const bp = b.params[i];
    if (ap === undefined || bp === undefined) return false;
    if (ap.name !== bp.name) return false;
    // Compare type via structureEquals; absent type (any-typed) matches absent type
    if (ap.type === undefined && bp.type !== undefined) return false;
    if (ap.type !== undefined && bp.type === undefined) return false;
    if (
      ap.type !== undefined &&
      bp.type !== undefined &&
      !structureEquals(ap.type, bp.type)
    )
      return false;
    if (!valueEquals(ap.defaultValue ?? null, bp.defaultValue ?? null)) {
      return false;
    }
    if (!annotationsEqual(ap.annotations, bp.annotations, valueEquals)) {
      return false;
    }
  }

  // Compare declared return type structurally. Two closures that differ only
  // in their `:T` return-type suffix are distinct values.
  if (!structureEquals(a.returnType.structure, b.returnType.structure)) {
    return false;
  }

  // Compare body by AST structure (ignoring source locations)
  if (!astEquals(a.body, b.body)) {
    return false;
  }

  // Compare defining scope by reference (same scope = same closure context)
  if (a.definingScope !== b.definingScope) return false;

  // Compare closure-level annotations
  if (!annotationsEqual(a.annotations, b.annotations, valueEquals)) {
    return false;
  }

  return true;
}

/**
 * Build a TypeStructure closure variant from a closure's parameter list.
 *
 * Called at closure creation time to build the structural type for `$fn.^input`.
 * - Typed params use param.type directly when present
 * - Untyped params (type: undefined) map to { kind: 'any' }
 * - Return type is always { kind: 'any' }
 *
 * Validate defaultValue type matches declared parameter type.
 *
 * Called at registration time to catch configuration errors early.
 * Throws Error (not RuntimeError) to indicate registration failure.
 *
 * @param param - Parameter with defaultValue to validate
 * @param _functionName - Function name (unused, kept for API consistency)
 * @throws Error if defaultValue type doesn't match param.type
 */
export function validateDefaultValueType(
  param: RillParam,
  _functionName: string
): void {
  if (param.defaultValue === undefined) return;

  // Skip validation when type is undefined (any-typed, all defaults valid)
  if (param.type === undefined) return;

  if (!structureMatches(param.defaultValue, param.type)) {
    const actualType = inferType(param.defaultValue);
    const expectedType = formatStructure(param.type);
    throw new RuntimeError(
      ERROR_IDS.RILL_R077,
      `Invalid defaultValue for parameter '${param.name}': expected ${expectedType}, got ${actualType}`
    );
  }
}

/**
 * Options for marshalArgs error reporting.
 */
export interface MarshalOptions {
  /** Function name included in error messages */
  readonly functionName: string;
  /** Source location for error reporting */
  readonly location: SourceLocation | undefined;
}

/**
 * Info passed to `HydrationPolicy.onMissingField` when a declared dict/ordered
 * field or tuple element has no value, no default, and is not itself a
 * collection type that can be synthesized empty.
 */
export interface HydrationMissingFieldInfo {
  /** Which structural kind the missing field belongs to. */
  readonly kind: 'dict' | 'ordered' | 'tuple';
  /** Runtime shape of the value being hydrated (e.g. 'dict', 'ordered', 'tuple'). */
  readonly source: string;
  /** Structural kind being hydrated into; mirrors `kind` as a string. */
  readonly target: string;
  /** Field name (dict/ordered) or stringified index (tuple). */
  readonly fieldName: string;
  /** Element index, set only when `kind === 'tuple'`. */
  readonly position: number | undefined;
}

/**
 * Behavior knobs that let a single structural walker serve two independent
 * callers whose missing-field and extras handling were never meant to
 * diverge, but drifted because each caller carried its own copy of the walk.
 *
 * - `onMissingField` never lets the walker throw directly: marshaling
 *   (host-application argument binding) leaves the field absent and lets
 *   Stage 3 type-check report RILL-R001; `-> type` conversion throws
 *   RILL-R044 immediately, since a structural conversion has no later
 *   type-check stage to fall back on.
 * - `keepExtras` controls whether keys/elements not declared on the target
 *   type survive in the result (marshaling: yes, values must remain
 *   structurally compatible with the wider caller-supplied shape) or are
 *   dropped (conversion: yes, `-> type` narrows to exactly the declared
 *   shape).
 * - `coerceOrderedFromDict` controls whether a plain dict value is accepted
 *   as a source for an `ordered`-typed field (conversion allows dict ->
 *   ordered per the compatibility matrix; marshaling never coerces shape,
 *   only fills defaults on an already-ordered value).
 */
export interface HydrationPolicy {
  readonly onMissingField: (info: HydrationMissingFieldInfo) => void;
  readonly keepExtras: boolean;
  readonly coerceOrderedFromDict: boolean;
}

/**
 * Recursively walk a value against a dict/ordered/tuple TypeStructure,
 * filling in field-level defaults and empty collections, per a
 * HydrationPolicy. Returns the value unchanged when the type has no
 * fields/elements or the value's runtime shape does not match.
 *
 * Shared by `hydrateFieldDefaults` (argument marshaling) and conversion's
 * nested-field hydration (`-> type` structural conversion). See
 * HydrationPolicy for why these two callers need distinct behavior.
 *
 * Pure function: no class context, no evaluator, no side effects beyond
 * invoking `policy.onMissingField`.
 */
export function hydrateStructure(
  value: RillValue,
  type: TypeStructure,
  policy: HydrationPolicy
): RillValue {
  if (type.kind === 'dict' && (type as DictStructure).fields && isDict(value)) {
    const t = type as DictStructure;
    const dictValue = value as Record<string, RillValue>;
    const result: Record<string, RillValue> = policy.keepExtras
      ? { ...dictValue }
      : {};
    if (policy.keepExtras) {
      copyTypedKeys(dictValue, result);
    }
    for (const [fieldName, fieldDef] of Object.entries(t.fields!)) {
      if (Object.hasOwn(dictValue, fieldName)) {
        setDictField(
          result,
          fieldName,
          hydrateStructure(dictValue[fieldName]!, fieldDef.type, policy)
        );
      } else if (fieldDef.defaultValue !== undefined) {
        setDictField(
          result,
          fieldName,
          hydrateStructure(
            copyValue(fieldDef.defaultValue),
            fieldDef.type,
            policy
          )
        );
      } else if (hasCollectionFields(fieldDef.type)) {
        setDictField(
          result,
          fieldName,
          hydrateStructure(emptyForType(fieldDef.type), fieldDef.type, policy)
        );
      } else {
        policy.onMissingField({
          kind: 'dict',
          source: 'dict',
          target: 'dict',
          fieldName,
          position: undefined,
        });
      }
    }
    return result;
  }

  if (
    type.kind === 'ordered' &&
    (type as OrderedStructure).fields &&
    (isOrdered(value) || (policy.coerceOrderedFromDict && isDict(value)))
  ) {
    const t = type as OrderedStructure;
    const source = isOrdered(value) ? 'ordered' : 'dict';
    const lookup = new Map<string, RillValue>(
      isOrdered(value)
        ? value.entries.map(([k, v]) => [k, v] as [string, RillValue])
        : Object.entries(value as Record<string, RillValue>)
    );
    const fieldNames = new Set<string>(t.fields!.map((f) => f.name ?? ''));
    const resultEntries: [string, RillValue][] = [];
    for (const field of t.fields!) {
      const name = field.name ?? '';
      if (lookup.has(name)) {
        resultEntries.push([
          name,
          hydrateStructure(lookup.get(name)!, field.type, policy),
        ]);
      } else if (field.defaultValue !== undefined) {
        resultEntries.push([
          name,
          hydrateStructure(copyValue(field.defaultValue), field.type, policy),
        ]);
      } else if (hasCollectionFields(field.type)) {
        resultEntries.push([
          name,
          hydrateStructure(emptyForType(field.type), field.type, policy),
        ]);
      } else {
        policy.onMissingField({
          kind: 'ordered',
          source,
          target: 'ordered',
          fieldName: name,
          position: undefined,
        });
      }
    }
    if (policy.keepExtras) {
      const sourceEntries = isOrdered(value)
        ? value.entries
        : Object.entries(value as Record<string, RillValue>);
      for (const [k, v] of sourceEntries) {
        if (!fieldNames.has(k)) {
          resultEntries.push([k, v]);
        }
      }
    }
    return createOrdered(resultEntries);
  }

  if (
    type.kind === 'tuple' &&
    (type as TupleStructure).elements &&
    isTuple(value)
  ) {
    const elements = (type as TupleStructure).elements!;
    const entries = value.entries;
    const resultEntries: RillValue[] = [];
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i]!;
      if (i < entries.length) {
        resultEntries.push(hydrateStructure(entries[i]!, el.type, policy));
      } else if (el.defaultValue !== undefined) {
        resultEntries.push(
          hydrateStructure(copyValue(el.defaultValue), el.type, policy)
        );
      } else if (hasCollectionFields(el.type)) {
        resultEntries.push(
          hydrateStructure(emptyForType(el.type), el.type, policy)
        );
      } else {
        policy.onMissingField({
          kind: 'tuple',
          source: 'tuple',
          target: 'tuple',
          fieldName: String(i),
          position: i,
        });
      }
    }
    if (policy.keepExtras) {
      for (let i = elements.length; i < entries.length; i++) {
        resultEntries.push(entries[i]!);
      }
    }
    // resultEntries is a freshly-built array exclusively owned by this call;
    // freeze directly instead of going through createTuple's defensive copy.
    return Object.freeze({
      __rill_tuple: true as const,
      entries: resultEntries,
    });
  }

  if (type.kind === 'union') {
    // First structural match wins, in declaration order. When two members
    // overlap structurally, the same value hydrates differently depending on
    // which is declared first; declare union members non-overlapping (or
    // most-specific-first) for predictable hydration.
    const members = (type as { kind: 'union'; members: TypeStructure[] })
      .members;
    const match = members.find((member) => structureMatches(value, member));
    if (match) {
      return hydrateStructure(value, match, policy);
    }
  }

  return value;
}

/**
 * Marshaling hydration policy: leave missing required fields absent (Stage 3
 * type-check reports RILL-R001), keep extras (structural match allows wider
 * shapes than declared), never coerce a dict source into an ordered target.
 */
const MARSHAL_HYDRATION_POLICY: HydrationPolicy = {
  onMissingField: () => {
    // Leave the field absent; Stage 3 (structureMatches) reports RILL-R001.
  },
  keepExtras: true,
  coerceOrderedFromDict: false,
};

/**
 * Hydrate missing dict/ordered field-level defaults into a value.
 *
 * When a param has type `dict(a: string = "x", b: number)` and the caller
 * passes `[b: 2]`, this fills in `a` with its default `"x"`. Fields without
 * defaults are left absent so Stage 3 catches them with RILL-R001.
 *
 * Pure function: no class context, no evaluator, no side effects.
 */
export function hydrateFieldDefaults(
  value: RillValue,
  type: TypeStructure
): RillValue {
  return hydrateStructure(value, type, MARSHAL_HYDRATION_POLICY);
}

/**
 * Unified marshaling entry point for all 3 invocation paths.
 *
 * Builds a named argument map from positional args, hydrates defaults,
 * type-checks each field, and returns a Record<string, RillValue>.
 *
 * Stages:
 * 1. Excess args check (RILL-R045)
 * 2. Default hydration + missing required check (RILL-R044)
 * 2.5. Dict/ordered field-level default hydration
 * 3. Type check per field (RILL-R001)
 *
 * Preconditions (enforced by caller):
 * - args contains already-evaluated RillValue[]
 * - pipe value already inserted as first element by caller
 * - boundDict already prepended as first element by caller
 * - params is defined (caller skips marshalArgs for untyped callables)
 *
 * @param args - Positional arguments (already evaluated)
 * @param params - Parameter definitions
 * @param options - Error context: functionName and location
 * @returns Named argument map keyed by param name
 */
export function marshalArgs(
  args: RillValue[],
  params: readonly RillParam[],
  options?: MarshalOptions
): Record<string, RillValue> {
  const functionName = options?.functionName ?? '<anonymous>';
  const location = options?.location;

  // Stage 1: Excess args check
  if (args.length > params.length) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R045,
      `Function expects ${params.length} arguments, got ${args.length}`,
      location,
      {
        functionName,
        expectedCount: params.length,
        actualCount: args.length,
      }
    );
  }

  const result: Record<string, RillValue> = {};

  // Stage 2 + 3: Hydrate defaults, check required, type-check
  for (let i = 0; i < params.length; i++) {
    const param = params[i];
    if (param === undefined) continue;

    let value = args[i];

    // Hydrate default when no positional arg was supplied
    if (value === undefined) {
      if (param.defaultValue !== undefined) {
        value = param.defaultValue;
      } else if (param.type !== undefined && hasCollectionFields(param.type)) {
        // Collection-typed param with field-level defaults: synthesize empty
        // collection so Stage 2.5 (hydrateFieldDefaults) can fill in defaults
        value = emptyForType(param.type);
      } else {
        // Stage 2: Missing required parameter
        throw new RuntimeError(
          ERROR_IDS.RILL_R044,
          `Missing argument for parameter '${param.name}'`,
          location,
          {
            functionName,
            paramName: param.name,
          }
        );
      }
    }

    // Stage 2.5: Hydrate dict/ordered field-level defaults
    if (param.type !== undefined) {
      value = hydrateFieldDefaults(value, param.type);
    }

    // Stage 3: Type check when param.type is defined
    if (param.type !== undefined) {
      if (!structureMatches(value, param.type)) {
        const expectedType = formatStructure(param.type);
        const actualType = inferType(value);
        throw new RuntimeError(
          ERROR_IDS.RILL_R001,
          `Parameter type mismatch: ${param.name} expects ${expectedType}, got ${actualType}`,
          location,
          {
            functionName,
            paramName: param.name,
            expectedType,
            actualType,
          }
        );
      }
    }

    setDictField(result, param.name, value);
  }

  return result;
}

/**
 * Validates a raw JavaScript value returned by a host function, ensuring it
 * is representable in the rill value model before it flows further through
 * the runtime.
 *
 * Deep-walks arrays and plain objects. Any recognized rill value brand
 * (atom, tuple, vector, ordered value, type value, datetime, duration,
 * callable, stream, iterator, field descriptor) stops descent at that node.
 * Anything else that cannot be represented -- undefined, null, symbol,
 * bigint, a raw function, Date, Map, Set, or any other non-plain class
 * instance -- throws a fatal RuntimeError. This is a host-contract
 * violation, not a catchable script error.
 *
 * @param result - The raw value returned by the host function
 * @param functionName - Name of the host function, for the error message
 * @param location - Call-site location, for error reporting
 */
export function validateHostResult(
  result: unknown,
  functionName: string,
  location?: SourceLocation
): void {
  walkHostResult(result, functionName, '<root>', location);
}

/** Identity predicate for the field_descriptor brand (mirrors the private
 * helper in types/protocols/field-descriptor.ts, which is not exported). */
function isFieldDescriptorValue(value: object): boolean {
  return (
    '__rill_field_descriptor' in value &&
    (value as Record<string, unknown>)['__rill_field_descriptor'] === true
  );
}

/** True when `value`'s prototype is `Object.prototype` or `null`, i.e. it is
 * a plain object literal rather than a class instance. */
function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Human-readable label for the JS shape of an unrepresentable value. */
function jsTypeLabel(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'symbol') return 'symbol';
  if (t === 'bigint') return 'bigint';
  if (t === 'function') return 'function';
  if (value instanceof Date) return 'Date';
  if (value instanceof Map) return 'Map';
  if (value instanceof Set) return 'Set';
  if (t === 'object') {
    const ctorName = (value as { constructor?: { name?: string } }).constructor
      ?.name;
    return ctorName && ctorName !== 'Object' ? ctorName : 'object';
  }
  return t;
}

function throwHostResultError(
  functionName: string,
  path: string,
  value: unknown,
  location: SourceLocation | undefined
): never {
  throw new RuntimeError(
    ERROR_IDS.RILL_R085,
    `Host function '${functionName}' returned an invalid value at ${path}: ${jsTypeLabel(value)}`,
    location
  );
}

function walkHostResult(
  value: unknown,
  functionName: string,
  path: string,
  location: SourceLocation | undefined
): void {
  if (value === undefined || value === null) {
    throwHostResultError(functionName, path, value, location);
  }

  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') {
    return;
  }
  if (t === 'symbol' || t === 'bigint' || t === 'function') {
    throwHostResultError(functionName, path, value, location);
  }

  // Remaining case: t === 'object'
  const obj = value as object;
  const rillValue = value as RillValue;

  if (
    isAtom(rillValue) ||
    isTuple(rillValue) ||
    isVector(rillValue) ||
    isOrdered(rillValue) ||
    isTypeValue(rillValue) ||
    isDatetime(rillValue) ||
    isDuration(rillValue) ||
    isCallable(rillValue) ||
    isStream(rillValue) ||
    isIterator(rillValue) ||
    isFieldDescriptorValue(obj)
  ) {
    return;
  }

  if (value instanceof Date || value instanceof Map || value instanceof Set) {
    throwHostResultError(functionName, path, value, location);
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walkHostResult(value[i], functionName, `${path}[${i}]`, location);
    }
    return;
  }

  if (isPlainObject(obj)) {
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      const childPath = path === '<root>' ? `.${key}` : `${path}.${key}`;
      walkHostResult(
        (obj as Record<string, unknown>)[key],
        functionName,
        childPath,
        location
      );
    }
    return;
  }

  // Non-plain class instance: reject
  throwHostResultError(functionName, path, value, location);
}
