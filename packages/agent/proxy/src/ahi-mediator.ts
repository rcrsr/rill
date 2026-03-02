/**
 * AHI Mediator: creates the handler function that the process manager calls
 * when a child sends an 'ahi' message.
 *
 * IC-37: createAhiHandler factory.
 * IR-10: AHI mediation flow — validate target, spawn child B, return result to child A.
 * EC-12: AHI target not in catalog → ProxyError PROXY_AHI_TARGET_MISSING, writes error ahi.result.
 * AC-32: Child A calls agent B via stdio, proxy spawns B, returns result to A.
 * AC-48: AHI target missing → ahi.result with error written to child stdin.
 */

import type { ChildProcess } from 'node:child_process';
import type {
  StdioAhiRequest,
  StdioAhiResponse,
  StdioRunMessage,
} from '@rcrsr/rill-agent-shared';
import type { Catalog } from './catalog.js';
import type { ProcessManager } from './process-manager.js';
import { ProxyError, PROXY_AHI_TARGET_MISSING } from './errors.js';
import { writeJsonLine } from './protocol.js';

// ============================================================
// FACTORY
// ============================================================

/**
 * Creates the AHI handler function that the process manager calls
 * when a child sends an 'ahi' message.
 *
 * @param catalog - Used to look up target agents by name.
 * @param processManager - Used to spawn target children.
 * @param defaultTimeoutMs - Applied when request.timeout is absent.
 * @param correlationId - Correlation ID of the root request (propagated to child).
 */
export function createAhiHandler(
  catalog: Catalog,
  processManager: ProcessManager,
  defaultTimeoutMs: number,
  correlationId: string
): (child: ChildProcess, request: StdioAhiRequest) => Promise<void> {
  return async function ahiHandler(
    child: ChildProcess,
    request: StdioAhiRequest
  ): Promise<void> {
    // EC-12: validate target exists in catalog.
    const entry = catalog.get(request.target);
    if (entry === undefined) {
      const errorResponse: StdioAhiResponse = {
        method: 'ahi.result',
        id: request.id,
        error: {
          code: PROXY_AHI_TARGET_MISSING,
          message: `AHI target "${request.target}" not found in catalog`,
        },
      };
      if (child.stdin) {
        writeJsonLine(child.stdin, errorResponse);
      }
      return;
    }

    // Build the run message for the target child.
    const runMessage: StdioRunMessage = {
      method: 'run',
      name: request.target,
      params: request.params,
      config: {},
      bindings: {},
      timeout: request.timeout ?? defaultTimeoutMs,
      correlationId,
    };

    // AC-32: spawn target, collect result, write ahi.result back to child A.
    try {
      const result = await processManager.spawn(entry, runMessage);
      const successResponse: StdioAhiResponse = {
        method: 'ahi.result',
        id: request.id,
        result: result.result,
      };
      if (child.stdin) {
        writeJsonLine(child.stdin, successResponse);
      }
    } catch (err: unknown) {
      const proxyErr = err instanceof ProxyError ? err : undefined;
      const errorResponse: StdioAhiResponse = {
        method: 'ahi.result',
        id: request.id,
        error: {
          code: proxyErr?.code ?? 'PROXY_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      };
      if (child.stdin) {
        writeJsonLine(child.stdin, errorResponse);
      }
    }
  };
}
