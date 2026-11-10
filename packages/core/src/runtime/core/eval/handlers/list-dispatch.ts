/**
 * list[...] Pipe Target Dispatch
 *
 * Handles `index -> list[v0, v1, ...]` — evaluates the list literal elements,
 * then returns the element at the piped numeric index.
 *
 * Interface requirements:
 * - evaluateListLiteralDispatch(node, input) -> Promise<RillValue>
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
import {
  findIndexPosition,
  throwIndexOutOfBounds,
} from '../../types/index-access.js';
import { findElementTypeMismatch } from '../../types/operations.js';
import type { EvalState } from '../state.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import { getNodeLocation } from '../shared.js';
import { evaluateBody } from './control-flow.js';
import { evaluateExpression } from './core.js';

/**
 * Evaluate list[...] as a pipe target.
 *
 * The piped value is used as a numeric index. Negative indices count from
 * the end (-1 is last). Non-integer indices halt with #INVALID_INPUT.
 * Out-of-bounds without a default value halts with RILL-R009.
 */
export async function evaluateListLiteralDispatch(
  s: EvalState,
  node: ListLiteralNode,
  input: RillValue
): Promise<RillValue> {
  // index must be a number
  if (typeof input !== 'number') {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'evaluateListLiteralDispatch',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `List index must be number, got ${typeof input}`,
      { input, expectedType: 'number' }
    );
  }

  // Evaluate all elements (supporting ...spread)
  const elements = await evaluateListLiteralElements(s, node.elements);
  // Validate homogeneity: all elements must share the same structural type
  const mismatch = findElementTypeMismatch(elements);
  if (mismatch !== undefined) {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'evaluateListLiteralDispatch',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      mismatch
    );
  }

  const site = {
    location: getNodeLocation(s, node),
    sourceId: s.ctx.sourceId,
    fn: 'evaluateListLiteralDispatch',
  };
  const position = findIndexPosition(input, elements.length, 'List', site);
  // `element` is undefined only when the position is out of range
  const element = position === undefined ? undefined : elements[position];
  if (element === undefined) {
    // Use default value if provided via ??
    if (node.defaultValue) {
      return await evaluateBody(s, node.defaultValue);
    }
    return throwIndexOutOfBounds(input, elements.length, 'List', site);
  }

  return element;
}

/**
 * Evaluate list literal elements, expanding any ...spread nodes inline.
 */
async function evaluateListLiteralElements(
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
  return result;
}
