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

import type {
  VariableNode,
  CaptureNode,
  RillTypeName,
  SourceLocation,
} from '../../../../types.js';
import { RuntimeError, RILL_ERROR_CODES } from '../../../../types.js';
import type { RillValue } from '../../values.js';
import { inferType } from '../../values.js';
import { getVariable, hasVariable } from '../../context.js';
import { isDict } from '../../callable.js';
import type { EvaluatorConstructor } from '../types.js';
import type { EvaluatorBase } from '../base.js';

/**
 * VariablesMixin implementation.
 *
 * Provides variable access and mutation functionality. Variables follow
 * lexical scoping with type locking on first assignment. Outer scope
 * variables cannot be reassigned from child scopes.
 *
 * Depends on:
 * - EvaluatorBase: ctx, checkAborted(), getNodeLocation()
 * - context utilities: getVariable, hasVariable
 *
 * Methods added:
 * - setVariable(name, value, explicitType?, location?) -> void
 * - evaluateVariable(node) -> RillValue
 * - evaluateVariableAsync(node) -> Promise<RillValue>
 * - evaluateCapture(node, input) -> RillValue
 */
function createVariablesMixin(Base: EvaluatorConstructor<EvaluatorBase>) {
  return class VariablesEvaluator extends Base {
    /**
     * Set a variable with type checking.
     * - First assignment locks the type (inferred or explicit)
     * - Subsequent assignments must match the locked type
     * - Explicit type annotation is validated against value type
     * - Cannot shadow outer scope variables (produces error)
     */
    protected setVariable(
      name: string,
      value: RillValue,
      explicitType?: RillTypeName,
      location?: SourceLocation
    ): void {
      const valueType = inferType(value);

      // Check explicit type annotation matches value
      if (explicitType !== undefined && explicitType !== valueType) {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `Type mismatch: cannot assign ${valueType} to $${name}:${explicitType}`,
          location,
          {
            variableName: name,
            expectedType: explicitType,
            actualType: valueType,
          }
        );
      }

      // Check if this is a new variable that would reassign an outer scope variable
      // (error: cannot reassign outer scope variables from child scopes)
      if (
        !this.ctx.variables.has(name) &&
        this.ctx.parent &&
        hasVariable(this.ctx.parent, name)
      ) {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `Cannot reassign outer variable $${name} from child scope`,
          location,
          { variableName: name }
        );
      }

      // Check if variable already has a locked type in current scope
      const lockedType = this.ctx.variableTypes.get(name);
      if (lockedType !== undefined && lockedType !== valueType) {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `Type mismatch: cannot assign ${valueType} to $${name} (locked as ${lockedType})`,
          location,
          {
            variableName: name,
            expectedType: lockedType,
            actualType: valueType,
          }
        );
      }

      // Set the variable and lock its type in current scope
      this.ctx.variables.set(name, value);
      if (!this.ctx.variableTypes.has(name)) {
        // Lock type: use explicit annotation if provided, otherwise infer from value
        // This enables `$x:string` to lock type before assignment while still
        // supporting type inference for bare captures like `:> $x`
        this.ctx.variableTypes.set(name, explicitType ?? valueType);
      }
    }

    /**
     * Evaluate variable access synchronously.
     * Handles bare variable references: $name or $.
     *
     * Note: This is a simplified synchronous version. The full implementation
     * with property access chains is in evaluateVariableAsync.
     */
    protected evaluateVariable(node: VariableNode): RillValue {
      // Handle pipe variable ($)
      if (node.isPipeVar && !node.name) {
        if (this.ctx.pipeValue === null) {
          throw new RuntimeError(
            RILL_ERROR_CODES.RUNTIME_UNDEFINED_VARIABLE,
            'Undefined variable: $',
            this.getNodeLocation(node),
            { variable: '$' }
          );
        }
        return this.ctx.pipeValue;
      }

      // Handle named variable ($name)
      if (node.name) {
        const result = getVariable(this.ctx, node.name);
        if (result === undefined) {
          throw new RuntimeError(
            RILL_ERROR_CODES.RUNTIME_UNDEFINED_VARIABLE,
            `Undefined variable: $${node.name}`,
            this.getNodeLocation(node),
            { variable: node.name }
          );
        }
        return result;
      }

      // Should not reach here - all variable nodes have either isPipeVar or name
      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_UNDEFINED_VARIABLE,
        'Invalid variable node',
        this.getNodeLocation(node)
      );
    }

    /**
     * Evaluate variable access asynchronously.
     * Async variant that supports access chains ($.field, $var.field).
     *
     * Handles property access chains and default values.
     */
    protected async evaluateVariableAsync(
      node: VariableNode
    ): Promise<RillValue> {
      // Get base value ($ or $name)
      let value: RillValue;

      if (node.isPipeVar && !node.name) {
        // Pipe variable ($)
        if (this.ctx.pipeValue === null) {
          throw new RuntimeError(
            RILL_ERROR_CODES.RUNTIME_UNDEFINED_VARIABLE,
            'Undefined variable: $',
            this.getNodeLocation(node),
            { variable: '$' }
          );
        }
        value = this.ctx.pipeValue;
      } else if (node.name) {
        // Named variable ($name)
        const result = getVariable(this.ctx, node.name);
        if (result === undefined) {
          throw new RuntimeError(
            RILL_ERROR_CODES.RUNTIME_UNDEFINED_VARIABLE,
            `Undefined variable: $${node.name}`,
            this.getNodeLocation(node),
            { variable: node.name }
          );
        }
        value = result;
      } else {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_UNDEFINED_VARIABLE,
          'Invalid variable node',
          this.getNodeLocation(node)
        );
      }

      // Apply access chain ($.field, $var.field, etc.)
      for (const access of node.accessChain) {
        if (value === null) {
          // Use default value if available
          if (node.defaultValue) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (this as any).evaluateBody(node.defaultValue);
          }
          throw new RuntimeError(
            RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
            `Cannot access property on null`,
            this.getNodeLocation(node)
          );
        }

        // Check if this is a bracket access
        if ('accessKind' in access) {
          // Bracket access: [expr]
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const indexValue = await (this as any).evaluatePipeChain(
            access.expression
          );

          if (Array.isArray(value)) {
            if (typeof indexValue !== 'number') {
              throw new RuntimeError(
                RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
                `List index must be number, got ${inferType(indexValue)}`,
                this.getNodeLocation(node)
              );
            }
            let index = indexValue;
            // Handle negative indices
            if (index < 0) {
              index = value.length + index;
            }
            const result = value[index];
            if (result === undefined) {
              throw new RuntimeError(
                RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
                `List index out of bounds: ${indexValue}`,
                this.getNodeLocation(node)
              );
            }
            value = result;
          } else if (isDict(value)) {
            if (typeof indexValue !== 'string') {
              throw new RuntimeError(
                RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
                `Dict key must be string, got ${inferType(indexValue)}`,
                this.getNodeLocation(node)
              );
            }
            const result = (value as Record<string, RillValue>)[indexValue];
            if (result === undefined) {
              throw new RuntimeError(
                RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
                `Undefined dict key: ${indexValue}`,
                this.getNodeLocation(node)
              );
            }
            value = result;
          } else {
            throw new RuntimeError(
              RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
              `Cannot index ${inferType(value)}`,
              this.getNodeLocation(node)
            );
          }
          continue;
        }

        // Must be a FieldAccess
        if (access.kind === 'literal') {
          const field = access.field;
          if (isDict(value)) {
            // Allow missing fields if there's a default value
            const allowMissing = node.defaultValue !== null;
            value = await this.accessDictField(
              value,
              field,
              this.getNodeLocation(node),
              allowMissing
            );
          } else {
            value = null;
          }
        } else {
          // Other field access types (variable, computed, block, alternatives)
          throw new RuntimeError(
            RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
            `Field access kind '${access.kind}' not yet supported`,
            this.getNodeLocation(node)
          );
        }
      }

      // Apply default value if final result is null
      if (value === null && node.defaultValue) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this as any).evaluateBody(node.defaultValue);
      }

      return value;
    }

    /**
     * Evaluate capture: :> $name
     * Handles capture syntax which assigns the piped value to a variable.
     * Calls setVariable for type checking and fires observability callback.
     */
    protected evaluateCapture(node: CaptureNode, input: RillValue): RillValue {
      this.setVariable(
        node.name,
        input,
        node.typeName ?? undefined,
        node.span.start
      );
      this.ctx.observability.onCapture?.({ name: node.name, value: input });
      return input;
    }

    /**
     * Handle statement capture (public API wrapper).
     * Returns capture info if a capture occurred.
     * This overrides the stub in EvaluatorBase.
     */
    protected override handleCapture(
      capture: CaptureNode | null,
      value: RillValue
    ): { name: string; value: RillValue } | undefined {
      if (!capture) return undefined;

      this.evaluateCapture(capture, value);
      return { name: capture.name, value };
    }
  };
}

// Export with type assertion to work around TS4094 limitation
// TypeScript can't generate declarations for functions returning classes with protected members
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const VariablesMixin = createVariablesMixin as any;
