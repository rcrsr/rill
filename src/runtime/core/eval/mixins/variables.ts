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
  ExpressionNode,
} from '../../../../types.js';
import { RuntimeError, RILL_ERROR_CODES } from '../../../../types.js';
import type { RillValue } from '../../values.js';
import { inferType } from '../../values.js';
import { getVariable, hasVariable } from '../../context.js';
import { isDict, isCallable } from '../../callable.js';
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
          // Handle .params property on closures
          if (field === 'params') {
            if (isCallable(value)) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              value = await (this as any).evaluateParamsProperty(
                value,
                this.getNodeLocation(node)
              );
            } else {
              // .params on non-callable: throw or return null based on default value
              if (node.defaultValue !== null) {
                value = null;
              } else {
                throw new RuntimeError(
                  RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
                  `Cannot access .params on ${inferType(value)}`,
                  this.getNodeLocation(node),
                  { actualType: inferType(value) }
                );
              }
            }
          } else if (isDict(value)) {
            // Allow missing fields if there's a default value or existence check
            const allowMissing =
              node.defaultValue !== null || node.existenceCheck !== null;
            value = await this.accessDictField(
              value,
              field,
              this.getNodeLocation(node),
              allowMissing
            );
          } else {
            value = null;
          }
        } else if (access.kind === 'variable') {
          value = await this.evaluateFieldAccessVariable(access, value, node);
        } else if (access.kind === 'computed') {
          value = await this.evaluateFieldAccessComputed(access, value, node);
        } else if (access.kind === 'alternatives') {
          value = await this.evaluateFieldAccessAlternatives(
            access,
            value,
            node
          );
        } else if (access.kind === 'annotation') {
          // Annotation reflection: .^key
          // Delegates to evaluateAnnotationAccess from ClosuresMixin
          // Convert RUNTIME_UNDEFINED_ANNOTATION to null ONLY if defaultValue exists (for ?? coalescing)
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            value = await (this as any).evaluateAnnotationAccess(
              value,
              access.key,
              this.getNodeLocation(node)
            );
          } catch (e) {
            if (
              e instanceof RuntimeError &&
              e.code === RILL_ERROR_CODES.RUNTIME_UNDEFINED_ANNOTATION &&
              node.defaultValue !== null
            ) {
              // Convert missing annotation to null for ?? coalescing
              value = null;
            } else {
              // No default value: re-throw RUNTIME_UNDEFINED_ANNOTATION
              throw e;
            }
          }
        } else {
          // Other field access types (block)
          throw new RuntimeError(
            RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
            `Field access kind '${access.kind}' not yet supported`,
            this.getNodeLocation(node)
          );
        }
      }

      // Handle existence check (.?field): return boolean instead of value
      if (node.existenceCheck) {
        // value now contains the result of the access chain (without the final field)
        // Check if the final field exists in value
        const finalAccess = node.existenceCheck.finalAccess;
        const typeName = node.existenceCheck.typeName;

        if (finalAccess.kind === 'literal') {
          // Check if literal field exists in dict
          if (isDict(value)) {
            const fieldValue = (value as Record<string, RillValue>)[
              finalAccess.field
            ];
            const exists = fieldValue !== undefined && fieldValue !== null;

            // If type-qualified check, verify type matches
            if (exists && typeName !== null) {
              return inferType(fieldValue) === typeName;
            }

            return exists;
          }
          return false;
        }

        if (finalAccess.kind === 'variable') {
          // Resolve variable to get key (EC-9)
          let keyValue: RillValue | undefined;
          if (finalAccess.variableName === null) {
            keyValue = this.ctx.pipeValue ?? undefined;
          } else {
            keyValue = getVariable(this.ctx, finalAccess.variableName);
          }

          // EC-9: Variable undefined
          if (keyValue === undefined) {
            const varName = finalAccess.variableName ?? '$';
            throw new RuntimeError(
              RILL_ERROR_CODES.RUNTIME_UNDEFINED_VARIABLE,
              `Variable '${varName}' is undefined`,
              this.getNodeLocation(node)
            );
          }

          // Check if key exists in dict or list
          if (isDict(value)) {
            // EC-10: Key variable non-string
            if (typeof keyValue !== 'string') {
              throw new RuntimeError(
                RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
                `Existence check key must be string, got ${inferType(keyValue)}`,
                this.getNodeLocation(node)
              );
            }

            const fieldValue = (value as Record<string, RillValue>)[keyValue];
            const exists = fieldValue !== undefined && fieldValue !== null;

            // If type-qualified check, verify type matches
            if (exists && typeName !== null) {
              return inferType(fieldValue) === typeName;
            }

            return exists;
          }

          if (Array.isArray(value)) {
            if (typeof keyValue === 'number') {
              const index = keyValue < 0 ? value.length + keyValue : keyValue;
              return index >= 0 && index < value.length;
            }
            return false;
          }

          return false;
        }

        if (finalAccess.kind === 'computed') {
          // Evaluate the computed expression (EC-11)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const keyValue = await (this as any).evaluatePipeChain(
            finalAccess.expression
          );

          // EC-11: Computed key non-string
          if (typeof keyValue !== 'string') {
            throw new RuntimeError(
              RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
              `Existence check key evaluated to ${inferType(keyValue)}, expected string`,
              this.getNodeLocation(node)
            );
          }

          // Check if computed key exists in dict
          if (isDict(value)) {
            const fieldValue = (value as Record<string, RillValue>)[keyValue];
            const exists = fieldValue !== undefined && fieldValue !== null;

            // If type-qualified check, verify type matches
            if (exists && typeName !== null) {
              return inferType(fieldValue) === typeName;
            }

            return exists;
          }

          return false;
        }

        // For other access kinds (block, alternatives, annotation), not supported
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `Existence check not yet supported for ${finalAccess.kind} access`,
          this.getNodeLocation(node)
        );
      }

      // Apply default value if final result is null
      if (value === null && node.defaultValue) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this as any).evaluateBody(node.defaultValue);
      }

      return value;
    }

    /**
     * Evaluate field access using a variable as the key.
     * Resolves variable by name and uses resulting string/number as dict field or list index.
     *
     * @param access - The field access node with variable name
     * @param value - The current value being accessed (dict or list)
     * @param node - The parent variable node for location info
     * @returns The field/element value or null if missing
     * @throws RuntimeError if variable undefined or wrong type (EC-1, EC-2, EC-3)
     */
    protected async evaluateFieldAccessVariable(
      access: {
        readonly kind: 'variable';
        readonly variableName: string | null;
      },
      value: RillValue,
      node: VariableNode
    ): Promise<RillValue> {
      // Resolve the variable (EC-1)
      let keyValue: RillValue | undefined;
      if (access.variableName === null) {
        // .$ (pipe variable as key)
        keyValue = this.ctx.pipeValue ?? undefined;
        if (keyValue === undefined) {
          throw new RuntimeError(
            RILL_ERROR_CODES.RUNTIME_UNDEFINED_VARIABLE,
            `Pipe variable '$' is undefined`,
            this.getNodeLocation(node)
          );
        }
      } else {
        // .$variable (named variable as key)
        keyValue = getVariable(this.ctx, access.variableName);
        if (keyValue === undefined) {
          throw new RuntimeError(
            RILL_ERROR_CODES.RUNTIME_UNDEFINED_VARIABLE,
            `Variable '${access.variableName}' is undefined`,
            this.getNodeLocation(node)
          );
        }
      }

      // Validate key type (EC-2, EC-3)
      if (typeof keyValue === 'boolean') {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `Key must be string or number, got bool`,
          this.getNodeLocation(node)
        );
      }
      if (Array.isArray(keyValue)) {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `Key must be string or number, got list`,
          this.getNodeLocation(node)
        );
      }

      // Handle string key (dict access)
      if (typeof keyValue === 'string') {
        if (isDict(value)) {
          // Allow missing fields to return null
          return await this.accessDictField(
            value,
            keyValue,
            this.getNodeLocation(node),
            true
          );
        }
        return null;
      }

      // Handle number key (list access)
      if (typeof keyValue === 'number') {
        if (Array.isArray(value)) {
          let index = keyValue;
          // Handle negative indices
          if (index < 0) {
            index = value.length + index;
          }
          const result = value[index];
          // Return null for out of bounds (use allowMissing pattern)
          return result !== undefined ? result : null;
        }
        return null;
      }

      // Other types (dict, closure) - fall through to type error
      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
        `Key must be string or number, got ${inferType(keyValue)}`,
        this.getNodeLocation(node)
      );
    }

    /**
     * Evaluate field access using a computed expression as the key.
     * Evaluates expression and uses resulting string/number as dict field or list index.
     *
     * @param access - The field access node with expression
     * @param value - The current value being accessed (dict or list)
     * @param node - The parent variable node for location info
     * @returns The field/element value or null if missing
     * @throws RuntimeError if expression result is wrong type (EC-4, EC-5)
     */
    protected async evaluateFieldAccessComputed(
      access: {
        readonly kind: 'computed';
        readonly expression: ExpressionNode;
      },
      value: RillValue,
      node: VariableNode
    ): Promise<RillValue> {
      // Evaluate the expression to get the key
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const keyValue = await (this as any).evaluatePipeChain(access.expression);

      // EC-4: Expression result is closure
      if (isCallable(keyValue)) {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `Computed key evaluated to closure, expected string or number`,
          this.getNodeLocation(node)
        );
      }

      // EC-5: Expression result is dict
      if (isDict(keyValue)) {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `Computed key evaluated to dict, expected string or number`,
          this.getNodeLocation(node)
        );
      }

      // Other invalid types (boolean, list)
      if (typeof keyValue === 'boolean') {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `Computed key evaluated to bool, expected string or number`,
          this.getNodeLocation(node)
        );
      }
      if (Array.isArray(keyValue)) {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `Computed key evaluated to list, expected string or number`,
          this.getNodeLocation(node)
        );
      }

      // Handle string key (dict access)
      if (typeof keyValue === 'string') {
        if (isDict(value)) {
          // Allow missing fields to return null
          return await this.accessDictField(
            value,
            keyValue,
            this.getNodeLocation(node),
            true
          );
        }
        return null;
      }

      // Handle number key (list access)
      if (typeof keyValue === 'number') {
        if (Array.isArray(value)) {
          let index = keyValue;
          // Handle negative indices
          if (index < 0) {
            index = value.length + index;
          }
          const result = value[index];
          // Return null for out of bounds (use allowMissing pattern)
          return result !== undefined ? result : null;
        }
        return null;
      }

      // Shouldn't reach here due to exhaustive type checks above
      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
        `Computed key evaluated to unexpected type`,
        this.getNodeLocation(node)
      );
    }

    /**
     * Evaluate field access using alternatives (try keys left-to-right).
     * Returns first found value or null if all keys missing.
     *
     * @param access - The field access node with alternatives array
     * @param value - The current value being accessed (must be dict)
     * @param node - The parent variable node for location info
     * @returns The first found field value or null if all keys missing
     * @throws RuntimeError if target is not dict (EC-6)
     */
    protected async evaluateFieldAccessAlternatives(
      access: {
        readonly kind: 'alternatives';
        readonly alternatives: string[];
      },
      value: RillValue,
      node: VariableNode
    ): Promise<RillValue> {
      // EC-6: Target must be dict
      if (!isDict(value)) {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `Alternative access requires dict, got ${inferType(value)}`,
          this.getNodeLocation(node)
        );
      }

      // Try each alternative left-to-right (short-circuit on first match)
      for (const key of access.alternatives) {
        const dictValue = (value as Record<string, RillValue>)[key];
        if (dictValue !== undefined && dictValue !== null) {
          // Property-style callable: auto-invoke when accessed
          if (isCallable(dictValue) && dictValue.isProperty) {
            // ApplicationCallable: pass [dict] as args (no boundDict mechanism)
            // ScriptCallable: pass [] - dict is bound via boundDict -> pipeValue
            const args = dictValue.kind === 'script' ? [] : [value];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return await (this as any).invokeCallable(
              dictValue,
              args,
              this.getNodeLocation(node)
            );
          }
          return dictValue;
        }
      }

      // All keys missing: return null
      return null;
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
