/**
 * ExpressionsMixin: Binary and Unary Expressions
 *
 * Handles arithmetic, comparison, and logical operators.
 * Provides evaluation for binary operations, unary operations, and grouped expressions.
 *
 * Interface requirements (from spec):
 * - evaluateBinaryExpr(node) -> Promise<RillValue>
 * - evaluateUnaryExpr(node) -> Promise<RillValue>
 * - evaluateGroupedExpr(node) -> Promise<RillValue>
 * - resolveExpressionValue(value) -> Promise<RillValue>
 *
 * Error Handling:
 * - Type mismatches in operators throw RuntimeError(RUNTIME_TYPE_ERROR) [EC-22]
 * - Nested expression evaluation errors are propagated [EC-23]
 * - Closure auto-invoke errors are propagated [EC-4, EC-6]
 *
 * @internal
 */

import type {
  BinaryExprNode,
  UnaryExprNode,
  GroupedExprNode,
  ArithHead,
} from '../../../../types.js';
import { throwCatchableHostHalt } from '../../types/halt.js';
import type { RillValue } from '../../types/structures.js';
import { inferType } from '../../types/registrations.js';
import { isTruthy } from '../../values.js';
import { BUILT_IN_TYPES } from '../../types/registrations.js';
import { createChildContext } from '../../context.js';
import { isCallable } from '../../callable.js';
import type { EvaluatorConstructor } from '../types.js';
import type { EvaluatorBase } from '../base.js';
import type { EvalState } from '../state.js';
import { haltSlowPath } from './access.js';
import { STATUS_SYM, type RillStatus } from '../../types/status.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import { invokeCallable } from './closures.js';
import { evaluatePostfixExpr, evaluatePipeChain } from './core.js';

/**
 * Find the type registration for a value by type name.
 * Returns undefined when no registration matches.
 */
function findRegistration(typeName: string) {
  return BUILT_IN_TYPES.find((r) => r.name === typeName);
}

/**
 * Resolve expression value, auto-invoking closures when $ is bound.
 *
 * Auto-invokes closures only when ctx.pipeValue is set:
 * - Zero-param closures: invoke with pipeValue = $
 * - Parameterized closures: invoke with args = [$]
 * - Non-callable values: returned unchanged
 *
 * Expression contexts that call resolveExpressionValue:
 * - Unary operand (e.g., `! $closure`)
 * - Binary operands (e.g., `$a && $b`, `$x + $y`)
 *
 * Excluded contexts (no auto-invoke):
 * - Capture target (`:> $var`)
 * - Direct pipe target (`-> $fn`)
 * - Function call arguments (`func($closure)`)
 *
 * Reference: variables.ts:720-733 (property-style auto-invoke)
 */
export async function resolveExpressionValue(
  s: EvalState,
  value: RillValue
): Promise<RillValue> {
  // Auto-invoke only when $ is bound (pipeValue set)
  if (!isCallable(value) || s.ctx.pipeValue === null) {
    return value;
  }

  // Callable and $ is bound: auto-invoke
  // Zero-param closures: invoke with pipeValue = $
  // Parameterized closures: invoke with args = [$]
  const args =
    value.kind === 'script' && value.params.length === 0
      ? []
      : [s.ctx.pipeValue];

  return await invokeCallable(s, value, args, undefined);
}

/**
 * Evaluate binary expression: left op right.
 * Handles arithmetic, comparison, and logical operators.
 * Auto-invokes closures when $ is bound.
 */
export async function evaluateBinaryExpr(
  s: EvalState,
  node: BinaryExprNode
): Promise<RillValue> {
  const { op } = node;

  // Logical operators with short-circuit evaluation
  if (op === '||') {
    const rawLeft = await evaluateExprHead(s, node.left);
    const left = await resolveExpressionValue(s, rawLeft);
    if (isTruthy(left)) return true;
    const rawRight = await evaluateExprHead(s, node.right);
    const right = await resolveExpressionValue(s, rawRight);
    return isTruthy(right);
  }

  if (op === '&&') {
    const rawLeft = await evaluateExprHead(s, node.left);
    const left = await resolveExpressionValue(s, rawLeft);
    if (!isTruthy(left)) return false;
    const rawRight = await evaluateExprHead(s, node.right);
    const right = await resolveExpressionValue(s, rawRight);
    return isTruthy(right);
  }

  // Comparison operators - work on any values, return boolean
  if (
    op === '==' ||
    op === '!=' ||
    op === '<' ||
    op === '>' ||
    op === '<=' ||
    op === '>='
  ) {
    const rawLeft = await evaluateExprHead(s, node.left);
    const left = await resolveExpressionValue(s, rawLeft);
    const rawRight = await evaluateExprHead(s, node.right);
    const right = await resolveExpressionValue(s, rawRight);
    return evaluateBinaryComparison(s, left, right, op, node);
  }

  // Arithmetic operators - require numbers
  // Auto-invoke closures before checking type
  const rawLeft = await evaluateExprHead(s, node.left);
  const resolvedLeftRaw = await resolveExpressionValue(s, rawLeft);
  // EC-7: access-halt gate at arith site. An invalid operand halts
  // before the type check, so the halt surfaces as an access frame.
  // RI-4: inline the Symbol-keyed sidecar probe to eliminate the
  // per-iteration arrow-closure allocation that `accessHaltGateFast`
  // required (NFR-ERR-1 hot loop). Slow path delegates to
  // `haltSlowPath` which reads `node.span.start` itself.
  let resolvedLeft: RillValue;
  if (
    resolvedLeftRaw !== null &&
    typeof resolvedLeftRaw === 'object' &&
    (resolvedLeftRaw as { [STATUS_SYM]?: RillStatus })[STATUS_SYM] !== undefined
  ) {
    resolvedLeft = haltSlowPath(resolvedLeftRaw, op, node.left, s.ctx.sourceId);
  } else {
    resolvedLeft = resolvedLeftRaw;
  }
  if (typeof resolvedLeft !== 'number') {
    throwCatchableHostHalt(
      {
        location: node.left.span.start,
        sourceId: s.ctx.sourceId,
        fn: 'evaluateArithmetic',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Arithmetic requires number, got ${inferType(resolvedLeft)}`
    );
  }
  const left = resolvedLeft;

  const rawRight = await evaluateExprHead(s, node.right);
  const resolvedRightRaw = await resolveExpressionValue(s, rawRight);
  let resolvedRight: RillValue;
  if (
    resolvedRightRaw !== null &&
    typeof resolvedRightRaw === 'object' &&
    (resolvedRightRaw as { [STATUS_SYM]?: RillStatus })[STATUS_SYM] !==
      undefined
  ) {
    resolvedRight = haltSlowPath(
      resolvedRightRaw,
      op,
      node.right,
      s.ctx.sourceId
    );
  } else {
    resolvedRight = resolvedRightRaw;
  }
  if (typeof resolvedRight !== 'number') {
    throwCatchableHostHalt(
      {
        location: node.right.span.start,
        sourceId: s.ctx.sourceId,
        fn: 'evaluateArithmetic',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Arithmetic requires number, got ${inferType(resolvedRight)}`
    );
  }
  const right = resolvedRight;

  switch (op) {
    case '+':
      return left + right;
    case '-':
      return left - right;
    case '*':
      return left * right;
    case '/':
      if (right === 0) {
        throwCatchableHostHalt(
          {
            location: node.span.start,
            sourceId: s.ctx.sourceId,
            fn: 'evaluateArithmetic',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          'Division by zero'
        );
      }
      return left / right;
    case '%':
      if (right === 0) {
        throwCatchableHostHalt(
          {
            location: node.span.start,
            sourceId: s.ctx.sourceId,
            fn: 'evaluateArithmetic',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          'Modulo by zero'
        );
      }
      return left % right;
  }
}

/**
 * Evaluate comparison between two values via protocol dispatch.
 *
 * - == / != dispatch to protocol.eq; absent eq raises RILL-R002.
 * - Ordering ops dispatch to protocol.compare; absent compare raises RILL-R002.
 *
 * IR-5: Breaking change: bool ordering (e.g. true > false) raises RILL-R002
 * because the bool registration has no protocol.compare.
 */
export function evaluateBinaryComparison(
  s: EvalState,
  left: RillValue,
  right: RillValue,
  op: '==' | '!=' | '<' | '>' | '<=' | '>=',
  node: BinaryExprNode
): boolean {
  const typeName = inferType(left);
  const reg = findRegistration(typeName);

  if (op === '==' || op === '!=') {
    if (!reg || !reg.protocol.eq) {
      throwCatchableHostHalt(
        {
          location: node.span.start,
          sourceId: s.ctx.sourceId,
          fn: 'evaluateBinaryComparison',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        `Cannot compare ${typeName} using ${op}`
      );
    }
    const eqResult = reg.protocol.eq(left, right);
    return op === '==' ? eqResult : !eqResult;
  }

  // Ordering ops: <, >, <=, >=
  const rightTypeName = inferType(right);
  if (!reg || !reg.protocol.compare || typeName !== rightTypeName) {
    throwCatchableHostHalt(
      {
        location: node.span.start,
        sourceId: s.ctx.sourceId,
        fn: 'evaluateBinaryComparison',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Cannot compare ${typeName} with ${rightTypeName} using ${op}`
    );
  }
  const cmp = reg.protocol.compare(left, right);
  switch (op) {
    case '<':
      return cmp < 0;
    case '>':
      return cmp > 0;
    case '<=':
      return cmp <= 0;
    case '>=':
      return cmp >= 0;
  }
}

/**
 * Evaluate unary expression: -operand or !operand.
 * Auto-invokes closures when $ is bound.
 */
export async function evaluateUnaryExpr(
  s: EvalState,
  node: UnaryExprNode
): Promise<RillValue> {
  if (node.op === '!') {
    const rawValue = await evaluateExprHead(s, node.operand);
    const value = await resolveExpressionValue(s, rawValue);
    if (typeof value !== 'boolean') {
      throwCatchableHostHalt(
        {
          location: node.span.start,
          sourceId: s.ctx.sourceId,
          fn: 'evaluateUnaryExpr',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        `Negation operator (!) requires boolean operand, got ${inferType(value)}`
      );
    }
    return !value;
  }

  // Unary minus
  const operand = node.operand;
  if (operand.type === 'UnaryExpr') {
    const inner = await evaluateUnaryExpr(s, operand);
    if (typeof inner !== 'number') {
      throwCatchableHostHalt(
        {
          location: node.span.start,
          sourceId: s.ctx.sourceId,
          fn: 'evaluateUnaryExpr',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        `Arithmetic requires number, got ${inferType(inner)}`
      );
    }
    return -inner;
  }
  const rawValue = await evaluateExprHead(s, operand);
  const value = await resolveExpressionValue(s, rawValue);
  if (typeof value !== 'number') {
    throwCatchableHostHalt(
      {
        location: node.span.start,
        sourceId: s.ctx.sourceId,
        fn: 'evaluateUnaryExpr',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Arithmetic requires number, got ${inferType(value)}`
    );
  }
  return -value;
}

/**
 * Evaluate expression head, returning any RillValue.
 * Helper for binary and unary expression evaluation.
 */
export async function evaluateExprHead(
  s: EvalState,
  node: ArithHead
): Promise<RillValue> {
  switch (node.type) {
    case 'BinaryExpr':
      return evaluateBinaryExpr(s, node);
    case 'UnaryExpr':
      return evaluateUnaryExpr(s, node);
    case 'PostfixExpr':
      return evaluatePostfixExpr(s, node);
  }
}

/**
 * Evaluate grouped expression: (expression).
 * Provides scoping - captures inside are local and not visible outside.
 */
export async function evaluateGroupedExpr(
  s: EvalState,
  node: GroupedExprNode
): Promise<RillValue> {
  // Grouped expressions have their own scope (reads parent, writes local only)
  const childCtx = createChildContext(s.ctx);
  const savedCtx = s.ctx;
  s.ctx = childCtx;
  try {
    return await evaluatePipeChain(s, node.expression);
  } finally {
    s.ctx = savedCtx;
  }
}

/**
 * ExpressionsMixin implementation.
 *
 * Evaluates binary expressions (arithmetic, comparison, logical),
 * unary expressions (negation, logical NOT), and grouped expressions.
 *
 * Depends on:
 * - EvaluatorBase: ctx, getNodeLocation()
 * - evaluateExprHead() (internal helper, defined in this mixin)
 * - evaluatePostfixExpr() (from future CoreMixin composition)
 * - evaluatePipeChain() (from future CoreMixin composition)
 * - invokeCallable() (from ClosuresMixin)
 *
 * Methods added:
 * - evaluateBinaryExpr(node) -> Promise<RillValue>
 * - evaluateUnaryExpr(node) -> Promise<RillValue>
 * - evaluateGroupedExpr(node) -> Promise<RillValue>
 * - resolveExpressionValue(value) -> Promise<RillValue>
 * - evaluateExprHead(node) -> Promise<RillValue> (helper)
 * - evaluateBinaryComparison(left, right, op, node) -> boolean (helper)
 */
export function ExpressionsMixin<
  TBase extends EvaluatorConstructor<EvaluatorBase>,
>(Base: TBase) {
  return class ExpressionsEvaluator extends Base {
    /**
     * Resolve expression value, auto-invoking closures when $ is bound.
     *
     * Auto-invokes closures only when ctx.pipeValue is set:
     * - Zero-param closures: invoke with pipeValue = $
     * - Parameterized closures: invoke with args = [$]
     * - Non-callable values: returned unchanged
     *
     * Expression contexts that call resolveExpressionValue:
     * - Unary operand (e.g., `! $closure`)
     * - Binary operands (e.g., `$a && $b`, `$x + $y`)
     *
     * Excluded contexts (no auto-invoke):
     * - Capture target (`:> $var`)
     * - Direct pipe target (`-> $fn`)
     * - Function call arguments (`func($closure)`)
     *
     * Reference: variables.ts:720-733 (property-style auto-invoke)
     */
    resolveExpressionValue(value: RillValue): Promise<RillValue> {
      return resolveExpressionValue(this as unknown as EvalState, value);
    }
    /**
     * Evaluate binary expression: left op right.
     * Handles arithmetic, comparison, and logical operators.
     * Auto-invokes closures when $ is bound.
     */
    evaluateBinaryExpr(node: BinaryExprNode): Promise<RillValue> {
      return evaluateBinaryExpr(this as unknown as EvalState, node);
    }

    /**
     * Evaluate comparison between two values via protocol dispatch.
     *
     * - == / != dispatch to protocol.eq; absent eq raises RILL-R002.
     * - Ordering ops dispatch to protocol.compare; absent compare raises RILL-R002.
     *
     * IR-5: Breaking change: bool ordering (e.g. true > false) raises RILL-R002
     * because the bool registration has no protocol.compare.
     */
    evaluateBinaryComparison(
      left: RillValue,
      right: RillValue,
      op: '==' | '!=' | '<' | '>' | '<=' | '>=',
      node: BinaryExprNode
    ): boolean {
      return evaluateBinaryComparison(
        this as unknown as EvalState,
        left,
        right,
        op,
        node
      );
    }

    /**
     * Evaluate unary expression: -operand or !operand.
     * Auto-invokes closures when $ is bound.
     */
    evaluateUnaryExpr(node: UnaryExprNode): Promise<RillValue> {
      return evaluateUnaryExpr(this as unknown as EvalState, node);
    }

    /**
     * Evaluate expression head, returning any RillValue.
     * Helper for binary and unary expression evaluation.
     */
    evaluateExprHead(node: ArithHead): Promise<RillValue> {
      return evaluateExprHead(this as unknown as EvalState, node);
    }

    /**
     * Evaluate grouped expression: (expression).
     * Provides scoping - captures inside are local and not visible outside.
     */
    evaluateGroupedExpr(node: GroupedExprNode): Promise<RillValue> {
      return evaluateGroupedExpr(this as unknown as EvalState, node);
    }
  };
}

/**
 * Capability fragment: methods contributed by ExpressionsMixin that are called
 * from core.ts cast sites. Covers only the methods core.ts invokes.
 */
export type ExpressionsMixinCapability = {
  evaluateBinaryExpr(node: BinaryExprNode): Promise<RillValue>;
  evaluateUnaryExpr(node: UnaryExprNode): Promise<RillValue>;
  evaluateGroupedExpr(node: GroupedExprNode): Promise<RillValue>;
};
