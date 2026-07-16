/**
 * ListDispatchMixin: list[...] Pipe Target Dispatch
 *
 * Handles `index -> list[v0, v1, ...]` — evaluates the list literal elements,
 * then returns the element at the piped numeric index.
 *
 * Interface requirements (from spec IR-11):
 * - evaluateListLiteralDispatch(node, input) -> Promise<RillValue>
 *
 * Error Contracts:
 * - EC-15 (RILL-R041): Non-integer index
 * - EC-16 (RILL-R042): Out-of-bounds without ?? fallback
 *
 * @internal
 */

import type {
  ListLiteralNode,
  ExpressionNode,
  ListSpreadNode,
} from '../../../../types.js';
import { throwCatchableHostHalt } from '../../types/halt.js';
import type { RillValue } from '../../types/structures.js';
import { inferElementType } from '../../types/operations.js';
import type { EvaluatorConstructor } from '../types.js';
import type { EvaluatorBase } from '../base.js';
import type { EvalState } from '../state.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import { getNodeLocation } from '../shared.js';
import { evaluateBody } from './control-flow.js';
import { evaluateExpression } from './core.js';

/**
 * Evaluate list[...] as a pipe target [IR-11].
 *
 * The piped value is used as a numeric index. Negative indices count from
 * the end (-1 is last). Non-integer indices throw EC-15. Out-of-bounds
 * without a default value throws EC-16.
 */
export async function evaluateListLiteralDispatch(
  s: EvalState,
  node: ListLiteralNode,
  input: RillValue
): Promise<RillValue> {
  // EC-15: index must be a number
  if (typeof input !== 'number') {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'evaluateListLiteralDispatch',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R041],
      'list index must be an integer',
      { index: input }
    );
  }

  // EC-15: index must be an integer (no fractional part)
  if (!Number.isInteger(input)) {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'evaluateListLiteralDispatch',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R041],
      'list index must be an integer',
      { index: input }
    );
  }

  // Evaluate all elements (supporting ...spread)
  const elements = await evaluateListLiteralElements(s, node.elements);

  const index = input;
  // Normalize negative indices
  const normalizedIndex = index < 0 ? elements.length + index : index;

  // Check bounds
  if (normalizedIndex < 0 || normalizedIndex >= elements.length) {
    // Use default value if provided via ??
    if (node.defaultValue) {
      return await evaluateBody(s, node.defaultValue);
    }
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'evaluateListLiteralDispatch',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R042],
      `list index ${index} out of range (length: ${elements.length})`,
      { n: index, m: elements.length }
    );
  }

  return elements[normalizedIndex]!;
}

/**
 * Evaluate list literal elements, expanding any ...spread nodes inline.
 */
export async function evaluateListLiteralElements(
  s: EvalState,
  rawElements: (ExpressionNode | ListSpreadNode)[]
): Promise<RillValue[]> {
  const result: RillValue[] = [];
  for (const elem of rawElements) {
    if (elem.type === 'ListSpread') {
      // Spread: ...$other — expand collection inline
      const spreadValue = await evaluateExpression(s, elem.expression);
      if (Array.isArray(spreadValue)) {
        result.push(...spreadValue);
      } else {
        throwCatchableHostHalt(
          {
            location: elem.span?.start,
            sourceId: s.ctx.sourceId,
            fn: 'evaluateListLiteralElements',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          `Spread in list literal requires list, got ${typeof spreadValue}`,
          { got: typeof spreadValue }
        );
      }
    } else {
      result.push(await evaluateExpression(s, elem));
    }
  }
  // Validate homogeneity: all elements must share the same structural type
  inferElementType(result);
  return result;
}

/**
 * ListDispatchMixin implementation.
 *
 * Evaluates list[...] when used as a pipe target. The piped value is
 * used as a numeric index into the evaluated list elements.
 *
 * Depends on:
 * - EvaluatorBase: ctx, getNodeLocation()
 * - evaluateExpression() (from CoreMixin composition)
 *
 * Methods added:
 * - evaluateListLiteralDispatch(node, input) -> Promise<RillValue>
 */
export function ListDispatchMixin<
  TBase extends EvaluatorConstructor<EvaluatorBase>,
>(Base: TBase) {
  return class ListDispatchEvaluator extends Base {
    /**
     * Evaluate list[...] as a pipe target [IR-11].
     *
     * The piped value is used as a numeric index. Negative indices count from
     * the end (-1 is last). Non-integer indices throw EC-15. Out-of-bounds
     * without a default value throws EC-16.
     */
    evaluateListLiteralDispatch(
      node: ListLiteralNode,
      input: RillValue
    ): Promise<RillValue> {
      return evaluateListLiteralDispatch(
        this as unknown as EvalState,
        node,
        input
      );
    }

    /**
     * Evaluate list literal elements, expanding any ...spread nodes inline.
     */
    evaluateListLiteralElements(
      rawElements: (ExpressionNode | ListSpreadNode)[]
    ): Promise<RillValue[]> {
      return evaluateListLiteralElements(
        this as unknown as EvalState,
        rawElements
      );
    }
  };
}

/**
 * Capability fragment: methods contributed by ListDispatchMixin that are called
 * from core.ts cast sites. Covers only the methods core.ts invokes.
 */
export type ListDispatchMixinCapability = {
  evaluateListLiteralDispatch(
    node: ListLiteralNode,
    input: RillValue
  ): Promise<RillValue>;
};
