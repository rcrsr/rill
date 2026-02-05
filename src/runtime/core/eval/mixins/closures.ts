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
 * - Closure chains
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
 * - evaluateClosureChain(node, input) -> Promise<RillValue>
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
  ClosureCallNode,
  MethodCallNode,
  InvokeNode,
  PipeInvokeNode,
  ClosureChainNode,
  VariableNode,
  SourceLocation,
  ExpressionNode,
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
} from '../../callable.js';
import { getVariable } from '../../context.js';
import type { RuntimeContext } from '../../types.js';
import type { RillValue, RillTuple } from '../../values.js';
import { inferType, isTuple } from '../../values.js';
import type { EvaluatorConstructor } from '../types.js';
import type { EvaluatorBase } from '../base.js';

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
 * - evaluateClosureChain(node, input) -> Promise<RillValue>
 * - evaluateArgs(argExprs) -> Promise<RillValue[]> (helper)
 * - invokeFnCallable(callable, args, location) -> Promise<RillValue> (helper)
 * - invokeScriptCallable(callable, args, location) -> Promise<RillValue> (helper)
 * - invokeScriptCallableWithArgs(callable, tuple, location) -> Promise<RillValue> (helper)
 * - createCallableContext(callable) -> RuntimeContext (helper)
 * - validateParamType(param, value, location) -> void (helper)
 * - inferTypeFromDefault(defaultValue) -> RillTypeName | null (helper)
 */
function createClosuresMixin(Base: EvaluatorConstructor<EvaluatorBase>) {
  return class ClosuresEvaluator extends Base {
    /**
     * Evaluate argument expressions while preserving the current pipeValue.
     * Used by all callable invocations to prepare arguments.
     */
    protected async evaluateArgs(
      argExprs: ExpressionNode[]
    ): Promise<RillValue[]> {
      const savedPipeValue = this.ctx.pipeValue;
      const args: RillValue[] = [];
      for (const arg of argExprs) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        args.push(await (this as any).evaluateExpression(arg));
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
      callLocation?: SourceLocation
    ): Promise<RillValue> {
      this.checkAborted();

      if (callable.kind === 'script') {
        return this.invokeScriptCallable(callable, args, callLocation);
      } else {
        return this.invokeFnCallable(callable, args, callLocation);
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
      const expectedType =
        param.typeName ?? this.inferTypeFromDefault(param.defaultValue);
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
      const firstArg = args[0];
      if (args.length === 1 && firstArg !== undefined && isTuple(firstArg)) {
        return this.invokeScriptCallableWithArgs(
          callable,
          firstArg,
          callLocation
        );
      }

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

      // Switch context to callable context
      const savedCtx = this.ctx;
      this.ctx = callableCtx;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await (this as any).evaluateBodyExpression(callable.body);
      } finally {
        this.ctx = savedCtx;
      }
    }

    /**
     * Invoke script callable with tuple arguments (named or positional).
     * Handles *[...] and *[name: val] argument unpacking.
     */
    protected async invokeScriptCallableWithArgs(
      closure: ScriptCallable,
      tupleValue: RillTuple,
      callLocation?: SourceLocation
    ): Promise<RillValue> {
      const closureCtx = this.createCallableContext(closure);

      const hasNumericKeys = [...tupleValue.entries.keys()].some(
        (k) => typeof k === 'number'
      );
      const hasStringKeys = [...tupleValue.entries.keys()].some(
        (k) => typeof k === 'string'
      );

      if (hasNumericKeys && hasStringKeys) {
        throw new RuntimeError(
          'RILL-R001',
          'Tuple cannot mix positional (numeric) and named (string) keys',
          callLocation
        );
      }

      const boundParams = new Set<string>();

      if (hasNumericKeys) {
        for (const [key, value] of tupleValue.entries) {
          const position = key as number;
          const param = closure.params[position];

          if (param === undefined) {
            throw new RuntimeError(
              'RILL-R001',
              `Extra argument at position ${position} (closure has ${closure.params.length} params)`,
              callLocation,
              { position, paramCount: closure.params.length }
            );
          }

          this.validateParamType(param, value, callLocation);
          closureCtx.variables.set(param.name, value);
          boundParams.add(param.name);
        }
      } else if (hasStringKeys) {
        const paramNames = new Set(closure.params.map((p) => p.name));

        for (const [key, value] of tupleValue.entries) {
          const name = key as string;

          if (!paramNames.has(name)) {
            throw new RuntimeError(
              'RILL-R001',
              `Unknown argument '${name}' (valid params: ${[...paramNames].join(', ')})`,
              callLocation,
              { argName: name, validParams: [...paramNames] }
            );
          }

          const param = closure.params.find((p) => p.name === name)!;
          this.validateParamType(param, value, callLocation);
          closureCtx.variables.set(name, value);
          // Block-closures have param named '$': sync with pipeValue for bare $ references
          if (name === '$') {
            closureCtx.pipeValue = value;
          }
          boundParams.add(name);
        }
      }

      for (const param of closure.params) {
        if (!boundParams.has(param.name)) {
          if (param.defaultValue !== null) {
            closureCtx.variables.set(param.name, param.defaultValue);
            // Block-closures have param named '$': sync with pipeValue for bare $ references
            if (param.name === '$') {
              closureCtx.pipeValue = param.defaultValue;
            }
          } else {
            throw new RuntimeError(
              'RILL-R001',
              `Missing argument '${param.name}' (no default value)`,
              callLocation,
              { paramName: param.name }
            );
          }
        }
      }

      // Switch context to callable context
      const savedCtx = this.ctx;
      this.ctx = closureCtx;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await (this as any).evaluateBodyExpression(closure.body);
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

      // Use invokeFnCallable for consistent validation and invocation
      const wrappedPromise = this.withTimeout(
        (async () => {
          // Handle both CallableFn and ApplicationCallable
          if (typeof fn === 'function') {
            // Raw CallableFn - call directly (no validation)
            return fn(args, this.ctx, node.span.start);
          } else {
            // ApplicationCallable - use invokeFnCallable for validation
            return this.invokeFnCallable(fn, args, node.span.start, node.name);
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
      const args = await this.evaluateArgs(node.args);

      // If no explicit args and has pipe input, add pipe value as first arg
      if (args.length === 0 && pipeInput !== null) {
        args.push(pipeInput);
      }

      return this.invokeCallable(closure, args, node.span.start);
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

      const args = await this.evaluateArgs(node.args);

      if (isDict(receiver)) {
        const dictValue = receiver[node.name];
        if (dictValue !== undefined && isCallable(dictValue)) {
          return this.invokeCallable(
            dictValue,
            args,
            this.getNodeLocation(node)
          );
        }
      }

      const method = this.ctx.methods.get(node.name);
      if (!method) {
        // Fall back to property access on dict (no-arg only)
        if (isDict(receiver) && args.length === 0 && node.name in receiver) {
          return receiver[node.name] as RillValue;
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

      const args = await this.evaluateArgs(node.args);
      return this.invokeCallable(receiver, args, this.getNodeLocation(node));
    }

    /**
     * Evaluate closure chain: >>expr
     * Chains multiple closures for composition.
     */
    protected async evaluateClosureChain(
      node: ClosureChainNode,
      input: RillValue
    ): Promise<RillValue> {
      // Evaluate the target expression to get the closure(s)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const target = await (this as any).evaluateExpression(node.target);

      if (Array.isArray(target)) {
        // List of closures: chain them left-to-right
        let result = input;
        for (const closure of target) {
          if (!isCallable(closure)) {
            throw new RuntimeError(
              'RILL-R002',
              `Closure chain element must be callable, got ${inferType(closure)}`,
              this.getNodeLocation(node)
            );
          }
          result = await this.invokeCallable(
            closure,
            [result],
            this.getNodeLocation(node)
          );
        }
        return result;
      } else if (isCallable(target)) {
        // Single closure: invoke with input
        return this.invokeCallable(target, [input], this.getNodeLocation(node));
      } else {
        throw new RuntimeError(
          'RILL-R002',
          `Closure chain requires callable or list of callables, got ${inferType(target)}`,
          this.getNodeLocation(node)
        );
      }
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
      // Only ScriptCallable supports annotation reflection
      if (!isScriptCallable(value)) {
        throw new RuntimeError(
          'RILL-R003',
          `Cannot access annotation on ${inferType(value)}`,
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
