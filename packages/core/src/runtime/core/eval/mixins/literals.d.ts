/**
 * LiteralsMixin: String, Tuple, Dict, Closure, and Pass Evaluation
 *
 * Handles evaluation of literal values including:
 * - Pass keyword (returns current pipe value)
 * - String literals with interpolation
 * - Tuple literals
 * - Dict literals with callable binding
 * - Closure creation with late binding
 * - Block-closure creation for expression-position blocks
 *
 * Interface requirements (from spec):
 * - evaluatePass(node) -> Promise<RillValue> [IR-4]
 * - evaluateString(node) -> Promise<string>
 * - evaluateTuple(node) -> Promise<RillValue[]>
 * - evaluateDict(node) -> Promise<Record<string, RillValue>>
 * - createClosure(node) -> Promise<ScriptCallable>
 * - createBlockClosure(node) -> ScriptCallable
 *
 * Error Handling:
 * - Pass throws RUNTIME_UNDEFINED_VARIABLE if $ not bound [EC-5]
 * - String interpolation errors propagate from evaluateExpression() [EC-6]
 * - Dict/tuple evaluation errors propagate from nested expressions [EC-7]
 *
 * @internal
 */
export declare const LiteralsMixin: any;
//# sourceMappingURL=literals.d.ts.map