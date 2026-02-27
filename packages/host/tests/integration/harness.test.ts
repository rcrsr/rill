/**
 * Integration tests for multi-agent harness HTTP routing.
 *
 * Covered:
 *   AC-9   POST /classifier/run routes to classifier agent
 *   AC-9   POST /resolver/run routes to resolver agent
 *   AC-10  GET /classifier/sessions returns only classifier sessions
 *   IC-12  Concurrent requests to different agents succeed independently
 *   IC-12  POST /stop stops all agents cleanly
 *   AC-12  Per-agent cap exceeded → HTTP 429
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:net';
import type { AgentHost, ComposedAgent } from '../../src/index.js';
import { createAgentHost } from '../../src/index.js';
import { mockComposedAgent } from '../helpers/host.js';
import { parse, createRuntimeContext } from '@rcrsr/rill';
import type { ExtensionResult } from '@rcrsr/rill';

// ============================================================
// HELPERS
// ============================================================

/**
 * Returns a ComposedAgent with the given name by spreading over
 * a base agent from the fixture helper.
 */
async function makeAgent(name: string): Promise<ComposedAgent> {
  const base = await mockComposedAgent();
  return { ...base, card: { ...base.card, name } };
}

/**
 * Finds a free port by binding to port 0 and reading back the assigned port.
 */
function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

// ============================================================
// MULTI-AGENT HARNESS INTEGRATION
// ============================================================

describe('multi-agent harness integration', () => {
  let host: AgentHost;
  let port: number;

  beforeAll(async () => {
    const classifier = await makeAgent('classifier');
    const resolver = await makeAgent('resolver');
    const agents = new Map<string, ComposedAgent>([
      ['classifier', classifier],
      ['resolver', resolver],
    ]);
    host = createAgentHost(agents, {
      logLevel: 'silent',
      responseTimeout: 5000,
    });
    port = await getFreePort();
    await host.listen(port);
  });

  afterAll(async () => {
    await host.stop().catch(() => undefined);
    await host.close().catch(() => undefined);
  });

  // ----------------------------------------------------------
  // AC-9: Per-agent routing — classifier
  // ----------------------------------------------------------
  it('POST /classifier/run routes to classifier agent (AC-9)', async () => {
    const res = await fetch(`http://localhost:${port}/classifier/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger: 'api' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('sessionId');
    expect(body).toHaveProperty('correlationId');
    expect(typeof body['sessionId']).toBe('string');
    expect(typeof body['correlationId']).toBe('string');
    expect(['running', 'completed', 'failed']).toContain(body['state']);
  });

  // ----------------------------------------------------------
  // AC-9: Per-agent routing — resolver
  // ----------------------------------------------------------
  it('POST /resolver/run routes to resolver agent (AC-9)', async () => {
    const res = await fetch(`http://localhost:${port}/resolver/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger: 'api' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('sessionId');
    expect(body).toHaveProperty('correlationId');
    expect(typeof body['sessionId']).toBe('string');
    expect(typeof body['correlationId']).toBe('string');
    expect(['running', 'completed', 'failed']).toContain(body['state']);
  });

  // ----------------------------------------------------------
  // AC-10: Per-agent session isolation
  // ----------------------------------------------------------
  it('GET /classifier/sessions returns only classifier sessions (AC-10)', async () => {
    // Trigger a run on the classifier to ensure at least one session exists.
    const runRes = await fetch(`http://localhost:${port}/classifier/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger: 'api' }),
    });
    expect(runRes.status).toBe(200);
    const runBody = (await runRes.json()) as { sessionId: string };
    const sessionId = runBody.sessionId;

    // Trigger a run on the resolver so its session must NOT appear in classifier list.
    await fetch(`http://localhost:${port}/resolver/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger: 'api' }),
    });

    const sessionsRes = await fetch(
      `http://localhost:${port}/classifier/sessions`
    );
    expect(sessionsRes.status).toBe(200);
    const sessions = (await sessionsRes.json()) as Array<{
      id: string;
      agentName: string;
    }>;

    // Every session in this list must belong to the classifier agent.
    for (const session of sessions) {
      expect(session.agentName).toBe('classifier');
    }

    // The session we just created must be present.
    const found = sessions.some((s) => s.id === sessionId);
    expect(found).toBe(true);
  });

  // ----------------------------------------------------------
  // Concurrent requests to different agents succeed independently
  // ----------------------------------------------------------
  it('concurrent requests to different agents succeed independently', async () => {
    const [classifierRes, resolverRes] = await Promise.all([
      fetch(`http://localhost:${port}/classifier/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: 'api' }),
      }),
      fetch(`http://localhost:${port}/resolver/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: 'api' }),
      }),
    ]);

    expect(classifierRes.status).toBe(200);
    expect(resolverRes.status).toBe(200);

    const classifierBody = (await classifierRes.json()) as Record<
      string,
      unknown
    >;
    const resolverBody = (await resolverRes.json()) as Record<string, unknown>;

    expect(classifierBody).toHaveProperty('sessionId');
    expect(resolverBody).toHaveProperty('sessionId');
    // Session IDs are distinct — the two runs are independent.
    expect(classifierBody['sessionId']).not.toBe(resolverBody['sessionId']);
  });

  // ----------------------------------------------------------
  // POST /stop stops all agents cleanly
  // Creates a separate host so the shared one remains available for
  // any concurrent test that runs in parallel.
  // ----------------------------------------------------------
  it('POST /stop stops all agents cleanly', async () => {
    const agent1 = await makeAgent('alpha');
    const agent2 = await makeAgent('beta');
    const stopHost = createAgentHost(
      new Map<string, ComposedAgent>([
        ['alpha', agent1],
        ['beta', agent2],
      ]),
      { logLevel: 'silent' }
    );
    const stopPort = await getFreePort();
    await stopHost.listen(stopPort);

    const res = await fetch(`http://localhost:${stopPort}/stop`, {
      method: 'POST',
    });
    expect(res.status).toBe(202);

    // Allow the async drain + phase transition to complete.
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    expect(stopHost.phase).toBe('stopped');

    await stopHost.close().catch(() => undefined);
  });
});

// ============================================================
// AC-12: PER-AGENT CAP → HTTP 429
// ============================================================

/**
 * Builds a ComposedAgent whose script blocks until the caller resolves
 * the returned `release` function. This guarantees the first session is
 * still "running" when the second HTTP request arrives.
 */
function makeBlockingAgent(name: string): {
  agent: ComposedAgent;
  release: () => void;
} {
  let release!: () => void;
  const releasePromise = new Promise<void>((resolve) => {
    release = resolve;
  });

  const context = createRuntimeContext();
  // Register a zero-param host function that blocks until release() is called.
  context.functions.set('wait_for_release', async () => {
    await releasePromise;
    return 1 as unknown as import('@rcrsr/rill').RillValue;
  });

  const ast = parse('1 -> wait_for_release');

  const agent: ComposedAgent = {
    ast,
    context,
    card: { name, version: '0.0.0', capabilities: [] },
    extensions: {} as Record<string, ExtensionResult>,
    dispose: async () => undefined,
  };

  return { agent, release };
}

describe('per-agent cap HTTP 429 (AC-12)', () => {
  let capHost: AgentHost;
  let capPort: number;
  let releaseFirst: () => void;

  beforeAll(async () => {
    const { agent, release } = makeBlockingAgent('classifier');
    releaseFirst = release;

    capHost = createAgentHost(
      new Map<string, ComposedAgent>([['classifier', agent]]),
      {
        logLevel: 'silent',
        agentCaps: new Map([['classifier', 1]]),
      }
    );
    capPort = await getFreePort();
    await capHost.listen(capPort);
  });

  afterAll(async () => {
    // Unblock the first session so the host can drain cleanly.
    releaseFirst();
    await capHost.stop().catch(() => undefined);
    await capHost.close().catch(() => undefined);
  });

  // ----------------------------------------------------------
  // AC-12: second request to capped agent returns HTTP 429
  // ----------------------------------------------------------
  it('POST /classifier/run returns HTTP 429 when per-agent cap is reached (AC-12)', async () => {
    // First request: starts executing and blocks inside wait_for_release.
    // We do NOT await it so the session stays "running".
    const firstFetch = fetch(`http://localhost:${capPort}/classifier/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger: 'api' }),
    });

    // Give the event loop a tick so the first request reaches sessionManager.create().
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    // Second request: cap is 1, first session is running → must get 429.
    const secondRes = await fetch(
      `http://localhost:${capPort}/classifier/run`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: 'api' }),
      }
    );

    expect(secondRes.status).toBe(429);
    const body = (await secondRes.json()) as Record<string, unknown>;
    expect(body['error']).toBe('session limit reached');

    // Unblock the first session so it can complete.
    releaseFirst();
    await firstFetch;
  });
});
