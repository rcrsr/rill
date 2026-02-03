/**
 * ExtractionMixin - Extraction Operators
 *
 * Handles destructure, slice, and spread operations for extracting
 * values from lists and dicts.
 *
 * @internal
 */

import type {
  DestructureNode,
  SliceNode,
  SpreadNode,
  GroupedExprNode,
} from '../../../../types.js';
import { RILL_ERROR_CODES, RuntimeError } from '../../../../types.js';
import type { EvaluatorConstructor } from '../types.js';
import type { RillValue, RillTuple } from '../../values.js';
import {
  createTupleFromDict,
  createTupleFromList,
  inferType,
} from '../../values.js';
import { isDict } from '../../callable.js';
import type { EvaluatorBase } from '../base.js';

/**
 * ExtractionMixin implementation.
 *
 * Provides extraction operator functionality for destructuring lists/dicts,
 * slicing sequences, and spreading values for argument unpacking.
 *
 * Depends on:
 * - EvaluatorBase: ctx, checkAborted(), getNodeLocation()
 * - evaluateExpression() (from CoreMixin composition)
 * - evaluateVariable() (from VariablesMixin composition)
 * - setVariable() (from VariablesMixin composition)
 *
 * Methods added:
 * - evaluateDestructure(node, input) -> RillValue
 * - evaluateSlice(node, input) -> Promise<RillValue>
 * - evaluateSpread(node) -> Promise<RillTuple>
 *
 * Covers:
 * - IR-26: evaluateDestructure(node, input) -> RillValue
 * - IR-27: evaluateSlice(node, input) -> Promise<RillValue>
 * - IR-28: evaluateSpread(node) -> Promise<RillTuple>
 *
 * Error handling:
 * - EC-13: Destructure/slice on wrong types -> RuntimeError(RUNTIME_TYPE_ERROR)
 * - EC-14: List destructure size mismatch -> RuntimeError
 */
function createExtractionMixin(Base: EvaluatorConstructor<EvaluatorBase>) {
  return class ExtractionEvaluator extends Base {
    /**
     * Evaluate destructure operator: *<$a, $b, $c>
     * Extracts values from list or dict into variables.
     *
     * List destructure: [1, 2, 3] -> *<$a, $b, $c>  # $a=1, $b=2, $c=3
     * Dict destructure: [x: 1, y: 2] -> *<x: $a, y: $b>  # $a=1, $b=2
     */
    protected evaluateDestructure(
      node: DestructureNode,
      input: RillValue
    ): RillValue {
      const isList = Array.isArray(input);
      const isDictInput = isDict(input);

      const firstNonSkip = node.elements.find((e) => e.kind !== 'skip');
      const isKeyPattern = firstNonSkip?.kind === 'keyValue';

      if (isKeyPattern) {
        // Dict destructure pattern
        if (!isDictInput) {
          throw new RuntimeError(
            RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
            `RILL-R002: Key destructure requires dict, got ${isList ? 'list' : typeof input}`,
            node.span.start
          );
        }

        for (const elem of node.elements) {
          if (elem.kind === 'skip') continue;

          if (elem.kind === 'nested') {
            throw new RuntimeError(
              RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
              'RILL-R002: Nested destructure not supported in dict patterns',
              elem.span.start
            );
          }

          if (
            elem.kind !== 'keyValue' ||
            elem.key === null ||
            elem.name === null
          ) {
            throw new RuntimeError(
              RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
              'RILL-R002: Dict destructure requires key: $var patterns',
              elem.span.start
            );
          }

          const dictInput = input as Record<string, RillValue>;
          if (!(elem.key in dictInput)) {
            throw new RuntimeError(
              RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
              `RILL-R009: Key '${elem.key}' not found in dict`,
              elem.span.start,
              { key: elem.key, availableKeys: Object.keys(dictInput) }
            );
          }

          const dictValue = dictInput[elem.key];
          if (dictValue === undefined) {
            throw new RuntimeError(
              RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
              `RILL-R009: Key '${elem.key}' has undefined value`,
              elem.span.start
            );
          }

          // Note: setVariable will be available from VariablesMixin
          // which is applied before ExtractionMixin in the composition order
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (this as any).setVariable(
            elem.name,
            dictValue,
            elem.typeName ?? undefined,
            elem.span.start
          );
        }
      } else {
        // List destructure pattern
        if (!isList) {
          throw new RuntimeError(
            RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
            `RILL-R002: Positional destructure requires list, got ${isDictInput ? 'dict' : typeof input}`,
            node.span.start
          );
        }

        const listInput = input as RillValue[];
        if (node.elements.length !== listInput.length) {
          throw new RuntimeError(
            RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
            `RILL-R002: Destructure pattern has ${node.elements.length} elements, list has ${listInput.length}`,
            node.span.start
          );
        }

        for (let i = 0; i < node.elements.length; i++) {
          const elem = node.elements[i];
          const value = listInput[i];

          if (elem === undefined || value === undefined) {
            continue;
          }

          if (elem.kind === 'skip') continue;

          if (elem.kind === 'nested' && elem.nested) {
            this.evaluateDestructure(elem.nested, value);
            continue;
          }

          if (elem.name === null) {
            throw new RuntimeError(
              RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
              'RILL-R002: Invalid destructure element',
              elem.span.start
            );
          }

          // Note: setVariable will be available from VariablesMixin
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (this as any).setVariable(
            elem.name,
            value,
            elem.typeName ?? undefined,
            elem.span.start
          );
        }
      }

      return input;
    }

    /**
     * Evaluate slice operator: /<start:stop:step>
     * Extracts a portion of a list or string using Python-style slicing.
     *
     * Examples:
     * [0, 1, 2, 3, 4] -> /<0:3>    # [0, 1, 2]
     * [0, 1, 2, 3, 4] -> /<-2:>    # [3, 4]
     * [0, 1, 2, 3, 4] -> /<::-1>   # [4, 3, 2, 1, 0]
     * "hello" -> /<1:4>             # "ell"
     */
    protected async evaluateSlice(
      node: SliceNode,
      input: RillValue
    ): Promise<RillValue> {
      const isList = Array.isArray(input);
      const isString = typeof input === 'string';

      if (!isList && !isString) {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `RILL-R002: Slice requires list or string, got ${isDict(input) ? 'dict' : typeof input}`,
          node.span.start
        );
      }

      const startBound = node.start
        ? await this.evaluateSliceBound(node.start)
        : null;
      const stopBound = node.stop
        ? await this.evaluateSliceBound(node.stop)
        : null;
      const stepBound = node.step
        ? await this.evaluateSliceBound(node.step)
        : null;

      if (isList) {
        return this.applySlice(
          input,
          input.length,
          startBound,
          stopBound,
          stepBound
        );
      }
      return this.applySlice(
        input,
        input.length,
        startBound,
        stopBound,
        stepBound
      );
    }

    /**
     * Evaluate spread operator: *[...] or *[key: value, ...]
     * Creates a tuple from a list or dict for argument unpacking.
     *
     * Examples:
     * *[1, 2, 3] -> $fn()             # Calls $fn(1, 2, 3)
     * *[a: 1, b: 2] -> $fn()          # Calls $fn with named args
     */
    protected async evaluateSpread(node: SpreadNode): Promise<RillTuple> {
      let value: RillValue;
      if (node.operand === null) {
        value = this.ctx.pipeValue;
      } else {
        // Note: evaluateExpression will be available from CoreMixin
        // which is applied before ExtractionMixin in the composition order
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        value = await (this as any).evaluateExpression(node.operand);
      }

      if (Array.isArray(value)) {
        return createTupleFromList(value);
      }

      if (isDict(value)) {
        return createTupleFromDict(value);
      }

      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
        `RILL-R002: Spread requires list or dict, got ${inferType(value)}`,
        node.span.start
      );
    }

    /**
     * Evaluate a slice bound expression (start, stop, or step).
     * Returns the numeric value of the bound.
     */
    private async evaluateSliceBound(
      bound: SliceNode['start']
    ): Promise<number> {
      if (bound === null) {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          'RILL-R002: Slice bound is null',
          undefined
        );
      }

      switch (bound.type) {
        case 'NumberLiteral':
          return bound.value;

        case 'Variable': {
          // Note: evaluateVariable will be available from VariablesMixin
          // which is applied before ExtractionMixin in the composition order
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const value = (this as any).evaluateVariable(bound);
          if (typeof value !== 'number') {
            throw new RuntimeError(
              RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
              `RILL-R002: Slice bound must be number, got ${typeof value}`,
              bound.span.start
            );
          }
          return value;
        }

        case 'GroupedExpr': {
          // Note: evaluateGroupedExpr will be available from ExpressionsMixin
          // which is applied after ExtractionMixin, so we need to call evaluateExpression
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const value = await (this as any).evaluateExpression(
            (bound as GroupedExprNode).expression
          );
          if (typeof value !== 'number') {
            throw new RuntimeError(
              RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
              `RILL-R002: Slice bound must be number, got ${typeof value}`,
              bound.span.start
            );
          }
          return value;
        }
      }
    }

    /**
     * Apply Python-style slice to a list or string.
     * Handles negative indices, step values, and edge cases.
     */
    private applySlice<T extends RillValue[] | string>(
      input: T,
      len: number,
      start: number | null,
      stop: number | null,
      step: number | null
    ): T {
      const actualStep = step ?? 1;

      if (actualStep === 0) {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          'RILL-R002: Slice step cannot be zero',
          undefined
        );
      }

      const normalizeIndex = (
        idx: number | null,
        defaultVal: number,
        forStep: number
      ): number => {
        if (idx === null) return defaultVal;
        let normalized = idx < 0 ? len + idx : idx;
        if (forStep > 0) {
          normalized = Math.max(0, Math.min(len, normalized));
        } else {
          normalized = Math.max(-1, Math.min(len - 1, normalized));
        }
        return normalized;
      };

      const actualStart = normalizeIndex(
        start,
        actualStep > 0 ? 0 : len - 1,
        actualStep
      );
      const actualStop = normalizeIndex(
        stop,
        actualStep > 0 ? len : -1,
        actualStep
      );

      const indices: number[] = [];
      if (actualStep > 0) {
        for (let i = actualStart; i < actualStop; i += actualStep) {
          indices.push(i);
        }
      } else {
        for (let i = actualStart; i > actualStop; i += actualStep) {
          indices.push(i);
        }
      }

      if (Array.isArray(input)) {
        return indices.map((i) => input[i]) as T;
      } else {
        return indices.map((i) => input[i]).join('') as T;
      }
    }
  };
}

// Export with type assertion to work around TS4094 limitation
// TypeScript can't generate declarations for functions returning classes with protected members
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ExtractionMixin = createExtractionMixin as any;
