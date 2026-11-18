/**
 * `-> type` conversion helpers
 *
 * Converts the pipe value to a target type according to the compatibility
 * matrix. `-> type` (bare type keyword) calls applyConversion directly;
 * `-> type(...)` (parameterized type constructor) and `-> $var` (bound to a
 * type value) share one path, convertToType, so both behave identically.
 *
 * Compatibility matrix:
 * | Source  | list   | dict   | tuple   | ordered(sig)   | number          | string   | bool                |
 * |---------|--------|--------|---------|----------------|-----------------|----------|---------------------|
 * | list    | no-op  | error  | valid   | error          | error           | valid    | error               |
 * | dict    | error  | no-op  | error   | valid          | error           | valid    | error               |
 * | tuple   | valid  | error  | no-op   | error          | error           | valid    | error               |
 * | ordered | error  | valid  | error   | no-op          | error           | valid    | error               |
 * | string  | error  | error  | error   | error          | valid           | no-op    | valid("true"|"false")|
 * | number  | error  | error  | error   | error          | no-op           | valid    | valid(0 or 1)       |
 * | bool    | error  | error  | error   | error          | error           | valid    | no-op               |
 *
 * Error Contracts:
 * - RILL-R036: Incompatible source/target type, or a function, iterator,
 *   vector, datetime, or duration inside a collection converted to string
 * - RILL-R037: dict -> ordered without structural signature
 * - RILL-R038: Non-parseable string to number
 *
 * @internal
 */

import type { ASTNode } from '../../../../types.js';
import {
  RuntimeHaltSignal,
  throwCatchableHostHalt,
  enrichHaltOriginLocation,
} from '../../types/halt.js';
import { ControlSignal } from '../../signals.js';
import type {
  RillValue,
  TypeStructure,
  RillFieldDef,
  RillTypeValue,
} from '../../types/structures.js';
import { inferType, inferTypeName } from '../../types/registrations.js';
import {
  isTuple,
  isOrdered,
  isPlainDict,
  isStructureKind,
} from '../../types/guards.js';
import {
  createOrdered,
  createTuple,
  copyValue,
  emptyForType,
} from '../../types/constructors.js';
import { hasCollectionFields } from '../../values.js';
import type {
  HydrationMissingFieldInfo,
  HydrationPolicy,
} from '../../callable.js';
import { hydrateStructure } from '../../callable.js';
import { setDictField, orderedDictEntries } from '../../types/dict-keys.js';
import { BUILT_IN_TYPES } from '../../types/registrations.js';

import type { EvalState } from '../state.js';
import type { RillTypeName } from '../../../../types.js';
import { isRillTypeName } from '../../../../types.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import { getStatus } from '../../types/status.js';
import { getNodeLocation } from '../shared.js';
import { assertType } from './types.js';
import { structureMatches, formatStructure } from '../../types/operations.js';

/**
 * Convert a value to a resolved type target. The single conversion path for
 * `-> type(...)` and `-> $var` when `$var` holds a type value.
 *
 * - dict/ordered with explicit `fields` (and no `valueType`), tuple with
 *   explicit `elements`:
 *   structural conversion (assert inner, fill defaults, drop extras)
 * - Every other type: convert by type name, then assert the structure
 */
export function convertToType(
  s: EvalState,
  input: RillValue,
  target: RillTypeValue,
  node: ASTNode
): RillValue {
  const { structure } = target;
  if (
    isStructureKind(structure, 'dict') &&
    structure.fields !== undefined &&
    !structure.valueType
  ) {
    return convertToDictWithSig(s, input, structure.fields, node);
  }
  if (
    isStructureKind(structure, 'ordered') &&
    structure.fields !== undefined &&
    !structure.valueType
  ) {
    return convertToOrderedWithSig(s, input, structure.fields, node);
  }
  if (isStructureKind(structure, 'tuple') && structure.elements !== undefined) {
    return convertToTupleWithSig(s, input, structure.elements, node);
  }
  if (
    isStructureKind(structure, 'list') ||
    isStructureKind(structure, 'dict') ||
    isStructureKind(structure, 'ordered')
  ) {
    return convertPart(s, input, structure, node);
  }
  const result = applyConversion(s, input, target.typeName, node);
  assertType(s, result, structure, node.span.start);
  return result;
}

/** Append the failing part (`element 1`, `field 'a'`) to a halt message. */
function withPart(message: string, part: string | undefined): string {
  return part === undefined ? message : `${message} (${part})`;
}

/** Extend the enclosing part with the part inside it (`element 1, field 'a'`). */
function joinPart(outer: string | undefined, inner: string): string {
  return outer === undefined ? inner : `${outer}, ${inner}`;
}

/**
 * Convert one part of a parameterized target (an element, field, value, or
 * position) to its declared structure. Containers recurse; a nested `any`
 * passes unchanged; a nested union, literal, or closure signature is checked
 * structurally and a miss halts RILL-R036 naming the part.
 */
function convertPart(
  s: EvalState,
  value: RillValue,
  structure: TypeStructure,
  node: ASTNode,
  part?: string
): RillValue {
  if (structure.kind === 'any') {
    return value;
  }
  if (isStructureKind(structure, 'dict') && structure.valueType === undefined) {
    if (structure.fields !== undefined) {
      return convertToDictWithSig(s, value, structure.fields, node, part);
    }
  }
  if (
    isStructureKind(structure, 'ordered') &&
    structure.valueType === undefined &&
    structure.fields !== undefined
  ) {
    return convertToOrderedWithSig(s, value, structure.fields, node, part);
  }
  if (isStructureKind(structure, 'tuple') && structure.elements !== undefined) {
    return convertToTupleWithSig(s, value, structure.elements, node, part);
  }
  if (isStructureKind(structure, 'list')) {
    const outer = applyConversion(s, value, 'list', node, part);
    if (structure.element === undefined || !Array.isArray(outer)) {
      return outer;
    }
    const elementType = structure.element;
    return outer.map((item, i) =>
      convertPart(s, item, elementType, node, `element ${i}`)
    );
  }
  if (isStructureKind(structure, 'dict') && structure.valueType) {
    const outer = applyConversion(s, value, 'dict', node, part);
    if (!isPlainDict(outer)) {
      return outer;
    }
    const valueType = structure.valueType;
    const result: Record<string, RillValue> = {};
    for (const { key, value: item } of orderedDictEntries(outer)) {
      setDictField(
        result,
        key,
        convertPart(s, item, valueType, node, `field '${key}'`)
      );
    }
    return result;
  }
  if (isStructureKind(structure, 'ordered') && structure.valueType) {
    const outer = applyConversion(s, value, 'ordered', node, part);
    if (!isOrdered(outer)) {
      return outer;
    }
    const valueType = structure.valueType;
    return createOrdered(
      outer.entries.map(([key, item]): [string, RillValue] => [
        key,
        convertPart(s, item, valueType, node, `field '${key}'`),
      ])
    );
  }
  if (
    structure.kind === 'union' ||
    structure.kind === 'literal' ||
    (isStructureKind(structure, 'closure') &&
      (structure.params !== undefined || structure.ret !== undefined))
  ) {
    const hydrated = hydrateNested(s, value, structure, node);
    if (!structureMatches(hydrated, structure)) {
      throwCatchableHostHalt(
        {
          location: getNodeLocation(s, node),
          sourceId: s.ctx.sourceId,
          fn: 'convertType',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R036],
        withPart(
          `cannot convert ${inferType(value)} to ${formatStructure(structure)}`,
          part
        ),
        { source: inferType(value), target: structure.kind }
      );
    }
    return hydrated;
  }
  if (!isRillTypeName(structure.kind)) {
    return throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'convertType',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R036],
      withPart(`cannot convert ${inferType(value)} to ${structure.kind}`, part),
      { source: inferType(value), target: structure.kind }
    );
  }
  return applyConversion(s, value, structure.kind, node, part);
}

const PROTOCOL_CONVERSION_ATOMS: ReadonlySet<string> = new Set([
  ERROR_ATOMS[ERROR_IDS.RILL_R064],
  ERROR_ATOMS[ERROR_IDS.RILL_R065],
  ERROR_ATOMS[ERROR_IDS.RILL_R066],
]);

/**
 * True when a halt carries one of the protocol-converter atoms. Matches on
 * the resolved atom's own name.
 */
function isProtocolConversionHalt(err: RuntimeHaltSignal): boolean {
  return PROTOCOL_CONVERSION_ATOMS.has(getStatus(err.value).code.name);
}

/**
 * Apply conversion from source value to target type name.
 * Dispatches to protocol.convertTo on the source type's registration.
 *
 * Replaces the hardcoded conversion matrix with protocol dispatch.
 *
 * Special cases preserved:
 * - Same type = no-op (short-circuit)
 * - dict -> :>ordered without structural sig raises RILL-R037
 * - String-to-number parse failure raises RILL-R038
 * - Missing convertTo target raises RILL-R036
 * - `-> string` of a value that is, or contains at any depth, a function or
 *   iterator raises RILL-R036 before the converter runs
 */
export function applyConversion(
  s: EvalState,
  input: RillValue,
  targetType: RillTypeName,
  node: ASTNode,
  part?: string
): RillValue {
  const sourceType = inferTypeName(input);

  // Same type = no-op
  if (sourceType === targetType) {
    return input;
  }

  // :>stream is not supported — stream type cannot be a conversion target
  if (targetType === 'stream') {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'convertType',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      'Type conversion not supported for stream type'
    );
  }

  // dict -> :>ordered without structural sig is always RILL-R037
  if (sourceType === 'dict' && targetType === 'ordered') {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'convertType',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R037],
      withPart(
        'dict to ordered conversion requires structural type signature',
        part
      )
    );
  }

  // A function, iterator, vector, datetime, or duration has no string form,
  // at the top level or nested. A bare duration is the exception: it converts
  // to its printed form. A collection holding one still halts.
  if (targetType === 'string' && sourceType !== 'duration') {
    const d = describeNoStringForm(input, 'convert');
    if (d !== undefined) {
      throwCatchableHostHalt(
        {
          location: getNodeLocation(s, node),
          sourceId: s.ctx.sourceId,
          fn: 'convertType',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R036],
        withPart(d.message, part),
        d.raw
      );
    }
  }

  // Find source type registration and dispatch via protocol.convertTo
  const reg = BUILT_IN_TYPES.find((r) => r.name === sourceType);
  const converter = reg?.protocol.convertTo?.[targetType];

  if (!converter) {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'convertType',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R036],
      withPart(`cannot convert ${sourceType} to ${targetType}`, part),
      { source: sourceType, target: targetType }
    );
  }

  try {
    return converter(input);
  } catch (err) {
    // A converter that already raised a typed halt (e.g. the reserved
    // "ok" -> atom rejection) is a catchable RuntimeHaltSignal; propagate
    // it unchanged instead of remapping it to the generic RILL_R036 code
    // below, which would discard its atom and message. ControlSignal
    // subclasses (break/return/yield) always re-throw as well.
    if (err instanceof RuntimeHaltSignal && !isProtocolConversionHalt(err)) {
      throw enrichHaltOriginLocation(
        err,
        getNodeLocation(s, node),
        s.ctx.sourceId
      );
    }
    if (err instanceof ControlSignal) {
      throw err;
    }

    // Protocol converters raise RILL-R064/R065/R066 as a RuntimeError or as
    // a protocol halt (see isProtocolConversionHalt); wrap with
    // evaluator-level error codes for user-facing messages.

    // String-to-number parse failures use RILL-R038
    // Preserve the protocol's detailed message (includes unparseable value).
    if (sourceType === 'string' && targetType === 'number') {
      const message =
        err instanceof RuntimeHaltSignal
          ? getStatus(err.value).message
          : err instanceof Error
            ? err.message
            : String(err);
      throwCatchableHostHalt(
        {
          location: getNodeLocation(s, node),
          sourceId: s.ctx.sourceId,
          fn: 'convertType',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R038],
        withPart(message, part),
        { value: input }
      );
    }

    // All other conversion failures use RILL-R036
    // Use consistent "cannot convert X to Y" format.
    return throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'convertType',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R036],
      withPart(`cannot convert ${sourceType} to ${targetType}`, part),
      { source: sourceType, target: targetType }
    );
  }
}

/**
 * Find the first value with no string form in `value`, walking depth-first
 * in element order (list elements, tuple entries, ordered entry values, dict
 * values in canonical order). Returns the halt message and raw payload, or
 * undefined when the value has a string form.
 *
 * A function, an iterator, and a vector never have one. Under `convert`
 * (`-> string`) a datetime and a duration have none either; under `print`
 * (interpolation, `join`) they print.
 */
export function describeNoStringForm(
  value: RillValue,
  mode: NoStringFormMode
): { message: string; raw: { source: string; target: 'string' } } | undefined {
  const offender = findNoStringFormKind(value, mode);
  if (offender === undefined) {
    return undefined;
  }
  const outerType = inferTypeName(value);
  if (value === offender.node) {
    return {
      message: `cannot convert ${offender.kind} to string`,
      raw: { source: offender.kind, target: 'string' },
    };
  }
  return {
    message: `cannot convert ${outerType} to string: contains ${offender.kind}`,
    raw: { source: outerType, target: 'string' },
  };
}

/** `convert` is `-> string`; `print` is interpolation and `join`. */
export type NoStringFormMode = 'convert' | 'print';

const NO_STRING_FORM_ALWAYS: ReadonlySet<string> = new Set([
  'closure',
  'iterator',
  'vector',
]);
const NO_STRING_FORM_CONVERT: ReadonlySet<string> = new Set([
  'datetime',
  'duration',
]);

function findNoStringFormKind(
  value: RillValue,
  mode: NoStringFormMode
): { kind: string; node: RillValue } | undefined {
  const typeName = inferTypeName(value);
  if (
    NO_STRING_FORM_ALWAYS.has(typeName) ||
    (mode === 'convert' && NO_STRING_FORM_CONVERT.has(typeName))
  ) {
    return { kind: typeName, node: value };
  }
  let children: ReadonlyArray<RillValue> = [];
  if (Array.isArray(value)) {
    children = value;
  } else if (isTuple(value)) {
    children = value.entries;
  } else if (isOrdered(value)) {
    children = value.entries.map((entry) => entry[1]);
  } else if (isPlainDict(value)) {
    children = orderedDictEntries(value).map((entry) => entry.value);
  }
  for (const child of children) {
    const found = findNoStringFormKind(child, mode);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/** Copy ordered entries into a plain dict, keeping a `__proto__` key own. */
function orderedEntriesToDict(
  entries: ReadonlyArray<readonly [string, RillValue, RillValue?]>
): Record<string, RillValue> {
  const dict: Record<string, RillValue> = {};
  for (const [key, value] of entries) {
    setDictField(dict, key, value);
  }
  return dict;
}

/**
 * Convert dict -> :>ordered(field: type = default, ...) using structural signature.
 *
 * - Input must be a dict (else RILL-R036)
 * - Iterates signature fields in declaration order
 * - Missing field with default: inserts deep copy of default value
 * - Missing field without default: emits RILL-R044
 * - Extra keys not in signature: omitted from result
 */
function convertToOrderedWithSig(
  s: EvalState,
  input: RillValue,
  resolvedFields: readonly RillFieldDef[],
  node: ASTNode,
  part?: string
): RillValue {
  let dictInput: Record<string, RillValue>;
  if (isOrdered(input)) {
    dictInput = orderedEntriesToDict(input.entries);
  } else if (isPlainDict(input)) {
    dictInput = input;
  } else {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'convertToOrderedWithSig',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R036],
      withPart(`cannot convert ${inferType(input)} to ordered`, part),
      { source: inferType(input), target: 'ordered' }
    );
  }

  const sourceType = isOrdered(input) ? 'ordered' : 'dict';

  const entries: [string, RillValue][] = [];

  const throwMissingField = (fieldName: string | undefined): never =>
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'convertToOrderedWithSig',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R044],
      `cannot convert ${sourceType} to ordered: missing required field '${fieldName}'`,
      { source: sourceType, target: 'ordered' }
    );

  for (const field of resolvedFields) {
    const fieldName = field.name;
    if (fieldName === undefined) {
      throwMissingField(fieldName);
      continue;
    }
    const presentValue = Object.hasOwn(dictInput, fieldName)
      ? dictInput[fieldName]
      : undefined;

    if (presentValue !== undefined) {
      entries.push([
        fieldName,
        convertPart(
          s,
          presentValue,
          field.type,
          node,
          joinPart(part, `field '${fieldName}'`)
        ),
      ]);
    } else if (field.defaultValue !== undefined) {
      entries.push([
        fieldName,
        hydrateNested(s, copyValue(field.defaultValue), field.type, node),
      ]);
    } else if (hasCollectionFields(field.type)) {
      entries.push([
        fieldName,
        hydrateNested(s, emptyForType(field.type), field.type, node),
      ]);
    } else {
      throwMissingField(fieldName);
    }
  }

  return createOrdered(entries);
}

/**
 * Convert dict -> :>dict(field: type = default, ...) using structural signature.
 *
 * - Input must be a dict (else RILL-R036)
 * - Iterates signature fields in declaration order
 * - Missing field with default: inserts deep copy of default value
 * - Missing field without default: emits RILL-R044
 * - Extra keys not in signature: omitted from result
 * - Recurses into nested dict-typed fields for nested hydration
 */
function convertToDictWithSig(
  s: EvalState,
  input: RillValue,
  resolvedFields: Readonly<Record<string, RillFieldDef>>,
  node: ASTNode,
  part?: string
): RillValue {
  let dictInput: Record<string, RillValue>;
  if (isOrdered(input)) {
    dictInput = orderedEntriesToDict(input.entries);
  } else if (isPlainDict(input)) {
    dictInput = input;
  } else {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'convertToDictWithSig',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R036],
      withPart(`cannot convert ${inferType(input)} to dict`, part),
      { source: inferType(input), target: 'dict' }
    );
  }

  const sourceType = isOrdered(input) ? 'ordered' : 'dict';

  const result: Record<string, RillValue> = {};

  for (const [fieldName, resolvedField] of Object.entries(resolvedFields)) {
    const presentValue = Object.hasOwn(dictInput, fieldName)
      ? dictInput[fieldName]
      : undefined;

    if (presentValue !== undefined) {
      setDictField(
        result,
        fieldName,
        convertPart(
          s,
          presentValue,
          resolvedField.type,
          node,
          joinPart(part, `field '${fieldName}'`)
        )
      );
    } else if (resolvedField.defaultValue !== undefined) {
      setDictField(
        result,
        fieldName,
        hydrateNested(
          s,
          copyValue(resolvedField.defaultValue),
          resolvedField.type,
          node
        )
      );
    } else if (hasCollectionFields(resolvedField.type)) {
      setDictField(
        result,
        fieldName,
        hydrateNested(
          s,
          emptyForType(resolvedField.type),
          resolvedField.type,
          node
        )
      );
    } else {
      throwCatchableHostHalt(
        {
          location: getNodeLocation(s, node),
          sourceId: s.ctx.sourceId,
          fn: 'convertToDictWithSig',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R044],
        `cannot convert ${sourceType} to dict: missing required field '${fieldName}'`,
        { source: sourceType, target: 'dict' }
      );
    }
  }

  return result;
}

/**
 * Convert tuple/list -> :>tuple(type, ...) using structural signature.
 *
 * - Input must be a tuple or list (else RILL-R036)
 * - Iterates signature elements in declaration order
 * - Missing trailing element with default: inserts deep copy of default value
 * - Missing element without default: emits RILL-R044 with position
 * - Extra elements beyond signature length: omitted from result
 */
function convertToTupleWithSig(
  s: EvalState,
  input: RillValue,
  resolvedElements: readonly RillFieldDef[],
  node: ASTNode,
  part?: string
): RillValue {
  const isTupleInput = isTuple(input);
  const isListInput =
    Array.isArray(input) && !isTupleInput && !isOrdered(input);
  if (!isTupleInput && !isListInput) {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'convertToTupleWithSig',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R036],
      withPart(`cannot convert ${inferType(input)} to tuple`, part),
      { source: inferType(input), target: 'tuple' }
    );
  }

  const inputEntries: RillValue[] = isTupleInput ? input.entries : input;

  const result: RillValue[] = [];

  let i = -1;
  for (const element of resolvedElements) {
    i++;
    const inputEntry = i < inputEntries.length ? inputEntries[i] : undefined;

    if (inputEntry !== undefined) {
      // Element present in input: recurse into nested types
      result.push(
        convertPart(
          s,
          inputEntry,
          element.type,
          node,
          joinPart(part, `position ${i}`)
        )
      );
    } else if (element.defaultValue !== undefined) {
      // Missing trailing element with default: deep copy and hydrate
      result.push(
        hydrateNested(s, copyValue(element.defaultValue), element.type, node)
      );
    } else if (hasCollectionFields(element.type)) {
      // Missing element with collection type: seed empty and hydrate
      result.push(
        hydrateNested(s, emptyForType(element.type), element.type, node)
      );
    } else {
      // Missing element without default
      throwCatchableHostHalt(
        {
          location: getNodeLocation(s, node),
          sourceId: s.ctx.sourceId,
          fn: 'convertToTupleWithSig',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R044],
        `cannot convert ${inferType(input)} to tuple: missing required element at position ${i}`,
        { source: inferType(input), target: 'tuple' }
      );
    }
  }

  return createTuple(result);
}

/**
 * Build the RILL-R044 halt for a field/element that conversion's structural
 * hydration cannot fill: no value, no default, and not itself a collection
 * type that can be synthesized empty. Unlike marshaling, structural
 * conversion has no later type-check stage to fall back on, so this throws
 * immediately instead of leaving the field absent.
 */
function throwNestedHydrationMissingField(
  s: EvalState,
  node: ASTNode,
  info: HydrationMissingFieldInfo
): never {
  const site = {
    location: getNodeLocation(s, node),
    sourceId: s.ctx.sourceId,
    fn: 'hydrateNested',
  };
  if (info.kind === 'tuple') {
    throwCatchableHostHalt(
      site,
      ERROR_ATOMS[ERROR_IDS.RILL_R044],
      `cannot convert tuple to tuple: missing required element at position ${info.position}`,
      { source: 'tuple', target: 'tuple' }
    );
  }
  throwCatchableHostHalt(
    site,
    ERROR_ATOMS[ERROR_IDS.RILL_R044],
    `cannot convert ${info.source} to ${info.target}: missing required field '${info.fieldName}'`,
    { source: info.source, target: info.target }
  );
}

/**
 * Conversion hydration policy: throw RILL-R044 immediately on a missing
 * required field (no later type-check stage to defer to), drop keys/elements
 * not declared on the target type, and allow a dict value to hydrate into an
 * ordered-typed field (dict -> ordered is a valid conversion).
 */
function conversionHydrationPolicy(
  s: EvalState,
  node: ASTNode
): HydrationPolicy {
  return {
    onMissingField: (info) => throwNestedHydrationMissingField(s, node, info),
    keepExtras: false,
    coerceOrderedFromDict: true,
  };
}

/**
 * Recursively hydrate a value against a nested dict, ordered, or tuple RillType.
 * Only applies when the field type has explicit fields/elements.
 * Returns the value unchanged if the type has no fields or the value type does not match.
 *
 * Thin wrapper over the shared structural walker (`hydrateStructure` in
 * callable.ts); see `conversionHydrationPolicy` for how this caller's
 * behavior differs from argument marshaling's `hydrateFieldDefaults`. Kept
 * as a two-caller extraction deliberately: the shared walker is what pins
 * the two behaviors together and stops them from silently drifting apart
 * again, at the cost of both callers reading a policy object instead of an
 * inlined recursion.
 */
function hydrateNested(
  s: EvalState,
  value: RillValue,
  fieldType: TypeStructure,
  node: ASTNode
): RillValue {
  return hydrateStructure(value, fieldType, conversionHydrationPolicy(s, node));
}
