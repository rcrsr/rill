/**
 * ConversionMixin: `-> type` conversion helpers
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
 * - EC-10 (RILL-R036): Incompatible source/target type
 * - EC-11 (RILL-R037): dict -> ordered without structural signature
 * - EC-12 (RILL-R038): Non-parseable string to number
 *
 * @internal
 */

import type { ASTNode, TypeConstructorNode } from '../../../../types.js';
import { throwCatchableHostHalt } from '../../types/halt.js';
import type {
  RillValue,
  TypeStructure,
  RillFieldDef,
  RillTuple,
} from '../../types/structures.js';
import type {
  DictStructure,
  TupleStructure,
  OrderedStructure,
} from '../../types/operations.js';
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
import { BUILT_IN_TYPES } from '../../types/registrations.js';

import type { EvaluatorConstructor } from '../types.js';
import type { EvaluatorBase } from '../base.js';
import type { EvaluatorInterface } from '../interface.js';
import type { RillTypeName } from '../../../../types.js';

/**
 * ConversionMixin implementation.
 *
 * Provides conversion helpers used by pipe-target evaluators when a
 * `-> type` or `-> type(...)` form is piped onto a value.
 *
 * Depends on:
 * - EvaluatorBase: ctx, getNodeLocation()
 * - evaluateExpression() (from CoreMixin composition)
 *
 * Methods added:
 * - applyConversion(input, targetType, node) -> RillValue
 * - applyConstructorConversion(input, typeRef, node) -> Promise<RillValue>
 * - convertToOrderedWithSig / convertToDictWithSig / convertToTupleWithSig
 */
function createConversionMixin(Base: EvaluatorConstructor<EvaluatorBase>) {
  return class ConversionEvaluator extends Base {
    /**
     * Apply conversion for a parameterized type constructor target
     * (`-> list(T)`, `-> dict(...)`, `-> ordered(...)`, `-> tuple(...)`, ...).
     *
     * Handles the uniform vs structural dispatch and delegates to the
     * structural conversion helpers for dict/ordered/tuple with fields.
     */
    protected async applyConstructorConversion(
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
        const iface = this as unknown as EvaluatorInterface;
        const typeValue = await iface.evaluateTypeConstructor(typeRef);
        const structure = typeValue.structure;

        // Uniform types (valueType present): use general convert-then-assert path
        if ('valueType' in structure && structure.valueType) {
          const result = this.applyConversion(
            input,
            typeRef.constructorName,
            node
          );
          iface.assertType(result, structure, node.span.start);
          return result;
        }

        // Structural types (fields/elements present): use structural-specific handlers
        if (typeRef.constructorName === 'ordered') {
          return this.convertToOrderedWithSig(input, typeRef, node);
        }
        if (typeRef.constructorName === 'dict') {
          return this.convertToDictWithSig(input, typeRef, node);
        }
        return this.convertToTupleWithSig(input, typeRef, node);
      }

      // Non-dict/ordered/tuple constructors: convert first, then assert structural type
      const iface = this as unknown as EvaluatorInterface;
      const typeValue = await iface.evaluateTypeConstructor(typeRef);
      const result = this.applyConversion(input, typeRef.constructorName, node);
      iface.assertType(result, typeValue.structure, node.span.start);
      return result;
    }

    /**
     * Apply conversion from source value to target type name.
     * Dispatches to protocol.convertTo on the source type's registration.
     *
     * IR-6: Replaces the hardcoded conversion matrix with protocol dispatch.
     *
     * Special cases preserved:
     * - Same type = no-op (short-circuit)
     * - dict -> :>ordered without structural sig raises RILL-R037 (EC-11)
     * - String-to-number parse failure raises RILL-R038 (EC-12)
     * - Missing convertTo target raises RILL-R036 (EC-10)
     */
    protected applyConversion(
      input: RillValue,
      targetType: RillTypeName,
      node: ASTNode
    ): RillValue {
      const sourceType = inferType(input) as RillTypeName;

      // Same type = no-op
      if (sourceType === targetType) {
        return input;
      }

      // IR-11: :>stream is not supported — stream type cannot be a conversion target
      if (targetType === 'stream') {
        throwCatchableHostHalt(
          {
            location: this.getNodeLocation(node),
            sourceId: this.ctx.sourceId,
            fn: 'convertType',
          },
          'RILL_R003',
          'Type conversion not supported for stream type'
        );
      }

      // dict -> :>ordered without structural sig is always RILL-R037 (EC-11)
      if (sourceType === 'dict' && targetType === 'ordered') {
        throwCatchableHostHalt(
          {
            location: this.getNodeLocation(node),
            sourceId: this.ctx.sourceId,
            fn: 'convertType',
          },
          'RILL_R037',
          'dict to ordered conversion requires structural type signature'
        );
      }

      // Find source type registration and dispatch via protocol.convertTo
      const reg = BUILT_IN_TYPES.find((r) => r.name === sourceType);
      const converter = reg?.protocol.convertTo?.[targetType];

      if (!converter) {
        throwCatchableHostHalt(
          {
            location: this.getNodeLocation(node),
            sourceId: this.ctx.sourceId,
            fn: 'convertType',
          },
          'RILL_R036',
          `cannot convert ${sourceType} to ${targetType}`,
          { source: sourceType, target: targetType }
        );
      }

      try {
        return converter(input);
      } catch (err) {
        // Protocol converters throw RuntimeError (RILL-R064/R065/R066);
        // wrap with evaluator-level error codes for user-facing messages.

        // String-to-number parse failures use RILL-R038 (EC-12)
        // Preserve the protocol's detailed message (includes unparseable value).
        if (sourceType === 'string' && targetType === 'number') {
          const message = err instanceof Error ? err.message : String(err);
          throwCatchableHostHalt(
            {
              location: this.getNodeLocation(node),
              sourceId: this.ctx.sourceId,
              fn: 'convertType',
            },
            'RILL_R038',
            message,
            { value: input }
          );
        }

        // All other conversion failures use RILL-R036 (EC-10)
        // Use consistent "cannot convert X to Y" format.
        throwCatchableHostHalt(
          {
            location: this.getNodeLocation(node),
            sourceId: this.ctx.sourceId,
            fn: 'convertType',
          },
          'RILL_R036',
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
    private async convertToOrderedWithSig(
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
            location: this.getNodeLocation(node),
            sourceId: this.ctx.sourceId,
            fn: 'convertToOrderedWithSig',
          },
          'RILL_R036',
          `cannot convert ${inferType(input)} to ordered`,
          { source: inferType(input), target: 'ordered' }
        );
      }

      const sourceType = isOrdered(input) ? 'ordered' : 'dict';

      // Evaluate the full type constructor to get resolved fields with defaults.
      const typeValue = await (
        this as unknown as EvaluatorInterface
      ).evaluateTypeConstructor(sigNode);
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

        if (fieldName in dictInput) {
          let fieldValue: RillValue = dictInput[fieldName]!;
          fieldValue = this.hydrateNested(fieldValue, field.type, node);
          entries.push([fieldName, fieldValue]);
        } else if (field.defaultValue !== undefined) {
          entries.push([
            fieldName,
            this.hydrateNested(copyValue(field.defaultValue), field.type, node),
          ]);
        } else if (hasCollectionFields(field.type)) {
          entries.push([
            fieldName,
            this.hydrateNested(emptyForType(field.type), field.type, node),
          ]);
        } else {
          throwCatchableHostHalt(
            {
              location: this.getNodeLocation(node),
              sourceId: this.ctx.sourceId,
              fn: 'convertToOrderedWithSig',
            },
            'RILL_R044',
            `cannot convert ${sourceType} to ordered: missing required field '${fieldName}'`,
            { source: sourceType, target: 'ordered' }
          );
        }
      }

      return createOrdered(entries);
    }

    /**
     * Convert dict -> :>dict(field: type = default, ...) using structural signature [IR-4].
     *
     * - Input must be a dict (else RILL-R036)
     * - Iterates signature fields in declaration order
     * - Missing field with default: inserts deep copy of default value
     * - Missing field without default: emits RILL-R044
     * - Extra keys not in signature: omitted from result
     * - Recurses into nested dict-typed fields for nested hydration
     */
    private async convertToDictWithSig(
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
            location: this.getNodeLocation(node),
            sourceId: this.ctx.sourceId,
            fn: 'convertToDictWithSig',
          },
          'RILL_R036',
          `cannot convert ${inferType(input)} to dict`,
          { source: inferType(input), target: 'dict' }
        );
      }

      const sourceType = isOrdered(input) ? 'ordered' : 'dict';

      // Evaluate the full type constructor to get resolved fields with defaults.
      const typeValue = await (
        this as unknown as EvaluatorInterface
      ).evaluateTypeConstructor(sigNode);
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

        if (fieldName in dictInput) {
          // Field present in input: use it, recursing if the field type is a nested dict
          let fieldValue: RillValue = dictInput[fieldName]!;
          if (resolvedField !== undefined) {
            fieldValue = this.hydrateNested(
              fieldValue,
              resolvedField.type,
              node
            );
          }
          result[fieldName] = fieldValue;
        } else {
          // Field missing from input: use default if available, else error
          if (
            resolvedField !== undefined &&
            resolvedField.defaultValue !== undefined
          ) {
            result[fieldName] = this.hydrateNested(
              copyValue(resolvedField.defaultValue),
              resolvedField.type,
              node
            );
          } else if (
            resolvedField !== undefined &&
            hasCollectionFields(resolvedField.type)
          ) {
            result[fieldName] = this.hydrateNested(
              emptyForType(resolvedField.type),
              resolvedField.type,
              node
            );
          } else {
            throwCatchableHostHalt(
              {
                location: this.getNodeLocation(node),
                sourceId: this.ctx.sourceId,
                fn: 'convertToDictWithSig',
              },
              'RILL_R044',
              `cannot convert ${sourceType} to dict: missing required field '${fieldName}'`,
              { source: sourceType, target: 'dict' }
            );
          }
        }
      }

      return result;
    }

    /**
     * Convert tuple/list -> :>tuple(type, ...) using structural signature [IR-5].
     *
     * - Input must be a tuple or list (else RILL-R036)
     * - Iterates signature elements in declaration order
     * - Missing trailing element with default: inserts deep copy of default value
     * - Missing element without default: emits RILL-R044 with position
     * - Extra elements beyond signature length: omitted from result
     */
    private async convertToTupleWithSig(
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
            location: this.getNodeLocation(node),
            sourceId: this.ctx.sourceId,
            fn: 'convertToTupleWithSig',
          },
          'RILL_R036',
          `cannot convert ${inferType(input)} to tuple`,
          { source: inferType(input), target: 'tuple' }
        );
      }

      // Evaluate the full type constructor to get resolved elements with defaults.
      const typeValue = await (
        this as unknown as EvaluatorInterface
      ).evaluateTypeConstructor(sigNode);
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
          result.push(this.hydrateNested(inputEntries[i]!, element.type, node));
        } else if (element.defaultValue !== undefined) {
          // Missing trailing element with default: deep copy and hydrate
          result.push(
            this.hydrateNested(
              copyValue(element.defaultValue),
              element.type,
              node
            )
          );
        } else if (hasCollectionFields(element.type)) {
          // Missing element with collection type: seed empty and hydrate
          result.push(
            this.hydrateNested(emptyForType(element.type), element.type, node)
          );
        } else {
          // Missing element without default
          throwCatchableHostHalt(
            {
              location: this.getNodeLocation(node),
              sourceId: this.ctx.sourceId,
              fn: 'convertToTupleWithSig',
            },
            'RILL_R044',
            `cannot convert ${inferType(input)} to tuple: missing required element at position ${i}`,
            { source: inferType(input), target: 'tuple' }
          );
        }
      }

      return createTuple(result);
    }

    /**
     * Recursively hydrate a value against a nested dict, ordered, or tuple RillType.
     * Only applies when the field type has explicit fields/elements.
     * Returns the value unchanged if the type has no fields or the value type does not match.
     */
    private hydrateNested(
      value: RillValue,
      fieldType: TypeStructure,
      node: ASTNode
    ): RillValue {
      if (
        fieldType.kind === 'dict' &&
        (fieldType as DictStructure).fields &&
        isDict(value)
      ) {
        const ft = fieldType as DictStructure;
        const dictValue = value as Record<string, RillValue>;
        const result: Record<string, RillValue> = {};
        for (const [fieldName, resolvedField] of Object.entries(ft.fields!)) {
          if (fieldName in dictValue) {
            const fieldValue = this.hydrateNested(
              dictValue[fieldName]!,
              resolvedField.type,
              node
            );
            result[fieldName] = fieldValue;
          } else {
            if (resolvedField.defaultValue !== undefined) {
              result[fieldName] = this.hydrateNested(
                copyValue(resolvedField.defaultValue),
                resolvedField.type,
                node
              );
            } else if (hasCollectionFields(resolvedField.type)) {
              result[fieldName] = this.hydrateNested(
                emptyForType(resolvedField.type),
                resolvedField.type,
                node
              );
            } else {
              throwCatchableHostHalt(
                {
                  location: this.getNodeLocation(node),
                  sourceId: this.ctx.sourceId,
                  fn: 'hydrateNested',
                },
                'RILL_R044',
                `cannot convert dict to dict: missing required field '${fieldName}'`,
                { source: 'dict', target: 'dict' }
              );
            }
          }
        }
        return result;
      } else if (
        fieldType.kind === 'ordered' &&
        (fieldType as OrderedStructure).fields
      ) {
        const ft = fieldType as OrderedStructure;
        // Only hydrate if the runtime value is an ordered or dict; return unchanged otherwise.
        if (!isOrdered(value) && !isDict(value)) {
          return value;
        }
        const source = isOrdered(value) ? 'ordered' : 'dict';
        // Build a key->value lookup from either an ordered value or a dict value.
        const lookup = new Map<string, RillValue>(
          isOrdered(value)
            ? value.entries.map(([k, v]) => [k, v] as [string, RillValue])
            : Object.entries(value as Record<string, RillValue>)
        );
        const resultEntries: [string, RillValue][] = [];
        for (const field of ft.fields!) {
          const name = field.name!;
          if (lookup.has(name)) {
            const fieldValue = this.hydrateNested(
              lookup.get(name)!,
              field.type,
              node
            );
            resultEntries.push([name, fieldValue]);
          } else if (field.defaultValue !== undefined) {
            resultEntries.push([
              name,
              this.hydrateNested(
                copyValue(field.defaultValue),
                field.type,
                node
              ),
            ]);
          } else if (hasCollectionFields(field.type)) {
            resultEntries.push([
              name,
              this.hydrateNested(emptyForType(field.type), field.type, node),
            ]);
          } else {
            throwCatchableHostHalt(
              {
                location: this.getNodeLocation(node),
                sourceId: this.ctx.sourceId,
                fn: 'hydrateNested',
              },
              'RILL_R044',
              `cannot convert ${source} to ordered: missing required field '${name}'`,
              { source, target: 'ordered' }
            );
          }
        }
        return createOrdered(resultEntries);
      } else if (
        fieldType.kind === 'tuple' &&
        (fieldType as TupleStructure).elements
      ) {
        const ft = fieldType as TupleStructure;
        // Only hydrate if the runtime value is a tuple; return unchanged otherwise.
        if (!isTuple(value)) {
          return value;
        }
        const inputEntries = (value as unknown as RillTuple).entries;
        const resultEntries: RillValue[] = [];
        for (let i = 0; i < ft.elements!.length; i++) {
          const element = ft.elements![i]!;
          if (i < inputEntries.length) {
            const elementValue = this.hydrateNested(
              inputEntries[i]!,
              element.type,
              node
            );
            resultEntries.push(elementValue);
          } else if (element.defaultValue !== undefined) {
            resultEntries.push(
              this.hydrateNested(
                copyValue(element.defaultValue),
                element.type,
                node
              )
            );
          } else if (hasCollectionFields(element.type)) {
            resultEntries.push(
              this.hydrateNested(emptyForType(element.type), element.type, node)
            );
          } else {
            throwCatchableHostHalt(
              {
                location: this.getNodeLocation(node),
                sourceId: this.ctx.sourceId,
                fn: 'hydrateNested',
              },
              'RILL_R044',
              `cannot convert tuple to tuple: missing required element at position ${i}`,
              { source: 'tuple', target: 'tuple' }
            );
          }
        }
        return createTuple(resultEntries);
      }
      return value;
    }
  };
}

// Export with type assertion to work around TS4094 limitation
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ConversionMixin = createConversionMixin as any;

/**
 * Capability fragment: methods contributed by ConversionMixin that are called
 * from core.ts cast sites. Covers only the methods core.ts invokes.
 */
export type ConversionMixinCapability = {
  applyConversion(
    input: RillValue,
    targetType: RillTypeName,
    node: ASTNode
  ): RillValue;
  applyConstructorConversion(
    input: RillValue,
    typeRef: TypeConstructorNode,
    node: ASTNode
  ): Promise<RillValue>;
};
