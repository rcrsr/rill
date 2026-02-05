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
export declare const ClosuresMixin: any;
//# sourceMappingURL=closures.d.ts.map