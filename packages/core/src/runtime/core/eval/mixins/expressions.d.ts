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
 * - resolveExpressionValue(value) -> Promise<RillValue>
 *
 * Error Handling:
 * - Type mismatches in operators throw RuntimeError(RUNTIME_TYPE_ERROR) [EC-22]
 * - Nested expression evaluation errors are propagated [EC-23]
 * - Closure auto-invoke errors are propagated [EC-4, EC-6]
 *
 * @internal
 */
export declare const ExpressionsMixin: any;
//# sourceMappingURL=expressions.d.ts.map