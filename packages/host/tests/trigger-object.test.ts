/**
 * Integration tests for RunRequest.trigger object form (IC-14).
 *
 * Verifies end-to-end behavior when trigger is passed as an object
 * via AgentHost.run(). HTTP-level validation is covered in routes.test.ts.
 * SessionManager unit coverage is in host-sessions.test.ts.
 *
 * Covered:
 *   AC-4   trigger.type, trigger.agentName, trigger.sessionId set on session record
 *   IC-14  Object trigger form accepted by host.run()
 *   IC-14  String trigger still accepted (backward compatibility)
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { AgentHost, RunResponse, SessionRecord } from '../src/index.js';
import { createTestHost } from './helpers/host.js';

// ============================================================
// RunRequest.trigger object form (IC-14)
// ============================================================

describe('RunRequest.trigger object form (IC-14)', () => {
  let host: AgentHost | undefined;

  afterEach(async () => {
    if (host !== undefined) {
      await host.stop();
      host = undefined;
    }
  });

  // --------------------------------------------------------
  // Object trigger accepted
  // --------------------------------------------------------
  it('accepts object trigger form without error (IC-14, AC-4)', async () => {
    host = await createTestHost();

    const response: RunResponse = await host.run({
      trigger: {
        type: 'agent',
        agentName: 'caller-agent',
        sessionId: 'abc-123',
      },
    });

    expect(response.sessionId).toBeDefined();
    expect(typeof response.sessionId).toBe('string');
    expect(['completed', 'running']).toContain(response.state);
  });

  // --------------------------------------------------------
  // String trigger backward compatibility
  // --------------------------------------------------------
  it('still accepts string trigger form (backward compat, IC-14)', async () => {
    host = await createTestHost();

    const response: RunResponse = await host.run({ trigger: 'agent' });

    expect(response.sessionId).toBeDefined();
    expect(typeof response.sessionId).toBe('string');
    expect(['completed', 'running']).toContain(response.state);
  });

  // --------------------------------------------------------
  // Session record stores object trigger (AC-4)
  // --------------------------------------------------------
  it('session record stores object trigger fields (AC-4)', async () => {
    host = await createTestHost();

    const objectTrigger = {
      type: 'agent' as const,
      agentName: 'caller-agent',
      sessionId: 'abc-123',
    };

    const response: RunResponse = await host.run({ trigger: objectTrigger });

    const session: SessionRecord | undefined = await host.getSession(
      response.sessionId
    );

    expect(session).toBeDefined();
    expect(session?.trigger).toEqual(objectTrigger);
  });

  // --------------------------------------------------------
  // Session record stores string trigger
  // --------------------------------------------------------
  it('session record stores string trigger unchanged', async () => {
    host = await createTestHost();

    const response: RunResponse = await host.run({ trigger: 'agent' });

    const session: SessionRecord | undefined = await host.getSession(
      response.sessionId
    );

    expect(session).toBeDefined();
    expect(session?.trigger).toBe('agent');
  });

  // --------------------------------------------------------
  // Metric label uses 'agent' for object trigger (AC-4)
  // --------------------------------------------------------
  it('session record trigger.type is agent for object trigger (AC-4)', async () => {
    host = await createTestHost();

    const response: RunResponse = await host.run({
      trigger: {
        type: 'agent',
        agentName: 'metrics-caller',
        sessionId: 'metrics-sess',
      },
    });

    const session: SessionRecord | undefined = await host.getSession(
      response.sessionId
    );

    expect(session).toBeDefined();

    const trigger = session?.trigger;
    // Object trigger must have type 'agent' — the label used for observability.
    expect(typeof trigger).toBe('object');
    if (typeof trigger === 'object' && trigger !== null) {
      expect(trigger.type).toBe('agent');
    }
  });
});
