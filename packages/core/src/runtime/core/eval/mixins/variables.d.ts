/**
 * VariablesMixin: Variable Access and Mutation
 *
 * Handles variable access, mutation, and capture operations:
 * - Variable lookup with scope chain traversal
 * - Variable assignment with type checking
 * - Capture syntax (:> $name)
 *
 * LIMITATIONS:
 * - Property access chains ($data.field[0]) require AccessMixin
 * - Existence checks (.?field) require AccessMixin
 * - Default values ($data ?? default) require AccessMixin or ControlFlowMixin
 *
 * Interface requirements (from spec):
 * - setVariable(name, value, explicitType?, location?) -> void
 * - evaluateVariable(node) -> RillValue
 * - evaluateVariableAsync(node) -> Promise<RillValue>
 * - evaluateCapture(node, input) -> RillValue
 *
 * Depends on:
 * - EvaluatorBase: ctx, checkAborted(), getNodeLocation()
 * - context utilities: getVariable, hasVariable
 *
 * Extended by:
 * - AccessMixin: Will add property chain evaluation to evaluateVariableAsync
 *
 * Error Handling:
 * - Undefined variables throw RuntimeError(RUNTIME_UNDEFINED_VARIABLE) [EC-8]
 * - Type mismatches throw RuntimeError(RUNTIME_TYPE_ERROR) [EC-9]
 *
 * @internal
 */
export declare const VariablesMixin: any;
//# sourceMappingURL=variables.d.ts.map