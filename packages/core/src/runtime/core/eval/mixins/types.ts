/**
 * TypesMixin: Type Assertions and Checks
 *
 * Handles type assertion (:type) and type check (:?type) operations.
 * Provides runtime type validation with error reporting.
 *
 * Interface requirements (from spec):
 * - assertType(value, expected, location?) -> RillValue
 * - evaluateTypeAssertion(node, input) -> Promise<RillValue>
 * - evaluateTypeCheck(node, input) -> Promise<boolean>
 * - evaluateTypeAssertionPrimary(node) -> Promise<RillValue>
 * - evaluateTypeCheckPrimary(node) -> Promise<boolean>
 *
 * Error Handling:
 * - Type assertion failures throw RuntimeError(RUNTIME_TYPE_ERROR) [EC-24]
 *
 * @internal
 */

import type {
  TypeAssertionNode,
  TypeCheckNode,
  RillTypeName,
  SourceLocation,
} from '../../../../types.js';
import { RuntimeError } from '../../../../types.js';
import type { RillValue } from '../../values.js';
import { inferType, checkType } from '../../values.js';
import type { EvaluatorConstructor } from '../types.js';
import type { EvaluatorBase } from '../base.js';

/**
 * TypesMixin implementation.
 *
 * Provides type assertion and type check functionality. Type assertions
 * validate that a value is of the expected type and throw on mismatch.
 * Type checks return boolean results without throwing.
 *
 * Depends on:
 * - EvaluatorBase: ctx, checkAborted(), getNodeLocation()
 * - evaluatePostfixExpr() (from future CoreMixin composition)
 *
 * Methods added:
 * - assertType(value, expected, location?) -> RillValue
 * - evaluateTypeAssertion(node, input) -> Promise<RillValue>
 * - evaluateTypeCheck(node, input) -> Promise<boolean>
 * - evaluateTypeAssertionPrimary(node) -> Promise<RillValue>
 * - evaluateTypeCheckPrimary(node) -> Promise<boolean>
 */
function createTypesMixin(Base: EvaluatorConstructor<EvaluatorBase>) {
  return class TypesEvaluator extends Base {
    /**
     * Assert that a value is of the expected type.
     * Returns the value unchanged if assertion passes, throws on mismatch.
     * Exported for use by type assertion evaluation.
     */
    assertType(
      value: RillValue,
      expected: RillTypeName,
      location?: SourceLocation
    ): RillValue {
      const actual = inferType(value);
      if (actual !== expected) {
        throw new RuntimeError(
          'RILL-R004',
          `Type assertion failed: expected ${expected}, got ${actual}`,
          location,
          { expectedType: expected, actualType: actual }
        );
      }
      return value;
    }

    /**
     * Evaluate type assertion: expr:type or :type (shorthand for $:type).
     * Returns the value if type matches, throws on mismatch.
     */
    async evaluateTypeAssertion(
      node: TypeAssertionNode,
      input: RillValue
    ): Promise<RillValue> {
      // If operand is null, use the input (pipe value)
      // Otherwise, evaluate the operand
      const value = node.operand
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (this as any).evaluatePostfixExpr(node.operand)
        : input;

      return this.assertType(value, node.typeName, node.span.start);
    }

    /**
     * Evaluate type check: expr:?type or :?type (shorthand for $:?type).
     * Returns true if type matches, false otherwise.
     */
    async evaluateTypeCheck(
      node: TypeCheckNode,
      input: RillValue
    ): Promise<boolean> {
      // If operand is null, use the input (pipe value)
      // Otherwise, evaluate the operand
      const value = node.operand
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (this as any).evaluatePostfixExpr(node.operand)
        : input;

      return checkType(value, node.typeName);
    }

    /**
     * Evaluate postfix type assertion: expr:type.
     * The operand is always present (not null) for postfix form.
     */
    async evaluateTypeAssertionPrimary(
      node: TypeAssertionNode
    ): Promise<RillValue> {
      if (!node.operand) {
        throw new RuntimeError(
          'RILL-R004',
          'Postfix type assertion requires operand',
          node.span.start
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const value = await (this as any).evaluatePostfixExpr(node.operand);
      return this.evaluateTypeAssertion(node, value);
    }

    /**
     * Evaluate postfix type check: expr:?type.
     * The operand is always present (not null) for postfix form.
     */
    async evaluateTypeCheckPrimary(node: TypeCheckNode): Promise<boolean> {
      if (!node.operand) {
        throw new RuntimeError(
          'RILL-R004',
          'Postfix type check requires operand',
          node.span.start
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const value = await (this as any).evaluatePostfixExpr(node.operand);
      return this.evaluateTypeCheck(node, value);
    }
  };
}

// Export with type assertion to work around TS4094 limitation
// TypeScript can't generate declarations for functions returning classes with protected members
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TypesMixin = createTypesMixin as any;
