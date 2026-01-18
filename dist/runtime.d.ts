/**
 * Rill Runtime
 * Executes parsed Rill AST with pluggable context and I/O
 */
import type { BlockNode, RillTypeName, ScriptNode, SourceLocation } from './types.js';
export { AbortError, AutoExceptionError, RuntimeError, TimeoutError, } from './types.js';
/**
 * Callable function signature.
 * Used for both host-provided functions and runtime callables.
 */
export type CallableFn = (args: RillValue[], ctx: RuntimeContext, location?: SourceLocation) => RillValue | Promise<RillValue>;
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
    readonly body: BlockNode;
    readonly capturedVars: Map<string, RillValue>;
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
export type RillCallable = ScriptCallable | RuntimeCallable | ApplicationCallable;
/** Type guard for any callable */
export declare function isCallable(value: RillValue): value is RillCallable;
/** Type guard for script callable */
export declare function isScriptCallable(value: RillValue): value is ScriptCallable;
/** Type guard for runtime callable */
export declare function isRuntimeCallable(value: RillValue): value is RuntimeCallable;
/** Type guard for application callable */
export declare function isApplicationCallable(value: RillValue): value is ApplicationCallable;
/**
 * Create an application callable from a host function.
 * @param fn The function to wrap
 * @param isProperty If true, auto-invokes when accessed from dict (property-style)
 */
export declare function callable(fn: CallableFn, isProperty?: boolean): ApplicationCallable;
/** Type guard for dict (plain object, not array, not callable, not args) */
export declare function isDict(value: RillValue): value is Record<string, RillValue>;
/**
 * Args type - represents unpacked arguments for closure invocation.
 * Created by the * (spread) operator from tuples or dicts.
 * Entries are keyed by position (number) or name (string).
 */
export interface RillArgs {
    readonly __rill_args: true;
    readonly entries: Map<string | number, RillValue>;
}
/** Type guard for RillArgs */
export declare function isArgs(value: RillValue): value is RillArgs;
/** Reserved dict method names that cannot be overridden */
export declare const RESERVED_DICT_METHODS: readonly ["keys", "values", "entries"];
/** Check if a key name is reserved */
export declare function isReservedMethod(name: string): boolean;
/** Any value that can flow through Rill */
export type RillValue = string | number | boolean | null | RillValue[] | {
    [key: string]: RillValue;
} | RillCallable | RillArgs;
/**
 * Method signature for built-in methods (internal use only).
 * Methods are called on a receiver value: $val.method(args)
 */
type RillMethod = (receiver: RillValue, args: RillValue[], ctx: RuntimeContext, location?: SourceLocation) => RillValue | Promise<RillValue>;
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
    onFunctionCall?: (event: FunctionCallEvent) => void;
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
export interface FunctionCallEvent {
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
    /** Named variables ($varname) */
    readonly variables: Map<string, RillValue>;
    /** Variable types - locked after first assignment */
    readonly variableTypes: Map<string, RillTypeName>;
    /** Built-in and user-defined functions */
    readonly functions: Map<string, CallableFn>;
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
}
/** Options for creating a runtime context */
export interface RuntimeOptions {
    /** Initial variables */
    variables?: Record<string, RillValue>;
    /** Custom functions */
    functions?: Record<string, CallableFn>;
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
    captured?: {
        name: string;
        value: RillValue;
    } | undefined;
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
/** Signal thrown by `break` to exit loops */
export declare class BreakSignal extends Error {
    readonly value: RillValue;
    constructor(value: RillValue);
}
/** Signal thrown by `return` to exit blocks */
export declare class ReturnSignal extends Error {
    readonly value: RillValue;
    constructor(value: RillValue);
}
export declare function createRuntimeContext(options?: RuntimeOptions): RuntimeContext;
export declare function execute(script: ScriptNode, context: RuntimeContext): Promise<ExecutionResult>;
/**
 * Create a stepper for controlled step-by-step execution.
 * Allows the caller to control the execution loop and inspect state between steps.
 */
export declare function createStepper(script: ScriptNode, context: RuntimeContext): ExecutionStepper;
//# sourceMappingURL=runtime.d.ts.map