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
import { RuntimeError } from '../../../../types.js';
import { inferType, isTruthy, deepEquals } from '../../values.js';
import { createChildContext } from '../../context.js';
import { isCallable } from '../../callable.js';
/**
 * ExpressionsMixin implementation.
 *
 * Evaluates binary expressions (arithmetic, comparison, logical),
 * unary expressions (negation, logical NOT), and grouped expressions.
 *
 * Depends on:
 * - EvaluatorBase: ctx, getNodeLocation()
 * - evaluateExprHead() (internal helper, defined in this mixin)
 * - evaluatePostfixExpr() (from future CoreMixin composition)
 * - evaluatePipeChain() (from future CoreMixin composition)
 * - invokeCallable() (from ClosuresMixin)
 *
 * Methods added:
 * - evaluateBinaryExpr(node) -> Promise<RillValue>
 * - evaluateUnaryExpr(node) -> Promise<RillValue>
 * - evaluateGroupedExpr(node) -> Promise<RillValue>
 * - resolveExpressionValue(value) -> Promise<RillValue>
 * - evaluateExprHead(node) -> Promise<RillValue> (helper)
 * - evaluateBinaryComparison(left, right, op, node) -> boolean (helper)
 */
function createExpressionsMixin(Base) {
    return class ExpressionsEvaluator extends Base {
        /**
         * Resolve expression value, auto-invoking closures when $ is bound.
         *
         * Auto-invokes closures only when ctx.pipeValue is set:
         * - Zero-param closures: invoke with pipeValue = $
         * - Parameterized closures: invoke with args = [$]
         * - Non-callable values: returned unchanged
         *
         * Expression contexts that call resolveExpressionValue:
         * - Unary operand (e.g., `! $closure`)
         * - Binary operands (e.g., `$a && $b`, `$x + $y`)
         *
         * Excluded contexts (no auto-invoke):
         * - Capture target (`:> $var`)
         * - Direct pipe target (`-> $fn`)
         * - Function call arguments (`func($closure)`)
         *
         * Reference: variables.ts:720-733 (property-style auto-invoke)
         */
        async resolveExpressionValue(value) {
            // Auto-invoke only when $ is bound (pipeValue set)
            if (!isCallable(value) || this.ctx.pipeValue === null) {
                return value;
            }
            // Callable and $ is bound: auto-invoke
            // Zero-param closures: invoke with pipeValue = $
            // Parameterized closures: invoke with args = [$]
            const args = value.kind === 'script' && value.params.length === 0
                ? []
                : [this.ctx.pipeValue];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return await this.invokeCallable(value, args, undefined);
        }
        /**
         * Evaluate binary expression: left op right.
         * Handles arithmetic, comparison, and logical operators.
         * Auto-invokes closures when $ is bound.
         */
        async evaluateBinaryExpr(node) {
            const { op } = node;
            // Logical operators with short-circuit evaluation
            if (op === '||') {
                const rawLeft = await this.evaluateExprHead(node.left);
                const left = await this.resolveExpressionValue(rawLeft);
                if (isTruthy(left))
                    return true;
                const rawRight = await this.evaluateExprHead(node.right);
                const right = await this.resolveExpressionValue(rawRight);
                return isTruthy(right);
            }
            if (op === '&&') {
                const rawLeft = await this.evaluateExprHead(node.left);
                const left = await this.resolveExpressionValue(rawLeft);
                if (!isTruthy(left))
                    return false;
                const rawRight = await this.evaluateExprHead(node.right);
                const right = await this.resolveExpressionValue(rawRight);
                return isTruthy(right);
            }
            // Comparison operators - work on any values, return boolean
            if (op === '==' ||
                op === '!=' ||
                op === '<' ||
                op === '>' ||
                op === '<=' ||
                op === '>=') {
                const rawLeft = await this.evaluateExprHead(node.left);
                const left = await this.resolveExpressionValue(rawLeft);
                const rawRight = await this.evaluateExprHead(node.right);
                const right = await this.resolveExpressionValue(rawRight);
                return this.evaluateBinaryComparison(left, right, op, node);
            }
            // Arithmetic operators - require numbers
            // Auto-invoke closures before checking type
            const rawLeft = await this.evaluateExprHead(node.left);
            const resolvedLeft = await this.resolveExpressionValue(rawLeft);
            if (typeof resolvedLeft !== 'number') {
                throw new RuntimeError('RILL-R002', `Arithmetic requires number, got ${inferType(resolvedLeft)}`, node.left.span.start);
            }
            const left = resolvedLeft;
            const rawRight = await this.evaluateExprHead(node.right);
            const resolvedRight = await this.resolveExpressionValue(rawRight);
            if (typeof resolvedRight !== 'number') {
                throw new RuntimeError('RILL-R002', `Arithmetic requires number, got ${inferType(resolvedRight)}`, node.right.span.start);
            }
            const right = resolvedRight;
            switch (op) {
                case '+':
                    return left + right;
                case '-':
                    return left - right;
                case '*':
                    return left * right;
                case '/':
                    if (right === 0) {
                        throw new RuntimeError('RILL-R002', 'Division by zero', node.span.start);
                    }
                    return left / right;
                case '%':
                    if (right === 0) {
                        throw new RuntimeError('RILL-R002', 'Modulo by zero', node.span.start);
                    }
                    return left % right;
            }
        }
        /**
         * Evaluate comparison between two values.
         * Equality works on all types, ordering requires compatible types.
         */
        evaluateBinaryComparison(left, right, op, node) {
            switch (op) {
                case '==':
                    return deepEquals(left, right);
                case '!=':
                    return !deepEquals(left, right);
                case '<':
                case '>':
                case '<=':
                case '>=':
                    // Ordering comparisons require compatible types
                    if (typeof left === 'number' && typeof right === 'number') {
                        return op === '<'
                            ? left < right
                            : op === '>'
                                ? left > right
                                : op === '<='
                                    ? left <= right
                                    : left >= right;
                    }
                    if (typeof left === 'string' && typeof right === 'string') {
                        return op === '<'
                            ? left < right
                            : op === '>'
                                ? left > right
                                : op === '<='
                                    ? left <= right
                                    : left >= right;
                    }
                    throw new RuntimeError('RILL-R002', `Cannot compare ${inferType(left)} with ${inferType(right)} using ${op}`, node.span.start);
            }
        }
        /**
         * Evaluate unary expression: -operand or !operand.
         * Auto-invokes closures when $ is bound.
         */
        async evaluateUnaryExpr(node) {
            if (node.op === '!') {
                const rawValue = await this.evaluateExprHead(node.operand);
                const value = await this.resolveExpressionValue(rawValue);
                if (typeof value !== 'boolean') {
                    throw new RuntimeError('RILL-R002', `Negation operator (!) requires boolean operand, got ${inferType(value)}`, node.span.start);
                }
                return !value;
            }
            // Unary minus
            const operand = node.operand;
            if (operand.type === 'UnaryExpr') {
                const inner = await this.evaluateUnaryExpr(operand);
                if (typeof inner !== 'number') {
                    throw new RuntimeError('RILL-R002', `Arithmetic requires number, got ${inferType(inner)}`, node.span.start);
                }
                return -inner;
            }
            const rawValue = await this.evaluateExprHead(operand);
            const value = await this.resolveExpressionValue(rawValue);
            if (typeof value !== 'number') {
                throw new RuntimeError('RILL-R002', `Arithmetic requires number, got ${inferType(value)}`, node.span.start);
            }
            return -value;
        }
        /**
         * Evaluate expression head, returning any RillValue.
         * Helper for binary and unary expression evaluation.
         */
        async evaluateExprHead(node) {
            switch (node.type) {
                case 'BinaryExpr':
                    return this.evaluateBinaryExpr(node);
                case 'UnaryExpr':
                    return this.evaluateUnaryExpr(node);
                case 'PostfixExpr':
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return this.evaluatePostfixExpr(node);
            }
        }
        /**
         * Evaluate grouped expression: (expression).
         * Provides scoping - captures inside are local and not visible outside.
         */
        async evaluateGroupedExpr(node) {
            // Grouped expressions have their own scope (reads parent, writes local only)
            const childCtx = createChildContext(this.ctx);
            const savedCtx = this.ctx;
            this.ctx = childCtx;
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return await this.evaluatePipeChain(node.expression);
            }
            finally {
                this.ctx = savedCtx;
            }
        }
    };
}
// Export with type assertion to work around TS4094 limitation
// TypeScript can't generate declarations for functions returning classes with protected members
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ExpressionsMixin = createExpressionsMixin;
//# sourceMappingURL=expressions.js.map