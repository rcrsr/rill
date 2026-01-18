/**
 * Test utilities for Rill runtime tests
 */

import {
  createRuntimeContext,
  createStepper,
  execute,
  type ExecutionResult,
  type ObservabilityCallbacks,
  parse,
  type CallableFn,
  type RillValue,
  type RuntimeOptions,
  type StepResult,
} from '../../src/index.js';

/** Options for test execution */
export interface TestOptions extends Omit<RuntimeOptions, 'functions'> {
  functions?: Record<string, CallableFn>;
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
  return (await execute(ast, ctx)).value;
}

/** Execute and return full result with variables */
export async function runFull(
  source: string,
  options: TestOptions = {}
): Promise<ExecutionResult> {
  const { ast, ctx } = setup(source, options);
  return execute(ast, ctx);
}

/** Execute using stepper and return all step results */
export async function runStepped(
  source: string,
  options: TestOptions = {}
): Promise<StepResult[]> {
  const { ast, ctx } = setup(source, options);
  const stepper = createStepper(ast, ctx);
  const results: StepResult[] = [];

  while (!stepper.done) {
    results.push(await stepper.step());
  }

  return results;
}

/** Create a mock async function with configurable delay */
export function mockAsyncFn(
  delay: number,
  returnValue: RillValue
): CallableFn {
  return async () => {
    await new Promise((r) => setTimeout(r, delay));
    return returnValue;
  };
}

/** Create a mock sync function that tracks calls */
export function mockFn(returnValue: RillValue = null): CallableFn & {
  calls: RillValue[][];
  callCount: number;
} {
  const calls: RillValue[][] = [];
  const fn = ((args: RillValue[]) => {
    calls.push(args);
    return returnValue;
  }) as CallableFn & { calls: RillValue[][]; callCount: number };
  fn.calls = calls;
  Object.defineProperty(fn, 'callCount', {
    get: () => calls.length,
  });
  return fn;
}

/** Event collector for observability testing */
export interface CollectedEvents {
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
  logs: RillValue[];
  callbacks: { onLog: (value: RillValue) => void };
} {
  const logs: RillValue[] = [];
  return {
    logs,
    callbacks: {
      onLog: (value: RillValue) => logs.push(value),
    },
  };
}
