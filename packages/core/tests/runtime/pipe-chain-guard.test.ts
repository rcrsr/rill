/**
 * Rill Runtime Tests: isPipeChainNode type guard
 *
 * `ExpressionNode` is a two-member union: `PipeChainNode` (ordinary
 * expressions) and `PartialExpressionNode` (parser error-recovery
 * fragments). `isPipeChainNode` discriminates between them so runtime
 * evaluators can narrow an `ExpressionNode` without an unchecked
 * `as PipeChainNode` cast.
 */

import { describe, expect, it } from 'vitest';
import {
  isPipeChainNode,
  type HostCallNode,
  type PartialExpressionNode,
  type PipeChainNode,
  type PostfixExprNode,
  type SourceSpan,
} from '@rcrsr/rill';

const zeroSpan: SourceSpan = {
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 1, column: 1, offset: 0 },
};

/** Builds a HostCall node invoking `name` with no arguments. */
function hostCall(name: string): HostCallNode {
  return { type: 'HostCall', name, args: [], span: zeroSpan };
}

/** Wraps a HostCall primary in the PostfixExpr -> PipeChain scaffolding. */
function pipeChainOf(primary: HostCallNode): PipeChainNode {
  const postfix: PostfixExprNode = {
    type: 'PostfixExpr',
    primary,
    methods: [],
    defaultValue: null,
    span: zeroSpan,
  };
  return {
    type: 'PipeChain',
    head: postfix,
    pipes: [],
    terminator: null,
    span: zeroSpan,
  };
}

describe('isPipeChainNode', () => {
  it('returns true for a PipeChainNode', () => {
    const node = pipeChainOf(hostCall('foo'));

    expect(isPipeChainNode(node)).toBe(true);
  });

  it('returns false for a hand-built PartialExpressionNode', () => {
    const node: PartialExpressionNode = {
      type: 'PartialExpression',
      message: 'expected expression',
      children: [pipeChainOf(hostCall('foo'))],
      span: zeroSpan,
    };

    expect(isPipeChainNode(node)).toBe(false);
  });
});
