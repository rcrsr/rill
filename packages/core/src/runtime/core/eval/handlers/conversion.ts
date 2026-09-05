/**
 * `-> type` conversion helpers
 *
 * Converts the pipe value to a target type according to the compatibility
 * matrix. Used by `-> type` (bare type keyword), `-> type(...)` (parameterized
 * type constructor), and `-> $var` when `$var` is bound to a type value.
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
 * - RILL-R036: Incompatible source/target type
 * - RILL-R037: dict -> ordered without structural signature
 * - RILL-R038: Non-parseable string to number
 *
 * @internal
 */

import type { ASTNode, TypeConstructorNode } from '../../../../types.js';
import { RuntimeError } from '../../../../types.js';
import { RuntimeHaltSignal, throwCatchableHostHalt } from '../../types/halt.js';
import { ControlSignal } from '../../signals.js';
import type {
  RillValue,
  TypeStructure,
  RillFieldDef,
  RillTuple,
} from '../../types/structures.js';
import { inferType } from '../../types/registrations.js';
import { isTuple, isOrdered } from '../../types/guards.js';
import {
  createOrdered,
  createTuple,
  copyValue,
  emptyForType,
} from '../../types/constructors.js';
import { hasCollectionFields } from '../../values.js';
import { isDict } from '../../callable.js';
import type {
  HydrationMissingFieldInfo,
  HydrationPolicy,
} from '../../callable.js';
import { hydrateStructure } from '../../callable.js';
import { setDictField } from '../../types/dict-keys.js';
import { BUILT_IN_TYPES } from '../../types/registrations.js';

import type { EvalState } from '../state.js';
import type { RillTypeName } from '../../../../types.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import { getNodeLocation } from '../shared.js';
import { evaluateTypeConstructor, assertType } from './types.js';

/**
 * Apply conversion for a parameterized type constructor target
 * (`-> list(T)`, `-> dict(...)`, `-> ordered(...)`, `-> tuple(...)`, ...).
 *
 * Handles the uniform vs structural dispatch and delegates to the
 * structural conversion helpers for dict/ordered/tuple with fields.
 */
export async function applyConstructorConversion(
  s: EvalState,
  input: RillValue,
  typeRef: TypeConstructorNode,
  node: ASTNode
): Promise<RillValue> {
  // For dict/ordered/tuple, evaluate the type constructor to determine
  // uniform (valueType) vs structural (fields/elements) dispatch.
  if (
    typeRef.constructorName === 'ordered' ||
    typeRef.constructorName === 'dict' ||
    typeRef.constructorName === 'tuple'
  ) {
    const typeValue = await evaluateTypeConstructor(s, typeRef);
    const structure = typeValue.structure;

    // Uniform types (valueType present): use general convert-then-assert path
    if ('valueType' in structure && structure.valueType) {
      const result = applyConversion(s, input, typeRef.constructorName, node);
      assertType(s, result, structure, node.span.start);
      return result;
    }

    // Structural types (fields/elements present): use structural-specific handlers
    if (typeRef.constructorName === 'ordered') {
      return convertToOrderedWithSig(s, input, typeRef, node);
    }
    if (typeRef.constructorName === 'dict') {
      return convertToDictWithSig(s, input, typeRef, node);
    }
    return convertToTupleWithSig(s, input, typeRef, node);
  }

  // Non-dict/ordered/tuple constructors: convert first, then assert structural type
  const typeValue = await evaluateTypeConstructor(s, typeRef);
  const result = applyConversion(s, input, typeRef.constructorName, node);
  assertType(s, result, typeValue.structure, node.span.start);
  return result;
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
 */
export function applyConversion(
  s: EvalState,
  input: RillValue,
  targetType: RillTypeName,
  node: ASTNode
): RillValue {
  const sourceType = inferType(input) as RillTypeName;

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
      'dict to ordered conversion requires structural type signature'
    );
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
      `cannot convert ${sourceType} to ${targetType}`,
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
    if (err instanceof RuntimeHaltSignal || err instanceof ControlSignal) {
      throw err;
    }

    // Protocol converters throw RuntimeError (RILL-R064/R065/R066);
    // wrap with evaluator-level error codes for user-facing messages.

    // String-to-number parse failures use RILL-R038
    // Preserve the protocol's detailed message (includes unparseable value).
    if (sourceType === 'string' && targetType === 'number') {
      const message = err instanceof Error ? err.message : String(err);
      throwCatchableHostHalt(
        {
          location: getNodeLocation(s, node),
          sourceId: s.ctx.sourceId,
          fn: 'convertType',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R038],
        message,
        { value: input }
      );
    }

    // Heterogeneous tuple -> list conversions raise RILL-R002 from the
    // protocol's homogeneity check. Preserve that error id and message
    // instead of falling through to the generic RILL-R036 remap below,
    // for parity with the list-literal path's error.
    if (err instanceof RuntimeError && err.errorId === ERROR_IDS.RILL_R002) {
      throwCatchableHostHalt(
        {
          location: getNodeLocation(s, node),
          sourceId: s.ctx.sourceId,
          fn: 'convertType',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        err.rawMessage
      );
    }

    // All other conversion failures use RILL-R036
    // Use consistent "cannot convert X to Y" format.
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'convertType',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R036],
      `cannot convert ${sourceType} to ${targetType}`,
      { source: sourceType, target: targetType }
    );
  }
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
async function convertToOrderedWithSig(
  s: EvalState,
  input: RillValue,
  sigNode: TypeConstructorNode,
  node: ASTNode
): Promise<RillValue> {
  let dictInput: Record<string, RillValue>;
  if (isOrdered(input)) {
    dictInput = Object.fromEntries(input.entries);
  } else if (isDict(input)) {
    dictInput = input as Record<string, RillValue>;
  } else {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'convertToOrderedWithSig',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R036],
      `cannot convert ${inferType(input)} to ordered`,
      { source: inferType(input), target: 'ordered' }
    );
  }

  const sourceType = isOrdered(input) ? 'ordered' : 'dict';

  // Evaluate the full type constructor to get resolved fields with defaults.
  const typeValue = await evaluateTypeConstructor(s, sigNode);
  const { structure: orderedStructure } = typeValue;
  let resolvedFields: RillFieldDef[] = [];
  if (orderedStructure.kind === 'ordered') {
    const os = orderedStructure as {
      kind: 'ordered';
      fields?: RillFieldDef[];
    };
    resolvedFields = os.fields ?? [];
  }

  const entries: [string, RillValue][] = [];

  for (const field of resolvedFields) {
    const fieldName = field.name!;

    if (Object.hasOwn(dictInput, fieldName)) {
      let fieldValue: RillValue = dictInput[fieldName]!;
      fieldValue = hydrateNested(s, fieldValue, field.type, node);
      assertType(s, fieldValue, field.type, node.span.start);
      entries.push([fieldName, fieldValue]);
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
async function convertToDictWithSig(
  s: EvalState,
  input: RillValue,
  sigNode: TypeConstructorNode,
  node: ASTNode
): Promise<RillValue> {
  let dictInput: Record<string, RillValue>;
  if (isOrdered(input)) {
    dictInput = Object.fromEntries(input.entries);
  } else if (isDict(input)) {
    dictInput = input as Record<string, RillValue>;
  } else {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'convertToDictWithSig',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R036],
      `cannot convert ${inferType(input)} to dict`,
      { source: inferType(input), target: 'dict' }
    );
  }

  const sourceType = isOrdered(input) ? 'ordered' : 'dict';

  // Evaluate the full type constructor to get resolved fields with defaults.
  const typeValue = await evaluateTypeConstructor(s, sigNode);
  const { structure: dictStructure } = typeValue;
  let resolvedFields: Record<string, RillFieldDef> = {};
  if (dictStructure.kind === 'dict') {
    const ds = dictStructure as {
      kind: 'dict';
      fields?: Record<string, RillFieldDef>;
    };
    resolvedFields = ds.fields ?? {};
  }
  const result: Record<string, RillValue> = {};

  for (const arg of sigNode.args) {
    if (arg.name === undefined) {
      continue;
    }
    const fieldName = arg.name;
    const resolvedField = resolvedFields[fieldName];

    if (Object.hasOwn(dictInput, fieldName)) {
      // Field present in input: use it, recursing if the field type is a nested dict
      let fieldValue: RillValue = dictInput[fieldName]!;
      if (resolvedField !== undefined) {
        fieldValue = hydrateNested(s, fieldValue, resolvedField.type, node);
        assertType(s, fieldValue, resolvedField.type, node.span.start);
      }
      setDictField(result, fieldName, fieldValue);
    } else {
      // Field missing from input: use default if available, else error
      if (
        resolvedField !== undefined &&
        resolvedField.defaultValue !== undefined
      ) {
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
      } else if (
        resolvedField !== undefined &&
        hasCollectionFields(resolvedField.type)
      ) {
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
async function convertToTupleWithSig(
  s: EvalState,
  input: RillValue,
  sigNode: TypeConstructorNode,
  node: ASTNode
): Promise<RillValue> {
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
      `cannot convert ${inferType(input)} to tuple`,
      { source: inferType(input), target: 'tuple' }
    );
  }

  // Evaluate the full type constructor to get resolved elements with defaults.
  const typeValue = await evaluateTypeConstructor(s, sigNode);
  const { structure: tupleStructure } = typeValue;
  let resolvedElements: RillFieldDef[] = [];
  if (tupleStructure.kind === 'tuple') {
    const ts = tupleStructure as {
      kind: 'tuple';
      elements?: RillFieldDef[];
    };
    resolvedElements = ts.elements ?? [];
  }

  const inputEntries: RillValue[] = isTupleInput
    ? (input as unknown as RillTuple).entries
    : (input as RillValue[]);

  const result: RillValue[] = [];

  for (let i = 0; i < resolvedElements.length; i++) {
    const element = resolvedElements[i]!;

    if (i < inputEntries.length) {
      // Element present in input: recurse into nested types
      const elementValue = hydrateNested(
        s,
        inputEntries[i]!,
        element.type,
        node
      );
      assertType(s, elementValue, element.type, node.span.start);
      result.push(elementValue);
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
