import { type RillValue, type ExtensionEvent } from '@rcrsr/rill';
import { type ComposedHandler } from '@rcrsr/rill-agent-shared';

// ============================================================
// PUBLIC TYPES
// ============================================================

export type LogLevel = 'silent' | 'info' | 'debug';

export interface ExecuteOptions {
  readonly timeout?: number | undefined;
  readonly agentName: string;
  readonly config?: Record<string, Record<string, unknown>> | undefined;
  readonly logLevel?: LogLevel | undefined;
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
  options: ExecuteOptions
): Promise<ExecuteResult> {
  const timeout =
    options?.timeout !== undefined && options.timeout > 0
      ? options.timeout
      : undefined;

  const logLevel = options?.logLevel ?? 'info';
  const onLog =
    logLevel === 'silent'
      ? (): void => {}
      : (message: string): void => {
          process.stderr.write(message + '\n');
        };
  const onLogEvent =
    logLevel === 'silent'
      ? undefined
      : (event: ExtensionEvent): void => {
          process.stderr.write(JSON.stringify(event) + '\n');
        };

  const start = Date.now();

  // EC-23, EC-24, EC-25: all errors re-thrown as-is
  const response = await handler(
    { params, timeout },
    {
      agentName: options.agentName,
      config: options.config ?? {},
      onLog,
      onLogEvent,
    }
  );

  const durationMs = Date.now() - start;

  const result: RillValue = response.result ?? '';
  return { result, durationMs };
}
