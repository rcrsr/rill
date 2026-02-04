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
  SourceLocation,
} from '../../../../types.js';
import { RuntimeError, RILL_ERROR_CODES } from '../../../../types.js';
import type { RillValue } from '../../values.js';
import { isTuple } from '../../values.js';
import { isCallable, isDict } from '../../callable.js';
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
     *
     * Default value handling:
     * - If method chain throws RUNTIME_UNDEFINED_METHOD and expr.defaultValue exists,
     *   evaluates and returns defaultValue instead of propagating error.
     * - RUNTIME_UNDEFINED_METHOD is thrown when accessing a missing field via .field syntax.
     * - All other errors propagate normally.
     */
    async evaluatePostfixExpr(expr: PostfixExprNode): Promise<RillValue> {
      try {
        let value = await this.evaluatePrimary(expr.primary);

        for (const method of expr.methods) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          value = await (this as any).evaluateMethod(method, value);
        }

        return value;
      } catch (error) {
        // If method chain throws RUNTIME_UNDEFINED_METHOD and defaultValue exists,
        // evaluate and return the default value
        if (
          error instanceof RuntimeError &&
          error.code === RILL_ERROR_CODES.RUNTIME_UNDEFINED_METHOD &&
          expr.defaultValue !== null
        ) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateBody(expr.defaultValue);
        }
        // All other errors propagate
        throw error;
      }
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
              'RILL-R005: Undefined variable: $',
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
          return (this as any).createBlockClosure(primary);

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

        case 'Pass':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluatePass(primary);

        case 'TypeAssertion': {
          // Postfix type assertion: the operand is already evaluated
          if (!primary.operand) {
            throw new RuntimeError(
              RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
              'RILL-R004: Postfix type assertion requires operand',
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
              'RILL-R004: Postfix type check requires operand',
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
            `RILL-R004: Unsupported expression type: ${(primary as { type: string }).type}`,
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

        case 'Block': {
          // Create block-closure then invoke with input as $
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const closure = (this as any).createBlockClosure(target);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).invokeCallable(
            closure,
            [input],
            this.getNodeLocation(target)
          );
        }

        case 'Closure': {
          // Inline closure: create and invoke
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const closure = await (this as any).createClosure(target);

          // Per closure-semantics spec: check params.length to determine invocation style
          if (closure.params.length > 0) {
            // Has params: invoke with input as first argument
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (this as any).invokeCallable(
              closure,
              [input],
              this.getNodeLocation(target)
            );
          } else {
            // Zero-param closure: invoke with args = [] and pipeValue = input
            const savedPipeValue = this.ctx.pipeValue;
            this.ctx.pipeValue = input;
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return await (this as any).invokeCallable(
                closure,
                [],
                this.getNodeLocation(target)
              );
            } finally {
              this.ctx.pipeValue = savedPipeValue;
            }
          }
        }

        case 'StringLiteral':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateString(target);

        case 'Dict': {
          // Hierarchical dispatch: detect list input (not tuple)
          if (Array.isArray(input) && !isTuple(input)) {
            // Evaluate dict literal first, then dispatch through path
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const dictValue = await (this as any).evaluateDict(target);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return await (this as any).evaluateHierarchicalDispatch(
              dictValue,
              input,
              target.defaultValue,
              this.getNodeLocation(target)
            );
          }
          // Dict dispatch: lookup key matching piped value
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateDictDispatch(target, input);
        }

        case 'Tuple': {
          // Hierarchical dispatch: detect list input (not tuple)
          if (Array.isArray(input) && !isTuple(input)) {
            // Evaluate list literal first, then dispatch through path
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const listValue = await (this as any).evaluateTuple(target);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return await (this as any).evaluateHierarchicalDispatch(
              listValue,
              input,
              target.defaultValue,
              this.getNodeLocation(target)
            );
          }
          // Tuple dispatch: index lookup matching piped value
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluateListDispatch(target, input);
        }

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

        case 'Variable': {
          // $.field is property access on pipe value, not closure invocation
          if (
            target.isPipeVar &&
            !target.name &&
            target.accessChain.length > 0
          ) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (this as any).evaluatePipePropertyAccess(target, input);
          }
          // Variable in pipe chain: evaluate and invoke if callable
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const value = await (this as any).evaluateVariableAsync(target);
          // If value is callable, invoke it with the pipe input
          // Per closure-semantics spec: check params.length to determine invocation style
          if (isCallable(value)) {
            // Check if callable has params to determine invocation style
            const hasParams =
              (value.kind === 'script' && value.params.length > 0) ||
              (value.kind === 'application' &&
                value.params !== undefined &&
                value.params.length > 0);

            if (hasParams) {
              // Block-closure: invoke with input as argument
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return (this as any).invokeCallable(
                value,
                [input],
                this.getNodeLocation(target)
              );
            } else {
              // Zero-param closure: invoke with args = [] and pipeValue = input
              const savedPipeValue = this.ctx.pipeValue;
              this.ctx.pipeValue = input;
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const result = await (this as any).invokeCallable(
                  value,
                  [],
                  this.getNodeLocation(target)
                );
                return result;
              } finally {
                this.ctx.pipeValue = savedPipeValue;
              }
            }
          }

          // Variable dispatch: if value is dict or list, dispatch into it
          // Hierarchical dispatch: detect list input (not tuple) for path navigation
          if (Array.isArray(input) && !isTuple(input)) {
            if (isDict(value) || (Array.isArray(value) && !isTuple(value))) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return await (this as any).evaluateHierarchicalDispatch(
                value,
                input,
                target.defaultValue,
                this.getNodeLocation(target)
              );
            }
          }

          if (Array.isArray(value) && !isTuple(value)) {
            // List dispatch
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return await (this as any).dispatchToList(
              value,
              input,
              target.defaultValue,
              target
            );
          }

          if (isDict(value)) {
            // Dict dispatch
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return await (this as any).dispatchToDict(
              value,
              input,
              target.defaultValue,
              target
            );
          }

          // Non-dispatchable type in pipe context - error
          const valueType =
            typeof value === 'object' && value !== null
              ? Array.isArray(value)
                ? 'tuple'
                : 'dict'
              : typeof value;
          throw RuntimeError.fromNode(
            RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
            `RILL-R002: Cannot dispatch to ${valueType}`,
            target
          );
        }

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
            `RILL-R004: Unsupported pipe target type: ${(target as { type: string }).type}`,
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

    /**
     * Navigate nested data structure using list of keys/indexes [IR-1].
     *
     * Traverses through nested dicts and lists using a path of keys/indexes.
     * Empty path returns target unchanged. Each path element dispatches to
     * current value. Terminal closures receive $ = final path key.
     *
     * @param target - Already-evaluated dict/list to navigate
     * @param path - List of keys/indexes to traverse
     * @param defaultExpr - Optional default value if path not found
     * @param location - Source location for error reporting
     * @returns Final value at path
     */
    async evaluateHierarchicalDispatch(
      target: RillValue,
      path: RillValue[],
      defaultExpr?: ExpressionNode,
      location?: SourceLocation
    ): Promise<RillValue> {
      // Target is already evaluated
      const targetValue = target;

      // Empty path returns target unchanged
      if (path.length === 0) {
        return targetValue;
      }

      try {
        // Navigate through path elements
        let current = targetValue;
        let lastKey: RillValue | undefined;

        // Traverse all elements except the last
        for (let i = 0; i < path.length - 1; i++) {
          const key = path[i];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          current = await (this as any).traversePathStep(
            current,
            key,
            false,
            location
          );
        }

        // Handle last element separately for terminal closure support
        lastKey = path[path.length - 1];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (this as any).traversePathStep(
          current,
          lastKey,
          true,
          location
        );

        // Resolve terminal value (handles terminal closures with $ = lastKey)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await (this as any).resolveTerminalValue(
          result,
          lastKey,
          location
        );
      } catch (error) {
        // Handle missing key/index errors with default value
        if (
          error instanceof RuntimeError &&
          error.code === RILL_ERROR_CODES.RUNTIME_PROPERTY_NOT_FOUND
        ) {
          if (defaultExpr) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return await (this as any).evaluateExpression(defaultExpr);
          }
          // No default - re-throw original error
          throw error;
        }
        // Type errors and other errors always propagate
        throw error;
      }
    }

    /**
     * Execute single path step: dispatch key to current value [IR-2].
     *
     * Handles type-specific dispatch:
     * - Dict + string key -> dispatchToDict
     * - List + number key -> dispatchToList
     * - Other combinations -> type error
     *
     * For non-terminal steps, closures are resolved via resolveIntermediateClosure.
     * Terminal closures are handled by caller with $ = key.
     *
     * @param current - Current value in traversal
     * @param key - Key/index to dispatch
     * @param isTerminal - Whether this is the final path element
     * @param location - Source location for error reporting
     * @returns Value at key/index
     */
    async traversePathStep(
      current: RillValue,
      key: RillValue,
      isTerminal: boolean,
      location?: SourceLocation
    ): Promise<RillValue> {
      // Dict + string key: dispatch to dict
      if (isDict(current) && typeof key === 'string') {
        // Create location-like object for dispatchToDict signature
        const locObj = {
          span: location ? { start: location, end: location } : undefined,
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (this as any).dispatchToDict(
          current,
          key,
          null, // No default value for intermediate steps
          locObj,
          true // Skip closure resolution - we handle it here
        );

        // Non-terminal closures must be resolved via resolveIntermediateClosure
        if (!isTerminal && isCallable(result)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return await (this as any).resolveIntermediateClosure(
            result,
            location
          );
        }

        // Terminal closures will be handled by evaluateHierarchicalDispatch
        return result;
      }

      // List + number key: dispatch to list
      if (
        Array.isArray(current) &&
        !isTuple(current) &&
        typeof key === 'number'
      ) {
        // Create location-like object for dispatchToList signature
        const locObj = {
          span: location ? { start: location, end: location } : undefined,
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (this as any).dispatchToList(
          current,
          key,
          null, // No default value for intermediate steps
          locObj,
          true // Skip closure resolution - we handle it here
        );

        // Non-terminal closures must be resolved via resolveIntermediateClosure
        if (!isTerminal && isCallable(result)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return await (this as any).resolveIntermediateClosure(
            result,
            location
          );
        }

        // Terminal closures will be handled by evaluateHierarchicalDispatch
        return result;
      }

      // Type mismatch: throw error
      const currentType = Array.isArray(current)
        ? isTuple(current)
          ? 'tuple'
          : 'list'
        : isDict(current)
          ? 'dict'
          : typeof current;
      const keyType = typeof key;

      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
        `RILL-R002: Hierarchical dispatch type mismatch: cannot use ${keyType} key with ${currentType} value`,
        location,
        { currentType, keyType, key }
      );
    }

    /**
     * Resolve closure encountered at non-terminal path position.
     *
     * Auto-invokes zero-param closures with args = [].
     * Throws error for parameterized closures (no args available at intermediate position).
     * Returns non-callable values unchanged.
     *
     * @param value - Value to resolve (may be callable or regular value)
     * @param location - Source location for error reporting
     * @returns Resolved value (invoked result or original value)
     * @throws RuntimeError with RUNTIME_TYPE_ERROR if parameterized closure
     */
    async resolveIntermediateClosure(
      value: RillValue,
      location?: SourceLocation
    ): Promise<RillValue> {
      if (!isCallable(value)) {
        return value;
      }

      // Check for parameterized closure (explicit user-defined params)
      // Note: Block-closures have exactly 1 param named '$'
      // Parameterized closures have 1+ params with user-defined names
      if (value.kind === 'script' && value.params.length >= 1) {
        // Check if first param is '$' (block-closure) or user-defined (parameterized)
        if (value.params[0]!.name !== '$') {
          // Parameterized closure at intermediate position: error per EC-8
          throw new RuntimeError(
            RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
            'RILL-R002: Cannot invoke parameterized closure at intermediate path position',
            location
          );
        }
      }

      // Zero-param closure or block-closure: auto-invoke with args = []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (this as any).invokeCallable(value, [], location);
    }

    /**
     * Resolve terminal value in hierarchical dispatch: auto-invoke closures with finalKey.
     * Used when navigating to a final path element.
     *
     * Behavior per IR-4:
     * - Block-closures (params.length > 0, first param is '$'): invoke with args = [finalKey]
     * - Zero-param closures: invoke with pipeValue = finalKey
     * - Parameterized closures: throw error (dispatch does not provide args)
     * - Non-callable: return unchanged
     *
     * @param value - Value at terminal path position
     * @param finalKey - Final key from path (becomes $ or first arg)
     * @param location - Source location for error reporting
     * @returns Resolved value (invoked or unchanged)
     * @throws RuntimeError with RUNTIME_TYPE_ERROR if parameterized closure
     */
    async resolveTerminalValue(
      value: RillValue,
      finalKey: RillValue,
      location?: SourceLocation
    ): Promise<RillValue> {
      if (!isCallable(value)) {
        return value;
      }

      // Check for parameterized closure (explicit user-defined params)
      // Note: Block-closures have exactly 1 param named '$'
      // Parameterized closures have 1+ params with user-defined names
      if (value.kind === 'script' && value.params.length >= 1) {
        // Check if first param is '$' (block-closure) or user-defined (parameterized)
        if (value.params[0]!.name !== '$') {
          // Parameterized closure at terminal position: error per EC-9
          throw new RuntimeError(
            RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
            'RILL-R002: Dispatch does not provide arguments for parameterized closure',
            location
          );
        }
      }

      // Check if callable has params to determine invocation style
      const hasParams =
        (value.kind === 'script' && value.params.length > 0) ||
        (value.kind === 'application' &&
          value.params !== undefined &&
          value.params.length > 0);

      if (hasParams) {
        // Block-closure or application callable with params: invoke with finalKey as argument
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await (this as any).invokeCallable(value, [finalKey], location);
      } else {
        // Zero-param closure: invoke with pipeValue = finalKey
        const savedPipeValue = this.ctx.pipeValue;
        this.ctx.pipeValue = finalKey;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await (this as any).invokeCallable(
            value,
            [],
            location
          );
          return result;
        } finally {
          this.ctx.pipeValue = savedPipeValue;
        }
      }
    }
  };
}

// Export with type assertion to work around TS4094 limitation
// TypeScript can't generate declarations for functions returning classes with protected members
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const CoreMixin = createCoreMixin as any;
