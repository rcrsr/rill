/**
 * Script Execution
 *
 * Public API for executing Rill scripts.
 * Provides both full execution and step-by-step execution.
 */
import type { ScriptNode } from '../../types.js';
import type { ExecutionResult, ExecutionStepper, RuntimeContext } from './types.js';
/**
 * Execute a parsed Rill script.
 *
 * @param script The parsed AST (from parse())
 * @param context The runtime context (from createRuntimeContext())
 * @returns The final value and all captured variables
 */
export declare function execute(script: ScriptNode, context: RuntimeContext): Promise<ExecutionResult>;
/**
 * Create a stepper for controlled step-by-step execution.
 * Allows the caller to control the execution loop and inspect state between steps.
 *
 * @param script The parsed AST (from parse())
 * @param context The runtime context (from createRuntimeContext())
 * @returns A stepper for step-by-step execution
 */
export declare function createStepper(script: ScriptNode, context: RuntimeContext): ExecutionStepper;
//# sourceMappingURL=execute.d.ts.map