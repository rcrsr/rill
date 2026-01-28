/**
 * CoreMixin: Main Expression Dispatch
 *
 * Provides the main entry points for expression evaluation and dispatches
 * to specialized evaluators based on AST node type.
 *
 * This is the central coordination point that ties together all other mixins.
 *
 * Interface requirements (from spec IR-5 through IR-13):
 * - evaluateExpression(expr) -> Promise<RillValue> [IR-8]
 * - evaluatePipeChain(chain) -> Promise<RillValue> [IR-9]
 * - evaluatePostfixExpr(expr) -> Promise<RillValue> [IR-10]
 * - evaluatePrimary(primary) -> Promise<RillValue> [IR-11]
 * - evaluatePipeTarget(target, input) -> Promise<RillValue> [IR-12]
 * - evaluateArgs(argExprs) -> Promise<RillValue[]> [IR-13]
 *
 * Error Handling:
 * - Unsupported expression types throw RuntimeError [EC-4]
 * - Aborted execution throws AbortError [EC-5]
 *
 * @internal
 */

import type {
  ExpressionNode,
  PipeChainNode,
  PostfixExprNode,
  PrimaryNode,
  PipeTargetNode,
} from '../../../../types.js';
import { RuntimeError, RILL_ERROR_CODES } from '../../../../types.js';
import type { RillValue } from '../../values.js';
import { BreakSignal, ReturnSignal } from '../../signals.js';
import type { EvaluatorConstructor } from '../types.js';
import type { EvaluatorBase } from '../base.js';

/**
 * CoreMixin implementation.
 *
 * Provides main dispatch methods for expression evaluation.
 * This mixin coordinates with other mixins to provide complete evaluation.
 *
 * Depends on:
 * - EvaluatorBase: ctx, checkAborted(), getNodeLocation()
 * - ExpressionsMixin: evaluateBinaryExpr(), evaluateUnaryExpr(), evaluateGroupedExpr()
 * - LiteralsMixin: evaluateString(), evaluateDict(), evaluateTuple(), createClosure()
 * - VariablesMixin: evaluateVariable(), evaluateVariableAsync(), evaluatePipePropertyAccess(), evaluateVariableInvoke(), handleCapture()
 * - ClosuresMixin: evaluateHostCall(), evaluateClosureCall(), evaluatePipeInvoke(), evaluateClosureChain()
 * - ControlFlowMixin: evaluateConditional(), evaluateWhileLoop(), evaluateDoWhileLoop(), evaluateBlockExpression()
 * - TypesMixin: evaluateTypeAssertion(), evaluateTypeCheck()
 * - CollectionsMixin: evaluateEach(), evaluateMap(), evaluateFold(), evaluateFilter()
 * - ExtractionMixin: evaluateDestructure(), evaluateSlice(), evaluateSpread()
 *
 * Methods added:
 * - evaluateExpression(expr) -> Promise<RillValue>
 * - evaluatePipeChain(chain) -> Promise<RillValue>
 * - evaluatePostfixExpr(expr) -> Promise<RillValue>
 * - evaluatePrimary(primary) -> Promise<RillValue>
 * - evaluatePipeTarget(target, input) -> Promise<RillValue>
 * - evaluateArgs(argExprs) -> Promise<RillValue[]>
 */
function createCoreMixin(Base: EvaluatorConstructor<EvaluatorBase>) {
  return class CoreEvaluator extends Base {
    /**
     * Main expression evaluation entry point [IR-8].
     * Delegates to pipe chain evaluator.
     */
    async evaluateExpression(expr: ExpressionNode): Promise<RillValue> {
      this.checkAborted();
      return this.evaluatePipeChain(expr);
    }

    /**
     * Evaluate pipe chain with left-to-right flow [IR-9].
     *
     * Pipe chains isolate their $ value from parent scope.
     * The chain's result is returned, but $ modifications don't leak.
     *
     * Handles chain terminators:
     * - Capture: stores value and returns it
     * - Break: throws BreakSignal with value
     * - Return: throws ReturnSignal with value
     */
    async evaluatePipeChain(chain: PipeChainNode): Promise<RillValue> {
      // Save parent's $ - chains don't leak $ modifications to parent scope
      const savedPipeValue = this.ctx.pipeValue;

      // Evaluate head (can be PostfixExpr, BinaryExpr, or UnaryExpr)
      let value: RillValue;
      switch (chain.head.type) {
        case 'BinaryExpr':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          value = await (this as any).evaluateBinaryExpr(chain.head);
          break;
        case 'UnaryExpr':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          value = await (this as any).evaluateUnaryExpr(chain.head);
          break;
        case 'PostfixExpr':
          value = await this.evaluatePostfixExpr(chain.head);
          break;
      }
      this.ctx.pipeValue = value; // OK: local to this chain evaluation

      // Evaluate each pipe target in sequence
      // [IR-8: BreakSignal and ReturnSignal propagate through to caller]
      for (const target of chain.pipes) {
        // Handle inline captures (act as identity: store and pass through)
        if (target.type === 'Capture') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (this as any).handleCapture(target, value);
          // Value flows through unchanged
          continue;
        }

        value = await this.evaluatePipeTarget(target, value);
        this.ctx.pipeValue = value; // OK: flows within chain
      }

      // Handle chain terminator (capture, break, return)
      if (chain.terminator) {
        if (chain.terminator.type === 'Break') {
          // Restore parent's $ before throwing (cleanup)
          this.ctx.pipeValue = savedPipeValue;
          throw new BreakSignal(value);
        }
        if (chain.terminator.type === 'Return') {
          // Restore parent's $ before throwing (cleanup)
          this.ctx.pipeValue = savedPipeValue;
          throw new ReturnSignal(value);
        }
        // Capture
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).handleCapture(chain.terminator, value);
      }

      // Restore parent's $ - chain result is returned, but $ doesn't leak
      this.ctx.pipeValue = savedPipeValue;

      return value;
    }

    /**
     * Evaluate postfix expression: primary with method chain [IR-10].
     *
     * Example: obj.method1().method2().method3()
     * Evaluates primary, then applies each method in sequence.
     */
    async evaluatePostfixExpr(expr: PostfixExprNode): Promise<RillValue> {
      let value = await this.evaluatePrimary(expr.primary);

      for (const method of expr.methods) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        value = await (this as any).evaluateMethod(method, value);
      }

      return value;
    }

    /**
     * Evaluate primary expression [IR-11].
     *
     * Primary expressions are the atomic units of expressions:
     * - Literals (string, number, boolean, tuple, dict, closure)
     * - Variables
     * - Function calls
     * - Control flow constructs
     * - Grouped expressions
     */
    async evaluatePrimary(primary: PrimaryNode): Promise<RillValue> {
      switch (primary.type) {
        case 'StringLiteral':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateString(primary);

        case 'NumberLiteral':
          return primary.value;

        case 'BoolLiteral':
          return primary.value;

        case 'Tuple':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateTuple(primary);

        case 'Dict':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateDict(primary);

        case 'Closure':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return await (this as any).createClosure(primary);

        case 'Variable':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateVariableAsync(primary);

        case 'HostCall':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateHostCall(primary);

        case 'ClosureCall':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateClosureCall(primary);

        case 'MethodCall':
          if (this.ctx.pipeValue === null) {
            throw new RuntimeError(
              RILL_ERROR_CODES.RUNTIME_UNDEFINED_VARIABLE,
              'Undefined variable: $',
              primary.span?.start,
              { variable: '$' }
            );
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateMethod(primary, this.ctx.pipeValue);

        case 'Conditional':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateConditional(primary);

        case 'WhileLoop':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateWhileLoop(primary);

        case 'DoWhileLoop':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateDoWhileLoop(primary);

        case 'Block':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateBlockExpression(primary);

        case 'GroupedExpr':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateGroupedExpr(primary);

        case 'Spread':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateSpread(primary);

        case 'Assert':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateAssert(primary);

        case 'Error':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateError(primary);

        case 'TypeAssertion': {
          // Postfix type assertion: the operand is already evaluated
          if (!primary.operand) {
            throw new RuntimeError(
              RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
              'Postfix type assertion requires operand',
              primary.span.start
            );
          }
          const assertValue = await this.evaluatePostfixExpr(primary.operand);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateTypeAssertion(primary, assertValue);
        }

        case 'TypeCheck': {
          // Postfix type check: the operand is already evaluated
          if (!primary.operand) {
            throw new RuntimeError(
              RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
              'Postfix type check requires operand',
              primary.span.start
            );
          }
          const checkValue = await this.evaluatePostfixExpr(primary.operand);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateTypeCheck(primary, checkValue);
        }

        default:
          throw new RuntimeError(
            RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
            `Unsupported expression type: ${(primary as { type: string }).type}`,
            this.getNodeLocation(primary)
          );
      }
    }

    /**
     * Evaluate pipe target with input value [IR-12].
     *
     * Pipe targets are expressions that can receive piped values.
     * Sets $ to the input value before evaluation.
     */
    async evaluatePipeTarget(
      target: PipeTargetNode,
      input: RillValue
    ): Promise<RillValue> {
      this.ctx.pipeValue = input;

      switch (target.type) {
        case 'HostCall':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateHostCall(target);

        case 'ClosureCall':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateClosureCallWithPipe(target, input);

        case 'PipeInvoke':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluatePipeInvoke(target, input);

        case 'MethodCall':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateMethod(target, input);

        case 'Conditional':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateConditional(target);

        case 'WhileLoop':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateWhileLoop(target);

        case 'DoWhileLoop':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateDoWhileLoop(target);

        case 'Block':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateBlockExpression(target);

        case 'StringLiteral':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateString(target);

        case 'Dict':
          // Dict dispatch: lookup key matching piped value
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateDictDispatch(target, input);

        case 'GroupedExpr':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateGroupedExpr(target);

        case 'ClosureChain':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateClosureChain(target, input);

        case 'Destructure':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateDestructure(target, input);

        case 'Slice':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateSlice(target, input);

        case 'Spread':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateSpread(target);

        case 'TypeAssertion':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateTypeAssertion(target, input);

        case 'TypeCheck':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateTypeCheck(target, input);

        case 'EachExpr':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateEach(target, input);

        case 'MapExpr':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateMap(target, input);

        case 'FoldExpr':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateFold(target, input);

        case 'FilterExpr':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateFilter(target, input);

        case 'Variable':
          // $.field is property access on pipe value, not closure invocation
          if (
            target.isPipeVar &&
            !target.name &&
            target.accessChain.length > 0
          ) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (this as any).evaluatePipePropertyAccess(target, input);
          }
          // Variable in pipe chain: evaluate normally (preserves original error codes)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateVariableAsync(target);

        case 'PostfixExpr': {
          // Chained methods on pipe value: -> .a.b.c
          // The primary is implicit $ (pipe value)
          let value = input;
          for (const method of target.methods) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            value = await (this as any).evaluateMethod(method, value);
          }
          return value;
        }

        case 'Assert':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateAssert(target, input);

        case 'Error':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateError(target, input);

        default:
          throw new RuntimeError(
            RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
            `Unsupported pipe target type: ${(target as { type: string }).type}`,
            this.getNodeLocation(target)
          );
      }
    }

    /**
     * Evaluate argument expressions [IR-13].
     *
     * Evaluates arguments in order, preserving pipe value.
     * The pipe value is saved and restored so arguments don't affect it.
     */
    async evaluateArgs(argExprs: ExpressionNode[]): Promise<RillValue[]> {
      const savedPipeValue = this.ctx.pipeValue;
      const args: RillValue[] = [];
      for (const arg of argExprs) {
        args.push(await this.evaluateExpression(arg));
      }
      this.ctx.pipeValue = savedPipeValue;
      return args;
    }
  };
}

// Export with type assertion to work around TS4094 limitation
// TypeScript can't generate declarations for functions returning classes with protected members
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const CoreMixin = createCoreMixin as any;
