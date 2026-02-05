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
 * - Kept for API consistency with validateHostFunctionArgs signature
 *
 * [ASSUMPTION] validateHostFunctionArgs Args Array Mutation
 * - args array mutated in-place when substituting default values
 * - Per spec algorithm: "Apply default values for missing arguments before validation"
 * - Mutation occurs before host function receives args, maintaining immutability contract
 */

import type { BodyNode, SourceLocation } from '../../types.js';
import { RuntimeError } from '../../types.js';
import { astEquals } from './equals.js';
import type { RillValue } from './values.js';
import { formatValue, inferType, isTuple } from './values.js';

// Forward reference to RuntimeContext (defined in types.ts)
// Using a minimal interface to avoid circular dependency
interface RuntimeContextLike {
  readonly parent?: RuntimeContextLike | undefined;
  readonly variables: Map<string, RillValue>;
  pipeValue: RillValue;
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
 * Parameter definition for script closures.
 *
 * Annotations are captured at closure creation time and stored as evaluated values.
 * Empty object ({}) when no annotations present.
 */
export interface CallableParam {
  readonly name: string;
  readonly typeName: 'string' | 'number' | 'bool' | 'list' | 'dict' | null;
  readonly defaultValue: RillValue | null;
  /** Evaluated parameter-level annotations (e.g., ^(cache: true)) */
  readonly annotations: Record<string, RillValue>;
  /** Human-readable parameter description (optional, from host functions) */
  readonly description?: string;
}

/**
 * Parameter metadata for host-provided functions.
 *
 * Parameters without defaultValue are required.
 * Parameters with defaultValue are optional.
 */
export interface HostFunctionParam {
  /** Parameter name (for error messages and documentation) */
  readonly name: string;

  /** Expected type: limited to 5 primitive types */
  readonly type: 'string' | 'number' | 'bool' | 'list' | 'dict';

  /** Default value if argument omitted. Makes parameter optional. */
  readonly defaultValue?: RillValue;

  /** Human-readable parameter description (optional) */
  readonly description?: string;
}

/**
 * Host function with required parameter type declarations.
 *
 * Runtime validates arguments before invocation.
 */
export interface HostFunctionDefinition {
  /** Parameter declarations (required) */
  readonly params: readonly HostFunctionParam[];

  /** Function implementation (receives validated args) */
  readonly fn: CallableFn;

  /** Human-readable function description (optional) */
  readonly description?: string;
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
  readonly params: CallableParam[];
  readonly body: BodyNode;
  /** Reference to the scope where this closure was defined (late binding) */
  readonly definingScope: RuntimeContextLike;
  /** Evaluated closure-level annotations (e.g., ^(timeout: 30)) */
  readonly annotations: Record<string, RillValue>;
  /** Evaluated parameter annotations keyed by parameter name */
  readonly paramAnnotations: Record<string, Record<string, RillValue>>;
}

/** Runtime callable - Rill's built-in functions (type, log, json, identity) */
export interface RuntimeCallable extends CallableBase {
  readonly kind: 'runtime';
  readonly fn: CallableFn;
}

/** Application callable - host application-provided functions */
export interface ApplicationCallable extends CallableBase {
  readonly kind: 'application';
  readonly params: CallableParam[] | undefined;
  readonly fn: CallableFn;
  /** Human-readable function description (optional, from host functions) */
  readonly description?: string;
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
    if (ap.typeName !== bp.typeName) return false;
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
  param: HostFunctionParam,
  _functionName: string
): void {
  if (param.defaultValue === undefined) return;

  const actualType = inferType(param.defaultValue);
  const expectedType = param.type;

  if (actualType !== expectedType) {
    throw new Error(
      `Invalid defaultValue for parameter '${param.name}': expected ${expectedType}, got ${actualType}`
    );
  }
}

/**
 * Validate host function arguments against parameter declarations.
 *
 * Called before function invocation to enforce type contracts.
 * Throws RuntimeError on validation failure.
 *
 * @param args - Evaluated arguments from call site
 * @param params - Parameter declarations from function definition
 * @param functionName - Function name for error messages
 * @param location - Source location for error reporting
 * @throws RuntimeError with RUNTIME_TYPE_ERROR on validation failure
 */
export function validateHostFunctionArgs(
  args: RillValue[],
  params: readonly HostFunctionParam[],
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

    // Handle missing argument
    if (arg === undefined) {
      if (param.defaultValue !== undefined) {
        // Substitute default value (already validated at registration)
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

    // Validate argument type
    const actualType = inferType(arg);
    const expectedType = param.type;

    if (actualType !== expectedType) {
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

/**
 * Validate arguments against CallableParam[] for ApplicationCallable.
 *
 * Similar to validateHostFunctionArgs but works with CallableParam[] (used in ApplicationCallable).
 * Validates argument count, applies defaults, and checks types for primitive parameters.
 *
 * @param args - Arguments array (mutated in-place when defaults applied)
 * @param params - Parameter definitions
 * @param functionName - Function name for error messages
 * @param location - Source location for error reporting
 * @throws RuntimeError with RUNTIME_TYPE_ERROR on validation failure
 */
export function validateCallableArgs(
  args: RillValue[],
  params: readonly CallableParam[],
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

    // Handle missing argument
    if (arg === undefined) {
      if (param.defaultValue !== null) {
        // Substitute default value
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

    // Validate argument type (only for typed parameters)
    if (param.typeName !== null) {
      const actualType = inferType(arg);
      const expectedType = param.typeName;

      if (actualType !== expectedType) {
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
