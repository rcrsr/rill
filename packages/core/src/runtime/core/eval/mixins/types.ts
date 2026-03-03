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
 * - validateAgainstShape(value, shape, path, location) -> void
 *
 * Error Handling:
 * - Type assertion failures throw RuntimeError(RUNTIME_TYPE_ERROR) [EC-24]
 *
 * @internal
 */

import type {
  TypeAssertionNode,
  TypeCheckNode,
  ShapeLiteralNode,
  AnnotationArg,
  RillTypeName,
  SourceLocation,
  ShapeAssertionNode,
  ShapeCheckNode,
  TypeRef,
} from '../../../../types.js';
import { RuntimeError } from '../../../../types.js';
import type {
  RillValue,
  RillShape,
  RillTypeValue,
  ShapeFieldSpec,
} from '../../values.js';
import {
  inferType,
  checkType,
  isShape,
  isTypeValue,
  deepEquals,
} from '../../values.js';
import { isDict } from '../../callable.js';
import { getVariable } from '../../context.js';
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
 * - validateAgainstShape(value, shape, path, location) -> void
 */
function createTypesMixin(Base: EvaluatorConstructor<EvaluatorBase>) {
  return class TypesEvaluator extends Base {
    /**
     * Resolve a TypeRef to a RillTypeValue or RillShape [IR-1].
     *
     * Static refs return a frozen RillTypeValue directly.
     * Dynamic refs call getVariable, then dispatch on the result:
     * - RillTypeValue → return as-is
     * - RillShape → return as-is
     * - Otherwise → throw RILL-R004
     *
     * EC-1: Variable not found → undefined from getVariable → RILL-R005.
     * EC-2/EC-3: Non-type, non-shape value → RILL-R004.
     */
    resolveTypeRef(
      typeRef: TypeRef,
      getVariable: (name: string) => RillValue | undefined
    ): RillTypeValue | RillShape {
      if (typeRef.kind === 'static') {
        return Object.freeze({
          __rill_type: true as const,
          typeName: typeRef.typeName,
        });
      }

      const result = getVariable(typeRef.varName);
      if (result === undefined) {
        throw new RuntimeError(
          'RILL-R005',
          `Variable $${typeRef.varName} is not defined`
        );
      }
      if (isTypeValue(result)) return result;
      if (isShape(result)) return result;

      throw new RuntimeError(
        'RILL-R004',
        `Variable $${typeRef.varName} is not a valid type reference (got ${inferType(result)})`
      );
    }

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
      if (expected === 'any') return value;
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
     * Validate a value against a shape definition [IR-5].
     *
     * Reports the first failure only — consistent with rill's singular control flow.
     * Extra fields in the dict not declared in the shape pass silently (lenient).
     * Enum annotation validation runs for both assert and check paths.
     * Nested shapes validated recursively with dot-separated field path.
     *
     * @param value - The value to validate
     * @param shape - The shape definition to validate against
     * @param path - Dot-separated path prefix (empty string for top-level)
     * @param location - Source location for error reporting
     *
     * Error contracts:
     * - EC-1: value not a dict -> "Shape assertion failed: expected dict, got <type>"
     * - EC-2: required field absent -> "Shape assertion failed: missing required field "<path>""
     * - EC-3: field type mismatch -> "Shape assertion failed: field "<path>" expected <type>, got <type>"
     * - EC-4: enum violation -> "Shape assertion failed: field "<path>" value not in enum"
     */
    validateAgainstShape(
      value: RillValue,
      shape: RillShape,
      path: string,
      location: SourceLocation
    ): void {
      // EC-1: input must be a dict [AC-34]
      if (!isDict(value)) {
        throw new RuntimeError(
          'RILL-R004',
          `Shape assertion failed: expected dict, got ${inferType(value)}`,
          location
        );
      }

      const dict = value as Record<string, RillValue>;

      for (const [fieldName, spec] of Object.entries(shape.fields)) {
        const fieldPath = path === '' ? fieldName : `${path}.${fieldName}`;
        const fieldPresent = fieldName in dict;

        // AC-14: any? (optional any) — absent passes, present with any type passes
        // AC-12: optional field absent — skip silently
        if (!fieldPresent) {
          if (spec.optional) {
            // optional field absent: pass silently (covers any? as well)
            continue;
          }
          // EC-2: required field missing [AC-8]
          throw new RuntimeError(
            'RILL-R004',
            `Shape assertion failed: missing required field "${fieldPath}"`,
            location
          );
        }

        // Field is present
        const fieldValue = dict[fieldName] as RillValue;

        // Recursive nested shape validation [AC-20, AC-21, AC-38]
        // Must check nestedShape BEFORE the flat type equality check because
        // nestedShape fields carry typeName='shape' but the value is a dict
        // (inferType returns "dict", not "shape"). Delegating to recursion
        // lets the recursive call's EC-1 check validate the dict requirement.
        if (spec.nestedShape !== undefined) {
          this.validateAgainstShape(
            fieldValue,
            spec.nestedShape,
            fieldPath,
            location
          );
        } else if (spec.typeName !== 'any') {
          // AC-14: any (required or optional) with field present — skip type check
          // EC-3: field type mismatch [AC-9, AC-13]
          const actualType = inferType(fieldValue);
          if (actualType !== spec.typeName) {
            throw new RuntimeError(
              'RILL-R004',
              `Shape assertion failed: field "${fieldPath}" expected ${spec.typeName}, got ${actualType}`,
              location
            );
          }
        }

        // EC-4: enum annotation validation [AC-18]
        const enumAnnotation = spec.annotations['enum'];
        if (enumAnnotation !== undefined && Array.isArray(enumAnnotation)) {
          const inEnum = enumAnnotation.some((allowed) =>
            deepEquals(fieldValue, allowed)
          );
          if (!inEnum) {
            throw new RuntimeError(
              'RILL-R004',
              `Shape assertion failed: field "${fieldPath}" value not in enum`,
              location
            );
          }
        }
      }
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

      const resolved = this.resolveTypeRef(node.typeRef, (name) =>
        getVariable(this.ctx, name)
      );
      if (isTypeValue(resolved)) {
        return this.assertType(value, resolved.typeName, node.span.start);
      }
      this.validateAgainstShape(value, resolved, '', node.span.start);
      return value;
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

      const resolved = this.resolveTypeRef(node.typeRef, (name) =>
        getVariable(this.ctx, name)
      );
      if (isTypeValue(resolved)) {
        return checkType(value, resolved.typeName);
      }
      try {
        this.validateAgainstShape(value, resolved, '', node.span.start);
        return true;
      } catch {
        return false;
      }
    }

    /**
     * Evaluate a shape literal node into a frozen RillShape value [IR-3].
     *
     * Iterates node.fields to build ShapeFieldSpec entries. For nested
     * ShapeLiteralNode field types, recurses into evaluateShapeLiteral().
     * Processes spread expressions by inlining source shape fields.
     * Returns a frozen RillShape with frozen fields map.
     */
    async evaluateShapeLiteral(node: ShapeLiteralNode): Promise<RillShape> {
      const fields: Record<string, ShapeFieldSpec> = {};

      // Process spread expressions first so explicit fields can override [AC-22, AC-23]
      for (const spreadExpr of node.spreads) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const spreadValue = await (this as any).evaluateExpression(spreadExpr);
        if (!isShape(spreadValue)) {
          throw new RuntimeError(
            'RILL-R004',
            `Shape spread requires a shape value, got ${inferType(spreadValue as RillValue)}`,
            spreadExpr.span.start
          );
        }
        // Inline all fields from the source shape (including annotations) [AC-23]
        for (const [name, spec] of Object.entries(spreadValue.fields)) {
          fields[name] = spec;
        }
      }

      // Process explicit fields (may override spread fields)
      for (const field of node.fields) {
        let typeName: string;
        let nestedShape: RillShape | undefined;

        if ('kind' in field.fieldType) {
          // TypeRef — resolve at shape-creation time
          const resolved = this.resolveTypeRef(field.fieldType, (name) =>
            getVariable(this.ctx, name)
          );
          if (isTypeValue(resolved)) {
            typeName = resolved.typeName;
            nestedShape = undefined;
          } else {
            // isShape(resolved) — dynamic reference resolved to a shape
            typeName = 'shape';
            nestedShape = resolved;
          }
        } else {
          // ShapeLiteralNode — inline nested shape syntax
          typeName = 'shape';
          nestedShape = await this.evaluateShapeLiteral(field.fieldType);
        }

        // Evaluate field-level annotations into a key→value record
        const annotations: Record<string, RillValue> = {};
        const rawAnnotations: AnnotationArg[] = field.annotations ?? [];
        if (rawAnnotations.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const evaluated = await (this as any).evaluateAnnotations(
            rawAnnotations
          );
          Object.assign(annotations, evaluated);
        }

        const spec: ShapeFieldSpec = {
          typeName,
          optional: field.optional,
          nestedShape,
          annotations,
        };
        fields[field.name] = spec;
      }

      return Object.freeze({
        __rill_shape: true as const,
        fields: Object.freeze(fields),
      });
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

    /**
     * Evaluate inline shape assertion: expr:shape(...) or :shape(...) [IR-2].
     *
     * Evaluates the inline shape literal then validates the input against it.
     * Returns input unchanged on success [AC-7].
     */
    async evaluateShapeAssertion(
      node: ShapeAssertionNode,
      input: RillValue
    ): Promise<RillValue> {
      const value = node.operand
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (this as any).evaluatePostfixExpr(node.operand)
        : input;

      const shape = await this.evaluateShapeLiteral(node.shape);
      this.validateAgainstShape(value, shape, '', node.span.start);
      return value;
    }

    /**
     * Evaluate inline shape check: expr:?shape(...) or :?shape(...) [IR-2].
     *
     * Same as evaluateShapeAssertion but never throws.
     * Returns true on success, false on any error [AC-11].
     */
    async evaluateShapeCheck(
      node: ShapeCheckNode,
      input: RillValue
    ): Promise<boolean> {
      try {
        const value = node.operand
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (this as any).evaluatePostfixExpr(node.operand)
          : input;

        const shape = await this.evaluateShapeLiteral(node.shape);
        this.validateAgainstShape(value, shape, '', node.span.start);
        return true;
      } catch {
        return false;
      }
    }
  };
}

// Export with type assertion to work around TS4094 limitation
// TypeScript can't generate declarations for functions returning classes with protected members
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TypesMixin = createTypesMixin as any;
