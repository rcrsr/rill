/**
 * Test utilities for Rill runtime tests
 */

import {
  anyTypeValue,
  type CallableFn,
  createRuntimeContext,
  execute,
  type ExecutionResult,
  type ObservabilityCallbacks,
  parse,
  type RillCallable,
  type RillFunction,
  type RillValue,
  type RuntimeContext,
  type RuntimeOptions,
} from '@rcrsr/rill';

/** Options for test execution */
interface TestOptions extends Omit<RuntimeOptions, 'functions'> {
  functions?: Record<string, RillFunction>;
}

/** Shared setup for all execution modes */
function setup(source: string, options: TestOptions = {}) {
  return { ast: parse(source), ctx: createRuntimeContext(options) };
}

/** Execute a Rill script and return the final value */
export async function run(
  source: string,
  options: TestOptions = {}
): Promise<RillValue> {
  const { ast, ctx } = setup(source, options);
  return (await execute(ast, ctx)).result;
}

/** Execute and return full result */
export async function runFull(
  source: string,
  options: TestOptions = {}
): Promise<ExecutionResult> {
  const { ast, ctx } = setup(source, options);
  return execute(ast, ctx);
}

/** Execute and return both result and context for variable inspection */
export async function runWithContext(
  source: string,
  options: TestOptions = {}
): Promise<{ result: ExecutionResult; context: RuntimeContext }> {
  const { ast, ctx } = setup(source, options);
  const result = await execute(ast, ctx);
  return { result, context: ctx };
}

/** Context parameter type that host functions receive */
type HostFnContext = Parameters<CallableFn>[1];

/** Narrow the minimal context a host function receives to the full RuntimeContext */
function isRuntimeContext(ctx: HostFnContext): ctx is RuntimeContext {
  return 'callStack' in ctx && 'annotationStack' in ctx && 'functions' in ctx;
}

/**
 * Return the full RuntimeContext behind a host function's context parameter.
 * Host functions are typed with a minimal context; the evaluator always passes
 * the real one, so tests that inspect call or annotation state narrow it here.
 */
export function toRuntimeContext(ctx: HostFnContext): RuntimeContext {
  if (!isRuntimeContext(ctx)) {
    throw new Error('host function context is not a full RuntimeContext');
  }
  return ctx;
}

/**
 * Check a callable literal against its type and return it as a non-fresh
 * value, so it can be passed where a RillValue is expected (a fresh object
 * literal with host fields like `fn` fails the excess-property check against
 * RillValue's structural members).
 */
export function callableLiteral<T extends RillCallable>(callable: T): T {
  return callable;
}

/** Create a mock async function with configurable delay */
export function mockAsyncFn(
  delay: number,
  returnValue: RillValue
): RillFunction {
  return {
    params: [],
    returnType: anyTypeValue,
    fn: async () => {
      await new Promise((r) => setTimeout(r, delay));
      return returnValue;
    },
  };
}

/** Create a mock sync function that tracks calls */
export function mockFn(returnValue: RillValue = null): RillFunction & {
  calls: Record<string, RillValue>[];
  callCount: number;
} {
  const calls: Record<string, RillValue>[] = [];
  const fn = (args: Record<string, RillValue>) => {
    calls.push(args);
    return returnValue;
  };
  return {
    params: [],
    returnType: anyTypeValue,
    fn,
    calls,
    get callCount() {
      return calls.length;
    },
  };
}

/** Event collector for observability testing */
interface CollectedEvents {
  stepStart: { index: number; total: number; pipeValue: RillValue }[];
  stepEnd: {
    index: number;
    total: number;
    value: RillValue;
    durationMs: number;
  }[];
  hostCall: { name: string; args: RillValue[] }[];
  functionReturn: { name: string; value: RillValue; durationMs: number }[];
  capture: { name: string; value: RillValue }[];
  error: { error: Error; index?: number }[];
}

/** Create an event collector for observability callbacks */
export function createEventCollector(): {
  events: CollectedEvents;
  callbacks: ObservabilityCallbacks;
} {
  const events: CollectedEvents = {
    stepStart: [],
    stepEnd: [],
    hostCall: [],
    functionReturn: [],
    capture: [],
    error: [],
  };

  const callbacks: ObservabilityCallbacks = {
    onStepStart: (e) => events.stepStart.push(e),
    onStepEnd: (e) => events.stepEnd.push(e),
    onHostCall: (e) => events.hostCall.push(e),
    onFunctionReturn: (e) => events.functionReturn.push(e),
    onCapture: (e) => events.capture.push(e),
    onError: (e) => events.error.push(e),
  };

  return { events, callbacks };
}

/** Log collector for .log() method testing */
export function createLogCollector(): {
  logs: string[];
  callbacks: { onLog: (message: string) => void };
} {
  const logs: string[] = [];
  return {
    logs,
    callbacks: {
      onLog: (message: string) => logs.push(message),
    },
  };
}

/** Recursively find the first AST node with a matching type field */
export function findNode(
  node: unknown,
  type: string
): Record<string, unknown> | null {
  if (
    typeof node === 'object' &&
    node !== null &&
    (node as Record<string, unknown>)['type'] === type
  ) {
    return node as Record<string, unknown>;
  }
  if (typeof node === 'object' && node !== null) {
    for (const val of Object.values(node as Record<string, unknown>)) {
      const found = findNode(val, type);
      if (found) return found;
    }
  }
  return null;
}
