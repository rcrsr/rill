import { createInterface } from 'node:readline';
import type {
  ComposedHandlerMap,
  HandlerContext,
  RunRequest,
  StdioRunMessage,
  StdioRunResult,
  StdioAhiResponse,
  AhiBinding,
} from '@rcrsr/rill-agent-shared';
import { readJsonLine, writeJsonLine } from './protocol.js';
import { createAhiBridgeContext, handleAhiResult } from './ahi-bridge.js';

export type { AhiBinding };

// ============================================================
// STDIO HARNESS INTERFACE
// ============================================================

export interface StdioHarness {
  start(): Promise<void>;
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Creates a stdio harness that:
 * 1. Reads one StdioRunMessage from stdin
 * 2. Dispatches to the matching handler
 * 3. Concurrently feeds ahi.result lines from stdin back to the bridge
 * 4. Writes a StdioRunResult to stdout
 * 5. Exits with code 0 on success, 1 on error
 */
export function createStdioHarness(handlers: ComposedHandlerMap): StdioHarness {
  return {
    async start(): Promise<void> {
      // Step 1: Read the run message from stdin.
      let raw: unknown;
      try {
        raw = await readJsonLine(process.stdin);
      } catch (err) {
        console.error('[stdio] Failed to read run message:', err);
        process.exit(1);
      }

      // Step 2: Validate as StdioRunMessage.
      if (
        typeof raw !== 'object' ||
        raw === null ||
        (raw as Record<string, unknown>)['method'] !== 'run'
      ) {
        console.error('[stdio] Expected method "run", got:', raw);
        process.exit(1);
      }
      const msg = raw as StdioRunMessage;

      // Step 3: Find handler.
      const handler = handlers.get(msg.name);
      if (handler === undefined) {
        const result: StdioRunResult = {
          method: 'run.result',
          state: 'failed',
          error: {
            code: 'AGENT_NOT_FOUND',
            message: `No handler for agent "${msg.name}"`,
          },
          durationMs: 0,
        };
        writeJsonLine(process.stdout, result);
        process.exit(1);
      }

      // Step 4: Build RunRequest and HandlerContext.
      const request: RunRequest = {
        params: msg.params,
        timeout: msg.timeout,
        correlationId: msg.correlationId,
        trigger: 'agent',
      };
      const context: HandlerContext = {
        agentName: msg.name,
        correlationId: msg.correlationId,
        config: msg.config,
      };

      // Step 5: Set up AHI bridge and stdin line reader for ahi.result messages.
      const bridge = createAhiBridgeContext();

      const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
      rl.on('line', (line: string) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line) as unknown;
        } catch {
          // Non-JSON lines on stdin after the run message are ignored.
          return;
        }
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          (parsed as Record<string, unknown>)['method'] === 'ahi.result'
        ) {
          handleAhiResult(bridge, parsed as StdioAhiResponse);
        }
      });

      // Step 6-7: Execute the handler and measure duration.
      const startMs = Date.now();
      let result: StdioRunResult;

      try {
        const response = await handler(request, context);
        const durationMs = Date.now() - startMs;
        result = {
          method: 'run.result',
          state: response.state === 'completed' ? 'completed' : 'failed',
          ...(response.result !== undefined && { result: response.result }),
          durationMs,
        };
      } catch (err: unknown) {
        const durationMs = Date.now() - startMs;
        const message = err instanceof Error ? err.message : String(err);
        result = {
          method: 'run.result',
          state: 'failed',
          error: { code: 'HANDLER_ERROR', message },
          durationMs,
        };
      }

      rl.close();

      // Step 8: Write result to stdout.
      writeJsonLine(process.stdout, result);

      // Step 9: Exit.
      process.exit(result.state === 'completed' ? 0 : 1);
    },
  };
}
