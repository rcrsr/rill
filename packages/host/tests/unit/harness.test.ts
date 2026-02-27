/**
 * Unit tests for the multi-agent AgentHost harness.
 *
 * Covered:
 *   AC-7   createAgentHost(Map) returns a valid AgentHost in 'ready' phase
 *   AC-8   Single-agent createAgentHost(agent, options) signature unchanged
 *   AC-11  Unknown agent name → HTTP 404
 *   AC-12  Per-agent cap exceeded → HTTP 429
 *   AC-13  Other agents accept requests when one agent is at cap
 *   AC-14  Session record includes agentName from routing
 *   AC-15  GET /readyz returns 200 when phase is ready or running
 *   AC-16  GET /metrics includes agent label on session metrics
 *   AC-17  Two AgentHost instances have independent metric registries
 *   AC-25  1-agent harness behaves like single-agent routing
 *   AC-26  Agent with no cap applies no per-agent limit
 *   EC-6   Empty agents map → AgentHostError
 *   EC-8   Global capacity exceeded → AgentHostError('capacity')
 *   EC-9   Per-agent capacity exceeded → AgentHostError('capacity')
 *   EC-10  SessionManager.activeCountFor() returns 0 for unknown agent
 */

import { createServer } from 'node:net';
import { describe, it, expect, afterEach } from 'vitest';
import { createAgentHost } from '../../src/index.js';
import { AgentHostError } from '../../src/index.js';
import { SessionManager } from '../../src/session.js';
import type { AgentHost } from '../../src/index.js';
import type { ComposedAgent } from '../../src/index.js';
import { mockComposedAgent } from '../helpers/host.js';

// ============================================================
// HELPERS
// ============================================================

/**
 * Returns a free OS-assigned TCP port.
 * Binds then immediately closes a server to discover the port number.
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

/**
 * Creates a ComposedAgent with a specific name for multi-agent tests.
 * Uses mockComposedAgent() as the base; only card.name is overridden.
 */
async function makeAgent(name: string): Promise<ComposedAgent> {
  const base = await mockComposedAgent();
  return {
    ...base,
    card: { ...base.card, name },
  };
}

// ============================================================
// describe: createAgentHost — multi-agent overload
// ============================================================

describe('createAgentHost — multi-agent overload', () => {
  // Track hosts created in this group for cleanup.
  const hosts: AgentHost[] = [];

  afterEach(async () => {
    for (const h of hosts.splice(0)) {
      await h.stop().catch(() => undefined);
    }
  });

  // AC-7
  it('accepts Map<string, ComposedAgent> and returns AgentHost in ready phase', async () => {
    const classifier = await makeAgent('classifier');
    const resolver = await makeAgent('resolver');
    const agents = new Map<string, ComposedAgent>([
      ['classifier', classifier],
      ['resolver', resolver],
    ]);

    const host = createAgentHost(agents, { logLevel: 'silent' });
    hosts.push(host);

    expect(host.phase).toBe('ready');
  });

  // AC-8
  it('single-agent signature still works unchanged', async () => {
    const agent = await mockComposedAgent();
    const host = createAgentHost(agent, { logLevel: 'silent' });
    hosts.push(host);

    expect(host.phase).toBe('ready');
  });

  // EC-6
  it('throws AgentHostError when agents map is empty', () => {
    expect(() => createAgentHost(new Map())).toThrow(AgentHostError);
    try {
      createAgentHost(new Map());
    } catch (err) {
      expect(err).toBeInstanceOf(AgentHostError);
      expect((err as AgentHostError).phase).toBe('init');
    }
  });
});

// ============================================================
// describe: per-agent HTTP routing
// ============================================================

describe('per-agent HTTP routing', () => {
  let host: AgentHost | undefined;

  afterEach(async () => {
    if (host !== undefined) {
      await host.stop().catch(() => undefined);
      await host.close().catch(() => undefined);
      host = undefined;
    }
  });

  // AC-9: routes POST /:name/run to the correct agent
  it('routes POST /classifier/run to the classifier agent', async () => {
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
    const port = await getFreePort();
    await host.listen(port);

    const res = await fetch(`http://localhost:${port}/classifier/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger: 'api' }),
    });

    // Expect 200 (completed or running — either is a valid routed response).
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessionId?: string; state?: string };
    expect(typeof body.sessionId).toBe('string');
  });

  // AC-11
  it('returns 404 for unknown agent name', async () => {
    const classifier = await makeAgent('classifier');
    const agents = new Map<string, ComposedAgent>([['classifier', classifier]]);

    host = createAgentHost(agents, { logLevel: 'silent' });
    const port = await getFreePort();
    await host.listen(port);

    const res = await fetch(`http://localhost:${port}/unknown-agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(404);
  });

  // AC-14
  it('session record includes agentName from routing', async () => {
    const classifier = await makeAgent('classifier');
    const agents = new Map<string, ComposedAgent>([['classifier', classifier]]);

    host = createAgentHost(agents, {
      logLevel: 'silent',
      responseTimeout: 5000,
    });
    const port = await getFreePort();
    await host.listen(port);

    await fetch(`http://localhost:${port}/classifier/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger: 'api' }),
    });

    const sessions = await host.sessions();
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    const session = sessions[0];
    expect(session).toBeDefined();
    expect(session!.agentName).toBe('classifier');
  });

  // AC-25
  it('1-agent harness routes /:agentName/run like single-agent mode', async () => {
    const solo = await makeAgent('solo');
    const agents = new Map<string, ComposedAgent>([['solo', solo]]);

    host = createAgentHost(agents, {
      logLevel: 'silent',
      responseTimeout: 5000,
    });
    const port = await getFreePort();
    await host.listen(port);

    const res = await fetch(`http://localhost:${port}/solo/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger: 'api' }),
    });

    expect(res.status).toBe(200);
  });
});

// ============================================================
// describe: per-agent concurrency caps
// ============================================================

describe('per-agent concurrency caps', () => {
  // AC-12, EC-9: per-agent cap exceeded → AgentHostError('capacity')
  it('throws AgentHostError when per-agent cap is exceeded', () => {
    const sm = new SessionManager({
      maxConcurrentSessions: 10,
      sessionTtl: 60000,
      agentCaps: new Map([['bot', 1]]),
    });

    const req = { trigger: 'api' as const };
    sm.create(req, 'corr-1', 'bot'); // fills cap

    expect(() => sm.create(req, 'corr-2', 'bot')).toThrow(AgentHostError);

    try {
      sm.create(req, 'corr-3', 'bot');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentHostError);
      expect((err as AgentHostError).phase).toBe('capacity');
    }
  });

  // AC-13: other agents accept when one is at limit
  it('other agents accept requests when one agent is at per-agent cap', () => {
    const sm = new SessionManager({
      maxConcurrentSessions: 10,
      sessionTtl: 60000,
      agentCaps: new Map([['classifier', 1]]),
    });

    const req = { trigger: 'api' as const };
    sm.create(req, 'corr-1', 'classifier'); // fills classifier cap

    // classifier at cap — must throw
    expect(() => sm.create(req, 'corr-2', 'classifier')).toThrow(
      AgentHostError
    );

    // resolver has no cap — must succeed
    expect(() => sm.create(req, 'corr-3', 'resolver')).not.toThrow();
  });

  // AC-26: agent with no cap entry applies no per-agent limit
  it('agent not in agentCaps map applies no per-agent limit', () => {
    const sm = new SessionManager({
      maxConcurrentSessions: 10,
      sessionTtl: 60000,
      agentCaps: new Map([['capped', 1]]),
    });

    const req = { trigger: 'api' as const };
    // 'uncapped' has no entry in agentCaps — should accept multiple sessions
    sm.create(req, 'corr-1', 'uncapped');
    sm.create(req, 'corr-2', 'uncapped');
    sm.create(req, 'corr-3', 'uncapped');

    expect(sm.activeCountFor('uncapped')).toBe(3);
  });
});

// ============================================================
// describe: global capacity
// ============================================================

describe('global capacity', () => {
  // EC-8: global cap exceeded → AgentHostError('capacity')
  it('throws AgentHostError(capacity) when global cap exceeded', () => {
    const sm = new SessionManager({
      maxConcurrentSessions: 1,
      sessionTtl: 60000,
    });

    const req = { trigger: 'api' as const };
    sm.create(req, 'corr-1', 'bot'); // fills global cap

    expect(() => sm.create(req, 'corr-2', 'other')).toThrow(AgentHostError);

    try {
      sm.create(req, 'corr-3', 'other');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentHostError);
      expect((err as AgentHostError).phase).toBe('capacity');
      expect((err as AgentHostError).message).toBe('session limit reached');
    }
  });
});

// ============================================================
// describe: SessionManager.activeCountFor
// ============================================================

describe('SessionManager.activeCountFor', () => {
  // EC-10
  it('returns 0 for unknown agent name', () => {
    const sm = new SessionManager({
      maxConcurrentSessions: 10,
      sessionTtl: 60000,
    });

    expect(sm.activeCountFor('nonexistent')).toBe(0);
  });

  it('counts only running sessions for the named agent', () => {
    const sm = new SessionManager({
      maxConcurrentSessions: 10,
      sessionTtl: 60000,
    });

    const req = { trigger: 'api' as const };
    sm.create(req, 'corr-1', 'bot');
    sm.create(req, 'corr-2', 'bot');
    sm.create(req, 'corr-3', 'other');

    expect(sm.activeCountFor('bot')).toBe(2);
    expect(sm.activeCountFor('other')).toBe(1);
    expect(sm.activeCountFor('unknown')).toBe(0);
  });
});

// ============================================================
// describe: metrics
// ============================================================

describe('metrics', () => {
  // AC-16: GET /metrics output includes agent label on all 3 session metrics.
  it('GET /metrics includes agent label on all session metrics', async () => {
    const classifier = await makeAgent('classifier');
    const agents = new Map<string, ComposedAgent>([['classifier', classifier]]);

    const host = createAgentHost(agents, {
      logLevel: 'silent',
      responseTimeout: 5000,
    });
    const port = await getFreePort();
    await host.listen(port);

    // Trigger a session via the per-agent route.
    await fetch(`http://localhost:${port}/classifier/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger: 'api' }),
    });

    // Poll GET /metrics until the agent label appears.
    let metricsText = '';
    for (let i = 0; i < 20; i++) {
      const res = await fetch(`http://localhost:${port}/metrics`);
      metricsText = await res.text();
      if (metricsText.includes('agent=')) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }

    await host.stop().catch(() => undefined);
    await host.close().catch(() => undefined);

    expect(metricsText).toMatch(/rill_sessions_total\{[^}]*agent=/);
    expect(metricsText).toMatch(/rill_sessions_active\{[^}]*agent=/);
    // rill_execution_duration_seconds appears as _bucket, _sum, or _count
    expect(metricsText).toMatch(
      /rill_execution_duration_seconds[^{]*\{[^}]*agent=/
    );
  });

  // AC-17: two AgentHost instances use independent prom-client registries.
  it('two AgentHost instances have independent metric registries', async () => {
    const agent1 = await makeAgent('alpha');
    const agent2 = await makeAgent('beta');

    const host1 = createAgentHost(
      new Map<string, ComposedAgent>([['alpha', agent1]]),
      { logLevel: 'silent' }
    );
    const host2 = createAgentHost(
      new Map<string, ComposedAgent>([['beta', agent2]]),
      { logLevel: 'silent' }
    );

    const metrics1 = await host1.metrics();
    const metrics2 = await host2.metrics();

    // Neither registry references the other host's agent label.
    expect(metrics1).not.toContain('agent="beta"');
    expect(metrics2).not.toContain('agent="alpha"');

    await host1.stop().catch(() => undefined);
    await host2.stop().catch(() => undefined);
  });
});

// ============================================================
// describe: readyz endpoint
// ============================================================

describe('readyz endpoint', () => {
  // AC-15: GET /readyz returns 200 when the host is ready.
  // Process-level routes are now registered before the /:agentName/* catch-all,
  // so /readyz is reachable via HTTP.
  it('GET /readyz returns 200 when host is ready', async () => {
    const classifier = await makeAgent('classifier');
    const agents = new Map<string, ComposedAgent>([['classifier', classifier]]);

    const host = createAgentHost(agents, { logLevel: 'silent' });
    const port = await getFreePort();
    await host.listen(port);

    const res = await fetch(`http://localhost:${port}/readyz`);
    await host.stop().catch(() => undefined);
    await host.close().catch(() => undefined);

    expect(res.status).toBe(200);
  });

  // AC-15: GET /readyz returns 503 when host phase is NOT 'ready' or 'running'.
  // After host.stop(), phase transitions to 'stopped', triggering the 503 branch.
  it('GET /readyz returns 503 after host.stop()', async () => {
    const classifier = await makeAgent('classifier');
    const agents = new Map<string, ComposedAgent>([['classifier', classifier]]);

    const host = createAgentHost(agents, { logLevel: 'silent' });
    const port = await getFreePort();
    await host.listen(port);
    await host.stop().catch(() => undefined);

    const res = await fetch(`http://localhost:${port}/readyz`);
    await host.close().catch(() => undefined);

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'service unavailable' });
  });
});
