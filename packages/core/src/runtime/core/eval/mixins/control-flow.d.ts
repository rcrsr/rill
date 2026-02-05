/**
 * ControlFlowMixin: Conditionals, Loops, and Blocks
 *
 * Handles control flow constructs:
 * - Conditionals (if-else)
 * - While loops
 * - Do-while loops
 * - Block expressions
 * - Body evaluation
 *
 * Interface requirements (from spec):
 * - evaluateConditional(node) -> Promise<RillValue>
 * - evaluateWhileLoop(node) -> Promise<RillValue>
 * - evaluateDoWhileLoop(node) -> Promise<RillValue>
 * - evaluateBlockExpression(node) -> Promise<RillValue>
 * - evaluateBody(node) -> Promise<RillValue>
 * - evaluateBodyExpression(node) -> Promise<RillValue>
 *
 * Error Handling:
 * - Non-boolean conditions throw RuntimeError(RUNTIME_TYPE_ERROR) [EC-15]
 * - BreakSignal/ReturnSignal are caught and handled appropriately [EC-16]
 * - Body evaluation errors propagate correctly [EC-17]
 *
 * @internal
 */
export declare const ControlFlowMixin: any;
//# sourceMappingURL=control-flow.d.ts.map