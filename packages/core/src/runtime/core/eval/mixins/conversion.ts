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
 * | Source  | :>list | :>dict | :>tuple | :>ordered(sig) | :>number | :>string | :>bool |
 * |---------|--------|--------|---------|----------------|----------|----------|--------|
 * | list    | no-op  | error  | valid   | error          | error    | error    | error  |
 * | dict    | error  | no-op  | error   | valid          | error    | error    | error  |
 * | tuple   | valid  | error  | no-op   | error          | error    | error    | error  |
 * | ordered | error  | valid  | error   | no-op          | error    | error    | error  |
 * | string  | error  | error  | error   | error          | valid    | no-op    | error  |
 * | number  | error  | error  | error   | error          | no-op    | valid    | error  |
 * | bool    | error  | error  | error   | error          | error    | error    | no-op  |
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
import type { RillValue } from '../../values.js';
import {
  inferType,
  isTuple,
  isOrdered,
  isTypeValue,
  createOrdered,
  createTuple,
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

      // Structural ordered type: :>ordered(name: type, ...)
      if (isTypeConstructorNode(typeRef)) {
        return this.convertToOrderedWithSig(input, typeRef, node);
      }

      // Static type ref: :>list, :>dict, etc.
      if (typeRef.kind === 'static') {
        return this.applyConversion(input, typeRef.typeName, node);
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
          // Only bool -> :>bool is no-op (handled above); all others are errors
          this.throwIncompatible(sourceType, targetType, node);
          break;

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

    /** Convert to number type. Valid source: string (parseable). */
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
      this.throwIncompatible(sourceType, 'number', node);
      return input;
    }

    /** Convert to string type. Valid source: number. */
    private convertToString(
      input: RillValue,
      sourceType: RillTypeName,
      node: ConvertNode
    ): RillValue {
      if (sourceType === 'number') {
        return String(input as number);
      }
      this.throwIncompatible(sourceType, 'string', node);
      return input;
    }

    /**
     * Convert dict -> :>ordered(field: type, ...) using structural signature.
     * Extracts fields in the order specified by the signature.
     */
    private convertToOrderedWithSig(
      input: RillValue,
      sigNode: TypeConstructorNode,
      node: ConvertNode
    ): RillValue {
      if (!isDict(input)) {
        throw new RuntimeError(
          'RILL-R036',
          `cannot convert ${inferType(input)} to ordered`,
          this.getNodeLocation(node),
          { source: inferType(input), target: 'ordered' }
        );
      }

      const dictInput = input as Record<string, RillValue>;
      const entries: [string, RillValue][] = [];

      for (const arg of sigNode.args) {
        if (arg.kind !== 'named') {
          throw new RuntimeError(
            'RILL-R037',
            'dict to ordered conversion requires structural type signature',
            this.getNodeLocation(node)
          );
        }
        const fieldName = arg.name;
        if (!(fieldName in dictInput)) {
          throw new RuntimeError(
            'RILL-R036',
            `cannot convert dict to ordered: missing field '${fieldName}'`,
            this.getNodeLocation(node),
            { source: 'dict', target: 'ordered' }
          );
        }
        entries.push([fieldName, dictInput[fieldName]!]);
      }

      return createOrdered(entries);
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
