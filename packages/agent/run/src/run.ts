import type { RillValue } from '@rcrsr/rill';
import { RillError } from '@rcrsr/rill';

import { executeAgent } from './executor.js';
import { loadBundle } from './loader.js';

// ============================================================
// PUBLIC TYPES
// ============================================================

export interface RunOptions {
  readonly params?: Record<string, unknown> | undefined;
  readonly timeout?: number | undefined;
  readonly config?: Record<string, Record<string, unknown>> | undefined;
}

export interface RunResult {
  readonly result: RillValue;
  readonly exitCode: 0 | 1;
  readonly durationMs: number;
  readonly error?: string | undefined;
}

// ============================================================
// RUN AGENT
// ============================================================

/**
 * Execute a named agent from a bundle directory.
 *
 * IR-13: Public API for programmatic agent execution.
 *
 * On success: exitCode 0
 * On any error: exitCode 1
 */
export async function runAgent(
  bundleDir: string,
  agentName: string,
  options?: RunOptions | undefined
): Promise<RunResult> {
  const start = Date.now();
  try {
    const { handler, agentName: resolvedName } = await loadBundle(
      bundleDir,
      agentName !== '' ? agentName : undefined
    );

    const { result, durationMs } = await executeAgent(
      handler,
      options?.params ?? {},
      {
        timeout: options?.timeout,
        agentName: resolvedName,
        config: options?.config ?? {},
      }
    );

    return { result, exitCode: 0, durationMs };
  } catch (err) {
    let errorStr: string;
    if (err instanceof RillError) {
      errorStr = `${err.errorId}: ${err.message}`;
    } else if (err instanceof Error) {
      errorStr = err.message;
    } else {
      errorStr = String(err);
    }
    return {
      result: '',
      exitCode: 1,
      durationMs: Date.now() - start,
      error: errorStr,
    };
  }
}
