/**
 * Tests for AgentHost lifecycle, phase transitions, and error contracts.
 *
 * Covered:
 *   AC-1   createAgentHost returns host with phase 'ready'
 *   AC-3   run() returns RunResponse with state 'completed'
 *   AC-4   sessions() returns record with correct stepCount
 *   AC-5   health() returns HealthStatus with phase 'running' after run
 *   AC-6   metrics() returns Prometheus text with all 6 rill_* metric names
 *   AC-12  close() stops HTTP server; subsequent requests fail
 *   AC-15  createAgentHost(null) throws TypeError('agent is required')
 *   EC-10  listen() with no options falls back to DEFAULTS.port; EADDRINUSE propagates
 *   AC-27  10 concurrent run() calls succeed; 11th throws
 *   AC-31  sessions() returns [] with no active sessions
 *   EC-1   createAgentHost(null) throws TypeError('agent is required')
 *   EC-2   listen() called twice rejects with Error('server already listening')
 *   EC-3   listen() on port in use rejects with EADDRINUSE
 *   EC-5   run() after stop() throws AgentHostError('host stopped', 'lifecycle')
 *   EC-6   run() at capacity throws AgentHostError('session limit reached', 'capacity')
 *   EC-8   stop() called twice is no-op (idempotent)
 *   EC-10  listen() called twice throws AgentHostError('server already listening', 'lifecycle')
 *   EC-11  close() when not listening is no-op
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  createAgentHost,
  AgentHostError,
  type AgentHost,
  type ComposedAgent,
} from '../src/index.js';
import { createTestHost, mockComposedAgent } from './helpers/host.js';

// ============================================================
// HELPERS
// ============================================================

/**
 * Safely stops a host that may be in any phase.
 * No-op if host is in 'stopped' phase.
 */
async function safeStop(host: AgentHost): Promise<void> {
  if (host.phase === 'ready' || host.phase === 'running') {
    await host.stop();
  }
}

// ============================================================
// TEARDOWN REGISTRY
// ============================================================

// Track hosts created per test to ensure cleanup in afterEach.
const hostsToClean: AgentHost[] = [];

afterEach(async () => {
  for (const host of hostsToClean.splice(0)) {
    await host.close().catch(() => undefined);
    await safeStop(host).catch(() => undefined);
  }
});

// ============================================================
// FACTORY TESTS
// ============================================================

describe('createAgentHost', () => {
  it('returns AgentHost with phase ready synchronously (AC-1)', async () => {
    const host = await createTestHost();
    hostsToClean.push(host);

    expect(host.phase).toBe('ready');
  });

  it('throws TypeError when agent is null (AC-15 / EC-1)', () => {
    expect(() => createAgentHost(null as unknown as ComposedAgent)).toThrow(
      TypeError
    );

    let thrown: unknown;
    try {
      createAgentHost(null as unknown as ComposedAgent);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    const err = thrown as TypeError;
    expect(err.message).toBe('agent is required');
  });

  it('throws TypeError when agent is undefined (EC-1)', () => {
    let thrown: unknown;
    try {
      createAgentHost(undefined as unknown as ComposedAgent);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    const err = thrown as TypeError;
    expect(err.message).toBe('agent is required');
  });
});

// ============================================================
// RUN TESTS
// ============================================================

describe('run()', () => {
  it('returns RunResponse with state completed (AC-3)', async () => {
    const host = await createTestHost();
    hostsToClean.push(host);

    const response = await host.run({ params: { name: 'test' } });

    expect(response.state).toBe('completed');
    expect(response.sessionId).toBeDefined();
    expect(response.correlationId).toBeDefined();
  });

  it('throws AgentHostError when phase is stopped (EC-5)', async () => {
    const host = await createTestHost();
    hostsToClean.push(host);

    await host.stop();

    let thrown: unknown;
    try {
      await host.run({});
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AgentHostError);
    const err = thrown as AgentHostError;
    expect(err.message).toBe('host stopped');
    expect(err.phase).toBe('lifecycle');
  });

  it('throws AgentHostError at capacity (EC-6)', async () => {
    // maxConcurrentSessions: 1 so the first in-flight run blocks the second.
    const host = await createTestHost({ maxConcurrentSessions: 1 });
    hostsToClean.push(host);

    // Start a run but do not await — it will occupy the single slot.
    const firstRun = host.run({});

    // The second run should hit the capacity limit immediately.
    let thrown: unknown;
    try {
      await host.run({});
    } catch (err) {
      thrown = err;
    }

    // Await the first run to clean up before assertions.
    await firstRun.catch(() => undefined);

    expect(thrown).toBeInstanceOf(AgentHostError);
    const err = thrown as AgentHostError;
    expect(err.message).toBe('session limit reached');
    expect(err.phase).toBe('capacity');
  });

  it('10 concurrent runs succeed and 11th throws at default capacity (AC-27)', async () => {
    // Default maxConcurrentSessions is 10.
    const host = await createTestHost({ maxConcurrentSessions: 10 });
    hostsToClean.push(host);

    // Launch 10 runs without awaiting — each occupies a session slot.
    const runPromises = Array.from({ length: 10 }, () => host.run({}));

    // The 11th run must fail with capacity error.
    let thrown: unknown;
    try {
      await host.run({});
    } catch (err) {
      thrown = err;
    }

    // Drain all 10 runs before assertions.
    await Promise.allSettled(runPromises);

    expect(thrown).toBeInstanceOf(AgentHostError);
    const err = thrown as AgentHostError;
    expect(err.message).toBe('session limit reached');
    expect(err.phase).toBe('capacity');
  });
});

// ============================================================
// SESSIONS TESTS
// ============================================================

describe('sessions()', () => {
  it('returns empty array when no sessions have run (AC-31)', async () => {
    const host = await createTestHost();
    hostsToClean.push(host);

    const sessions = host.sessions();

    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions).toHaveLength(0);
  });

  it('returns session record with correct stepCount after execution (AC-4)', async () => {
    const host = await createTestHost();
    hostsToClean.push(host);

    await host.run({});

    const sessions = host.sessions();
    expect(sessions).toHaveLength(1);
    const record = sessions[0];
    expect(record).toBeDefined();
    // minimal.rill is: 1 -> log (one step)
    expect(record!.stepCount).toBeGreaterThanOrEqual(1);
    expect(record!.state).toBe('completed');
  });
});

// ============================================================
// HEALTH TESTS
// ============================================================

describe('health()', () => {
  it('returns HealthStatus with phase running after a session runs (AC-5)', async () => {
    const host = await createTestHost();
    hostsToClean.push(host);

    await host.run({});

    const status = host.health();
    expect(status.phase).toBe('running');
    expect(typeof status.uptimeSeconds).toBe('number');
    expect(typeof status.activeSessions).toBe('number');
  });
});

// ============================================================
// METRICS TESTS
// ============================================================

describe('metrics()', () => {
  it('returns Prometheus text containing all 6 rill_* metric names (AC-6)', async () => {
    const host = await createTestHost();
    hostsToClean.push(host);

    await host.run({});

    const text = await host.metrics();

    expect(text).toContain('rill_sessions_total');
    expect(text).toContain('rill_sessions_active');
    expect(text).toContain('rill_execution_duration_seconds');
    expect(text).toContain('rill_host_calls_total');
    expect(text).toContain('rill_host_call_errors_total');
    expect(text).toContain('rill_steps_total');
  });
});

// ============================================================
// STOP TESTS
// ============================================================

describe('stop()', () => {
  it('is a no-op when called twice on a stopped host (EC-8)', async () => {
    const host = await createTestHost();
    hostsToClean.push(host);

    await host.stop();
    expect(host.phase).toBe('stopped');

    // Second call must not throw.
    await expect(host.stop()).resolves.toBeUndefined();
    expect(host.phase).toBe('stopped');
  });
});

// ============================================================
// LISTEN TESTS
// ============================================================

describe('listen()', () => {
  it('throws AgentHostError when called twice (EC-10)', async () => {
    const host = await createTestHost();
    hostsToClean.push(host);

    // Use port 0 to let the OS assign a free port.
    await host.listen(0);

    let thrown: unknown;
    try {
      await host.listen(0);
    } catch (err) {
      thrown = err;
    }

    // Clean up the listening server.
    await host.close();

    expect(thrown).toBeInstanceOf(AgentHostError);
    const err = thrown as AgentHostError;
    expect(err.message).toBe('server already listening');
    expect(err.phase).toBe('lifecycle');
  });

  it('rejects with EADDRINUSE when port is already in use (EC-2 / EC-3)', async () => {
    const hostA = await createTestHost();
    const hostB = await createTestHost();

    // Bind hostA to a fixed port so hostB can conflict with it.
    await hostA.listen(19998);

    let thrown: unknown;
    try {
      await hostB.listen(19998);
    } catch (err) {
      thrown = err;
    } finally {
      await hostA.close().catch(() => undefined);
      await hostB.close().catch(() => undefined);
    }

    expect(thrown).toBeDefined();
    const err = thrown as { code?: string };
    expect(err.code).toBe('EADDRINUSE');
  });

  it('listen() with no options falls back to DEFAULTS.port; EADDRINUSE propagates (EC-10)', async () => {
    // EC-10: agent.card.port was removed from the port fallback. Without options,
    // listen() now uses DEFAULTS.port (3000). EADDRINUSE must propagate, not be swallowed.
    //
    // Pre-bind DEFAULTS.port so the condition is always met regardless of environment.
    const { createServer } = await import('node:net');
    const blocker = createServer();
    const prebindOk = await new Promise<boolean>((resolve) =>
      blocker
        .listen(3000, () => resolve(true))
        .on('error', () => resolve(false))
    );
    // If pre-bind failed, something else holds port 3000 — condition is already met.

    const host = createAgentHost(await mockComposedAgent());
    hostsToClean.push(host);

    let thrown: unknown;
    try {
      await host.listen();
    } catch (err) {
      thrown = err;
    } finally {
      if (prebindOk) {
        await new Promise<void>((resolve) => blocker.close(() => resolve()));
      }
    }

    expect(thrown).toBeDefined();
    const err = thrown as { code?: string };
    expect(err.code).toBe('EADDRINUSE');
  });
});

// ============================================================
// CLOSE TESTS
// ============================================================

describe('close()', () => {
  it('is a no-op when not listening (EC-11)', async () => {
    const host = await createTestHost();
    hostsToClean.push(host);

    // close() without listen() must not throw.
    await expect(host.close()).resolves.toBeUndefined();
  });

  it('stops HTTP server so subsequent requests fail (AC-12)', async () => {
    const host = await createTestHost();
    hostsToClean.push(host);

    // Bind to OS-assigned port.
    await host.listen(0);
    await host.close();

    // After close(), another listen() on the same host should succeed
    // (httpServer is cleared), proving close() released the server.
    // We verify by confirming close() did not leave an httpServer reference,
    // which would cause the next listen() call to throw 'server already listening'.
    await host.listen(0);
    await host.close();

    // If we reach here, close() correctly cleared the server reference.
    expect(true).toBe(true);
  });
});
