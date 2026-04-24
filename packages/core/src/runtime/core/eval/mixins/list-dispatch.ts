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
import { RuntimeError } from '../../../../types.js';
import type { RillValue } from '../../types/structures.js';
import { inferElementType } from '../../types/operations.js';
import type { EvaluatorConstructor } from '../types.js';
import type { EvaluatorBase } from '../base.js';
import type { EvaluatorInterface } from '../interface.js';

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
function createListDispatchMixin(Base: EvaluatorConstructor<EvaluatorBase>) {
  return class ListDispatchEvaluator extends Base {
    /**
     * Evaluate list[...] as a pipe target [IR-11].
     *
     * The piped value is used as a numeric index. Negative indices count from
     * the end (-1 is last). Non-integer indices throw EC-15. Out-of-bounds
     * without a default value throws EC-16.
     */
    protected async evaluateListLiteralDispatch(
      node: ListLiteralNode,
      input: RillValue
    ): Promise<RillValue> {
      // EC-15: index must be a number
      if (typeof input !== 'number') {
        throw new RuntimeError(
          'RILL-R041',
          'list index must be an integer',
          this.getNodeLocation(node),
          { index: input }
        );
      }

      // EC-15: index must be an integer (no fractional part)
      if (!Number.isInteger(input)) {
        throw new RuntimeError(
          'RILL-R041',
          'list index must be an integer',
          this.getNodeLocation(node),
          { index: input }
        );
      }

      // Evaluate all elements (supporting ...spread)
      const elements = await this.evaluateListLiteralElements(node.elements);

      const index = input;
      // Normalize negative indices
      const normalizedIndex = index < 0 ? elements.length + index : index;

      // Check bounds
      if (normalizedIndex < 0 || normalizedIndex >= elements.length) {
        // Use default value if provided via ??
        if (node.defaultValue) {
          return await (this as unknown as EvaluatorInterface).evaluateBody(
            node.defaultValue
          );
        }
        throw new RuntimeError(
          'RILL-R042',
          `list index ${index} out of range (length: ${elements.length})`,
          this.getNodeLocation(node),
          { n: index, m: elements.length }
        );
      }

      return elements[normalizedIndex]!;
    }

    /**
     * Evaluate list literal elements, expanding any ...spread nodes inline.
     */
    private async evaluateListLiteralElements(
      rawElements: ExpressionNode[]
    ): Promise<RillValue[]> {
      const result: RillValue[] = [];
      for (const elem of rawElements) {
        if ((elem as unknown as { type: string }).type === 'ListSpread') {
          // Spread: ...$other — expand collection inline
          const spreadNode = elem as unknown as ListSpreadNode;
          const spreadValue = await (
            this as unknown as EvaluatorInterface
          ).evaluateExpression(spreadNode.expression);
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
          result.push(
            await (this as unknown as EvaluatorInterface).evaluateExpression(
              elem
            )
          );
        }
      }
      // Validate homogeneity: all elements must share the same structural type
      inferElementType(result);
      return result;
    }
  };
}

// Export with type assertion to work around TS4094 limitation
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ListDispatchMixin = createListDispatchMixin as any;

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
