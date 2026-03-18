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
  DestructNode,
  SliceNode,
  GroupedExprNode,
  ListLiteralNode,
  DictLiteralNode,
  TupleLiteralNode,
  OrderedLiteralNode,
  ExpressionNode,
  ListSpreadNode,
  DictEntryNode,
  SourceLocation,
} from '../../../../types.js';
import { RuntimeError } from '../../../../types.js';
import type { EvaluatorConstructor } from '../types.js';
import type { RillValue } from '../../types/structures.js';
import { createOrdered, createTuple } from '../../types/constructors.js';
import { inferElementType } from '../../types/operations.js';
import { isDict } from '../../callable.js';
import { getVariable } from '../../context.js';
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
 * - evaluateDestructure(node, input) -> Promise<RillValue>
 * - evaluateDestruct(node, input) -> Promise<RillValue>
 * - evaluateSlice(node, input) -> Promise<RillValue>
 * - evaluateCollectionLiteral(node) -> Promise<RillValue>
 *
 * Covers:
 * - IR-8: evaluateCollectionLiteral for ListLiteralNode, DictLiteralNode, TupleLiteralNode, OrderedLiteralNode
 * - IR-26: evaluateDestructure(node, input) -> Promise<RillValue>
 * - IR-27: evaluateSlice(node, input) -> Promise<RillValue>
 *
 * Error handling:
 * - EC-13: Destructure/slice on wrong types -> RuntimeError(RUNTIME_TYPE_ERROR)
 * - EC-14: List destructure size mismatch -> RuntimeError
 */
function createExtractionMixin(Base: EvaluatorConstructor<EvaluatorBase>) {
  return class ExtractionEvaluator extends Base {
    /**
     * Evaluate destructure operator: destruct<$a, $b, $c>
     * Extracts values from list or dict into variables.
     *
     * List destructure: [1, 2, 3] -> destruct<$a, $b, $c>  # $a=1, $b=2, $c=3
     * Dict destructure: [x: 1, y: 2] -> destruct<x: $a, y: $b>  # $a=1, $b=2
     */
    protected async evaluateDestructure(
      node: DestructureNode,
      input: RillValue
    ): Promise<RillValue> {
      const isList = Array.isArray(input);
      const isDictInput = isDict(input);

      const firstNonSkip = node.elements.find((e) => e.kind !== 'skip');
      const isKeyPattern = firstNonSkip?.kind === 'keyValue';

      if (isKeyPattern) {
        // Dict destructure pattern
        if (!isDictInput) {
          throw new RuntimeError(
            'RILL-R002',
            `Key destructure requires dict, got ${isList ? 'list' : typeof input}`,
            node.span.start
          );
        }

        for (const elem of node.elements) {
          if (elem.kind === 'skip') continue;

          if (elem.kind === 'nested') {
            throw new RuntimeError(
              'RILL-R002',
              'Nested destructure not supported in dict patterns',
              elem.span.start
            );
          }

          if (
            elem.kind !== 'keyValue' ||
            elem.key === null ||
            elem.name === null
          ) {
            throw new RuntimeError(
              'RILL-R002',
              'Dict destructure requires key: $var patterns',
              elem.span.start
            );
          }

          const dictInput = input as Record<string, RillValue>;
          if (!(elem.key in dictInput)) {
            throw new RuntimeError(
              'RILL-R009',
              `Key '${elem.key}' not found in dict`,
              elem.span.start,
              { key: elem.key, availableKeys: Object.keys(dictInput) }
            );
          }

          const dictValue = dictInput[elem.key];
          if (dictValue === undefined) {
            throw new RuntimeError(
              'RILL-R009',
              `Key '${elem.key}' has undefined value`,
              elem.span.start
            );
          }

          // Note: setVariable and resolveTypeRef will be available from VariablesMixin
          // and TypesMixin which are applied before ExtractionMixin in the composition order
          const dictResolved =
            elem.typeRef !== null
              ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (this as any).resolveTypeRef(
                  elem.typeRef,
                  (name: string) => getVariable(this.ctx, name) as RillValue
                )
              : undefined;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (this as any).setVariable(
            elem.name,
            dictValue,
            dictResolved?.structure,
            elem.span.start
          );
        }
      } else {
        // List destructure pattern
        if (!isList) {
          throw new RuntimeError(
            'RILL-R002',
            `Positional destructure requires list, got ${isDictInput ? 'dict' : typeof input}`,
            node.span.start
          );
        }

        const listInput = input as RillValue[];
        if (node.elements.length !== listInput.length) {
          throw new RuntimeError(
            'RILL-R002',
            `Destructure pattern has ${node.elements.length} elements, list has ${listInput.length}`,
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
            await this.evaluateDestructure(elem.nested, value);
            continue;
          }

          if (elem.name === null) {
            throw new RuntimeError(
              'RILL-R002',
              'Invalid destructure element',
              elem.span.start
            );
          }

          // Note: setVariable and resolveTypeRef will be available from VariablesMixin
          // and TypesMixin which are applied before ExtractionMixin in the composition order
          const listResolved =
            elem.typeRef !== null
              ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (this as any).resolveTypeRef(
                  elem.typeRef,
                  (name: string) => getVariable(this.ctx, name) as RillValue
                )
              : undefined;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (this as any).setVariable(
            elem.name,
            value,
            listResolved?.structure,
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
          'RILL-R002',
          `Slice requires list or string, got ${isDict(input) ? 'dict' : typeof input}`,
          node.span.start
        );
      }

      const startBound = node.start
        ? await this.evaluateSliceBound(node.start, node.span.start)
        : null;
      const stopBound = node.stop
        ? await this.evaluateSliceBound(node.stop, node.span.start)
        : null;
      const stepBound = node.step
        ? await this.evaluateSliceBound(node.step, node.span.start)
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
     * Evaluate a slice bound expression (start, stop, or step).
     * Returns the numeric value of the bound.
     */
    private async evaluateSliceBound(
      bound: SliceNode['start'],
      location?: SourceLocation
    ): Promise<number> {
      if (bound === null) {
        throw new RuntimeError('RILL-R002', 'Slice bound is null', location);
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
              'RILL-R002',
              `Slice bound must be number, got ${typeof value}`,
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
              'RILL-R002',
              `Slice bound must be number, got ${typeof value}`,
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
          'RILL-R002',
          'Slice step cannot be zero',
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

    /**
     * Evaluate destruct operator: destruct<$a, $b, ...>
     * Same semantics as evaluateDestructure but for the keyword-based syntax.
     * Delegates to evaluateDestructure since the pattern structure is identical.
     */
    protected async evaluateDestruct(
      node: DestructNode,
      input: RillValue
    ): Promise<RillValue> {
      // DestructNode has the same elements structure as DestructureNode.
      // Cast to DestructureNode-compatible shape for reuse.
      return this.evaluateDestructure(
        { ...node, type: 'Destructure' } as unknown as DestructureNode,
        input
      );
    }

    /**
     * Evaluate collection literals [IR-8].
     * Handles list[...], dict[...], tuple[...], ordered[...] keyword forms.
     *
     * Ellipsis spread (...$other) expands referenced collections inline.
     * Type is fixed by the keyword — no runtime inference from content.
     *
     * Returns:
     * - ListLiteralNode  -> RillValue[] (plain list)
     * - DictLiteralNode  -> Record<string, RillValue>
     * - TupleLiteralNode -> RillTuple
     * - OrderedLiteralNode -> RillOrdered
     */
    protected async evaluateCollectionLiteral(
      node:
        | ListLiteralNode
        | DictLiteralNode
        | TupleLiteralNode
        | OrderedLiteralNode
    ): Promise<RillValue> {
      switch (node.type) {
        case 'ListLiteral': {
          const listItems = await this.evaluateListLiteralElements(
            node.elements
          );
          // Validate homogeneity: all elements must share the same structural type
          inferElementType(listItems);
          return listItems;
        }

        case 'TupleLiteral': {
          // Tuples allow mixed types — no homogeneity check
          const items = await this.evaluateListLiteralElements(node.elements);
          return createTuple(items);
        }

        case 'DictLiteral': {
          const result: Record<string, RillValue> = {};
          for (const [key, value] of await this.evaluateDictLiteralEntries(
            node.entries
          )) {
            result[key] = value;
          }
          return result;
        }

        case 'OrderedLiteral': {
          const pairs = await this.evaluateDictLiteralEntries(node.entries);
          return createOrdered(pairs);
        }
      }
    }

    /**
     * Evaluate list/tuple literal elements, expanding spread nodes inline.
     * Spread: ...$other expands the referenced collection into the result.
     */
    private async evaluateListLiteralElements(
      rawElements: ExpressionNode[]
    ): Promise<RillValue[]> {
      const result: RillValue[] = [];
      for (const elem of rawElements) {
        if ((elem as unknown as { type: string }).type === 'ListSpread') {
          const spreadNode = elem as unknown as ListSpreadNode;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const spreadValue = await (this as any).evaluateExpression(
            spreadNode.expression
          );
          if (Array.isArray(spreadValue)) {
            result.push(...spreadValue);
          } else {
            throw new RuntimeError(
              'RILL-R002',
              `Spread in list literal requires list, got ${typeof spreadValue}`,
              spreadNode.span?.start,
              { got: typeof spreadValue }
            );
          }
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          result.push(await (this as any).evaluateExpression(elem));
        }
      }
      return result;
    }

    /**
     * Evaluate dict/ordered literal entries, returning [key, value] pairs.
     * Keys are always strings (number/boolean keys are stringified).
     * Spread entries (...$other) expand inline (dict keys merged).
     */
    private async evaluateDictLiteralEntries(
      entries: DictEntryNode[]
    ): Promise<[string, RillValue][]> {
      const result: [string, RillValue][] = [];
      for (const entry of entries) {
        // Spread entry: key is a string starting with '...' is not how parser marks it.
        // The parser uses ListSpread for element spreads in list/tuple.
        // For dict/ordered, spread is encoded as a DictEntry with an object key
        // where kind === 'variable'. Handle simple string/number/boolean keys only here
        // since the collection literal parser does not support multi-key or computed keys.
        const key = entry.key;
        let stringKey: string;

        if (typeof key === 'string') {
          stringKey = key;
        } else if (typeof key === 'number' || typeof key === 'boolean') {
          stringKey = String(key);
        } else {
          // Object key (DictKeyVariable or DictKeyComputed) — evaluate like evaluateDict
          if ('kind' in key) {
            if (key.kind === 'variable') {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const varVal = (this as any).evaluateVariable
                ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (this as any).evaluateVariable({
                    name: key.variableName,
                    isPipeVar: false,
                    accessChain: [],
                    defaultValue: null,
                    existenceCheck: null,
                  })
                : undefined;
              stringKey =
                typeof varVal === 'string'
                  ? varVal
                  : String(varVal ?? key.variableName);
            } else {
              // computed: evaluate expression
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const computed = await (this as any).evaluateExpression(
                key.expression
              );
              stringKey = String(computed);
            }
          } else {
            stringKey = String(key);
          }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const value = await (this as any).evaluateExpression(entry.value);
        result.push([stringKey, value]);
      }
      return result;
    }
  };
}

// Export with type assertion to work around TS4094 limitation
// TypeScript can't generate declarations for functions returning classes with protected members
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ExtractionMixin = createExtractionMixin as any;
