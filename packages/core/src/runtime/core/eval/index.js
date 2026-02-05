/**
 * Evaluation Public API
 *
 * Public API for AST evaluation using the class-based Evaluator architecture.
 * Provides functional wrappers around Evaluator methods for backward compatibility.
 *
 * @internal
 */
import { getEvaluator } from './evaluator.js';
/**
 * Check if execution has been aborted via AbortSignal.
 * Throws AbortError if signal is aborted.
 */
export function checkAborted(ctx, node) {
    const evaluator = getEvaluator(ctx);
    // Access protected method via type assertion
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    evaluator.checkAborted(node);
}
/**
 * Check if the current pipe value matches any autoException pattern.
 * Only checks string values. Throws AutoExceptionError on match.
 */
export function checkAutoExceptions(value, ctx, node) {
    const evaluator = getEvaluator(ctx);
    // Access protected method via type assertion
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    evaluator.checkAutoExceptions(value, node);
}
/**
 * Handle statement capture: set variable and fire observability event.
 * Returns capture info if a capture occurred.
 *
 * Note: Accepts CaptureNode | null because internal calls from CoreMixin
 * pass chain.terminator which may be null.
 */
export function handleCapture(capture, value, ctx) {
    if (!capture)
        return undefined;
    const evaluator = getEvaluator(ctx);
    // Access protected evaluateCapture method via type assertion
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    evaluator.evaluateCapture(capture, value);
    // Return capture info for observability
    return { name: capture.name, value };
}
/**
 * Assert that a value is of the expected type.
 * Returns the value unchanged if assertion passes, throws on mismatch.
 */
export function assertType(value, expected, location) {
    // Create a minimal context for standalone type assertions
    // This is needed for assertType calls that occur outside expression evaluation
    const minimalContext = {
        variables: new Map(),
        variableTypes: new Map(),
        functions: new Map(),
        methods: new Map(),
        callbacks: { onLog: () => { } },
        pipeValue: null,
        parent: undefined,
        signal: undefined,
        observability: {},
        timeout: undefined,
        autoExceptions: [],
        maxCallStackDepth: 100,
        annotationStack: [],
        callStack: [],
    };
    const evaluator = getEvaluator(minimalContext);
    return evaluator.assertType(value, expected, location);
}
/**
 * Evaluate an expression and return its value.
 * Main entry point for expression evaluation.
 */
export async function evaluateExpression(expr, ctx) {
    const evaluator = getEvaluator(ctx);
    return evaluator.evaluateExpression(expr);
}
/**
 * Execute a statement and return the result.
 * Handles annotations and observability events.
 */
export async function executeStatement(stmt, ctx) {
    const evaluator = getEvaluator(ctx);
    return evaluator.executeStatement(stmt);
}
/**
 * Get annotation value by key from the context's annotation stack.
 * Returns undefined if annotation is not set.
 */
export function getAnnotation(ctx, key) {
    const evaluator = getEvaluator(ctx);
    return evaluator.getAnnotation(key);
}
//# sourceMappingURL=index.js.map