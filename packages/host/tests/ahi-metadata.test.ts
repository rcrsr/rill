/**
 * Integration test: AHI extension forwards X-Correlation-ID header.
 *
 * Covered:
 *   AC-3  X-Correlation-ID on outgoing AHI request matches session correlationId
 *
 * The host populates ctx.metadata.correlationId on every run().
 * The AHI extension reads ctx.metadata.correlationId and sets the
 * X-Correlation-ID header on the downstream fetch call.
 * This test wires both together through a real host.run() invocation.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { parse, createRuntimeContext, hoistExtension } from '@rcrsr/rill';
import type { HostFunctionDefinition } from '@rcrsr/rill';
import { createAhiExtension } from '@rcrsr/rill-ext-ahi';
import type { ComposedAgent, AgentHost } from '../src/index.js';
import { createAgentHost } from '../src/index.js';

// ============================================================
// HELPERS
// ============================================================

/** Minimal fetch init shape — avoids dependency on the DOM lib */
interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: unknown;
}

/**
 * Stub global fetch and capture the headers from the first call.
 * Returns a mutable object; headers are populated after fetch resolves.
 */
function stubFetchCapturingHeaders(): { headers: Record<string, string> } {
  const captured: { headers: Record<string, string> } = { headers: {} };

  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (_url: string, init: FetchInit) => {
      captured.headers = { ...(init.headers ?? {}) };
      return {
        ok: true,
        json: async () => ({ result: 'downstream-result' }),
      };
    })
  );

  return captured;
}

/**
 * Build a ComposedAgent that calls `ahi::downstream` with AHI functions
 * registered on the runtime context.
 */
function makeAhiAgent(
  ahiFunctions: Record<string, HostFunctionDefinition>
): ComposedAgent {
  const ast = parse('1 -> ahi::downstream');
  const context = createRuntimeContext({ functions: ahiFunctions });

  return {
    ast,
    context,
    card: { name: 'ahi-test-agent', version: '0.0.1', capabilities: [] },
    extensions: {},
    dispose: async () => undefined,
  };
}

// ============================================================
// AC-3: X-Correlation-ID forwarded to downstream request
// ============================================================

describe('AHI extension forwards X-Correlation-ID (AC-3)', () => {
  let host: AgentHost | undefined;

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (host !== undefined) {
      await host.stop();
      host = undefined;
    }
  });

  it('X-Correlation-ID on downstream request matches session correlationId', async () => {
    // Arrange: stub fetch to capture outgoing headers
    const captured = stubFetchCapturingHeaders();

    // Extract functions from AHI extension result via hoistExtension.
    // The factory returns unprefixed keys; hoistExtension adds the "ahi::" namespace.
    const ahiExt = createAhiExtension({
      agents: { downstream: { url: 'http://downstream:8080' } },
    });
    const hoisted = hoistExtension('ahi', ahiExt);
    const ahiFunctions = hoisted.functions;

    const agent = makeAhiAgent(ahiFunctions);

    // Act: run through the host — host populates ctx.metadata.correlationId
    host = createAgentHost(agent);
    const response = await host.run({});

    // Assert: the outgoing X-Correlation-ID matches the session correlationId
    expect(captured.headers['X-Correlation-ID']).toBe(response.correlationId);
  });
});
