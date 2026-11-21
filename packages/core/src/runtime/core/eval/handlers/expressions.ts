/**
 * Binary and Unary Expressions
 *
 * Handles arithmetic, comparison, and logical operators.
 * Provides evaluation for binary operations, unary operations, and grouped expressions.
 *
 * Interface requirements (from spec):
 * - evaluateBinaryExpr(node) -> Promise<RillValue>
 * - evaluateUnaryExpr(node) -> Promise<RillValue>
 * - evaluateGroupedExpr(node) -> Promise<RillValue>
 *
 * Error Handling:
 * - Operator operand type mismatches halt with RILL-R002; non-finite arithmetic
 *   results halt with #INVALID_INPUT
 * - Nested expression evaluation errors are propagated
 *
 * @internal
 */

import type {
  BinaryExprNode,
  UnaryExprNode,
  GroupedExprNode,
  ArithHead,
} from '../../../../types.js';
import {
  throwCatchableHostHalt,
  throwFatalHostHalt,
  RuntimeHaltSignal,
  enrichHaltOriginLocation,
} from '../../types/halt.js';
import type { RillValue } from '../../types/structures.js';
import { inferType } from '../../types/registrations.js';
import { BUILT_IN_TYPES } from '../../types/registrations.js';
import { createChildContext } from '../../context.js';
import type { EvalState } from '../state.js';
import { withChildScope } from '../shared.js';
import { accessHaltGate, haltSlowPath } from './access.js';
import { hasStatusSidecar } from '../../types/status.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import { evaluatePostfixExpr, evaluatePipeChainCarried } from './core.js';
import type { Carried } from '../../types/declared.js';
import { requireOverlap } from '../../types/overlap.js';
import { evaluatePostfixExprCarried } from './declared-flow.js';

/**
 * Find the type registration for a value by type name.
 * Returns undefined when no registration matches.
 */
function findRegistration(typeName: string) {
  return BUILT_IN_TYPES.find((r) => r.name === typeName);
}

/**
 * Evaluate binary expression: left op right.
 * Handles arithmetic, comparison, and logical operators.
 */
export async function evaluateBinaryExpr(
  s: EvalState,
  node: BinaryExprNode
): Promise<RillValue> {
  const { op } = node;

  // Logical operators with short-circuit evaluation
  if (op === '||') {
    const left = await evaluateExprHead(s, node.left);
    if (typeof left !== 'boolean') {
      throwCatchableHostHalt(
        {
          location: node.span.start,
          sourceId: s.ctx.sourceId,
          fn: 'evaluateBinaryExpr',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        `Logical operator (${op}) requires boolean operand, got ${inferType(left)}`
      );
    }
    if (left) return true;
    const right = await evaluateExprHead(s, node.right);
    if (typeof right !== 'boolean') {
      throwCatchableHostHalt(
        {
          location: node.span.start,
          sourceId: s.ctx.sourceId,
          fn: 'evaluateBinaryExpr',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        `Logical operator (${op}) requires boolean operand, got ${inferType(right)}`
      );
    }
    return right;
  }

  if (op === '&&') {
    const left = await evaluateExprHead(s, node.left);
    if (typeof left !== 'boolean') {
      throwCatchableHostHalt(
        {
          location: node.span.start,
          sourceId: s.ctx.sourceId,
          fn: 'evaluateBinaryExpr',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        `Logical operator (${op}) requires boolean operand, got ${inferType(left)}`
      );
    }
    if (!left) return false;
    const right = await evaluateExprHead(s, node.right);
    if (typeof right !== 'boolean') {
      throwCatchableHostHalt(
        {
          location: node.span.start,
          sourceId: s.ctx.sourceId,
          fn: 'evaluateBinaryExpr',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        `Logical operator (${op}) requires boolean operand, got ${inferType(right)}`
      );
    }
    return right;
  }

  // Equality: operands carry their declared types into the overlap check
  if (op === '==' || op === '!=') {
    const left = await evaluateExprHeadCarried(s, node.left);
    const right = await evaluateExprHeadCarried(s, node.right);
    return evaluateEquality(s, left, right, op, node);
  }

  // Comparison operators - work on any values, return boolean
  if (op === '<' || op === '>' || op === '<=' || op === '>=') {
    const left = await evaluateExprHead(s, node.left);
    const right = await evaluateExprHead(s, node.right);
    return evaluateBinaryComparison(s, left, right, op, node);
  }

  // Arithmetic operators - require numbers
  const rawLeft = await evaluateExprHead(s, node.left);
  // access-halt gate at arith site. An invalid operand halts
  // before the type check, so the halt surfaces as an access frame.
  // Inline the Symbol-keyed sidecar probe to eliminate the
  // per-iteration arrow-closure allocation that `accessHaltGateFast`
  // required in this hot loop. Slow path delegates to
  // `haltSlowPath` which reads `node.span.start` itself.
  let resolvedLeft: RillValue;
  if (hasStatusSidecar(rawLeft)) {
    resolvedLeft = haltSlowPath(rawLeft, op, node.left, s.ctx.sourceId);
  } else {
    resolvedLeft = rawLeft;
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
  let resolvedRight: RillValue;
  if (hasStatusSidecar(rawRight)) {
    resolvedRight = haltSlowPath(rawRight, op, node.right, s.ctx.sourceId);
  } else {
    resolvedRight = rawRight;
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

  let result: number;
  switch (op) {
    case '+':
      result = left + right;
      break;
    case '-':
      result = left - right;
      break;
    case '*':
      result = left * right;
      break;
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
      result = left / right;
      break;
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
      result = left % right;
      break;
  }

  if (!Number.isFinite(result)) {
    throwCatchableHostHalt(
      {
        location: node.span.start,
        sourceId: s.ctx.sourceId,
        fn: 'evaluateArithmetic',
      },
      'INVALID_INPUT',
      `Arithmetic (${op}) produced non-finite result (${result})`
    );
  }

  return result;
}

/**
 * Evaluate == / != between two carried operands.
 *
 * Halt order: access-halt gate, RILL-R002 when either operand type has no
 * eq protocol, #TYPE_MISMATCH when the operand types cannot overlap, then
 * protocol.eq. A carried type never changes an equality result.
 */
function evaluateEquality(
  s: EvalState,
  left: Carried,
  right: Carried,
  op: '==' | '!=',
  node: BinaryExprNode
): boolean {
  const gatedLeft = accessHaltGate(left.value, {
    location: node.left.span.start,
    sourceId: s.ctx.sourceId,
    fn: op,
  });
  const gatedRight = accessHaltGate(right.value, {
    location: node.right.span.start,
    sourceId: s.ctx.sourceId,
    fn: op,
  });
  const leftName = inferType(gatedLeft);
  const rightName = inferType(gatedRight);
  const leftReg = findRegistration(leftName);
  const rightReg = findRegistration(rightName);
  for (const [name, reg] of [
    [leftName, leftReg],
    [rightName, rightReg],
  ] as const) {
    if (!reg || !reg.protocol.eq) {
      throwCatchableHostHalt(
        {
          location: node.span.start,
          sourceId: s.ctx.sourceId,
          fn: 'evaluateBinaryComparison',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        `Cannot compare ${name} using ${op}`
      );
    }
  }
  requireOverlap(
    { value: gatedLeft, declared: left.declared },
    { value: gatedRight, declared: right.declared },
    {
      location: node.span.start,
      sourceId: s.ctx.sourceId,
      fn: op,
    },
    op
  );
  const eqResult = leftReg?.protocol.eq?.(gatedLeft, gatedRight) ?? false;
  return op === '==' ? eqResult : !eqResult;
}

/**
 * Evaluate comparison between two values via protocol dispatch.
 *
 * - == / != dispatch to protocol.eq; absent eq raises RILL-R002.
 * - Ordering ops dispatch to protocol.compare; absent compare raises RILL-R002.
 *
 * Breaking change: bool ordering (e.g. true > false) raises RILL-R002
 * because the bool registration has no protocol.compare.
 */
function evaluateBinaryComparison(
  s: EvalState,
  left: RillValue,
  right: RillValue,
  op: '<' | '>' | '<=' | '>=',
  node: BinaryExprNode
): boolean {
  const typeName = inferType(left);
  const reg = findRegistration(typeName);

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
  let cmp: number;
  try {
    cmp = reg.protocol.compare(left, right);
  } catch (e) {
    if (e instanceof RuntimeHaltSignal) {
      throw enrichHaltOriginLocation(e, node.span.start, s.ctx.sourceId);
    }
    throw e;
  }
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
  return throwFatalHostHalt(
    {
      location: node.span.start,
      sourceId: s.ctx.sourceId,
      fn: 'evaluateBinaryComparison',
    },
    ERROR_ATOMS[ERROR_IDS.RILL_R002],
    'Unsupported comparison operator'
  );
}

/**
 * Evaluate unary expression: -operand or !operand.
 */
export async function evaluateUnaryExpr(
  s: EvalState,
  node: UnaryExprNode
): Promise<RillValue> {
  if (node.op === '!') {
    const value = await evaluateExprHead(s, node.operand);
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
  const value = await evaluateExprHead(s, operand);
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
export function evaluateExprHead(
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
  return throwFatalHostHalt(
    { sourceId: s.ctx.sourceId, fn: 'evaluateExprHead' },
    ERROR_ATOMS[ERROR_IDS.RILL_R002],
    'Unsupported expression head'
  );
}

/**
 * Evaluate an expression head with its declared type. Postfix heads report
 * the type they carry; binary and unary results take their own type.
 */
async function evaluateExprHeadCarried(
  s: EvalState,
  node: ArithHead
): Promise<Carried> {
  if (node.type === 'PostfixExpr') return evaluatePostfixExprCarried(s, node);
  return { value: await evaluateExprHead(s, node), declared: undefined };
}

/**
 * Evaluate grouped expression: (expression).
 * Provides scoping - captures inside are local and not visible outside.
 */
export async function evaluateGroupedExpr(
  s: EvalState,
  node: GroupedExprNode
): Promise<RillValue> {
  return (await evaluateGroupedExprCarried(s, node)).value;
}

/**
 * Grouped expression that also reports the declared type of the inner chain
 * result.
 */
export function evaluateGroupedExprCarried(
  s: EvalState,
  node: GroupedExprNode
): Promise<Carried> {
  // Grouped expressions have their own scope (reads parent, writes local only)
  const childCtx = createChildContext(s.ctx);
  return withChildScope(s, childCtx, () =>
    evaluatePipeChainCarried(s, node.expression)
  );
}
