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
export declare const CoreMixin: any;
//# sourceMappingURL=core.d.ts.map