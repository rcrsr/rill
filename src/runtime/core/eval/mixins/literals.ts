/**
 * LiteralsMixin: String, Tuple, Dict, and Closure Evaluation
 *
 * Handles evaluation of literal values including:
 * - String literals with interpolation
 * - Tuple literals
 * - Dict literals with callable binding
 * - Closure creation with late binding
 *
 * Interface requirements (from spec):
 * - evaluateString(node) -> Promise<string>
 * - evaluateTuple(node) -> Promise<RillValue[]>
 * - evaluateDict(node) -> Promise<Record<string, RillValue>>
 * - createClosure(node) -> Promise<ScriptCallable>
 *
 * Error Handling:
 * - String interpolation errors propagate from evaluateExpression() [EC-6]
 * - Dict/tuple evaluation errors propagate from nested expressions [EC-7]
 *
 * @internal
 */

import type {
  StringLiteralNode,
  TupleNode,
  DictNode,
  ClosureNode,
  PipeChainNode,
  PostfixExprNode,
  ExpressionNode,
} from '../../../../types.js';
import { RuntimeError, RILL_ERROR_CODES } from '../../../../types.js';
import type { RillValue } from '../../values.js';
import { formatValue, isReservedMethod } from '../../values.js';
import {
  isCallable,
  type ScriptCallable,
  type CallableParam,
} from '../../callable.js';
import type { EvaluatorConstructor } from '../types.js';
import type { EvaluatorBase } from '../base.js';

/**
 * LiteralsMixin implementation.
 *
 * Provides evaluation of literal values. String literals support interpolation,
 * closures are created with late binding, and dict callables are automatically
 * bound to their containing dict.
 *
 * Depends on:
 * - EvaluatorBase: ctx, checkAborted(), getNodeLocation()
 * - evaluateExpression() (from future CoreMixin composition)
 * - evaluatePrimary() (from future CoreMixin composition)
 *
 * Methods added:
 * - evaluateString(node) -> Promise<string>
 * - evaluateTuple(node) -> Promise<RillValue[]>
 * - evaluateDict(node) -> Promise<Record<string, RillValue>>
 * - createClosure(node) -> Promise<ScriptCallable>
 */
function createLiteralsMixin(Base: EvaluatorConstructor<EvaluatorBase>) {
  return class LiteralsEvaluator extends Base {
    /**
     * Evaluate string literal with interpolation.
     * Interpolation expressions are evaluated with the current pipe value preserved.
     *
     * String parts are concatenated with interpolated values formatted via formatValue().
     * Errors from interpolation expression evaluation propagate to caller.
     */
    protected async evaluateString(node: StringLiteralNode): Promise<string> {
      let result = '';
      // Save pipeValue since interpolation expressions can modify it
      const savedPipeValue = this.ctx.pipeValue;
      for (const part of node.parts) {
        if (typeof part === 'string') {
          result += part;
        } else {
          // InterpolationNode: evaluate the expression
          // Restore pipeValue before each interpolation so they all see the same value
          this.ctx.pipeValue = savedPipeValue;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const value = await (this as any).evaluateExpression(part.expression);
          result += formatValue(value);
        }
      }
      // Restore pipeValue after string evaluation
      this.ctx.pipeValue = savedPipeValue;
      return result;
    }

    /**
     * Evaluate tuple literal.
     * Elements are evaluated in order and collected into an array.
     *
     * Errors from element evaluation propagate to caller.
     */
    protected async evaluateTuple(node: TupleNode): Promise<RillValue[]> {
      const elements: RillValue[] = [];
      for (const elem of node.elements) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        elements.push(await (this as any).evaluateExpression(elem));
      }
      return elements;
    }

    /**
     * Evaluate dict literal.
     * All callables in the dict are bound to the containing dict via boundDict property.
     *
     * Reserved method names (keys, values, entries) cannot be used as dict keys.
     * Errors from value evaluation propagate to caller.
     */
    protected async evaluateDict(
      node: DictNode
    ): Promise<Record<string, RillValue>> {
      const result: Record<string, RillValue> = {};
      for (const entry of node.entries) {
        if (isReservedMethod(entry.key)) {
          throw new RuntimeError(
            RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
            `Cannot use reserved method name '${entry.key}' as dict key`,
            entry.span.start,
            { key: entry.key, reservedMethods: ['keys', 'values', 'entries'] }
          );
        }

        if (this.isClosureExpr(entry.value)) {
          // Safe cast: isClosureExpr ensures head is PostfixExpr with Closure primary
          const head = entry.value.head as PostfixExprNode;
          const fnLit = head.primary as ClosureNode;
          const closure = await this.createClosure(fnLit);
          result[entry.key] = closure;
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          result[entry.key] = await (this as any).evaluateExpression(
            entry.value
          );
        }
      }

      // Bind all callables to the containing dict
      for (const key of Object.keys(result)) {
        const value = result[key];
        if (value !== undefined && isCallable(value)) {
          result[key] = {
            ...value,
            boundDict: result,
          };
        }
      }

      return result;
    }

    /**
     * Create a script callable from a closure node.
     * Closures use late binding - variables are resolved in definingScope when invoked.
     *
     * Default parameter values are evaluated immediately in the current context.
     * Property-style callables (zero params) are auto-invoked on dict access.
     */
    protected async createClosure(node: ClosureNode): Promise<ScriptCallable> {
      // Store reference to the defining scope for late-bound variable resolution
      const definingScope = this.ctx;

      const params: CallableParam[] = [];
      for (const param of node.params) {
        let defaultValue: RillValue | null = null;
        if (param.defaultValue) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          defaultValue = await (this as any).evaluatePrimary(
            param.defaultValue
          );
        }
        params.push({
          name: param.name,
          typeName: param.typeName,
          defaultValue,
        });
      }

      const isProperty = params.length === 0;

      return {
        __type: 'callable',
        kind: 'script',
        params,
        body: node.body,
        definingScope,
        isProperty,
      };
    }

    /**
     * Helper: Check if expression is a bare closure (no pipes, no methods).
     * Used to detect dict entries that should be treated as closures.
     */
    private isClosureExpr(expr: ExpressionNode): boolean {
      if (expr.type !== 'PipeChain') return false;
      const chain = expr as PipeChainNode;
      if (chain.pipes.length > 0) return false;
      if (chain.head.type !== 'PostfixExpr') return false;
      const head = chain.head as PostfixExprNode;
      if (head.methods.length > 0) return false;
      return head.primary.type === 'Closure';
    }
  };
}

// Export with type assertion to work around TS4094 limitation
// TypeScript can't generate declarations for functions returning classes with protected members
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const LiteralsMixin = createLiteralsMixin as any;
