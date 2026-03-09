/**
 * ClosuresMixin: Closure and Method Invocation
 *
 * Handles all callable operations:
 * - Host function calls
 * - Closure calls (script callables)
 * - Method calls on values
 * - Invoke operations
 * - Pipe invocations
 * - Property access on piped values
 *
 * Interface requirements (from spec):
 * - invokeCallable(callable, args, location) -> Promise<RillValue>
 * - evaluateHostCall(node) -> Promise<RillValue>
 * - evaluateClosureCall(node) -> Promise<RillValue>
 * - evaluateClosureCallWithPipe(node, pipeInput) -> Promise<RillValue>
 * - evaluatePipePropertyAccess(node, pipeInput) -> Promise<RillValue>
 * - evaluateVariableInvoke(node, pipeInput) -> Promise<RillValue>
 * - evaluatePipeInvoke(node, input) -> Promise<RillValue>
 * - evaluateMethod(node, receiver) -> Promise<RillValue>
 * - evaluateInvoke(node, receiver) -> Promise<RillValue>
 *
 * Error Handling:
 * - Undefined functions throw RuntimeError(RUNTIME_UNDEFINED_FUNCTION) [EC-18]
 * - Undefined methods throw RuntimeError(RUNTIME_UNDEFINED_METHOD) [EC-19]
 * - Parameter type mismatches throw RuntimeError(RUNTIME_TYPE_ERROR) [EC-20]
 * - Async operations timeout per TimeoutError [EC-21]
 *
 * ## Implementation Notes
 *
 * [DEVIATION] Function naming: Spec references validateHostFunctionArgs but implementation
 * uses validateCallableArgs because ApplicationCallable stores CallableParam[] (not
 * HostFunctionParam[]). The two interfaces have different type field names ('type' vs
 * 'typeName'). Separate validation functions maintain proper abstraction boundaries.
 *
 * [ASSUMPTION] Excess argument validation occurs before default application to fail fast
 * on arity mismatches, improving error messages. This matches the algorithm order in the
 * spec where excess check happens first.
 *
 * [ASSUMPTION] boundDict substitution happens before validation for property-style
 * callables to ensure type checks apply to the effective arguments (including bound dict).
 * This prevents validation bypass when property-style callables are accessed.
 *
 * @internal
 */

import type {
  HostCallNode,
  HostRefNode,
  ClosureCallNode,
  MethodCallNode,
  InvokeNode,
  PipeInvokeNode,
  VariableNode,
  SourceLocation,
  ExpressionNode,
  SpreadArgNode,
  BlockNode,
} from '../../../../types.js';
import { RuntimeError } from '../../../../types.js';
import type {
  RillCallable,
  ScriptCallable,
  RuntimeCallable,
  ApplicationCallable,
  CallableParam,
} from '../../callable.js';
import {
  isCallable,
  isScriptCallable,
  isApplicationCallable,
  isDict,
  validateCallableArgs,
  paramsToStructuralType,
} from '../../callable.js';
import { getVariable, pushCallFrame, popCallFrame } from '../../context.js';
import type { RuntimeContext } from '../../types.js';
import type { RillValue, RillTypeValue } from '../../values.js';
import {
  inferType,
  isTypeValue,
  isTuple,
  isOrdered,
  createOrdered,
  inferStructuralType,
  structuralTypeMatches,
  formatStructuralType,
} from '../../values.js';
import type { EvaluatorConstructor } from '../types.js';
import type { EvaluatorBase } from '../base.js';
import type { CallFrame } from '../../../../types.js';

/**
 * Result of bindArgsToParams: parameter names mapped to evaluated values.
 * @internal
 */
interface BoundArgs {
  readonly params: Map<string, RillValue>;
}

/**
 * ClosuresMixin implementation.
 *
 * Evaluates callable operations: host functions, closures, methods, invocations.
 * Handles parameter binding, type checking, and callable contexts.
 *
 * Depends on:
 * - EvaluatorBase: ctx, checkAborted(), getNodeLocation(), withTimeout()
 * - evaluateExpression() (from future CoreMixin composition)
 * - evaluateBodyExpression() (from ControlFlowMixin)
 *
 * Methods added:
 * - invokeCallable(callable, args, location) -> Promise<RillValue>
 * - evaluateHostCall(node) -> Promise<RillValue>
 * - evaluateClosureCall(node) -> Promise<RillValue>
 * - evaluateClosureCallWithPipe(node, pipeInput) -> Promise<RillValue>
 * - evaluatePipePropertyAccess(node, pipeInput) -> Promise<RillValue>
 * - evaluateVariableInvoke(node, pipeInput) -> Promise<RillValue>
 * - evaluatePipeInvoke(node, input) -> Promise<RillValue>
 * - evaluateMethod(node, receiver) -> Promise<RillValue>
 * - evaluateInvoke(node, receiver) -> Promise<RillValue>
 * - evaluateArgs(argExprs) -> Promise<RillValue[]> (helper)
 * - invokeFnCallable(callable, args, location) -> Promise<RillValue> (helper)
 * - invokeScriptCallable(callable, args, location) -> Promise<RillValue> (helper)
 * - createCallableContext(callable) -> RuntimeContext (helper)
 * - validateParamType(param, value, location) -> void (helper)
 * - inferTypeFromDefault(defaultValue) -> RillTypeName | null (helper)
 * - bindArgsToParams(argNodes, callable, callLocation) -> Promise<BoundArgs> (helper)
 */
function createClosuresMixin(Base: EvaluatorConstructor<EvaluatorBase>) {
  return class ClosuresEvaluator extends Base {
    /**
     * Evaluate argument expressions while preserving the current pipeValue.
     * Used by all callable invocations to prepare arguments.
     */
    protected async evaluateArgs(
      argExprs: (ExpressionNode | SpreadArgNode)[]
    ): Promise<RillValue[]> {
      const savedPipeValue = this.ctx.pipeValue;
      const args: RillValue[] = [];
      for (const arg of argExprs) {
        const expr = arg.type === 'SpreadArg' ? arg.expression : arg;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        args.push(await (this as any).evaluateExpression(expr));
      }
      this.ctx.pipeValue = savedPipeValue;
      return args;
    }

    /**
     * Invoke any callable (host function, script closure, runtime function).
     * Dispatches to appropriate invocation method based on callable kind.
     */
    protected async invokeCallable(
      callable: RillCallable,
      args: RillValue[],
      callLocation?: SourceLocation,
      functionName?: string
    ): Promise<RillValue> {
      this.checkAborted();

      // Push call frame before invocation (IR-2, IC-9)
      // Call stack captures the call site location, not the function body location
      if (callLocation) {
        const name =
          functionName ??
          (callable.kind === 'script' ? '<closure>' : '<callable>');
        const frame: CallFrame = {
          location: {
            start: callLocation,
            end: callLocation,
          },
          functionName: name,
        };
        pushCallFrame(this.ctx, frame);
      }

      try {
        if (callable.kind === 'script') {
          return await this.invokeScriptCallable(callable, args, callLocation);
        } else {
          return await this.invokeFnCallable(
            callable,
            args,
            callLocation,
            functionName
          );
        }
      } finally {
        // Pop call frame after invocation completes (IR-3)
        // Ensure pop happens even on error paths
        if (callLocation) {
          popCallFrame(this.ctx);
        }
      }
    }

    /**
     * Invoke runtime or application callable (native functions).
     * Handles bound dict for property-style callables.
     * Validates typed ApplicationCallable arguments before invocation.
     */
    protected async invokeFnCallable(
      callable: RuntimeCallable | ApplicationCallable,
      args: RillValue[],
      callLocation?: SourceLocation,
      functionName = 'callable'
    ): Promise<RillValue> {
      // Apply boundDict BEFORE validation (property-style callables need dict as first arg)
      const effectiveArgs =
        callable.boundDict && args.length === 0 ? [callable.boundDict] : args;

      // Validate arguments for typed ApplicationCallable (task 1.5)
      // Only validate if callable has params metadata (not undefined)
      // ApplicationCallable from HostFunctionDefinition: params is CallableParam[] (may be empty for zero-arg functions)
      // ApplicationCallable from callable(): params is undefined (untyped, skip validation)
      if (isApplicationCallable(callable) && callable.params !== undefined) {
        // Validate with effective args (validates count, applies defaults, checks types)
        validateCallableArgs(
          effectiveArgs,
          callable.params,
          functionName,
          callLocation
        );
      }

      const result = callable.fn(effectiveArgs, this.ctx, callLocation);
      return result instanceof Promise ? await result : result;
    }

    /**
     * Create callable context for script closure invocation.
     * Sets up parent scope for late-bound variable resolution.
     */
    protected createCallableContext(callable: ScriptCallable): RuntimeContext {
      // Create a child context with the defining scope as parent
      // This enables late-bound variable resolution through the scope chain

      // Determine initial pipeValue:
      // - Zero-param closures (||{ ... }): inherit from caller (for dict dispatch)
      // - Explicit-param closures (|a,b|{ ... }): clear to prevent leakage
      // - boundDict always overrides
      const hasExplicitParams =
        callable.params.length > 0 && callable.params[0]!.name !== '$';

      const callableCtx: RuntimeContext = {
        ...this.ctx,
        parent: callable.definingScope as RuntimeContext,
        variables: new Map(),
        variableTypes: new Map(),
        pipeValue: hasExplicitParams ? null : this.ctx.pipeValue,
      };

      if (callable.boundDict) {
        callableCtx.pipeValue = callable.boundDict;
      }

      return callableCtx;
    }

    /**
     * Infer type from default value for parameter type checking.
     */
    protected inferTypeFromDefault(
      defaultValue: RillValue | null
    ): 'string' | 'number' | 'bool' | null {
      if (defaultValue === null) return null;
      const t = inferType(defaultValue);
      return t === 'string' || t === 'number' || t === 'bool' ? t : null;
    }

    /**
     * Validate parameter type against actual value.
     * Throws RuntimeError on type mismatch.
     */
    protected validateParamType(
      param: CallableParam,
      value: RillValue,
      callLocation?: SourceLocation
    ): void {
      // IR-4: Structural dispatch — use typeStructure when sub-fields present
      if (param.typeStructure !== undefined) {
        const ts = param.typeStructure;
        const hasSubFields =
          'element' in ts ||
          'fields' in ts ||
          'elements' in ts ||
          'members' in ts ||
          'params' in ts ||
          'ret' in ts;
        if (hasSubFields) {
          if (!structuralTypeMatches(value, ts)) {
            throw new RuntimeError(
              'RILL-R001',
              `Parameter type mismatch: ${param.name} expects ${formatStructuralType(ts)}, got ${formatStructuralType(inferStructuralType(value))}`,
              callLocation,
              {
                paramName: param.name,
                expectedType: formatStructuralType(ts),
                actualType: formatStructuralType(inferStructuralType(value)),
              }
            );
          }
          return;
        }
      }

      // Backward-compatible leaf type check
      const expectedType =
        param.typeName ?? this.inferTypeFromDefault(param.defaultValue);
      if (expectedType === 'any') return;
      if (expectedType !== null) {
        const valueType = inferType(value);
        if (valueType !== expectedType) {
          throw new RuntimeError(
            'RILL-R001',
            `Parameter type mismatch: ${param.name} expects ${expectedType}, got ${valueType}`,
            callLocation,
            { paramName: param.name, expectedType, actualType: valueType }
          );
        }
      }
    }

    /**
     * Invoke script callable with positional arguments.
     * Handles parameter binding, default values, and type checking.
     */
    protected async invokeScriptCallable(
      callable: ScriptCallable,
      args: RillValue[],
      callLocation?: SourceLocation
    ): Promise<RillValue> {
      const callableCtx = this.createCallableContext(callable);

      // Validate excess arguments (EC-8)
      if (args.length > callable.params.length) {
        throw new RuntimeError(
          'RILL-R001',
          `Function expects ${callable.params.length} arguments, got ${args.length}`,
          callLocation
        );
      }

      for (let i = 0; i < callable.params.length; i++) {
        const param = callable.params[i]!;
        let value: RillValue;

        if (i < args.length) {
          value = args[i]!;
        } else if (param.defaultValue !== null) {
          value = param.defaultValue;
        } else {
          throw new RuntimeError(
            'RILL-R001',
            `Missing argument for parameter '${param.name}' at position ${i}`,
            callLocation,
            { paramName: param.name, position: i }
          );
        }

        this.validateParamType(param, value, callLocation);
        callableCtx.variables.set(param.name, value);
        // Block-closures have param named '$': sync with pipeValue for bare $ references
        if (param.name === '$') {
          callableCtx.pipeValue = value;
        }
      }

      // EC-1: Reject empty block bodies before execution (AC-17)
      if (
        callable.body.type === 'Block' &&
        (callable.body as BlockNode).statements.length === 0
      ) {
        throw new RuntimeError(
          'RILL-R043',
          'Closure body produced no value',
          callLocation,
          { context: 'Closure body' }
        );
      }

      // Switch context to callable context
      const savedCtx = this.ctx;
      this.ctx = callableCtx;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (this as any).evaluateBodyExpression(
          callable.body
        );
        // IR-4: Assert return value against declared returnShape (AC-14, AC-15, AC-16)
        if (callable.returnShape !== undefined) {
          // EC-4: Type assertion — value must match the declared scalar type
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (this as any).assertType(
            result,
            callable.returnShape.structure,
            callLocation
          );
        }
        return result;
      } finally {
        this.ctx = savedCtx;
      }
    }

    /**
     * Evaluate host function call: functionName(args)
     * Looks up function in context and invokes it.
     */
    protected async evaluateHostCall(node: HostCallNode): Promise<RillValue> {
      this.checkAborted(node);

      const fn = this.ctx.functions.get(node.name);
      if (!fn) {
        throw new RuntimeError(
          'RILL-R006',
          `Unknown function: ${node.name}`,
          this.getNodeLocation(node),
          { functionName: node.name }
        );
      }

      // EC-10/EC-11: spread-aware path for host calls
      const hasSpread = node.args.some((a) => a.type === 'SpreadArg');
      if (hasSpread) {
        if (typeof fn === 'function') {
          // EC-10: raw built-in (RuntimeCallable) — spread not supported
          throw new RuntimeError(
            'RILL-R001',
            `Spread not supported for built-in function '${node.name}'`,
            this.getNodeLocation(node),
            { functionName: node.name }
          );
        }
        // EC-11: ApplicationCallable — bindArgsToParams handles no-params guard
        const boundArgs = await this.bindArgsToParams(
          node.args,
          fn,
          node.span.start
        );
        const orderedArgs = fn.params!.map(
          (p) => boundArgs.params.get(p.name)!
        );

        // Observability: onHostCall before execution
        this.ctx.observability.onHostCall?.({
          name: node.name,
          args: orderedArgs,
        });

        const startTime = performance.now();
        const wrappedPromise = this.withTimeout(
          this.invokeCallable(fn, orderedArgs, node.span.start, node.name),
          this.ctx.timeout,
          node.name,
          node
        );
        const result = await wrappedPromise;
        const durationMs = performance.now() - startTime;
        this.ctx.observability.onFunctionReturn?.({
          name: node.name,
          value: result,
          durationMs,
        });
        return result;
      }

      const args = await this.evaluateArgs(node.args);

      // Add pipe value to empty args list UNLESS function has typed params with length 0
      // (typed functions with params: [] explicitly declare zero parameters)
      if (args.length === 0 && this.ctx.pipeValue !== null) {
        const fnHasTypedZeroParams =
          typeof fn === 'object' &&
          'params' in fn &&
          fn.params !== undefined &&
          fn.params.length === 0;
        if (!fnHasTypedZeroParams) {
          args.push(this.ctx.pipeValue);
        }
      }

      // Observability: onHostCall before execution
      this.ctx.observability.onHostCall?.({ name: node.name, args });

      const startTime = performance.now();

      // Use invokeCallable for consistent validation, invocation, and call stack management
      const wrappedPromise = this.withTimeout(
        (async () => {
          // Handle both CallableFn and ApplicationCallable
          if (typeof fn === 'function') {
            // Raw CallableFn - wrap in minimal callable and invoke through invokeCallable
            const callable: RuntimeCallable = {
              __type: 'callable' as const,
              kind: 'runtime' as const,
              fn,
              isProperty: false,
            };
            return this.invokeCallable(
              callable,
              args,
              node.span.start,
              node.name
            );
          } else {
            // ApplicationCallable - use invokeCallable for validation and call stack
            return this.invokeCallable(fn, args, node.span.start, node.name);
          }
        })(),
        this.ctx.timeout,
        node.name,
        node
      );

      const result = await wrappedPromise;
      const durationMs = performance.now() - startTime;

      // Observability: onFunctionReturn after execution
      this.ctx.observability.onFunctionReturn?.({
        name: node.name,
        value: result,
        durationMs,
      });

      return result;
    }

    /**
     * Evaluate host function reference: ns::name (no parens, namespaced).
     *
     * When pipeValue is null (value-capture context): returns the
     * ApplicationCallable directly without invoking [IR-4].
     *
     * When pipeValue is set (pipe/branch context): invokes the callable
     * with the pipe value as the implicit argument, consistent with how
     * bare HostRef behaves as a pipe-stage expression [IR-4].
     *
     * Throws RILL-R006 when the function name is not registered [EC-4].
     */
    protected async evaluateHostRef(node: HostRefNode): Promise<RillValue> {
      this.checkAborted(node);

      const fn = this.ctx.functions.get(node.name);
      if (!fn) {
        throw new RuntimeError(
          'RILL-R006',
          `Function "${node.name}" not found`,
          this.getNodeLocation(node),
          { functionName: node.name }
        );
      }

      // Build ApplicationCallable wrapper for raw CallableFn; pass through
      // ApplicationCallable objects directly.
      let appCallable: ApplicationCallable;
      if (typeof fn === 'function') {
        appCallable = {
          __type: 'callable' as const,
          kind: 'application' as const,
          fn,
          params: undefined,
          isProperty: false,
        };
      } else {
        appCallable = fn;
      }

      // Value-capture context: no pipe value → return callable without invoking [IR-4]
      if (this.ctx.pipeValue === null) {
        return appCallable as RillValue;
      }

      // Pipe/branch context: pipe value present → invoke with it as implicit argument
      const fnHasTypedZeroParams =
        appCallable.params !== undefined && appCallable.params.length === 0;
      const args: RillValue[] = fnHasTypedZeroParams
        ? []
        : [this.ctx.pipeValue];
      return this.invokeCallable(
        appCallable,
        args,
        this.getNodeLocation(node),
        node.name
      );
    }

    /**
     * Evaluate closure call: $fn(args)
     * Delegates to evaluateClosureCallWithPipe using current pipe value.
     */
    protected async evaluateClosureCall(
      node: ClosureCallNode
    ): Promise<RillValue> {
      return this.evaluateClosureCallWithPipe(node, this.ctx.pipeValue);
    }

    /**
     * Evaluate closure call with pipe input: value -> $fn(args)
     * Supports access chains like $math.double(args).
     */
    protected async evaluateClosureCallWithPipe(
      node: ClosureCallNode,
      pipeInput: RillValue
    ): Promise<RillValue> {
      // Get the base variable
      let value: RillValue | undefined = getVariable(this.ctx, node.name);
      if (value === undefined || value === null) {
        throw new RuntimeError(
          'RILL-R005',
          `Unknown variable: $${node.name}`,
          this.getNodeLocation(node),
          { variableName: node.name }
        );
      }

      // Traverse accessChain to get the closure (e.g., $math.double)
      const fullPath = ['$' + node.name, ...node.accessChain].join('.');
      for (const prop of node.accessChain) {
        if (value === null) {
          throw new RuntimeError(
            'RILL-R009',
            `Cannot access property '${prop}' on null`,
            this.getNodeLocation(node)
          );
        }
        if (isDict(value)) {
          value = (value as Record<string, RillValue>)[prop];
          if (value === undefined || value === null) {
            throw new RuntimeError(
              'RILL-R009',
              `Dict has no field '${prop}'`,
              this.getNodeLocation(node)
            );
          }
        } else {
          throw new RuntimeError(
            'RILL-R002',
            `Cannot access property on non-dict value at '${fullPath}'`,
            this.getNodeLocation(node)
          );
        }
      }

      if (!isCallable(value)) {
        throw new RuntimeError(
          'RILL-R002',
          `'${fullPath}' is not callable`,
          this.getNodeLocation(node),
          { path: fullPath, actualType: inferType(value) }
        );
      }

      const closure = value;

      // Spread-aware path: when args contain a SpreadArgNode use bindArgsToParams
      if (node.args.some((a) => a.type === 'SpreadArg')) {
        if (!isScriptCallable(closure) && !isApplicationCallable(closure)) {
          throw new RuntimeError(
            'RILL-R001',
            `Spread not supported for built-in callable at '${fullPath}'`,
            this.getNodeLocation(node)
          );
        }
        const boundArgs = await this.bindArgsToParams(
          node.args,
          closure,
          node.span.start
        );
        const orderedArgs = closure.params!.map(
          (p) => boundArgs.params.get(p.name)!
        );
        return this.invokeCallable(
          closure,
          orderedArgs,
          node.span.start,
          fullPath
        );
      }

      const args = await this.evaluateArgs(node.args);

      // If no explicit args and has pipe input, add pipe value as first arg
      // UNLESS closure has zero parameters (explicit zero-param signature)
      if (args.length === 0 && pipeInput !== null) {
        const closureHasZeroParams =
          (isScriptCallable(closure) && closure.params.length === 0) ||
          (isApplicationCallable(closure) &&
            closure.params !== undefined &&
            closure.params.length === 0);
        if (!closureHasZeroParams) {
          args.push(pipeInput);
        }
      }

      return this.invokeCallable(closure, args, node.span.start, fullPath);
    }

    /**
     * Evaluate $.field as property access on the pipe value.
     * This allows -> $.a to access property 'a' of the current pipe value.
     */
    protected async evaluatePipePropertyAccess(
      node: VariableNode,
      pipeInput: RillValue
    ): Promise<RillValue> {
      let value = pipeInput;

      for (const access of node.accessChain) {
        if (value === null) {
          throw new RuntimeError(
            'RILL-R009',
            `Cannot access property on null`,
            this.getNodeLocation(node)
          );
        }

        // Check if this is a bracket access (has accessKind discriminator)
        if ('accessKind' in access) {
          // bracket access - delegate to evaluateVariableAsync
          // (Not in scope for this mixin - will be handled by VariablesMixin)
          throw new RuntimeError(
            'RILL-R002',
            'Bracket access not supported in this context',
            this.getNodeLocation(node)
          );
        }

        // Must be a FieldAccess (literal, variable, computed, block, alternatives)
        // TypeScript now knows access is FieldAccess due to discriminated union
        if (access.kind === 'literal') {
          const field = access.field;
          value = await this.accessDictField(
            value,
            field,
            this.getNodeLocation(node)
          );
        } else {
          // Other field access types (variable, computed, block, alternatives)
          // are handled by VariablesMixin
          throw new RuntimeError(
            'RILL-R002',
            `Field access kind '${access.kind}' not supported in this context`,
            this.getNodeLocation(node)
          );
        }
      }

      // Handle default value from VariableNode (not PropertyAccess)
      if (value === null && node.defaultValue) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        value = await (this as any).evaluateExpression(node.defaultValue);
      }

      return value;
    }

    /**
     * Evaluate variable invocation with pipe: value -> $var
     * If variable is callable, invokes it with pipe value.
     */
    protected async evaluateVariableInvoke(
      node: PipeInvokeNode,
      _pipeInput: RillValue
    ): Promise<RillValue> {
      // NOTE: This method signature in spec doesn't match usage pattern.
      // PipeInvokeNode is for -> (args) syntax, not variable invocation.
      // The actual variable invoke logic is in evaluateVariableAsync (VariablesMixin).
      // This stub satisfies the spec interface but delegates to correct implementation.
      throw new RuntimeError(
        'RILL-R002',
        'evaluateVariableInvoke is a placeholder - use evaluateVariableAsync from VariablesMixin',
        this.getNodeLocation(node)
      );
    }

    /**
     * Evaluate pipe invoke: value -> (args)
     * Calls the input value as a closure with the given arguments.
     */
    protected async evaluatePipeInvoke(
      node: PipeInvokeNode,
      input: RillValue
    ): Promise<RillValue> {
      if (!isScriptCallable(input)) {
        throw new RuntimeError(
          'RILL-R002',
          `Cannot invoke non-closure value (got ${typeof input})`,
          this.getNodeLocation(node)
        );
      }

      // Spread-aware path: when args contain a SpreadArgNode use bindArgsToParams
      if (node.args.some((a) => a.type === 'SpreadArg')) {
        const boundArgs = await this.bindArgsToParams(
          node.args,
          input,
          node.span.start
        );
        const orderedArgs = input.params.map(
          (p) => boundArgs.params.get(p.name)!
        );
        return this.invokeScriptCallable(input, orderedArgs, node.span.start);
      }

      const args = await this.evaluateArgs(node.args);

      return this.invokeScriptCallable(input, args, node.span.start);
    }

    /**
     * Evaluate method call on receiver: value.method(args)
     * Handles both built-in methods and dict-bound callables.
     */
    protected async evaluateMethod(
      node: MethodCallNode | InvokeNode,
      receiver: RillValue
    ): Promise<RillValue> {
      this.checkAborted(node);

      // Handle postfix invocation: expr(args) - calls receiver as a closure
      if (node.type === 'Invoke') {
        return this.evaluateInvoke(node, receiver);
      }

      if (isCallable(receiver)) {
        throw new RuntimeError(
          'RILL-R003',
          `Method .${node.name} not available on callable (invoke with -> $() first)`,
          this.getNodeLocation(node),
          { methodName: node.name, receiverType: 'callable' }
        );
      }

      // IR-3: .name on type values returns the typeName string (method path)
      // IR-4: .signature on type values returns formatStructuralType(structure)
      if (isTypeValue(receiver)) {
        if (node.name === 'name') {
          return receiver.typeName;
        }
        if (node.name === 'signature') {
          return formatStructuralType(receiver.structure);
        }
      }

      const args = await this.evaluateArgs(node.args);

      if (isDict(receiver)) {
        const dictValue = receiver[node.name];
        if (dictValue !== undefined && isCallable(dictValue)) {
          return this.invokeCallable(
            dictValue,
            args,
            this.getNodeLocation(node),
            node.name
          );
        }
      }

      const method = this.ctx.methods.get(node.name);
      if (!method) {
        // Fall back to property access on dict (no-arg only)
        if (isDict(receiver) && args.length === 0 && node.name in receiver) {
          return receiver[node.name] as RillValue;
        }
        // EC-5: Unknown dot property on type value raises RILL-R009
        if (isTypeValue(receiver)) {
          throw new RuntimeError(
            'RILL-R009',
            `Property '${node.name}' not found on type value (available: name, signature)`,
            this.getNodeLocation(node),
            { property: node.name, type: 'type value' }
          );
        }
        throw new RuntimeError(
          'RILL-R007',
          `Unknown method: ${node.name}`,
          this.getNodeLocation(node),
          { methodName: node.name }
        );
      }

      const result = method(
        receiver,
        args,
        this.ctx,
        this.getNodeLocation(node)
      );
      return result instanceof Promise ? await result : result;
    }

    /**
     * Evaluate postfix invocation: expr(args)
     * Calls the receiver value as a closure with the given arguments.
     */
    protected async evaluateInvoke(
      node: InvokeNode,
      receiver: RillValue
    ): Promise<RillValue> {
      if (!isCallable(receiver)) {
        throw new RuntimeError(
          'RILL-R002',
          `Cannot invoke non-callable value (got ${inferType(receiver)})`,
          this.getNodeLocation(node),
          { actualType: inferType(receiver) }
        );
      }

      // Spread-aware path: when args contain a SpreadArgNode use bindArgsToParams
      if (node.args.some((a) => a.type === 'SpreadArg')) {
        if (!isScriptCallable(receiver) && !isApplicationCallable(receiver)) {
          throw new RuntimeError(
            'RILL-R001',
            `Spread not supported for built-in callable`,
            this.getNodeLocation(node)
          );
        }
        const boundArgs = await this.bindArgsToParams(
          node.args,
          receiver,
          node.span.start
        );
        const orderedArgs = receiver.params!.map(
          (p) => boundArgs.params.get(p.name)!
        );
        return this.invokeCallable(receiver, orderedArgs, node.span.start);
      }

      const args = await this.evaluateArgs(node.args);
      return this.invokeCallable(receiver, args, this.getNodeLocation(node));
    }

    /**
     * Evaluate annotation reflection access: .^key
     * Resolves annotation metadata from ScriptCallable values.
     *
     * Only ScriptCallable values support annotation reflection.
     * Throws RUNTIME_TYPE_ERROR for non-closure targets.
     * Throws RUNTIME_UNDEFINED_ANNOTATION for missing annotations.
     */
    protected async evaluateAnnotationAccess(
      value: RillValue,
      key: string,
      location: SourceLocation
    ): Promise<RillValue> {
      // IR-2: .^type returns a RillTypeValue for any rill value
      if (key === 'type') {
        const typeValue: RillTypeValue = Object.freeze({
          __rill_type: true as const,
          typeName: inferType(value),
          structure: inferStructuralType(value),
        });
        return typeValue;
      }

      // IR-5: .^name on type values raises RILL-R008 (type values are not annotation containers)
      if (isTypeValue(value) && key === 'name') {
        throw new RuntimeError(
          'RILL-R008',
          `Annotation access not supported on type values`,
          location,
          { annotationKey: key }
        );
      }

      // IR-2/IR-5: .^input returns the input shape for callable values
      // Params are converted from internal tuples to RillOrdered so the
      // value survives rill's homogeneous-list constraint.
      if (key === 'input') {
        if (isScriptCallable(value)) {
          const shape = value.inputShape;
          if (shape.type === 'closure') {
            return {
              type: shape.type,
              params: createOrdered(shape.params as [string, RillValue][]),
              ret:
                value.returnShape !== undefined
                  ? (value.returnShape as RillTypeValue).structure
                  : shape.ret,
            } as unknown as RillValue;
          }
          return shape as unknown as RillValue;
        }
        if (isApplicationCallable(value)) {
          if (value.params === undefined) {
            // IR-5: untyped host function — no shape available
            return false;
          }
          const shape = paramsToStructuralType(value.params);
          if (shape.type === 'closure') {
            return {
              type: shape.type,
              params: createOrdered(shape.params as [string, RillValue][]),
              ret: shape.ret,
            } as unknown as RillValue;
          }
          return shape as unknown as RillValue;
        }
        // Non-callable: fall through to existing RILL-R003 guard below
      }

      // IR-3: .^output returns the declared output contract for callable values
      if (key === 'output') {
        if (isScriptCallable(value)) {
          if (value.returnShape !== undefined) {
            return value.returnShape;
          }
          // No :type-target declared — return type value `any` (AC-17, AC-18, AC-19)
          const anyTypeValue: RillTypeValue = Object.freeze({
            __rill_type: true as const,
            typeName: 'any',
            structure: { type: 'any' as const },
          });
          return anyTypeValue;
        }
        // Non-callable: fall through to existing RILL-R003 guard below
      }

      // Only ScriptCallable supports annotation reflection
      if (!isScriptCallable(value)) {
        throw new RuntimeError(
          'RILL-R003',
          `annotation not found: ^${key}`,
          location,
          { actualType: inferType(value) }
        );
      }

      // Access annotation from ScriptCallable
      const annotationValue = value.annotations[key];

      // Throw if annotation not found (caller handles ?? coalescing)
      if (annotationValue === undefined) {
        throw new RuntimeError(
          'RILL-R008',
          `Annotation '${key}' not found`,
          location,
          { annotationKey: key }
        );
      }

      return annotationValue;
    }

    /**
     * Bind argument nodes to callable parameters when a SpreadArgNode is present.
     *
     * Evaluates positional args LTR, evaluates the spread expression, dispatches
     * by value type (Tuple, Ordered, or Dict), validates bindings, and returns
     * a Map of param name → value.
     *
     * EC-3: bare ... with null pipe value → RuntimeError
     * EC-4: spread value is not tuple/dict/ordered → RuntimeError
     * EC-5: dict spread key matches no parameter → RuntimeError
     * EC-6: ordered spread key at position N mismatches param at position N → RuntimeError
     * EC-7: duplicate binding (positional + spread) → RuntimeError
     * EC-8: missing required parameter after all args processed → RuntimeError
     * EC-9: extra tuple values exceed param count → RuntimeError
     * EC-11: ApplicationCallable with no params metadata → RuntimeError
     */
    protected async bindArgsToParams(
      argNodes: (ExpressionNode | SpreadArgNode)[],
      callable: ScriptCallable | ApplicationCallable,
      callLocation: SourceLocation
    ): Promise<BoundArgs> {
      // EC-11: ApplicationCallable must have params metadata for spread to work
      if (callable.kind === 'application' && callable.params === undefined) {
        const name = callable.fn.name !== '' ? callable.fn.name : '<anonymous>';
        throw new RuntimeError(
          'RILL-R001',
          `Spread not supported for host function '${name}': parameter metadata required`,
          callLocation
        );
      }

      const params =
        callable.params as import('../../callable.js').CallableParam[];
      const bound = new Map<string, RillValue>();

      // Positional index: next unbound parameter position
      let positionalIndex = 0;

      // Save pipe value so evaluating args does not mutate it permanently
      const savedPipeValue = this.ctx.pipeValue;

      try {
        for (const argNode of argNodes) {
          if (argNode.type !== 'SpreadArg') {
            // Positional argument
            const param = params[positionalIndex];
            if (param === undefined) {
              // Extra positional arg beyond param count — EC-9 reports after spread
              // but for pure positional excess, error here with the positional count
              throw new RuntimeError(
                'RILL-R001',
                `Extra positional argument at position ${positionalIndex} (function has ${params.length} parameters)`,
                callLocation
              );
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const value = await (this as any).evaluateExpression(argNode);
            bound.set(param.name, value);
            positionalIndex++;
          } else {
            // SpreadArg: evaluate the expression
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const spreadValue = await (this as any).evaluateExpression(
              argNode.expression
            );

            // EC-3: bare ... with no pipe value evaluates to null
            if (spreadValue === null) {
              throw new RuntimeError(
                'RILL-R001',
                'Spread requires an active pipe value ($)',
                callLocation
              );
            }

            // Dispatch by type: isOrdered BEFORE isDict per spec (IC-3 algorithm step 2)
            if (isTuple(spreadValue)) {
              // Tuple: fill remaining params positionally LTR (EC-9)
              const tupleEntries = spreadValue.entries;
              const remaining = params.length - positionalIndex;
              if (tupleEntries.length > remaining) {
                throw new RuntimeError(
                  'RILL-R001',
                  `Spread tuple has ${tupleEntries.length} values but only ${remaining} parameter(s) remain`,
                  callLocation
                );
              }
              for (let i = 0; i < tupleEntries.length; i++) {
                const param = params[positionalIndex + i]!;
                // EC-7: duplicate binding
                if (bound.has(param.name)) {
                  throw new RuntimeError(
                    'RILL-R001',
                    `Duplicate binding for parameter '${param.name}': already bound positionally`,
                    callLocation
                  );
                }
                bound.set(param.name, tupleEntries[i]!);
              }
              positionalIndex += tupleEntries.length;
            } else if (isOrdered(spreadValue)) {
              // Ordered: match key by name AND position
              // Key at position N within ordered value must match param at (spreadStart + N)
              const orderedEntries = spreadValue.entries;
              for (let i = 0; i < orderedEntries.length; i++) {
                const [key, value] = orderedEntries[i]!;
                const expectedParam = params[positionalIndex + i];
                // EC-6: key-order mismatch
                if (expectedParam === undefined || expectedParam.name !== key) {
                  const expectedName = expectedParam?.name ?? '<none>';
                  throw new RuntimeError(
                    'RILL-R001',
                    `Ordered spread key '${key}' at position ${i} does not match expected parameter '${expectedName}' at position ${positionalIndex + i}`,
                    callLocation
                  );
                }
                // EC-7: duplicate binding
                if (bound.has(key)) {
                  throw new RuntimeError(
                    'RILL-R001',
                    `Duplicate binding for parameter '${key}': already bound positionally`,
                    callLocation
                  );
                }
                bound.set(key, value);
              }
              positionalIndex += orderedEntries.length;
            } else if (isDict(spreadValue)) {
              // Dict: match each key to param by name (order irrelevant)
              const dictValue = spreadValue as Record<string, RillValue>;
              const paramNames = new Set(params.map((p) => p.name));
              for (const [key, value] of Object.entries(dictValue)) {
                // EC-5: key matches no parameter
                if (!paramNames.has(key)) {
                  const validParams = params.map((p) => p.name).join(', ');
                  throw new RuntimeError(
                    'RILL-R001',
                    `Dict spread key '${key}' does not match any parameter. Valid parameters: ${validParams}`,
                    callLocation
                  );
                }
                // EC-7: duplicate binding
                if (bound.has(key)) {
                  throw new RuntimeError(
                    'RILL-R001',
                    `Duplicate binding for parameter '${key}': already bound positionally`,
                    callLocation
                  );
                }
                bound.set(key, value);
              }
            } else {
              // EC-4: spread value is not tuple/dict/ordered
              const actualType = inferType(spreadValue);
              throw new RuntimeError(
                'RILL-R001',
                `Spread requires a tuple, dict, or ordered value, got ${actualType}`,
                callLocation
              );
            }
          }
        }
      } finally {
        this.ctx.pipeValue = savedPipeValue;
      }

      // EC-8: check for missing required parameters
      for (const param of params) {
        if (!bound.has(param.name)) {
          if (param.defaultValue !== null) {
            bound.set(param.name, param.defaultValue);
          } else {
            throw new RuntimeError(
              'RILL-R001',
              `Missing required parameter '${param.name}'`,
              callLocation
            );
          }
        }
      }

      return { params: bound };
    }

    /**
     * Evaluate .params property access on closures.
     * Builds dict from closure parameter metadata.
     *
     * Returns dict keyed by parameter name, where each entry is a dict with:
     * - type: string (if param has type annotation)
     * - __annotations: dict (if param has parameter-level annotations)
     *
     * Empty params closure returns empty dict [].
     * Throws RUNTIME_TYPE_ERROR for non-closure targets.
     */
    protected async evaluateParamsProperty(
      callable: RillValue,
      location: SourceLocation
    ): Promise<Record<string, RillValue>> {
      // Only ScriptCallable supports .params reflection
      if (!isScriptCallable(callable)) {
        throw new RuntimeError(
          'RILL-R003',
          `Cannot access .params on ${inferType(callable)}`,
          location,
          { actualType: inferType(callable) }
        );
      }

      // Build params dict from ScriptCallable.params and paramAnnotations
      const paramsDict: Record<string, RillValue> = {};

      for (const param of callable.params) {
        const paramEntry: Record<string, RillValue> = {};

        // Add type field if param has type annotation
        if (param.typeName !== null) {
          paramEntry['type'] = param.typeName;
        }

        // Add __annotations field if param has parameter-level annotations
        const paramAnnotations = callable.paramAnnotations[param.name];
        if (
          paramAnnotations !== undefined &&
          Object.keys(paramAnnotations).length > 0
        ) {
          paramEntry['__annotations'] = paramAnnotations;
        }

        paramsDict[param.name] = paramEntry;
      }

      return paramsDict;
    }
  };
}

// Export with type assertion to work around TS4094 limitation
// TypeScript can't generate declarations for functions returning classes with protected members
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ClosuresMixin = createClosuresMixin as any;
