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
 * - evaluateTypeConstructor(node) -> Promise<RillTypeValue> [IR-7]
 * - evaluateClosureSigLiteral(node) -> Promise<RillTypeValue> [IR-8]
 *
 * Error Handling:
 * - Type assertion failures throw RuntimeError(RUNTIME_TYPE_ERROR) [EC-24]
 * - Type constructor argument errors throw RuntimeError [EC-4 through EC-7]
 * - Closure sig literal errors throw RuntimeError [EC-8, EC-9]
 *
 * @internal
 */

import type {
  TypeAssertionNode,
  TypeCheckNode,
  TypeConstructorNode,
  ClosureSigLiteralNode,
  RillTypeName,
  SourceLocation,
  TypeRef,
  TypeRefArg,
} from '../../../../types.js';
import { RuntimeError } from '../../../../types.js';
import type {
  RillValue,
  RillTypeValue,
  RillType,
  RillFieldDef,
} from '../../values.js';
import {
  inferType,
  checkType,
  isTypeValue,
  structuralTypeMatches,
  inferStructuralType,
  formatStructuralType,
} from '../../values.js';
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
 * - evaluateExpression() (from CoreMixin, for type constructor arg evaluation)
 *
 * Methods added:
 * - assertType(value, expected, location?) -> RillValue
 * - evaluateTypeAssertion(node, input) -> Promise<RillValue>
 * - evaluateTypeCheck(node, input) -> Promise<boolean>
 * - evaluateTypeAssertionPrimary(node) -> Promise<RillValue>
 * - evaluateTypeCheckPrimary(node) -> Promise<boolean>
 * - evaluateTypeConstructor(node) -> Promise<RillTypeValue>
 * - evaluateClosureSigLiteral(node) -> Promise<RillTypeValue>
 */
function createTypesMixin(Base: EvaluatorConstructor<EvaluatorBase>) {
  return class TypesEvaluator extends Base {
    /**
     * Resolve a TypeRef to a RillTypeValue [IR-2].
     *
     * Static refs with no args return a frozen RillTypeValue directly.
     * Static refs with args build a parameterized RillType.
     * Dynamic refs call getVariable, then dispatch on the result:
     * - RillTypeValue → return as-is
     * - Otherwise → throw RILL-R004
     *
     * EC-1: Variable not found → undefined from getVariable → RILL-R005.
     * EC-2: Non-type variable value → RILL-R004.
     * EC-3: Leaf type with args → RILL-R004.
     * EC-4: list with != 1 positional arg → RILL-R004.
     * EC-5: dict/ordered with positional arg → RILL-R004.
     * EC-6: tuple with named arg → RILL-R004.
     * EC-7: arg value is not a type value → RILL-R004.
     */
    resolveTypeRef(
      typeRef: TypeRef,
      getVariable: (name: string) => RillValue | undefined
    ): RillTypeValue {
      if (typeRef.kind === 'static') {
        const { typeName, args } = typeRef;

        // No args: existing bare-type behavior
        if (!args || args.length === 0) {
          return Object.freeze({
            __rill_type: true as const,
            typeName,
            structure: { type: typeName } as RillType,
          });
        }

        // EC-3: Leaf types reject all type arguments
        const LEAF_TYPES: ReadonlySet<RillTypeName> = new Set([
          'string',
          'number',
          'bool',
          'vector',
          'type',
          'any',
          'closure',
        ]);
        if (LEAF_TYPES.has(typeName)) {
          throw new RuntimeError(
            'RILL-R004',
            `${typeName} does not accept type arguments`
          );
        }

        // Helper: recursively resolve one TypeRefArg to RillType
        const resolveArg = (arg: TypeRefArg): RillType => {
          const resolved = this.resolveTypeRef(arg.ref, getVariable);
          return resolved.structure;
        };

        if (typeName === 'list') {
          // EC-4: list requires exactly 1 positional arg
          if (args.length !== 1 || args[0]!.name !== undefined) {
            throw new RuntimeError(
              'RILL-R004',
              'list() requires exactly 1 type argument'
            );
          }
          const structure: RillType = {
            type: 'list',
            element: resolveArg(args[0]!),
          };
          return Object.freeze({
            __rill_type: true as const,
            typeName,
            structure,
          });
        }

        if (typeName === 'dict') {
          // EC-5: dict requires named args only
          for (const arg of args) {
            if (arg.name === undefined) {
              throw new RuntimeError(
                'RILL-R004',
                'dict() requires named arguments (field: type)'
              );
            }
          }
          const fields: Record<string, RillFieldDef> = {};
          for (const arg of args) {
            fields[arg.name!] = { type: resolveArg(arg) };
          }
          const structure: RillType = { type: 'dict', fields };
          return Object.freeze({
            __rill_type: true as const,
            typeName,
            structure,
          });
        }

        if (typeName === 'tuple') {
          // EC-6: tuple requires positional args only
          for (const arg of args) {
            if (arg.name !== undefined) {
              throw new RuntimeError(
                'RILL-R004',
                'tuple() requires positional arguments'
              );
            }
          }
          const elements: RillFieldDef[] = args.map(
            (arg): RillFieldDef => ({ type: resolveArg(arg) })
          );
          const structure: RillType = { type: 'tuple', elements };
          return Object.freeze({
            __rill_type: true as const,
            typeName,
            structure,
          });
        }

        // typeName === 'ordered'
        // EC-5: ordered requires named args only
        for (const arg of args) {
          if (arg.name === undefined) {
            throw new RuntimeError(
              'RILL-R004',
              'ordered() requires named arguments (field: type)'
            );
          }
        }
        const orderedFields: RillFieldDef[] = args.map(
          (arg): RillFieldDef => ({ name: arg.name!, type: resolveArg(arg) })
        );
        const structure: RillType = {
          type: 'ordered',
          fields: orderedFields,
        };
        return Object.freeze({
          __rill_type: true as const,
          typeName,
          structure,
        });
      }

      // Union type ref: (A | B) — resolve each member recursively and
      // return a RillTypeValue with structure: { type: 'union', members: [...] }.
      // typeName is set to a display string for error messages; the structure
      // field carries the authoritative type shape for validation (DR-1).
      if (typeRef.kind === 'union') {
        const members: RillType[] = typeRef.members.map((member) => {
          const resolved = this.resolveTypeRef(member, getVariable);
          return resolved.structure;
        });
        const structure: RillType = { type: 'union', members };
        const displayName = members
          .map(formatStructuralType)
          .join('|') as RillTypeName;
        return Object.freeze({
          __rill_type: true as const,
          typeName: displayName,
          structure,
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

      throw new RuntimeError(
        'RILL-R004',
        `Variable $${typeRef.varName} is not a valid type reference (got ${inferType(result)})`
      );
    }

    /**
     * Assert that a value is of the expected type.
     * Returns the value unchanged if assertion passes, throws on mismatch.
     * Accepts a bare RillTypeName or a full RillType.
     * When expected is a RillType with sub-fields (element, fields, elements),
     * dispatches to structuralTypeMatches for deep validation.
     * Exported for use by type assertion evaluation.
     */
    assertType(
      value: RillValue,
      expected: RillTypeName | RillType,
      location?: SourceLocation
    ): RillValue {
      // Structural path: expected is a RillType object
      if (typeof expected !== 'string') {
        const hasSubFields =
          'element' in expected ||
          'fields' in expected ||
          'elements' in expected ||
          'members' in expected;
        if (hasSubFields) {
          if (!structuralTypeMatches(value, expected)) {
            const expectedStr = formatStructuralType(expected);
            const actualStr = formatStructuralType(inferStructuralType(value));
            throw new RuntimeError(
              'RILL-R004',
              `Type assertion failed: expected ${expectedStr}, got ${actualStr}`,
              location,
              { expectedType: expectedStr, actualType: actualStr }
            );
          }
          return value;
        }
        // Bare structural type (no sub-fields): fall through using type name
        expected = expected.type as RillTypeName;
      }
      // Bare type name path
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
      return this.assertType(value, resolved.structure, node.span.start);
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
      const hasSubFields =
        'element' in resolved.structure ||
        'fields' in resolved.structure ||
        'elements' in resolved.structure ||
        'members' in resolved.structure;
      if (hasSubFields) {
        return structuralTypeMatches(value, resolved.structure);
      }
      return checkType(value, resolved.typeName);
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
     * Evaluate a type constructor node into a RillTypeValue [IR-7].
     *
     * Handles list(T), dict(k: T, ...), tuple(T1, T2, ...), ordered(k: T, ...).
     * All arguments must evaluate to RillTypeValue.
     *
     * Error contracts:
     * - EC-4: list() with != 1 arg -> RILL-R004
     * - EC-5: non-type argument -> RILL-R004
     * - EC-6: positional arg in dict/ordered -> RILL-R004
     * - EC-7: named arg in tuple -> RILL-R004
     */
    async evaluateTypeConstructor(
      node: TypeConstructorNode
    ): Promise<RillTypeValue> {
      const name = node.constructorName;
      const location = node.span.start;

      // Helper: evaluate one arg expression and assert it is a RillTypeValue
      const resolveArgAsType = async (
        argValue: RillValue
      ): Promise<RillType> => {
        if (!isTypeValue(argValue)) {
          throw new RuntimeError(
            'RILL-R004',
            `Type constructor argument must be a type value, got ${inferType(argValue)}`,
            location
          );
        }
        return argValue.structure.type === 'any' &&
          argValue.typeName !== ('any' as RillTypeName)
          ? ({ type: argValue.typeName } as RillType)
          : argValue.structure;
      };

      if (name === 'list') {
        // EC-4: list() requires exactly 1 argument
        if (node.args.length !== 1) {
          throw new RuntimeError(
            'RILL-R004',
            'list() requires exactly 1 type argument',
            location
          );
        }
        const arg = node.args[0]!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const argVal: RillValue = await (this as any).evaluateExpression(
          arg.value
        );
        const elementType = await resolveArgAsType(argVal);
        const structure: RillType = {
          type: 'list',
          element: elementType,
        };
        return Object.freeze({
          __rill_type: true as const,
          typeName: 'list' as RillTypeName,
          structure,
        });
      }

      if (name === 'dict') {
        // EC-6: dict() requires named arguments
        for (const arg of node.args) {
          if (arg.kind === 'positional') {
            throw new RuntimeError(
              'RILL-R004',
              'dict() requires named arguments (field: type)',
              location
            );
          }
        }
        const fields: Record<string, RillFieldDef> = {};
        for (const arg of node.args) {
          if (arg.kind === 'named') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const argVal: RillValue = await (this as any).evaluateExpression(
              arg.value
            );
            const resolvedType = await resolveArgAsType(argVal);
            if (arg.defaultValue !== undefined) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const defaultVal: RillValue = await (this as any).evaluatePrimary(
                arg.defaultValue
              );
              if (!structuralTypeMatches(defaultVal, resolvedType)) {
                throw new RuntimeError(
                  'RILL-R004',
                  `Default value for field '${arg.name}' must be ${formatStructuralType(resolvedType)}, got ${inferType(defaultVal)}`,
                  location
                );
              }
              fields[arg.name] = {
                type: resolvedType,
                defaultValue: defaultVal,
              };
            } else {
              fields[arg.name] = { type: resolvedType };
            }
          }
        }
        const structure: RillType = { type: 'dict', fields };
        return Object.freeze({
          __rill_type: true as const,
          typeName: 'dict' as RillTypeName,
          structure,
        });
      }

      if (name === 'tuple') {
        // EC-7: tuple() requires positional arguments
        for (const arg of node.args) {
          if (arg.kind === 'named') {
            throw new RuntimeError(
              'RILL-R004',
              'tuple() requires positional arguments',
              location
            );
          }
        }
        const elements: RillFieldDef[] = [];
        for (const arg of node.args) {
          if (arg.kind === 'positional') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const argVal: RillValue = await (this as any).evaluateExpression(
              arg.value
            );
            const resolvedType = await resolveArgAsType(argVal);
            if (arg.defaultValue !== undefined) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const defaultVal: RillValue = await (this as any).evaluatePrimary(
                arg.defaultValue
              );
              elements.push({ type: resolvedType, defaultValue: defaultVal });
            } else {
              elements.push({ type: resolvedType });
            }
          }
        }
        // EC-3: defaults must be trailing-only — no element without a default
        // may follow an element that has one.
        let sawDefault = false;
        for (let i = 0; i < elements.length; i++) {
          const hasDefault = elements[i]!.defaultValue !== undefined;
          if (hasDefault) {
            sawDefault = true;
          } else if (sawDefault) {
            throw new RuntimeError(
              'RILL-P003',
              `tuple() default values must be trailing: element at position ${i} has no default but a preceding element does`,
              location
            );
          }
        }
        const structure: RillType = { type: 'tuple', elements };
        return Object.freeze({
          __rill_type: true as const,
          typeName: 'tuple' as RillTypeName,
          structure,
        });
      }

      // name === 'ordered'
      // EC-6: ordered() requires named arguments
      for (const arg of node.args) {
        if (arg.kind === 'positional') {
          throw new RuntimeError(
            'RILL-R004',
            'ordered() requires named arguments (field: type)',
            location
          );
        }
      }
      const orderedFields: RillFieldDef[] = [];
      for (const arg of node.args) {
        if (arg.kind === 'named') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const argVal: RillValue = await (this as any).evaluateExpression(
            arg.value
          );
          const resolvedType = await resolveArgAsType(argVal);
          if (arg.defaultValue !== undefined) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const defaultVal: RillValue = await (this as any).evaluatePrimary(
              arg.defaultValue
            );
            if (!structuralTypeMatches(defaultVal, resolvedType)) {
              throw new RuntimeError(
                'RILL-R004',
                `Default value for field '${arg.name}' must be ${formatStructuralType(resolvedType)}, got ${inferType(defaultVal)}`,
                location
              );
            }
            orderedFields.push({
              name: arg.name,
              type: resolvedType,
              defaultValue: defaultVal,
            });
          } else {
            orderedFields.push({ name: arg.name, type: resolvedType });
          }
        }
      }
      const structure: RillType = {
        type: 'ordered',
        fields: orderedFields,
      };
      return Object.freeze({
        __rill_type: true as const,
        typeName: 'ordered' as RillTypeName,
        structure,
      });
    }

    /**
     * Evaluate a closure signature literal into a RillTypeValue [IR-8].
     *
     * Creates a closure type value from |param: T, ...|: R syntax.
     * Each parameter produces a [name, RillType] entry.
     *
     * Error contracts:
     * - EC-8: missing return type -> RILL-R004 (enforced at parse time; node always has returnType)
     * - EC-9: non-type in parameter position -> RILL-R004
     */
    async evaluateClosureSigLiteral(
      node: ClosureSigLiteralNode
    ): Promise<RillTypeValue> {
      const location = node.span.start;

      // Helper: evaluate a type expression and extract RillType
      const resolveTypeExpr = async (argVal: RillValue): Promise<RillType> => {
        if (!isTypeValue(argVal)) {
          throw new RuntimeError(
            'RILL-R004',
            `Parameter type must be a type value, got ${inferType(argVal)}`,
            location
          );
        }
        return argVal.structure.type === 'any' &&
          argVal.typeName !== ('any' as RillTypeName)
          ? ({ type: argVal.typeName } as RillType)
          : argVal.structure;
      };

      // Evaluate parameter types
      const params: RillFieldDef[] = [];
      for (const param of node.params) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const paramVal: RillValue = await (this as any).evaluateExpression(
          param.typeExpr
        );
        const paramType = await resolveTypeExpr(paramVal);
        params.push({ name: param.name, type: paramType });
      }

      // Evaluate return type (EC-8: required — parser enforces this at parse time)
      // returnType is PostfixExprNode (stops before pipe operators) so the
      // return type annotation cannot accidentally consume a trailing pipe chain.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const retVal: RillValue = await (this as any).evaluatePostfixExpr(
        node.returnType
      );
      if (!isTypeValue(retVal)) {
        throw new RuntimeError(
          'RILL-R004',
          `Closure type literal requires return type after |, got ${inferType(retVal)}`,
          location
        );
      }
      const ret: RillType =
        retVal.structure.type === 'any' &&
        retVal.typeName !== ('any' as RillTypeName)
          ? ({ type: retVal.typeName } as RillType)
          : retVal.structure;

      const structure: RillType = { type: 'closure', params, ret };
      return Object.freeze({
        __rill_type: true as const,
        typeName: 'closure' as RillTypeName,
        structure,
      });
    }
  };
}

// Export with type assertion to work around TS4094 limitation
// TypeScript can't generate declarations for functions returning classes with protected members
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TypesMixin = createTypesMixin as any;
