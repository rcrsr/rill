/**
 * Evaluation Public API
 *
 * Public API for AST evaluation using the class-based Evaluator architecture.
 * Provides functional wrappers around Evaluator methods for backward compatibility.
 *
 * @internal
 */
import type { AnnotatedStatementNode, ASTNode, CaptureNode, ExpressionNode, RillTypeName, SourceLocation, StatementNode } from '../../../types.js';
import type { RuntimeContext } from '../types.js';
import type { RillValue } from '../values.js';
/**
 * Capture information returned by handleCapture.
 */
export type CaptureInfo = {
    name: string;
    value: RillValue;
};
/**
 * Check if execution has been aborted via AbortSignal.
 * Throws AbortError if signal is aborted.
 */
export declare function checkAborted(ctx: RuntimeContext, node?: ASTNode): void;
/**
 * Check if the current pipe value matches any autoException pattern.
 * Only checks string values. Throws AutoExceptionError on match.
 */
export declare function checkAutoExceptions(value: RillValue, ctx: RuntimeContext, node?: ASTNode): void;
/**
 * Handle statement capture: set variable and fire observability event.
 * Returns capture info if a capture occurred.
 *
 * Note: Accepts CaptureNode | null because internal calls from CoreMixin
 * pass chain.terminator which may be null.
 */
export declare function handleCapture(capture: CaptureNode | null, value: RillValue, ctx: RuntimeContext): CaptureInfo | undefined;
/**
 * Assert that a value is of the expected type.
 * Returns the value unchanged if assertion passes, throws on mismatch.
 */
export declare function assertType(value: RillValue, expected: RillTypeName, location?: SourceLocation): RillValue;
/**
 * Evaluate an expression and return its value.
 * Main entry point for expression evaluation.
 */
export declare function evaluateExpression(expr: ExpressionNode, ctx: RuntimeContext): Promise<RillValue>;
/**
 * Execute a statement and return the result.
 * Handles annotations and observability events.
 */
export declare function executeStatement(stmt: StatementNode | AnnotatedStatementNode, ctx: RuntimeContext): Promise<RillValue>;
/**
 * Get annotation value by key from the context's annotation stack.
 * Returns undefined if annotation is not set.
 */
export declare function getAnnotation(ctx: RuntimeContext, key: string): RillValue | undefined;
//# sourceMappingURL=index.d.ts.map