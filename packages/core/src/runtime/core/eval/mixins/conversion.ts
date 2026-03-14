/**
 * ConversionMixin: :> Convert Operator
 *
 * Handles the :> (convert) pipe target, which converts the pipe value
 * to a target type according to the compatibility matrix.
 *
 * Interface requirements (from spec IR-9):
 * - evaluateConvert(value, node) -> Promise<RillValue>
 *
 * Compatibility matrix:
 * | Source  | :>list | :>dict | :>tuple | :>ordered(sig) | :>number        | :>string | :>bool              |
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
 * - EC-11 (RILL-R037): dict -> :>ordered without structural signature
 * - EC-12 (RILL-R038): Non-parseable string to number
 * - EC-13 (RILL-R039): :>$var where $var is not a type value
 *
 * @internal
 */

import type {
  ConvertNode,
  TypeConstructorNode,
  TypeRef,
} from '../../../../types.js';
import { RuntimeError } from '../../../../types.js';
import type {
  RillValue,
  RillType,
  RillFieldDef,
  RillTuple,
} from '../../values.js';
import {
  inferType,
  isTuple,
  isOrdered,
  isTypeValue,
  createOrdered,
  createTuple,
  formatValue,
  deepCopyRillValue,
} from '../../values.js';
import { isDict } from '../../callable.js';
import { getVariable } from '../../context.js';
import type { EvaluatorConstructor } from '../types.js';
import type { EvaluatorBase } from '../base.js';
import type { RillTypeName } from '../../../../types.js';

/**
 * ConversionMixin implementation.
 *
 * Evaluates the :> (convert) pipe target operator.
 *
 * Depends on:
 * - EvaluatorBase: ctx, getNodeLocation()
 * - evaluateExpression() (from CoreMixin composition)
 *
 * Methods added:
 * - evaluateConvert(node, input) -> Promise<RillValue>
 */
function createConversionMixin(Base: EvaluatorConstructor<EvaluatorBase>) {
  return class ConversionEvaluator extends Base {
    /**
     * Evaluate the :> convert operator [IR-9].
     *
     * Resolves the target type (static, dynamic, or structural) and applies
     * the conversion compatibility matrix to the input value.
     */
    protected async evaluateConvert(
      node: ConvertNode,
      input: RillValue
    ): Promise<RillValue> {
      const typeRef = node.typeRef;

      // Structural type constructor: :>ordered(name: type, ...) or :>list(T), :>dict(...), :>tuple(...)
      if (isTypeConstructorNode(typeRef)) {
        if (typeRef.constructorName === 'ordered') {
          return this.convertToOrderedWithSig(input, typeRef, node);
        }
        if (typeRef.constructorName === 'dict') {
          return this.convertToDictWithSig(input, typeRef, node);
        }
        if (typeRef.constructorName === 'tuple') {
          return this.convertToTupleWithSig(input, typeRef, node);
        }
        // Non-dict/ordered constructors: convert first, then assert structural type
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const typeValue = await (this as any).evaluateTypeConstructor(typeRef);
        const result = this.applyConversion(
          input,
          typeRef.constructorName,
          node
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).assertType(result, typeValue.structure, node.span.start);
        return result;
      }

      // Static type ref: :>list, :>dict, etc.
      if (typeRef.kind === 'static') {
        return this.applyConversion(input, typeRef.typeName, node);
      }

      // Union type ref: :>(A | B) — intentionally unsupported in this release
      if (typeRef.kind === 'union') {
        throw new RuntimeError(
          'RILL-R004',
          'union type conversion is not yet supported'
        );
      }

      // Dynamic type ref: :>$var
      const typeValue = getVariable(this.ctx, typeRef.varName);
      if (typeValue === undefined) {
        throw new RuntimeError(
          'RILL-R005',
          `Variable '${typeRef.varName}' is not defined`,
          this.getNodeLocation(node)
        );
      }
      if (!isTypeValue(typeValue)) {
        throw new RuntimeError(
          'RILL-R039',
          `expected type value, got ${inferType(typeValue)}`,
          this.getNodeLocation(node),
          { actual: inferType(typeValue) }
        );
      }

      return this.applyConversion(input, typeValue.typeName, node);
    }

    /**
     * Apply conversion from source value to target type name.
     * Implements the compatibility matrix from IR-9.
     */
    private applyConversion(
      input: RillValue,
      targetType: RillTypeName,
      node: ConvertNode
    ): RillValue {
      const sourceType = inferType(input);

      // Same type = no-op
      if (sourceType === targetType) {
        return input;
      }

      // Apply compatibility matrix
      switch (targetType) {
        case 'list':
          return this.convertToList(input, sourceType, node);

        case 'dict':
          return this.convertToDict(input, sourceType, node);

        case 'tuple':
          return this.convertToTuple(input, sourceType, node);

        case 'ordered':
          // dict -> :>ordered without structural sig is always a runtime error (EC-11)
          if (sourceType === 'dict') {
            throw new RuntimeError(
              'RILL-R037',
              'dict to ordered conversion requires structural type signature',
              this.getNodeLocation(node)
            );
          }
          return this.convertToOrdered(input, sourceType, node);

        case 'number':
          return this.convertToNumber(input, sourceType, node);

        case 'string':
          return this.convertToString(input, sourceType, node);

        case 'bool':
          return this.convertToBoolean(input, sourceType, node);

        default:
          this.throwIncompatible(sourceType, targetType, node);
      }

      // TypeScript exhaustiveness
      return input;
    }

    /** Convert to list type. Valid source: tuple. */
    private convertToList(
      input: RillValue,
      sourceType: RillTypeName,
      node: ConvertNode
    ): RillValue {
      if (isTuple(input)) {
        return input.entries;
      }
      this.throwIncompatible(sourceType, 'list', node);
      return input;
    }

    /** Convert to dict type. Valid source: ordered. */
    private convertToDict(
      input: RillValue,
      sourceType: RillTypeName,
      node: ConvertNode
    ): RillValue {
      if (isOrdered(input)) {
        const result: Record<string, RillValue> = {};
        for (const [key, value] of input.entries) {
          result[key] = value;
        }
        return result;
      }
      this.throwIncompatible(sourceType, 'dict', node);
      return input;
    }

    /** Convert to tuple type. Valid source: list. */
    private convertToTuple(
      input: RillValue,
      sourceType: RillTypeName,
      node: ConvertNode
    ): RillValue {
      if (Array.isArray(input) && !isTuple(input) && !isOrdered(input)) {
        return createTuple(input);
      }
      this.throwIncompatible(sourceType, 'tuple', node);
      return input;
    }

    /** Convert to ordered type. Valid source: dict (with sig, handled separately). */
    private convertToOrdered(
      input: RillValue,
      sourceType: RillTypeName,
      node: ConvertNode
    ): RillValue {
      // Only dict -> ordered is valid, but it requires a sig (checked by caller)
      this.throwIncompatible(sourceType, 'ordered', node);
      return input;
    }

    /** Convert to number type. Valid source: string (parseable) or bool. */
    private convertToNumber(
      input: RillValue,
      sourceType: RillTypeName,
      node: ConvertNode
    ): RillValue {
      if (sourceType === 'string') {
        const str = input as string;
        const parsed = Number(str);
        if (isNaN(parsed) || str.trim() === '') {
          throw new RuntimeError(
            'RILL-R038',
            `cannot convert string "${str}" to number`,
            this.getNodeLocation(node),
            { value: str }
          );
        }
        return parsed;
      }
      if (sourceType === 'bool') {
        return (input as boolean) ? 1 : 0;
      }
      this.throwIncompatible(sourceType, 'number', node);
      return input;
    }

    /** Convert to bool type. Valid source: number (0 or 1) or string ("true" or "false"). */
    private convertToBoolean(
      input: RillValue,
      sourceType: RillTypeName,
      node: ConvertNode
    ): RillValue {
      if (sourceType === 'number') {
        const n = input as number;
        if (n === 0) return false;
        if (n === 1) return true;
        this.throwIncompatible(sourceType, 'bool', node);
      }
      if (sourceType === 'string') {
        const s = input as string;
        if (s === 'true') return true;
        if (s === 'false') return false;
        this.throwIncompatible(sourceType, 'bool', node);
      }
      this.throwIncompatible(sourceType, 'bool', node);
    }

    /** Convert to string type. Valid source: any type via formatValue semantics. */
    private convertToString(
      input: RillValue,
      _sourceType: RillTypeName,
      _node: ConvertNode
    ): RillValue {
      return formatValue(input);
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
      node: ConvertNode
    ): Promise<RillValue> {
      let dictInput: Record<string, RillValue>;
      if (isOrdered(input)) {
        dictInput = Object.fromEntries(input.entries);
      } else if (isDict(input)) {
        dictInput = input as Record<string, RillValue>;
      } else {
        throw new RuntimeError(
          'RILL-R036',
          `cannot convert ${inferType(input)} to ordered`,
          this.getNodeLocation(node),
          { source: inferType(input), target: 'ordered' }
        );
      }

      const sourceType = isOrdered(input) ? 'ordered' : 'dict';

      // Evaluate the full type constructor to get resolved fields with defaults.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const typeValue = await (this as any).evaluateTypeConstructor(sigNode);
      const resolvedFields: RillFieldDef[] =
        typeValue.structure.type === 'ordered' && typeValue.structure.fields
          ? (typeValue.structure.fields as RillFieldDef[])
          : [];

      const entries: [string, RillValue][] = [];

      for (const field of resolvedFields) {
        const fieldName = field.name!;

        if (fieldName in dictInput) {
          let fieldValue: RillValue = dictInput[fieldName]!;
          fieldValue = this.hydrateNested(fieldValue, field.type, node);
          entries.push([fieldName, fieldValue]);
        } else if (field.defaultValue !== undefined) {
          entries.push([fieldName, deepCopyRillValue(field.defaultValue)]);
        } else {
          throw new RuntimeError(
            'RILL-R044',
            `cannot convert ${sourceType} to ordered: missing required field '${fieldName}'`,
            this.getNodeLocation(node),
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
      node: ConvertNode
    ): Promise<RillValue> {
      let dictInput: Record<string, RillValue>;
      if (isOrdered(input)) {
        dictInput = Object.fromEntries(input.entries);
      } else if (isDict(input)) {
        dictInput = input as Record<string, RillValue>;
      } else {
        throw new RuntimeError(
          'RILL-R036',
          `cannot convert ${inferType(input)} to dict`,
          this.getNodeLocation(node),
          { source: inferType(input), target: 'dict' }
        );
      }

      const sourceType = isOrdered(input) ? 'ordered' : 'dict';

      // Evaluate the full type constructor to get resolved fields with defaults.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const typeValue = await (this as any).evaluateTypeConstructor(sigNode);
      const resolvedFields: Record<string, RillFieldDef> =
        typeValue.structure.type === 'dict' && typeValue.structure.fields
          ? (typeValue.structure.fields as Record<string, RillFieldDef>)
          : {};
      const result: Record<string, RillValue> = {};

      for (const arg of sigNode.args) {
        if (arg.kind !== 'named') {
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
            result[fieldName] = deepCopyRillValue(resolvedField.defaultValue);
          } else {
            throw new RuntimeError(
              'RILL-R044',
              `cannot convert ${sourceType} to dict: missing required field '${fieldName}'`,
              this.getNodeLocation(node),
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
      node: ConvertNode
    ): Promise<RillValue> {
      const isTupleInput = isTuple(input);
      const isListInput =
        Array.isArray(input) && !isTupleInput && !isOrdered(input);
      if (!isTupleInput && !isListInput) {
        throw new RuntimeError(
          'RILL-R036',
          `cannot convert ${inferType(input)} to tuple`,
          this.getNodeLocation(node),
          { source: inferType(input), target: 'tuple' }
        );
      }

      // Evaluate the full type constructor to get resolved elements with defaults.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const typeValue = await (this as any).evaluateTypeConstructor(sigNode);
      const resolvedElements: RillFieldDef[] =
        typeValue.structure.type === 'tuple' && typeValue.structure.elements
          ? (typeValue.structure.elements as RillFieldDef[])
          : [];

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
          // Missing trailing element with default: deep copy default
          result.push(deepCopyRillValue(element.defaultValue));
        } else {
          // Missing element without default
          throw new RuntimeError(
            'RILL-R044',
            `cannot convert ${inferType(input)} to tuple: missing required element at position ${i}`,
            this.getNodeLocation(node),
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
      fieldType: RillType,
      node: ConvertNode
    ): RillValue {
      if (fieldType.type === 'dict' && fieldType.fields && isDict(value)) {
        const dictValue = value as Record<string, RillValue>;
        const result: Record<string, RillValue> = {};
        for (const [fieldName, resolvedField] of Object.entries(
          fieldType.fields
        )) {
          if (fieldName in dictValue) {
            const fieldValue = this.hydrateNested(
              dictValue[fieldName]!,
              resolvedField.type,
              node
            );
            result[fieldName] = fieldValue;
          } else {
            if (resolvedField.defaultValue !== undefined) {
              result[fieldName] = deepCopyRillValue(resolvedField.defaultValue);
            } else {
              throw new RuntimeError(
                'RILL-R044',
                `cannot convert dict to dict: missing required field '${fieldName}'`,
                this.getNodeLocation(node),
                { source: 'dict', target: 'dict' }
              );
            }
          }
        }
        return result;
      } else if (fieldType.type === 'ordered' && fieldType.fields) {
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
        for (const field of fieldType.fields as RillFieldDef[]) {
          const name = field.name!;
          if (lookup.has(name)) {
            const fieldValue = this.hydrateNested(
              lookup.get(name)!,
              field.type,
              node
            );
            resultEntries.push([name, fieldValue]);
          } else if (field.defaultValue !== undefined) {
            resultEntries.push([name, deepCopyRillValue(field.defaultValue)]);
          } else {
            throw new RuntimeError(
              'RILL-R044',
              `cannot convert ${source} to ordered: missing required field '${name}'`,
              this.getNodeLocation(node),
              { source, target: 'ordered' }
            );
          }
        }
        return createOrdered(resultEntries);
      } else if (fieldType.type === 'tuple' && fieldType.elements) {
        // Only hydrate if the runtime value is a tuple; return unchanged otherwise.
        if (!isTuple(value)) {
          return value;
        }
        const inputEntries = (value as unknown as RillTuple).entries;
        const resultEntries: RillValue[] = [];
        for (let i = 0; i < fieldType.elements.length; i++) {
          const element = fieldType.elements[i]!;
          if (i < inputEntries.length) {
            const elementValue = this.hydrateNested(
              inputEntries[i]!,
              element.type,
              node
            );
            resultEntries.push(elementValue);
          } else if (element.defaultValue !== undefined) {
            resultEntries.push(deepCopyRillValue(element.defaultValue));
          } else {
            throw new RuntimeError(
              'RILL-R044',
              `cannot convert tuple to tuple: missing required element at position ${i}`,
              this.getNodeLocation(node),
              { source: 'tuple', target: 'tuple' }
            );
          }
        }
        return createTuple(resultEntries);
      }
      return value;
    }

    /** Throw EC-10 incompatible conversion error. */
    private throwIncompatible(
      source: RillTypeName,
      target: RillTypeName,
      node: ConvertNode
    ): never {
      throw new RuntimeError(
        'RILL-R036',
        `cannot convert ${source} to ${target}`,
        this.getNodeLocation(node),
        { source, target }
      );
    }
  };
}

/**
 * Type guard: check if a TypeRef | TypeConstructorNode is a TypeConstructorNode.
 */
function isTypeConstructorNode(
  ref: TypeRef | TypeConstructorNode
): ref is TypeConstructorNode {
  return 'type' in ref && ref.type === 'TypeConstructor';
}

// Export with type assertion to work around TS4094 limitation
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ConversionMixin = createConversionMixin as any;
