/**
 * Callable Types
 *
 * Unified representation for all callable values in Rill:
 * - ScriptCallable: Closures parsed from Rill source code
 * - RuntimeCallable: Rill's built-in functions (type, log, json, identity)
 * - ApplicationCallable: Host application-provided functions
 *
 * Public API for host applications.
 *
 * ## Implementation Notes
 *
 * [DEVIATION] EC-1 Error Context Fields
 * - Spec defines error context as { functionName, paramName, expectedType, actualType }
 * - EC-1 (excess arguments) uses { functionName, expectedCount, actualCount }
 * - Rationale: Excess arguments is an arity check, not a type check
 *
 * [ASSUMPTION] validateDefaultValueType _functionName Parameter
 * - Parameter accepted but unused (prefixed with _ to satisfy eslint)
 * - Kept for API consistency with validateCallableArgs signature
 */

import type { BodyNode, SourceLocation } from '../../types.js';
import type { RillMethod } from './types.js';
import { RuntimeError } from '../../types.js';
import { astEquals } from './equals.js';
import type { RillType, RillTypeValue, RillValue } from './values.js';
import {
  formatValue,
  formatStructuralType,
  inferType,
  isTuple,
  structuralTypeEquals,
  structuralTypeMatches,
} from './values.js';

// Forward reference to RuntimeContext (defined in types.ts)
// Using a minimal interface to avoid circular dependency
interface RuntimeContextLike {
  readonly parent?: RuntimeContextLike | undefined;
  readonly variables: Map<string, RillValue>;
  pipeValue: RillValue;
  readonly metadata?: Record<string, string> | undefined;
}

/**
 * Callable function signature.
 * Used for both host-provided functions and runtime callables.
 */
export type CallableFn = (
  args: RillValue[],
  ctx: RuntimeContextLike,
  location?: SourceLocation
) => RillValue | Promise<RillValue>;

/**
 * Unified parameter definition for all callable types (script closures and host functions).
 *
 * - type: undefined means the parameter accepts any type (any-typed).
 * - defaultValue: undefined means the parameter is required.
 * - annotations: evaluated key-value pairs; empty object ({}) when no annotations present.
 * - Description lives at annotations.description — no separate description field.
 */
export interface RillParam {
  readonly name: string;
  readonly type: RillType | undefined;
  readonly defaultValue: RillValue | undefined;
  readonly annotations: Record<string, RillValue>;
}

/**
 * Unified host function definition using RillParam for parameter declarations.
 *
 * Replaces HostFunctionDefinition. Runtime does NOT validate return values
 * against returnType at call time.
 */
export interface RillFunction {
  readonly params: readonly RillParam[];
  readonly fn: CallableFn;
  readonly description?: string;
  readonly returnType?: RillType;
}

/**
 * Base interface for all callable signatures.
 * signature is an annotated rill closure type signature string.
 */
export interface RillCallableSignature {
  readonly signature: string;
}

/**
 * Signature for a host-provided function.
 * Discriminated from RillFunction by presence of signature field.
 */
export interface RillFunctionSignature extends RillCallableSignature {
  readonly fn: CallableFn;
}

/**
 * Signature for a built-in method with receiver type constraints.
 * receiverTypes contains valid RillTypeName strings (e.g., ["string", "list"]).
 */
export interface RillMethodSignature extends RillCallableSignature {
  readonly method: RillMethod;
  readonly receiverTypes: readonly string[];
}

/** Common fields for all callable types */
interface CallableBase {
  readonly __type: 'callable';
  /**
   * Property-style callable: auto-invoked when accessed from a dict.
   * For script callables, $ is bound to the containing dict.
   * For runtime callables, the dict is passed as first argument.
   */
  readonly isProperty: boolean;
  /** Reference to containing dict (set when stored in a dict) */
  boundDict?: Record<string, RillValue>;
}

/**
 * Script callable - parsed from Rill source code.
 *
 * Carries closure-level and parameter-level annotations captured at creation time.
 * Both annotation fields default to empty objects ({}) when no annotations present.
 */
export interface ScriptCallable extends CallableBase {
  readonly kind: 'script';
  readonly params: readonly RillParam[];
  readonly body: BodyNode;
  /** Reference to the scope where this closure was defined (late binding) */
  readonly definingScope: RuntimeContextLike;
  /** Evaluated closure-level annotations (e.g., ^(timeout: 30)) */
  readonly annotations: Record<string, RillValue>;
  /** Evaluated parameter annotations keyed by parameter name */
  readonly paramAnnotations: Record<string, Record<string, RillValue>>;
  /** Cached input structural type built from params at creation time — used by `$fn.^input` */
  readonly inputShape: RillType;
  /** Return type target from `:type-target` syntax — set in Phase 2, undefined until then */
  readonly returnShape?: RillTypeValue | undefined;
}

/** Runtime callable - Rill's built-in functions (type, log, json, identity) */
export interface RuntimeCallable extends CallableBase {
  readonly kind: 'runtime';
  readonly fn: CallableFn;
}

/** Application callable - host application-provided functions */
export interface ApplicationCallable extends CallableBase {
  readonly kind: 'application';
  readonly params: RillParam[] | undefined;
  readonly fn: CallableFn;
  /** Human-readable function description (optional, from host functions) */
  readonly description?: string;
  /** Return type declaration (optional, from host functions) */
  readonly returnType?: RillType | undefined;
  /** Original signature string as provided by host (only set for RillFunctionSignature registrations) */
  readonly originalSignature?: string | undefined;
}

/** Union of all callable types */
export type RillCallable =
  | ScriptCallable
  | RuntimeCallable
  | ApplicationCallable;

/** Type guard for any callable */
export function isCallable(value: RillValue): value is RillCallable {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__type' in value &&
    value.__type === 'callable'
  );
}

/** Type guard for script callable */
export function isScriptCallable(value: RillValue): value is ScriptCallable {
  return isCallable(value) && value.kind === 'script';
}

/** Type guard for runtime callable */
export function isRuntimeCallable(value: RillValue): value is RuntimeCallable {
  return isCallable(value) && value.kind === 'runtime';
}

/** Type guard for application callable */
export function isApplicationCallable(
  value: RillValue
): value is ApplicationCallable {
  return isCallable(value) && value.kind === 'application';
}

/**
 * Create an application callable from a host function.
 * Creates an untyped callable (params: undefined) that skips validation.
 * @param fn The function to wrap
 * @param isProperty If true, auto-invokes when accessed from dict (property-style)
 */
export function callable(
  fn: CallableFn,
  isProperty = false
): ApplicationCallable {
  return {
    __type: 'callable',
    kind: 'application',
    params: undefined,
    fn,
    isProperty,
  };
}

/** Type guard for dict (plain object, not array, not callable, not tuple) */
export function isDict(value: RillValue): value is Record<string, RillValue> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !isCallable(value) &&
    !isTuple(value)
  );
}

/** Format a callable for display */
export function formatCallable(callable: RillCallable): string {
  if (callable.kind === 'script') {
    const paramStr = callable.params.map((p) => p.name).join(', ');
    return `(${paramStr}) { ... }`;
  }
  return '(...) { [native] }';
}

/**
 * Compare two annotation records for equality.
 * Returns true if both records have the same keys and values.
 */
function annotationsEqual(
  a: Record<string, RillValue>,
  b: Record<string, RillValue>,
  valueEquals: (a: RillValue, b: RillValue) => boolean
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!(key in b)) return false;
    if (!valueEquals(a[key] as RillValue, b[key] as RillValue)) return false;
  }

  return true;
}

/**
 * Deep equality for script callables.
 * Compares params, body AST structure, defining scope, and annotations.
 *
 * Two closures are equal if:
 * 1. Same parameter names, types, default values, and annotations
 * 2. Structurally identical body AST (ignoring source locations)
 * 3. Same defining scope (reference equality)
 * 4. Same closure-level annotations
 * 5. Same parameter-level annotations
 */
export function callableEquals(
  a: ScriptCallable,
  b: ScriptCallable,
  valueEquals: (a: RillValue, b: RillValue) => boolean = (x, y) =>
    formatValue(x) === formatValue(y)
): boolean {
  // Compare params (name, type, default, annotations)
  if (a.params.length !== b.params.length) return false;
  for (let i = 0; i < a.params.length; i++) {
    const ap = a.params[i];
    const bp = b.params[i];
    if (ap === undefined || bp === undefined) return false;
    if (ap.name !== bp.name) return false;
    // Compare type via structuralTypeEquals; absent type (any-typed) matches absent type
    if (ap.type === undefined && bp.type !== undefined) return false;
    if (ap.type !== undefined && bp.type === undefined) return false;
    if (
      ap.type !== undefined &&
      bp.type !== undefined &&
      !structuralTypeEquals(ap.type, bp.type)
    )
      return false;
    if (!valueEquals(ap.defaultValue ?? null, bp.defaultValue ?? null)) {
      return false;
    }
    if (!annotationsEqual(ap.annotations, bp.annotations, valueEquals)) {
      return false;
    }
  }

  // Compare body by AST structure (ignoring source locations)
  if (!astEquals(a.body, b.body)) {
    return false;
  }

  // Compare defining scope by reference (same scope = same closure context)
  if (a.definingScope !== b.definingScope) return false;

  // Compare closure-level annotations
  if (!annotationsEqual(a.annotations, b.annotations, valueEquals)) {
    return false;
  }

  // Compare parameter-level annotations
  const paramNamesA = Object.keys(a.paramAnnotations);
  const paramNamesB = Object.keys(b.paramAnnotations);
  if (paramNamesA.length !== paramNamesB.length) return false;

  for (const paramName of paramNamesA) {
    if (!(paramName in b.paramAnnotations)) return false;
    const annotsA = a.paramAnnotations[paramName];
    const annotsB = b.paramAnnotations[paramName];
    if (annotsA === undefined || annotsB === undefined) return false;
    if (!annotationsEqual(annotsA, annotsB, valueEquals)) {
      return false;
    }
  }

  return true;
}

/**
 * Build a RillType closure variant from a closure's parameter list.
 *
 * Called at closure creation time to build the structural type for `$fn.^input`.
 * - Typed params use param.type directly when present
 * - Untyped params (type: undefined) map to { type: 'any' }
 * - Return type is always { type: 'any' }
 *
 * No validation: parser already validates type names.
 *
 * @param params - Closure parameter definitions (RillParam[])
 * @returns Frozen RillType with closure variant
 */
export function paramsToStructuralType(params: readonly RillParam[]): RillType {
  const closureParams: [string, RillType][] = params.map((param) => {
    const paramType: RillType = param.type ?? { type: 'any' };
    return [param.name, paramType];
  });

  return Object.freeze({
    type: 'closure' as const,
    params: closureParams,
    ret: { type: 'any' as const },
  });
}

/**
 * Validate defaultValue type matches declared parameter type.
 *
 * Called at registration time to catch configuration errors early.
 * Throws Error (not RuntimeError) to indicate registration failure.
 *
 * @param param - Parameter with defaultValue to validate
 * @param _functionName - Function name (unused, kept for API consistency)
 * @throws Error if defaultValue type doesn't match param.type
 */
export function validateDefaultValueType(
  param: RillParam,
  _functionName: string
): void {
  if (param.defaultValue === undefined) return;

  // Skip validation when type is undefined (any-typed, all defaults valid)
  if (param.type === undefined) return;

  if (!structuralTypeMatches(param.defaultValue, param.type)) {
    const actualType = inferType(param.defaultValue);
    const expectedType = formatStructuralType(param.type);
    throw new Error(
      `Invalid defaultValue for parameter '${param.name}': expected ${expectedType}, got ${actualType}`
    );
  }
}

/**
 * Validate arguments against RillParam[] using structural type matching.
 *
 * Single validation path for all callable kinds (host, built-in, script).
 * Uses structuralTypeMatches for type checking when param.type is defined.
 * Skips type check when param.type is undefined (any-typed).
 * Applies defaultValue in-place on the args array before validation.
 *
 * @param args - Arguments array (mutated in-place when defaults applied)
 * @param params - Parameter definitions
 * @param functionName - Function name for error messages
 * @param location - Source location for error reporting
 * @throws RuntimeError with RILL-R001 on validation failure
 */
export function validateCallableArgs(
  args: RillValue[],
  params: readonly RillParam[],
  functionName: string,
  location?: SourceLocation
): void {
  // Check for excess arguments
  if (args.length > params.length) {
    throw new RuntimeError(
      'RILL-R001',
      `Function '${functionName}' expects ${params.length} arguments, got ${args.length}`,
      location,
      {
        functionName,
        expectedCount: params.length,
        actualCount: args.length,
      }
    );
  }

  // Validate each parameter
  for (let i = 0; i < params.length; i++) {
    const param = params[i];
    if (param === undefined) continue;

    let arg = args[i];

    // Apply defaultValue in-place for missing arguments
    if (arg === undefined) {
      if (param.defaultValue !== undefined) {
        arg = param.defaultValue;
        args[i] = arg;
      } else {
        // Missing required argument
        throw new RuntimeError(
          'RILL-R001',
          `Missing required argument '${param.name}' for function '${functionName}'`,
          location,
          {
            functionName,
            paramName: param.name,
          }
        );
      }
    }

    // Type check via structuralTypeMatches when param.type is defined
    if (param.type !== undefined) {
      if (!structuralTypeMatches(arg, param.type)) {
        const expectedType = formatStructuralType(param.type);
        const actualType = inferType(arg);
        throw new RuntimeError(
          'RILL-R001',
          `Type mismatch in ${functionName}: parameter '${param.name}' expects ${expectedType}, got ${actualType}`,
          location,
          {
            functionName,
            paramName: param.name,
            expectedType,
            actualType,
          }
        );
      }
    }
  }
}
