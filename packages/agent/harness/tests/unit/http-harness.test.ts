/**
 * Unit tests for createHttpHarness — GET /:agentName/card route.
 *
 * Covered:
 *   - Returns 200 with card JSON when cards map contains entry for agent
 *   - Returns 404 when no cards option is provided
 *   - Returns 404 for unknown agent name
 */

import { createServer } from 'node:net';
import { describe, it, expect, afterEach } from 'vitest';
import { createHttpHarness } from '../../src/http/index.js';
import type { HttpHarness } from '../../src/http/index.js';
import type {
  AgentCard,
  ComposedHandler,
  ComposedHandlerMap,
} from '@rcrsr/rill-agent-shared';

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
 * Minimal mock handler that immediately returns a completed result.
 */
function mockHandler(): ComposedHandler {
  return async () => ({ state: 'completed', result: null });
}

/**
 * Builds a minimal valid AgentCard for the given agent name.
 */
function makeCard(name: string): AgentCard {
  return {
    name,
    description: 'Test agent',
    version: '0.0.1',
    url: 'http://localhost:3000',
    capabilities: { streaming: false, pushNotifications: false },
    skills: [],
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
  };
}

// ============================================================
// describe: GET /:agentName/card
// ============================================================

describe('GET /:agentName/card', () => {
  let harness: HttpHarness | undefined;

  afterEach(async () => {
    if (harness !== undefined) {
      await harness.close().catch(() => undefined);
      harness = undefined;
    }
  });

  it('returns 200 with card when cards map contains entry for agent', async () => {
    // Arrange
    const port = await getFreePort();
    const handlers: ComposedHandlerMap = new Map<string, ComposedHandler>([
      ['test-agent', mockHandler()],
    ]);
    const card = makeCard('test-agent');
    const cards = new Map<string, AgentCard>([['test-agent', card]]);

    harness = createHttpHarness(handlers, { port, cards });
    await harness.listen();

    // Act
    const res = await fetch(`http://localhost:${port}/test-agent/card`);

    // Assert
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(card);
  });

  it('returns 404 when no cards option provided', async () => {
    // Arrange
    const port = await getFreePort();
    const handlers: ComposedHandlerMap = new Map<string, ComposedHandler>([
      ['test-agent', mockHandler()],
    ]);

    harness = createHttpHarness(handlers, { port });
    await harness.listen();

    // Act
    const res = await fetch(`http://localhost:${port}/test-agent/card`);

    // Assert
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown agent name', async () => {
    // Arrange
    const port = await getFreePort();
    const handlers: ComposedHandlerMap = new Map<string, ComposedHandler>([
      ['test-agent', mockHandler()],
    ]);
    const cards = new Map<string, AgentCard>([
      ['test-agent', makeCard('test-agent')],
    ]);

    harness = createHttpHarness(handlers, { port, cards });
    await harness.listen();

    // Act
    const res = await fetch(`http://localhost:${port}/unknown-agent/card`);

    // Assert
    expect(res.status).toBe(404);
  });
});
