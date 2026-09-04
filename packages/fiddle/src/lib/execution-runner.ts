/**
 * Execution runner for Rill Fiddle
 *
 * Runs Rill source in a dedicated worker with a wall-clock timeout, so a
 * runaway script cannot freeze the main thread. Injection params exist only
 * because a real Worker + 5s wall-clock is not exercisable in vitest/jsdom.
 */

import { EXECUTION_TIMEOUT_MS } from './constants.js';
import type { ExecutionState, FiddleError } from './execution.js';

/** Minimal Worker surface runInWorker depends on, for test injection. */
export interface RunnerWorker {
  postMessage: (message: { source: string }) => void;
  terminate: () => void;
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<ExecutionState>) => void
  ) => void;
  removeEventListener: (
    type: 'message',
    listener: (event: MessageEvent<ExecutionState>) => void
  ) => void;
}

function createWorker(): RunnerWorker {
  return new Worker(new URL('./execution-worker.ts', import.meta.url), {
    type: 'module',
  });
}

function buildTimeoutState(timeoutMs: number): ExecutionState {
  const error: FiddleError = {
    message: `Execution exceeded the ${timeoutMs}ms time limit`,
    category: 'runtime',
    line: null,
    column: null,
    errorId: null,
    statusCode: null,
    statusMessage: null,
    statusProvider: null,
    statusTrace: null,
  };

  return {
    status: 'error',
    result: null,
    error,
    duration: null,
    logs: [],
  };
}

/**
 * Run Rill source on a dedicated worker, racing the reply against a
 * wall-clock timeout.
 *
 * @param source - Rill source code to execute
 * @param createWorkerFn - Worker factory; defaults to the real inline-Vite
 *   Worker construction (injectable for tests)
 * @param timeoutMs - Wall-clock timeout in milliseconds; defaults to
 *   EXECUTION_TIMEOUT_MS (injectable for tests)
 */
export function runInWorker(
  source: string,
  createWorkerFn: () => RunnerWorker = createWorker,
  timeoutMs: number = EXECUTION_TIMEOUT_MS
): { promise: Promise<ExecutionState>; cancel: () => void } {
  const worker = createWorkerFn();
  let settled = false;
  let timeoutId: ReturnType<typeof setTimeout>;

  const promise = new Promise<ExecutionState>((resolve) => {
    const onMessage = (event: MessageEvent<ExecutionState>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      worker.removeEventListener('message', onMessage);
      worker.terminate();
      resolve(event.data);
    };

    worker.addEventListener('message', onMessage);

    timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.removeEventListener('message', onMessage);
      worker.terminate();
      resolve(buildTimeoutState(timeoutMs));
    }, timeoutMs);

    worker.postMessage({ source });
  });

  const cancel = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutId);
    worker.terminate();
  };

  return { promise, cancel };
}
