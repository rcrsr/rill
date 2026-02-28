import { type RillValue } from '@rcrsr/rill';
import { type ComposedHandler } from '@rcrsr/rill-agent-shared';

// ============================================================
// PUBLIC TYPES
// ============================================================

export interface ExecuteOptions {
  readonly timeout?: number | undefined;
  readonly agentName?: string | undefined;
}

export interface ExecuteResult {
  readonly result: RillValue;
  readonly durationMs: number;
}

// ============================================================
// EXECUTOR
// ============================================================

/**
 * Execute a single agent run via a ComposedHandler.
 *
 * AC-47: timeout passed through RunRequest.timeout to the handler
 * AC-48: extensions are instantiated/disposed by the handler internally
 * EC-23: RuntimeError from handler re-thrown as-is
 * EC-24: Timeout RuntimeError (RILL-R012) from handler re-thrown as-is
 * EC-25: ComposeError from handler re-thrown as-is
 */
export async function executeAgent(
  handler: ComposedHandler,
  params: Record<string, unknown>,
  options?: ExecuteOptions | undefined
): Promise<ExecuteResult> {
  const timeout =
    options?.timeout !== undefined && options.timeout > 0
      ? options.timeout
      : undefined;

  const start = Date.now();

  // EC-23, EC-24, EC-25: all errors re-thrown as-is
  const response = await handler(
    { params, timeout },
    { agentName: options?.agentName ?? '' }
  );

  const durationMs = Date.now() - start;

  const result: RillValue = response.result ?? '';
  return { result, durationMs };
}
