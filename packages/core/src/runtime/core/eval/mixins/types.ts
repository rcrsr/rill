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
 * - resolveTypeRef(typeRef, getVariable) -> Promise<RillTypeValue> [IR-2]
 * - buildCollectionType(name, args, resolveArg, evaluateDefault, location?) -> Promise<RillTypeValue> [IR-4]
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
  LiteralNode,
  RillTypeName,
  SourceLocation,
  TypeRef,
  FieldArg,
} from '../../../../types.js';
import { RuntimeError } from '../../../../types.js';
import type {
  RillValue,
  RillTypeValue,
  TypeStructure,
  RillFieldDef,
} from '../../values.js';
import {
  inferType,
  checkType,
  isTypeValue,
  structureMatches,
  inferStructure,
  formatStructure,
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
 * - evaluatePrimary() (from CoreMixin, for default value evaluation)
 *
 * Methods added:
 * - assertType(value, expected, location?) -> RillValue
 * - evaluateTypeAssertion(node, input) -> Promise<RillValue>
 * - evaluateTypeCheck(node, input) -> Promise<boolean>
 * - evaluateTypeAssertionPrimary(node) -> Promise<RillValue>
 * - evaluateTypeCheckPrimary(node) -> Promise<boolean>
 * - evaluateTypeConstructor(node) -> Promise<RillTypeValue>
 * - evaluateClosureSigLiteral(node) -> Promise<RillTypeValue>
 * - resolveTypeRef(typeRef, getVariable) -> Promise<RillTypeValue>
 * - buildCollectionType(name, args, resolveArg, evaluateDefault, location?) -> Promise<RillTypeValue>
 */
function createTypesMixin(Base: EvaluatorConstructor<EvaluatorBase>) {
  return class TypesEvaluator extends Base {
    /**
     * Shared helper that partitions args, enforces validation, evaluates
     * defaults, and constructs a RillTypeValue [IR-4].
     *
     * Called by both resolveTypeRef and evaluateTypeConstructor with
     * different resolution/evaluation strategies via callbacks.
     *
     * Error contracts:
     * - EC-B1: Leaf type with args -> RILL-R004
     * - EC-B2: list != 1 arg -> RILL-R004
     * - EC-B3: Positional+named mix -> RILL-R004
     * - EC-B4: tuple with named arg -> RILL-R004
     * - EC-B5: Non-type arg value (delegated to resolveArg callback)
     * - EC-B6: Default type mismatch -> RILL-R004
     * - EC-B7: Tuple non-trailing default -> RILL-R004
     */
    async buildCollectionType(
      name: 'list' | 'dict' | 'tuple' | 'ordered',
      args: FieldArg[],
      resolveArg: (arg: FieldArg) => Promise<TypeStructure>,
      evaluateDefault: (node: LiteralNode) => Promise<RillValue>,
      location?: SourceLocation
    ): Promise<RillTypeValue> {
      if (name === 'list') {
        // EC-B2: list requires exactly 1 positional arg
        if (args.length !== 1 || args[0]!.name !== undefined) {
          throw new RuntimeError(
            'RILL-R004',
            'list() requires exactly 1 type argument',
            location
          );
        }
        const element = await resolveArg(args[0]!);
        const structure: TypeStructure = { kind: 'list', element };
        return Object.freeze({
          __rill_type: true as const,
          typeName: name as RillTypeName,
          structure,
        });
      }

      if (name === 'dict' || name === 'ordered') {
        const positional = args.filter((a) => a.name === undefined);
        const named = args.filter((a) => a.name !== undefined);

        // EC-B3: Cannot mix positional and named arguments
        if (positional.length > 0 && named.length > 0) {
          throw new RuntimeError(
            'RILL-R004',
            `${name}() cannot mix positional and named arguments`,
            location
          );
        }

        // Uniform path: exactly 1 positional, 0 named -> valueType
        if (positional.length === 1 && named.length === 0) {
          const valueType = await resolveArg(positional[0]!);
          // EC-B6: Default type mismatch on uniform single-arg path
          if (positional[0]!.defaultValue !== undefined) {
            const defaultVal = await evaluateDefault(
              positional[0]!.defaultValue
            );
            if (!structureMatches(defaultVal, valueType)) {
              throw new RuntimeError(
                'RILL-R004',
                `Default value for ${name} element must be ${formatStructure(valueType)}, got ${inferType(defaultVal)}`,
                location
              );
            }
          }
          const structure: TypeStructure = { kind: name, valueType };
          return Object.freeze({
            __rill_type: true as const,
            typeName: name as RillTypeName,
            structure,
          });
        }

        // EC: dict/ordered with 2+ positional args
        if (positional.length >= 2) {
          throw new RuntimeError(
            'RILL-R004',
            `${name}() requires exactly 1 positional type argument`,
            location
          );
        }

        // Structural path: named args only -> fields
        if (name === 'dict') {
          const fields: Record<string, RillFieldDef> = {};
          for (const arg of args) {
            const resolvedType = await resolveArg(arg);
            const fieldDef: RillFieldDef = { type: resolvedType };
            if (arg.defaultValue !== undefined) {
              const defaultVal = await evaluateDefault(arg.defaultValue);
              // EC-B6: Default type mismatch
              if (!structureMatches(defaultVal, resolvedType)) {
                throw new RuntimeError(
                  'RILL-R004',
                  `Default value for field '${arg.name}' must be ${formatStructure(resolvedType)}, got ${inferType(defaultVal)}`,
                  location
                );
              }
              fieldDef.defaultValue = defaultVal;
            }
            fields[arg.name!] = fieldDef;
          }
          const structure: TypeStructure = { kind: 'dict', fields };
          return Object.freeze({
            __rill_type: true as const,
            typeName: name as RillTypeName,
            structure,
          });
        }

        // name === 'ordered': structural path -> fields array with name
        const orderedFields: RillFieldDef[] = [];
        for (const arg of args) {
          const resolvedType = await resolveArg(arg);
          const fieldDef: RillFieldDef = {
            name: arg.name!,
            type: resolvedType,
          };
          if (arg.defaultValue !== undefined) {
            const defaultVal = await evaluateDefault(arg.defaultValue);
            // EC-B6: Default type mismatch
            if (!structureMatches(defaultVal, resolvedType)) {
              throw new RuntimeError(
                'RILL-R004',
                `Default value for field '${arg.name}' must be ${formatStructure(resolvedType)}, got ${inferType(defaultVal)}`,
                location
              );
            }
            fieldDef.defaultValue = defaultVal;
          }
          orderedFields.push(fieldDef);
        }
        const structure: TypeStructure = {
          kind: 'ordered',
          fields: orderedFields,
        };
        return Object.freeze({
          __rill_type: true as const,
          typeName: name as RillTypeName,
          structure,
        });
      }

      // name === 'tuple'
      // EC-B4: tuple requires positional args only
      for (const arg of args) {
        if (arg.name !== undefined) {
          throw new RuntimeError(
            'RILL-R004',
            'tuple() requires positional arguments',
            location
          );
        }
      }

      // Uniform path: exactly 1 positional -> valueType
      if (args.length === 1 && args[0]!.name === undefined) {
        const valueType = await resolveArg(args[0]!);
        // EC-B6: Default type mismatch on uniform single-arg path
        if (args[0]!.defaultValue !== undefined) {
          const defaultVal = await evaluateDefault(args[0]!.defaultValue);
          if (!structureMatches(defaultVal, valueType)) {
            throw new RuntimeError(
              'RILL-R004',
              `Default value for tuple element must be ${formatStructure(valueType)}, got ${inferType(defaultVal)}`,
              location
            );
          }
        }
        const structure: TypeStructure = { kind: 'tuple', valueType };
        return Object.freeze({
          __rill_type: true as const,
          typeName: 'tuple' as RillTypeName,
          structure,
        });
      }

      // Structural path: 2+ positional -> elements
      const elements: RillFieldDef[] = [];
      for (const arg of args) {
        const resolvedType = await resolveArg(arg);
        const fieldDef: RillFieldDef = { type: resolvedType };
        if (arg.defaultValue !== undefined) {
          const defaultVal = await evaluateDefault(arg.defaultValue);
          // EC-B6: Default type mismatch
          if (!structureMatches(defaultVal, resolvedType)) {
            throw new RuntimeError(
              'RILL-R004',
              `Default value for tuple element must be ${formatStructure(resolvedType)}, got ${inferType(defaultVal)}`,
              location
            );
          }
          fieldDef.defaultValue = defaultVal;
        }
        elements.push(fieldDef);
      }

      // EC-B7: Tuple non-trailing default — no element without a default
      // may follow an element that has one.
      let sawDefault = false;
      for (let i = 0; i < elements.length; i++) {
        const hasDefault = elements[i]!.defaultValue !== undefined;
        if (hasDefault) {
          sawDefault = true;
        } else if (sawDefault) {
          throw new RuntimeError(
            'RILL-R004',
            `tuple() default values must be trailing: element at position ${i} has no default but a preceding element does`,
            location
          );
        }
      }

      const structure: TypeStructure = { kind: 'tuple', elements };
      return Object.freeze({
        __rill_type: true as const,
        typeName: 'tuple' as RillTypeName,
        structure,
      });
    }

    /**
     * Resolve a TypeRef to a RillTypeValue [IR-2].
     *
     * Static refs with no args return a frozen RillTypeValue directly.
     * Static refs with args delegate to buildCollectionType.
     * Dynamic refs call getVariable, then dispatch on the result:
     * - RillTypeValue -> return as-is
     * - Otherwise -> throw RILL-R004
     *
     * EC-3: Variable not found -> RILL-R005.
     * EC-4: Non-type variable value -> RILL-R004.
     * EC-5: list with != 1 positional arg -> RILL-R004.
     * EC-6: dict/ordered positional+named mix -> RILL-R004.
     * EC-7: tuple with named arg -> RILL-R004.
     * EC-8: Default type mismatch -> RILL-R004.
     * EC-9: Default evaluation failure -> propagated.
     * EC-10: Tuple non-trailing default -> RILL-R004.
     */
    async resolveTypeRef(
      typeRef: TypeRef,
      getVariableFn: (name: string) => RillValue | undefined
    ): Promise<RillTypeValue> {
      if (typeRef.kind === 'static') {
        const { typeName, args } = typeRef;

        // No args: existing bare-type behavior
        if (!args || args.length === 0) {
          return Object.freeze({
            __rill_type: true as const,
            typeName,
            structure: { kind: typeName } as TypeStructure,
          });
        }

        // EC-B1: Leaf types reject all type arguments (AC-4: derived from registrations)
        if (this.ctx.leafTypes.has(typeName)) {
          throw new RuntimeError(
            'RILL-R004',
            `${typeName} does not accept type arguments`
          );
        }

        // Delegate to buildCollectionType with recursive resolveTypeRef
        return this.buildCollectionType(
          typeName as 'list' | 'dict' | 'tuple' | 'ordered',
          args,
          async (arg: FieldArg): Promise<TypeStructure> => {
            const resolved = await this.resolveTypeRef(
              arg.value,
              getVariableFn
            );
            return resolved.structure;
          },
          async (node: LiteralNode): Promise<RillValue> => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (this as any).evaluatePrimary(node);
          }
        );
      }

      // Union type ref: (A | B) -- resolve each member recursively and
      // return a RillTypeValue with structure: { kind: 'union', members: [...] }.
      // typeName is set to a display string for error messages; the structure
      // field carries the authoritative type shape for validation (DR-1).
      if (typeRef.kind === 'union') {
        const members: TypeStructure[] = [];
        for (const member of typeRef.members) {
          const resolved = await this.resolveTypeRef(member, getVariableFn);
          members.push(resolved.structure);
        }
        const structure: TypeStructure = { kind: 'union', members };
        const displayName = members
          .map(formatStructure)
          .join('|') as RillTypeName;
        return Object.freeze({
          __rill_type: true as const,
          typeName: displayName,
          structure,
        });
      }

      const result = getVariableFn(typeRef.varName);
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
     * Accepts a bare RillTypeName or a full TypeStructure.
     * When expected is a TypeStructure with sub-fields (element, fields, elements),
     * dispatches to structureMatches for deep validation.
     * Exported for use by type assertion evaluation.
     */
    assertType(
      value: RillValue,
      expected: RillTypeName | TypeStructure,
      location?: SourceLocation
    ): RillValue {
      // Structural path: expected is a TypeStructure object
      if (typeof expected !== 'string') {
        const hasSubFields =
          'element' in expected ||
          'fields' in expected ||
          'elements' in expected ||
          'members' in expected ||
          'valueType' in expected;
        if (hasSubFields) {
          if (!structureMatches(value, expected)) {
            const expectedStr = formatStructure(expected);
            const actualStr = formatStructure(inferStructure(value));
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
        expected = expected.kind as RillTypeName;
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

      const resolved = await this.resolveTypeRef(node.typeRef, (name) =>
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

      const resolved = await this.resolveTypeRef(node.typeRef, (name) =>
        getVariable(this.ctx, name)
      );
      const hasSubFields =
        'element' in resolved.structure ||
        'fields' in resolved.structure ||
        'elements' in resolved.structure ||
        'members' in resolved.structure ||
        'valueType' in resolved.structure;
      if (hasSubFields) {
        return structureMatches(value, resolved.structure);
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
     * Handles list(T), dict(...), tuple(...), ordered(...).
     * Delegates to buildCollectionType with evaluateTypeConstructor-specific
     * resolution strategy (resolves TypeRef via resolveTypeRef, evaluates
     * defaults via evaluatePrimary).
     *
     * Error contracts delegated to buildCollectionType.
     */
    async evaluateTypeConstructor(
      node: TypeConstructorNode
    ): Promise<RillTypeValue> {
      const name = node.constructorName;
      const location = node.span.start;

      return this.buildCollectionType(
        name,
        node.args,
        async (arg: FieldArg): Promise<TypeStructure> => {
          const resolved = await this.resolveTypeRef(arg.value, (varName) =>
            getVariable(this.ctx, varName)
          );
          return resolved.structure.kind === 'any' &&
            resolved.typeName !== ('any' as RillTypeName)
            ? ({ kind: resolved.typeName } as TypeStructure)
            : resolved.structure;
        },
        async (node: LiteralNode): Promise<RillValue> => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).evaluatePrimary(node);
        },
        location
      );
    }

    /**
     * Evaluate a closure signature literal into a RillTypeValue [IR-8].
     *
     * Creates a closure type value from |param: T, ...|: R syntax.
     * Each parameter produces a [name, TypeStructure] entry.
     *
     * Error contracts:
     * - EC-8: missing return type -> RILL-R004 (enforced at parse time; node always has returnType)
     * - EC-9: non-type in parameter position -> RILL-R004
     */
    async evaluateClosureSigLiteral(
      node: ClosureSigLiteralNode
    ): Promise<RillTypeValue> {
      const location = node.span.start;

      // Helper: evaluate a type expression and extract TypeStructure
      const resolveTypeExpr = async (
        argVal: RillValue
      ): Promise<TypeStructure> => {
        if (!isTypeValue(argVal)) {
          throw new RuntimeError(
            'RILL-R004',
            `Parameter type must be a type value, got ${inferType(argVal)}`,
            location
          );
        }
        return argVal.structure.kind === 'any' &&
          argVal.typeName !== ('any' as RillTypeName)
          ? ({ kind: argVal.typeName } as TypeStructure)
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

      // Evaluate return type (EC-8: required -- parser enforces this at parse time)
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
      const ret: TypeStructure =
        retVal.structure.kind === 'any' &&
        retVal.typeName !== ('any' as RillTypeName)
          ? ({ kind: retVal.typeName } as TypeStructure)
          : retVal.structure;

      const structure: TypeStructure = { kind: 'closure', params, ret };
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
