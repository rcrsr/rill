/**
 * Expression Evaluation
 *
 * Internal module for AST evaluation. Not part of public API.
 * All evaluation functions are internal implementation details.
 *
 * @internal
 */
import type { ASTNode, CaptureNode, ExpressionNode, StatementNode } from '../types.js';
import type { RuntimeContext } from './types.js';
import { type RillValue } from './values.js';
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
 */
export declare function handleCapture(capture: CaptureNode | null, value: RillValue, ctx: RuntimeContext): {
    name: string;
    value: RillValue;
} | undefined;
export declare function evaluateExpression(expr: ExpressionNode, ctx: RuntimeContext): Promise<RillValue>;
export declare function executeStatement(stmt: StatementNode, ctx: RuntimeContext): Promise<RillValue>;
//# sourceMappingURL=evaluate.d.ts.map