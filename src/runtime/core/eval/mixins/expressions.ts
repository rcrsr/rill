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
 *
 * Error Handling:
 * - Type mismatches in operators throw RuntimeError(RUNTIME_TYPE_ERROR) [EC-22]
 * - Nested expression evaluation errors are propagated [EC-23]
 *
 * @internal
 */

import type {
  BinaryExprNode,
  UnaryExprNode,
  GroupedExprNode,
  ArithHead,
} from '../../../../types.js';
import { RuntimeError, RILL_ERROR_CODES } from '../../../../types.js';
import type { RillValue } from '../../values.js';
import { inferType, isTruthy, deepEquals } from '../../values.js';
import { createChildContext } from '../../context.js';
import type { EvaluatorConstructor } from '../types.js';
import type { EvaluatorBase } from '../base.js';

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
 *
 * Methods added:
 * - evaluateBinaryExpr(node) -> Promise<RillValue>
 * - evaluateUnaryExpr(node) -> Promise<RillValue>
 * - evaluateGroupedExpr(node) -> Promise<RillValue>
 * - evaluateExprHead(node) -> Promise<RillValue> (helper)
 * - evaluateExprHeadNumber(node) -> Promise<number> (helper)
 * - evaluateBinaryComparison(left, right, op, node) -> boolean (helper)
 */
function createExpressionsMixin(Base: EvaluatorConstructor<EvaluatorBase>) {
  return class ExpressionsEvaluator extends Base {
    /**
     * Evaluate binary expression: left op right.
     * Handles arithmetic, comparison, and logical operators.
     */
    async evaluateBinaryExpr(node: BinaryExprNode): Promise<RillValue> {
      const { op } = node;

      // Logical operators with short-circuit evaluation
      if (op === '||') {
        const left = await this.evaluateExprHead(node.left);
        if (isTruthy(left)) return true;
        const right = await this.evaluateExprHead(node.right);
        return isTruthy(right);
      }

      if (op === '&&') {
        const left = await this.evaluateExprHead(node.left);
        if (!isTruthy(left)) return false;
        const right = await this.evaluateExprHead(node.right);
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
        const left = await this.evaluateExprHead(node.left);
        const right = await this.evaluateExprHead(node.right);
        return this.evaluateBinaryComparison(left, right, op, node);
      }

      // Arithmetic operators - require numbers
      const left = await this.evaluateExprHeadNumber(node.left);
      const right = await this.evaluateExprHeadNumber(node.right);

      switch (op) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          if (right === 0) {
            throw new RuntimeError(
              RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
              'RILL-R002: Division by zero',
              node.span.start
            );
          }
          return left / right;
        case '%':
          if (right === 0) {
            throw new RuntimeError(
              RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
              'RILL-R002: Modulo by zero',
              node.span.start
            );
          }
          return left % right;
      }
    }

    /**
     * Evaluate comparison between two values.
     * Equality works on all types, ordering requires compatible types.
     */
    protected evaluateBinaryComparison(
      left: RillValue,
      right: RillValue,
      op: '==' | '!=' | '<' | '>' | '<=' | '>=',
      node: BinaryExprNode
    ): boolean {
      switch (op) {
        case '==':
          return deepEquals(left, right);
        case '!=':
          return !deepEquals(left, right);
        case '<':
        case '>':
        case '<=':
        case '>=':
          // Ordering comparisons require compatible types
          if (typeof left === 'number' && typeof right === 'number') {
            return op === '<'
              ? left < right
              : op === '>'
                ? left > right
                : op === '<='
                  ? left <= right
                  : left >= right;
          }
          if (typeof left === 'string' && typeof right === 'string') {
            return op === '<'
              ? left < right
              : op === '>'
                ? left > right
                : op === '<='
                  ? left <= right
                  : left >= right;
          }
          throw new RuntimeError(
            RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
            `RILL-R002: Cannot compare ${inferType(left)} with ${inferType(right)} using ${op}`,
            node.span.start
          );
      }
    }

    /**
     * Evaluate unary expression: -operand or !operand.
     */
    async evaluateUnaryExpr(node: UnaryExprNode): Promise<RillValue> {
      if (node.op === '!') {
        const value = await this.evaluateExprHead(node.operand);
        return !isTruthy(value);
      }

      // Unary minus
      const operand = node.operand;
      if (operand.type === 'UnaryExpr') {
        const inner = await this.evaluateUnaryExpr(operand);
        if (typeof inner !== 'number') {
          throw new RuntimeError(
            RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
            `RILL-R002: Unary minus requires number, got ${inferType(inner)}`,
            node.span.start
          );
        }
        return -inner;
      }
      const value = await this.evaluateExprHeadNumber(operand);
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluatePostfixExpr(node);
      }
    }

    /**
     * Evaluate expression head, requiring a number result.
     * Helper for arithmetic operators.
     */
    protected async evaluateExprHeadNumber(node: ArithHead): Promise<number> {
      const value = await this.evaluateExprHead(node);
      if (typeof value !== 'number') {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `RILL-R002: Arithmetic requires number, got ${inferType(value)}`,
          node.span.start
        );
      }
      return value;
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await (this as any).evaluatePipeChain(node.expression);
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
