/**
 * Runtime Types
 *
 * Public types for runtime configuration and execution results.
 * These types are the primary interface for host applications.
 */

import type { RillTypeName } from '../../../types.js';
import type { CallableFn, RillFunction } from '../callable.js';
import type { TypeStructure, RillValue } from './structures.js';

export type { NativeArray, NativePlainObject, NativeValue } from '../values.js';

/** I/O callbacks for runtime operations */
export interface RuntimeCallbacks {
  /** Called when .log is invoked */
  onLog: (message: string) => void;
  /** Called when extensions emit diagnostic events */
  onLogEvent?: (event: ExtensionEvent) => void;
}

/** Structured diagnostic event from extensions */
export interface ExtensionEvent {
  /** Semantic event name (required) */
  event: string;
  /** Extension identifier (required, pattern: extension:{namespace}) */
  subsystem: string;
  /** ISO timestamp (auto-added by runtime if omitted) */
  timestamp?: string | undefined;
  /** Extensible context fields */
  [key: string]: unknown;
}

/** Observability callbacks for monitoring execution */
export interface ObservabilityCallbacks {
  /** Called before each statement executes */
  onStepStart?: (event: StepStartEvent) => void;
  /** Called after each statement executes */
  onStepEnd?: (event: StepEndEvent) => void;
  /** Called before a function is invoked */
  onHostCall?: (event: HostCallEvent) => void;
  /** Called after a function returns */
  onFunctionReturn?: (event: FunctionReturnEvent) => void;
  /** Called when a variable is captured */
  onCapture?: (event: CaptureEvent) => void;
  /** Called when an error occurs */
  onError?: (event: ErrorEvent) => void;
}

/** Event emitted before a statement executes */
export interface StepStartEvent {
  /** Statement index (0-based) */
  index: number;
  /** Total statements */
  total: number;
  /** Current pipe value before execution */
  pipeValue: RillValue;
}

/** Event emitted after a statement executes */
export interface StepEndEvent {
  /** Statement index (0-based) */
  index: number;
  /** Total statements */
  total: number;
  /** Value produced by the statement */
  value: RillValue;
  /** Execution time in milliseconds */
  durationMs: number;
}

/** Event emitted before a function call */
export interface HostCallEvent {
  /** Function name */
  name: string;
  /** Arguments passed to function */
  args: RillValue[];
}

/** Event emitted after a function returns */
export interface FunctionReturnEvent {
  /** Function name */
  name: string;
  /** Return value */
  value: RillValue;
  /** Execution time in milliseconds */
  durationMs: number;
}

/** Event emitted when a variable is captured */
export interface CaptureEvent {
  /** Variable name */
  name: string;
  /** Captured value */
  value: RillValue;
}

/** Event emitted on error */
export interface ErrorEvent {
  /** The error that occurred */
  error: Error;
  /** Statement index where error occurred (if available) */
  index?: number;
}

/**
 * Result returned by a SchemeResolver.
 * `kind: "value"` — runtime binds `value` directly without evaluation.
 * `kind: "source"` — runtime parses and executes `text` in an isolated child scope.
 */
export type ResolverResult =
  | { kind: 'value'; value: RillValue }
  | { kind: 'source'; text: string; sourceId?: string };

/**
 * Resolves a scheme-qualified resource to a value or source text.
 * `resource` is the dot-joined path after the scheme separator (e.g. `"greetings"`, `"qdrant.search"`).
 * `config` is the value from `RuntimeOptions.configurations.resolvers[scheme]`.
 * Async resolvers are supported; synchronous resolvers may return ResolverResult directly.
 * Resolvers must not call back into the rill runtime.
 */
export type SchemeResolver = (
  resource: string,
  config?: unknown
) => ResolverResult | Promise<ResolverResult>;

/** Runtime context with variables, functions, and callbacks */
export interface RuntimeContext {
  /** Parent scope for lexical variable lookup (undefined = root scope) */
  readonly parent?: RuntimeContext | undefined;
  /** Named variables ($varname) - local to this scope */
  readonly variables: Map<string, RillValue>;
  /** Variable types - locked after first assignment (local to this scope) */
  readonly variableTypes: Map<string, RillTypeName | TypeStructure>;
  /** Built-in and user-defined functions (CallableFn for untyped, ApplicationCallable for typed) */
  readonly functions: Map<
    string,
    CallableFn | import('../callable.js').ApplicationCallable
  >;
  /** I/O callbacks */
  readonly callbacks: RuntimeCallbacks;
  /** Observability callbacks */
  readonly observability: ObservabilityCallbacks;
  /** Current pipe value ($) */
  pipeValue: RillValue;
  /** Timeout in milliseconds for user-supplied functions (undefined = no timeout) */
  readonly timeout: number | undefined;
  /** Compiled regex patterns for auto-exceptions */
  readonly autoExceptions: RegExp[];
  /** AbortSignal for cancellation (undefined = no cancellation) */
  readonly signal: AbortSignal | undefined;
  /** Maximum call stack depth */
  readonly maxCallStackDepth: number;
  /**
   * Annotation stack for statement annotations.
   * Each entry is a dict of annotation key-value pairs.
   * Annotations do not inherit — each annotated statement carries only its own annotations.
   */
  readonly annotationStack: Record<string, RillValue>[];
  /**
   * Annotations for the immediate next child statement only.
   * Set by executeAnnotatedStatement() and read by captureClosureAnnotations().
   * Not inherited through the scope chain — cleared after one statement.
   */
  immediateAnnotation: Record<string, RillValue> | undefined;
  /**
   * Call stack for error context.
   * Managed by evaluator; pushed on function entry, popped on exit.
   */
  readonly callStack: import('../../../types.js').CallFrame[];
  /** Arbitrary string metadata passed from the host (e.g. request IDs, user IDs) */
  readonly metadata?: Record<string, string> | undefined;
  /**
   * Per-type method dictionaries: maps type name to a frozen dict of ApplicationCallable values.
   * Keys: "string", "list", "dict", "number", "bool", "vector".
   * Populated at context creation from type registrations; propagated to child contexts.
   */
  readonly typeMethodDicts: ReadonlyMap<
    string,
    Readonly<Record<string, RillValue>>
  >;
  /**
   * Type names that reject type arguments in type constructors.
   * Derived from BUILT_IN_TYPES registrations where isLeaf === true, plus 'any'.
   * Used by type assertion/check evaluation to reject e.g. string(number).
   */
  readonly leafTypes: ReadonlySet<string>;
  /**
   * Method names that handle their own receiver type checking with specific
   * error messages. Generic RILL-R003 must not fire before the method body runs.
   * Derived from registration method dicts at context creation.
   */
  readonly unvalidatedMethodReceivers: ReadonlySet<string>;
  /** Scheme-to-resolver map, populated from RuntimeOptions.resolvers (empty Map when absent) */
  readonly resolvers: ReadonlyMap<string, SchemeResolver>;
  /** Per-scheme config data, populated from RuntimeOptions.configurations.resolvers (empty Map when absent) */
  readonly resolverConfigs: ReadonlyMap<string, unknown>;
  /** In-flight resolution keys for cycle detection; shared across child scopes */
  readonly resolvingSchemes: Set<string>;
  /**
   * Parser function for executing resolver source results.
   * Must be provided when `kind: 'source'` resolver results are expected.
   * Omit if only `kind: 'value'` resolvers are used.
   */
  readonly parseSource?:
    | ((text: string) => import('../../../types.js').ScriptNode)
    | undefined;
  /** Identifies the current source file for cross-module error reporting */
  readonly sourceId?: string | undefined;
  /** Source text of the current file for cross-module error snippets */
  readonly sourceText?: string | undefined;
}

/** Options for creating a runtime context */
export interface RuntimeOptions {
  /** Initial variables */
  variables?: Record<string, RillValue>;
  /** Host functions: structured definitions */
  functions?: Record<string, RillFunction>;
  /** I/O callbacks */
  callbacks?: Partial<RuntimeCallbacks>;
  /** Observability callbacks for monitoring execution */
  observability?: ObservabilityCallbacks;
  /** Timeout in milliseconds for user-supplied functions */
  timeout?: number;
  /** Regex patterns that auto-halt execution when $_ matches (string values only) */
  autoExceptions?: string[];
  /** AbortSignal for cancellation support */
  signal?: AbortSignal;
  /** Require descriptions for all functions and parameters */
  requireDescriptions?: boolean;
  /** Maximum call stack depth (default: 100) */
  maxCallStackDepth?: number;
  /** Arbitrary string metadata passed through to the runtime context */
  metadata?: Record<string, string>;
  /** Scheme-to-resolver map; keys are scheme names (e.g. `"env"`, `"qdrant"`) */
  resolvers?: Record<string, SchemeResolver>;
  /** Per-scheme configuration data passed as the second argument to each resolver */
  configurations?: { resolvers?: Record<string, unknown> };
  /** Type checker mode; default `'permissive'` */
  checkerMode?: 'strict' | 'permissive';
  /**
   * Parser function for executing resolver source results.
   * Required when resolvers may return `kind: 'source'` results.
   */
  parseSource?: (text: string) => import('../../../types.js').ScriptNode;
}

/** Result of script execution */
export interface ExecutionResult {
  /** Final result returned by the script */
  result: RillValue;
}

/** Result of a single step execution */
export interface StepResult {
  /** Value produced by this step */
  value: RillValue;
  /** Whether execution is complete (no more statements) */
  done: boolean;
  /** Current statement index (0-based) */
  index: number;
  /** Total number of statements */
  total: number;
  /** Variable captured by this step (if any) */
  captured?: { name: string; value: RillValue } | undefined;
}

/** Stepper for controlled step-by-step execution */
export interface ExecutionStepper {
  /** Whether execution is complete */
  readonly done: boolean;
  /** Current statement index (0-based) */
  readonly index: number;
  /** Total number of statements */
  readonly total: number;
  /** The runtime context (for inspecting variables, pipeValue, etc.) */
  readonly context: RuntimeContext;
  /** Execute the next statement */
  step(): Promise<StepResult>;
  /** Get final result (only valid after done=true) */
  getResult(): ExecutionResult;
}

/**
 * Bind callables in a dict to their containing dict.
 * This sets boundDict on each callable so they can access their container.
 */
export function bindDictCallables(value: RillValue): RillValue {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    '__type' in value ||
    '__rill_args' in value
  ) {
    return value;
  }

  const dict = value as Record<string, RillValue>;
  let hasBoundCallables = false;

  // Check if any values are callables that need binding
  for (const v of Object.values(dict)) {
    if (
      typeof v === 'object' &&
      v !== null &&
      '__type' in v &&
      v.__type === 'callable' &&
      !('boundDict' in v && (v as Record<string, unknown>)['boundDict'])
    ) {
      hasBoundCallables = true;
      break;
    }
  }

  if (!hasBoundCallables) return value;

  // Create a new dict with bound callables
  const result: Record<string, RillValue> = {};
  for (const [key, v] of Object.entries(dict)) {
    if (
      typeof v === 'object' &&
      v !== null &&
      '__type' in v &&
      v.__type === 'callable' &&
      !('boundDict' in v && (v as Record<string, unknown>)['boundDict'])
    ) {
      result[key] = { ...v, boundDict: result } as RillValue;
    } else {
      result[key] = v;
    }
  }

  return result;
}
