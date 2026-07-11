/**
 * Rill Runtime Tests: PartialExpression children are never evaluated
 *
 * `parseWithRecovery` can salvage a typed child (a HostCall) inside a
 * `PartialExpressionNode` when a statement fails to parse in its intended
 * form but the skipped span re-parses cleanly as an ordinary expression.
 * The runtime must never evaluate that salvaged child: a
 * `PartialExpressionNode` always surfaces as a recovery-message halt, both
 * when it appears as a top-level statement and when it appears nested
 * inside an ordinary pipe chain (e.g. as a call argument).
 *
 * Two paths are covered:
 *   - Top-level: `execute()` treats a `PartialExpression` statement as an
 *     invalid `#R001` value directly, without evaluating its children.
 *   - Nested: `evaluateExpression` raises a catchable host halt the
 *     moment it encounters a `PartialExpression`, before any child
 *     expression (including a salvaged `HostCall`) is evaluated.
 *
 * Both assertions prove the salvaged host function is never invoked by
 * checking `mockFn().callCount === 0`.
 */

import { describe, expect, it } from 'vitest';
import {
  createRuntimeContext,
  execute,
  getStatus,
  isInvalid,
  parseWithRecovery,
  resolveAtom,
  type ExpressionNode,
  type GuardBlockNode,
  type HostCallNode,
  type PartialExpressionNode,
  type PipeChainNode,
  type PostfixExprNode,
  type ScriptNode,
  type SourceSpan,
  type StatementNode,
} from '@rcrsr/rill';
import { mockFn } from '../helpers/runtime.js';

const zeroSpan: SourceSpan = {
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 1, column: 1, offset: 0 },
};

/** Builds a HostCall node invoking `name` with no arguments. */
function hostCall(name: string): HostCallNode {
  return { type: 'HostCall', name, args: [], span: zeroSpan };
}

/** Wraps a primary node in the PostfixExpr -> PipeChain scaffolding it
 * needs to serve as a chain head (salvaged child, guard body, or the
 * script's top-level statement expression). */
function pipeChainOf(primary: HostCallNode | GuardBlockNode): PipeChainNode {
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

describe('PartialExpression children are never evaluated through execute()', () => {
  it('top-level: salvaged HostCall is not invoked; result is invalid #R001', async () => {
    // `error()` fails as the `error` statement form (message required) but
    // its skipped span re-parses cleanly as a plain HostCall, so recovery
    // salvages a typed HostCall child instead of an opaque RecoveryError.
    const parsed = parseWithRecovery('error()');
    expect(parsed.success).toBe(false);
    expect(parsed.ast.statements[0]?.type).toBe('PartialExpression');

    const mock = mockFn('should never run');
    const ctx = createRuntimeContext({ functions: { error: mock } });

    const { result } = await execute(parsed.ast, ctx);

    expect(isInvalid(result as never)).toBe(true);
    expect(getStatus(result as never).code).toBe(resolveAtom('R001'));
    expect(mock.callCount).toBe(0);
  });

  it('nested: PartialExpression as a call argument raises a catchable halt before the salvaged HostCall runs', async () => {
    const mock = mockFn('should never run');
    const outerMock = mockFn('outer should never run');

    // Hand-built PipeChain: `outer(<partial argument>)`. The argument slot
    // holds a PartialExpressionNode whose salvaged child is a HostCall to
    // the mock. `evaluateArgs` calls `evaluateExpression` on each argument
    // before invoking `outer`, so the PartialExpression must halt at
    // `core.ts` (evaluateExpression) before the salvaged child, or the
    // `outer` call itself, is ever reached.
    const partialArg: PartialExpressionNode = {
      type: 'PartialExpression',
      message: 'partial expression salvage fixture',
      children: [pipeChainOf(hostCall('mock')) as ExpressionNode],
      span: zeroSpan,
    };

    const outerCall: HostCallNode = {
      type: 'HostCall',
      name: 'outer',
      args: [partialArg],
      span: zeroSpan,
    };

    const innerStatement: StatementNode = {
      type: 'Statement',
      expression: pipeChainOf(outerCall),
      span: zeroSpan,
    };

    // Wrap in `guard { ... }` so the catchable halt raised by
    // `evaluateExpression` is caught at the guard boundary and surfaces
    // as an invalid #R001 value the test can assert via the public
    // `isInvalid`/`getStatus` API, instead of asserting on the internal
    // `RuntimeHaltSignal` class.
    const guardBlock: GuardBlockNode = {
      type: 'GuardBlock',
      body: { type: 'Block', statements: [innerStatement], span: zeroSpan },
      span: zeroSpan,
    };

    const topStatement: StatementNode = {
      type: 'Statement',
      expression: pipeChainOf(guardBlock),
      span: zeroSpan,
    };

    const script: ScriptNode = {
      type: 'Script',
      frontmatter: null,
      statements: [topStatement],
      span: zeroSpan,
    };

    const ctx = createRuntimeContext({
      functions: { outer: outerMock, mock },
    });

    const { result } = await execute(script, ctx);

    expect(isInvalid(result as never)).toBe(true);
    expect(getStatus(result as never).code).toBe(resolveAtom('R001'));
    expect(mock.callCount).toBe(0);
    expect(outerMock.callCount).toBe(0);
  });
});
