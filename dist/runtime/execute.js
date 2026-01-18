/**
 * Script Execution
 *
 * Public API for executing Rill scripts.
 * Provides both full execution and step-by-step execution.
 */
import { evaluateExpression, handleCapture, checkAutoExceptions, checkAborted } from './evaluate.js';
/**
 * Execute a parsed Rill script.
 *
 * @param script The parsed AST (from parse())
 * @param context The runtime context (from createRuntimeContext())
 * @returns The final value and all captured variables
 */
export async function execute(script, context) {
    const stepper = createStepper(script, context);
    while (!stepper.done) {
        await stepper.step();
    }
    return stepper.getResult();
}
/**
 * Create a stepper for controlled step-by-step execution.
 * Allows the caller to control the execution loop and inspect state between steps.
 *
 * @param script The parsed AST (from parse())
 * @param context The runtime context (from createRuntimeContext())
 * @returns A stepper for step-by-step execution
 */
export function createStepper(script, context) {
    const statements = script.statements;
    const total = statements.length;
    let index = 0;
    let lastValue = null;
    let isDone = total === 0;
    const collectVariables = () => {
        const vars = {};
        for (const [name, value] of context.variables) {
            vars[name] = value;
        }
        return vars;
    };
    return {
        get done() {
            return isDone;
        },
        get index() {
            return index;
        },
        get total() {
            return total;
        },
        get context() {
            return context;
        },
        async step() {
            if (isDone) {
                return {
                    value: lastValue,
                    done: true,
                    index: index,
                    total,
                };
            }
            const stmt = statements[index];
            if (!stmt) {
                isDone = true;
                return { value: lastValue, done: true, index, total };
            }
            // Check for abort before each step
            checkAborted(context, stmt);
            const startTime = Date.now();
            // Fire onStepStart
            context.observability.onStepStart?.({
                index,
                total,
                pipeValue: context.pipeValue,
            });
            let captured;
            try {
                // Execute the statement
                const value = await evaluateExpression(stmt.expression, context);
                captured = handleCapture(stmt.capture, value, context);
                context.pipeValue = value;
                lastValue = value;
                checkAutoExceptions(value, context, stmt);
                // Fire onStepEnd
                context.observability.onStepEnd?.({
                    index,
                    total,
                    value,
                    durationMs: Date.now() - startTime,
                });
                index++;
                isDone = index >= total;
                return {
                    value,
                    done: isDone,
                    index: index - 1,
                    total,
                    captured,
                };
            }
            catch (error) {
                // Fire onError
                context.observability.onError?.({
                    error: error instanceof Error ? error : new Error(String(error)),
                    index,
                });
                throw error;
            }
        },
        getResult() {
            return {
                value: lastValue,
                variables: collectVariables(),
            };
        },
    };
}
//# sourceMappingURL=execute.js.map