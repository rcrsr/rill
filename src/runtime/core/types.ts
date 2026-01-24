/**
 * Runtime Types
 *
 * Public types for runtime configuration and execution results.
 * These types are the primary interface for host applications.
 */

import type { RillTypeName } from '../../types.js';
import type { CallableFn, HostFunctionDefinition } from './callable.js';
import type { RillValue } from './values.js';

/**
 * Method signature for built-in methods.
 * Methods are called on a receiver value: $val.method(args)
 * @internal
 */
export type RillMethod = (
  receiver: RillValue,
  args: RillValue[],
  ctx: RuntimeContext,
  location?: import('../../types.js').SourceLocation
) => RillValue | Promise<RillValue>;

/** I/O callbacks for runtime operations */
export interface RuntimeCallbacks {
  /** Called when .log is invoked */
  onLog: (value: RillValue) => void;
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

/** Runtime context with variables, functions, and callbacks */
export interface RuntimeContext {
  /** Parent scope for lexical variable lookup (undefined = root scope) */
  readonly parent?: RuntimeContext | undefined;
  /** Named variables ($varname) - local to this scope */
  readonly variables: Map<string, RillValue>;
  /** Variable types - locked after first assignment (local to this scope) */
  readonly variableTypes: Map<string, RillTypeName>;
  /** Built-in and user-defined functions (CallableFn for untyped, ApplicationCallable for typed) */
  readonly functions: Map<
    string,
    CallableFn | import('./callable.js').ApplicationCallable
  >;
  /** Built-in and user-defined methods */
  readonly methods: Map<string, RillMethod>;
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
  /**
   * Annotation stack for statement annotations.
   * Each entry is a dict of annotation key-value pairs.
   * Inner scopes inherit and can override outer annotations.
   */
  readonly annotationStack: Record<string, RillValue>[];
}

/** Options for creating a runtime context */
export interface RuntimeOptions {
  /** Initial variables */
  variables?: Record<string, RillValue>;
  /** Host functions: typed definitions with parameter declarations */
  functions?: Record<string, HostFunctionDefinition>;
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
}

/** Result of script execution */
export interface ExecutionResult {
  /** Final value returned by the script */
  value: RillValue;
  /** All captured variables */
  variables: Record<string, RillValue>;
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
