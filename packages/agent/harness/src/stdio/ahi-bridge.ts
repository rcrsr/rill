import type { AhiBinding, StdioAhiResponse } from '@rcrsr/rill-agent-shared';

// ============================================================
// AHI BRIDGE CONTEXT
// ============================================================

/**
 * Holds pending AHI calls keyed by their request ID.
 * The stdio harness resolves these when ahi.result lines arrive on stdin.
 */
export interface AhiBridgeContext {
  readonly pendingAhiCalls: Map<
    string,
    { resolve: (r: unknown) => void; reject: (e: Error) => void }
  >;
}

/**
 * Creates a fresh AhiBridgeContext with an empty pending-calls map.
 */
export function createAhiBridgeContext(): AhiBridgeContext {
  return { pendingAhiCalls: new Map() };
}

// ============================================================
// AHI RESULT HANDLER
// ============================================================

/**
 * Resolves or rejects the pending AHI call matching msg.id.
 * Called by the stdio harness when an ahi.result line arrives on stdin.
 */
export function handleAhiResult(
  ctx: AhiBridgeContext,
  msg: StdioAhiResponse
): void {
  const pending = ctx.pendingAhiCalls.get(msg.id);
  if (pending === undefined) {
    // No matching pending call — ignore (could be a duplicate or stale message).
    return;
  }
  ctx.pendingAhiCalls.delete(msg.id);
  if (msg.error !== undefined) {
    pending.reject(
      new Error(`AHI error [${msg.error.code}]: ${msg.error.message}`)
    );
  } else {
    pending.resolve(msg.result);
  }
}

// ============================================================
// BINDINGS STORE
// ============================================================

/**
 * Creates an AHI bridge that stores the available bindings for this run.
 * The actual transport mediation (writing ahi messages to stdout and reading
 * ahi.result from stdin) is handled at the StdioHarness level using
 * AhiBridgeContext. This object simply makes the bindings available.
 */
export function createAhiBridge(_bindings: Record<string, AhiBinding>): {
  readonly bindings: Record<string, AhiBinding>;
} {
  return { bindings: _bindings };
}
