/**
 * Callable Types
 *
 * Unified representation for all callable values in Rill:
 * - ScriptCallable: Closures parsed from Rill source code
 * - RuntimeCallable: Rill's built-in functions (type, log, json, identity)
 * - ApplicationCallable: Host application-provided functions
 *
 * Public API for host applications.
 */

import type { BodyNode, SourceLocation } from '../../types.js';
import { astEquals } from './equals.js';
import type { RillValue } from './values.js';
import { formatValue, isTuple } from './values.js';

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

/** Parameter definition for script closures */
export interface CallableParam {
  readonly name: string;
  readonly typeName: 'string' | 'number' | 'bool' | null;
  readonly defaultValue: RillValue | null;
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

/** Script callable - parsed from Rill source code */
export interface ScriptCallable extends CallableBase {
  readonly kind: 'script';
  readonly params: CallableParam[];
  readonly body: BodyNode;
  /** Reference to the scope where this closure was defined (late binding) */
  readonly definingScope: RuntimeContextLike;
}

/** Runtime callable - Rill's built-in functions (type, log, json, identity) */
export interface RuntimeCallable extends CallableBase {
  readonly kind: 'runtime';
  readonly fn: CallableFn;
}

/** Application callable - host application-provided functions */
export interface ApplicationCallable extends CallableBase {
  readonly kind: 'application';
  readonly fn: CallableFn;
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
 * @param fn The function to wrap
 * @param isProperty If true, auto-invokes when accessed from dict (property-style)
 */
export function callable(
  fn: CallableFn,
  isProperty = false
): ApplicationCallable {
  return { __type: 'callable', kind: 'application', fn, isProperty };
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
 * Deep equality for script callables.
 * Compares params, body AST structure, and defining scope.
 *
 * Two closures are equal if:
 * 1. Same parameter names, types, and default values
 * 2. Structurally identical body AST (ignoring source locations)
 * 3. Same defining scope (reference equality)
 */
export function callableEquals(
  a: ScriptCallable,
  b: ScriptCallable,
  valueEquals: (a: RillValue, b: RillValue) => boolean = (x, y) =>
    formatValue(x) === formatValue(y)
): boolean {
  // Compare params (name, type, default)
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
  }

  // Compare body by AST structure (ignoring source locations)
  if (!astEquals(a.body, b.body)) {
    return false;
  }

  // Compare defining scope by reference (same scope = same closure context)
  if (a.definingScope !== b.definingScope) return false;

  return true;
}
