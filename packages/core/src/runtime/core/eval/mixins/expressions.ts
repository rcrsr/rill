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
import type { EvaluatorInterface } from '../interface.js';
import { haltSlowPath } from './access.js';
import { STATUS_SYM, type RillStatus } from '../../types/status.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';

/**
 * Find the type registration for a value by type name.
 * Returns undefined when no registration matches.
 */
function findRegistration(typeName: string) {
  return BUILT_IN_TYPES.find((r) => r.name === typeName);
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
function createExpressionsMixin(Base: EvaluatorConstructor<EvaluatorBase>) {
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
    protected async resolveExpressionValue(
      value: RillValue
    ): Promise<RillValue> {
      // Auto-invoke only when $ is bound (pipeValue set)
      if (!isCallable(value) || this.ctx.pipeValue === null) {
        return value;
      }

      // Callable and $ is bound: auto-invoke
      // Zero-param closures: invoke with pipeValue = $
      // Parameterized closures: invoke with args = [$]
      const args =
        value.kind === 'script' && value.params.length === 0
          ? []
          : [this.ctx.pipeValue];

      return await (this as unknown as EvaluatorInterface).invokeCallable(
        value,
        args,
        undefined
      );
    }
    /**
     * Evaluate binary expression: left op right.
     * Handles arithmetic, comparison, and logical operators.
     * Auto-invokes closures when $ is bound.
     */
    async evaluateBinaryExpr(node: BinaryExprNode): Promise<RillValue> {
      const { op } = node;

      // Logical operators with short-circuit evaluation
      if (op === '||') {
        const rawLeft = await this.evaluateExprHead(node.left);
        const left = await this.resolveExpressionValue(rawLeft);
        if (isTruthy(left)) return true;
        const rawRight = await this.evaluateExprHead(node.right);
        const right = await this.resolveExpressionValue(rawRight);
        return isTruthy(right);
      }

      if (op === '&&') {
        const rawLeft = await this.evaluateExprHead(node.left);
        const left = await this.resolveExpressionValue(rawLeft);
        if (!isTruthy(left)) return false;
        const rawRight = await this.evaluateExprHead(node.right);
        const right = await this.resolveExpressionValue(rawRight);
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
        const rawLeft = await this.evaluateExprHead(node.left);
        const left = await this.resolveExpressionValue(rawLeft);
        const rawRight = await this.evaluateExprHead(node.right);
        const right = await this.resolveExpressionValue(rawRight);
        return this.evaluateBinaryComparison(left, right, op, node);
      }

      // Arithmetic operators - require numbers
      // Auto-invoke closures before checking type
      const rawLeft = await this.evaluateExprHead(node.left);
      const resolvedLeftRaw = await this.resolveExpressionValue(rawLeft);
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
        (resolvedLeftRaw as { [STATUS_SYM]?: RillStatus })[STATUS_SYM] !==
          undefined
      ) {
        resolvedLeft = haltSlowPath(
          resolvedLeftRaw,
          op,
          node.left,
          this.ctx.sourceId
        );
      } else {
        resolvedLeft = resolvedLeftRaw;
      }
      if (typeof resolvedLeft !== 'number') {
        throwCatchableHostHalt(
          {
            location: node.left.span.start,
            sourceId: this.ctx.sourceId,
            fn: 'evaluateArithmetic',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          `Arithmetic requires number, got ${inferType(resolvedLeft)}`
        );
      }
      const left = resolvedLeft;

      const rawRight = await this.evaluateExprHead(node.right);
      const resolvedRightRaw = await this.resolveExpressionValue(rawRight);
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
          this.ctx.sourceId
        );
      } else {
        resolvedRight = resolvedRightRaw;
      }
      if (typeof resolvedRight !== 'number') {
        throwCatchableHostHalt(
          {
            location: node.right.span.start,
            sourceId: this.ctx.sourceId,
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
                sourceId: this.ctx.sourceId,
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
                sourceId: this.ctx.sourceId,
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
    protected evaluateBinaryComparison(
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
              sourceId: this.ctx.sourceId,
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
            sourceId: this.ctx.sourceId,
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
    async evaluateUnaryExpr(node: UnaryExprNode): Promise<RillValue> {
      if (node.op === '!') {
        const rawValue = await this.evaluateExprHead(node.operand);
        const value = await this.resolveExpressionValue(rawValue);
        if (typeof value !== 'boolean') {
          throwCatchableHostHalt(
            {
              location: node.span.start,
              sourceId: this.ctx.sourceId,
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
        const inner = await this.evaluateUnaryExpr(operand);
        if (typeof inner !== 'number') {
          throwCatchableHostHalt(
            {
              location: node.span.start,
              sourceId: this.ctx.sourceId,
              fn: 'evaluateUnaryExpr',
            },
            ERROR_ATOMS[ERROR_IDS.RILL_R002],
            `Arithmetic requires number, got ${inferType(inner)}`
          );
        }
        return -inner;
      }
      const rawValue = await this.evaluateExprHead(operand);
      const value = await this.resolveExpressionValue(rawValue);
      if (typeof value !== 'number') {
        throwCatchableHostHalt(
          {
            location: node.span.start,
            sourceId: this.ctx.sourceId,
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
    protected async evaluateExprHead(node: ArithHead): Promise<RillValue> {
      switch (node.type) {
        case 'BinaryExpr':
          return this.evaluateBinaryExpr(node);
        case 'UnaryExpr':
          return this.evaluateUnaryExpr(node);
        case 'PostfixExpr':
          return (this as unknown as EvaluatorInterface).evaluatePostfixExpr(
            node
          );
      }
    }

    /**
     * Evaluate grouped expression: (expression).
     * Provides scoping - captures inside are local and not visible outside.
     */
    async evaluateGroupedExpr(node: GroupedExprNode): Promise<RillValue> {
      // Grouped expressions have their own scope (reads parent, writes local only)
      const childCtx = createChildContext(this.ctx);
      const savedCtx = this.ctx;
      this.ctx = childCtx;
      try {
        return await (this as unknown as EvaluatorInterface).evaluatePipeChain(
          node.expression
        );
      } finally {
        this.ctx = savedCtx;
      }
    }
  };
}

// Export with type assertion to work around TS4094 limitation
// TypeScript can't generate declarations for functions returning classes with protected members
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ExpressionsMixin = createExpressionsMixin as any;

/**
 * Capability fragment: methods contributed by ExpressionsMixin that are called
 * from core.ts cast sites. Covers only the methods core.ts invokes.
 */
export type ExpressionsMixinCapability = {
  evaluateBinaryExpr(node: BinaryExprNode): Promise<RillValue>;
  evaluateUnaryExpr(node: UnaryExprNode): Promise<RillValue>;
  evaluateGroupedExpr(node: GroupedExprNode): Promise<RillValue>;
};
