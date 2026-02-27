/**
 * Tests for metadata population on session context.
 *
 * Covered:
 *   IC-12  handler.ts populates correlationId, sessionId, agentName on sessionContext.metadata
 *   IC-13  host.ts run() populates correlationId, sessionId, agentName on sessionContext.metadata
 *   AC-3   metadata.correlationId is a valid UUID v4 string
 */

import { describe, it, expect, afterEach } from 'vitest';
import { parse, createRuntimeContext } from '@rcrsr/rill';
import type { RuntimeContextLike } from '@rcrsr/rill';
import type { ComposedAgent, AgentHost } from '../src/index.js';
import {
  createAgentHost,
  createAgentHandler,
  type APIGatewayEvent,
  type LambdaContext,
} from '../src/index.js';

// ============================================================
// UUID v4 pattern
// ============================================================

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// ============================================================
// HELPERS
// ============================================================

/**
 * Builds a ComposedAgent whose script calls `capture_meta`.
 * `capture_meta` reads ctx.metadata and stores it in capturedMetadata.
 * This lets tests assert on the metadata the runtime context received.
 */
function makeMetaCapturingAgent(capturedMetadata: {
  value: Record<string, string> | undefined;
}): ComposedAgent {
  // Script calls capture_meta with a dummy value.
  // The host function ignores args and reads ctx.metadata.
  const ast = parse('1 -> capture_meta');
  const context = createRuntimeContext();

  context.functions.set(
    'capture_meta',
    (_args: unknown[], ctx: RuntimeContextLike) => {
      capturedMetadata.value = ctx.metadata;
      return 1;
    }
  );

  return {
    ast,
    context,
    card: { name: 'meta-agent', version: '0.0.1', capabilities: [] },
    extensions: {},
    dispose: async () => undefined,
  };
}

function makeLambdaContext(): LambdaContext {
  return {
    functionName: 'test-fn',
    awsRequestId: 'test-request-id',
    getRemainingTimeInMillis: () => 30000,
  };
}

function makeEvent(): APIGatewayEvent {
  return {
    httpMethod: 'POST',
    path: '/invoke',
    headers: { 'Content-Type': 'application/json' },
    body: null,
  };
}

// ============================================================
// IC-13: host.ts run() metadata population
// ============================================================

describe('AgentHost run() metadata (IC-13)', () => {
  let host: AgentHost | undefined;

  afterEach(async () => {
    if (host !== undefined) {
      await host.stop();
      host = undefined;
    }
  });

  it('populates metadata.correlationId as a UUID v4 on sessionContext (IC-13, AC-3)', async () => {
    const captured: { value: Record<string, string> | undefined } = {
      value: undefined,
    };
    const agent = makeMetaCapturingAgent(captured);
    host = createAgentHost(agent);

    await host.run({});

    expect(captured.value).toBeDefined();
    expect(typeof captured.value!['correlationId']).toBe('string');
    expect(captured.value!['correlationId']).toMatch(UUID_PATTERN);
  });

  it('populates metadata.sessionId matching the session record ID (IC-13)', async () => {
    const captured: { value: Record<string, string> | undefined } = {
      value: undefined,
    };
    const agent = makeMetaCapturingAgent(captured);
    host = createAgentHost(agent);

    const response = await host.run({});

    expect(captured.value).toBeDefined();
    expect(captured.value!['sessionId']).toBe(response.sessionId);
  });

  it('populates metadata.agentName matching composedAgent.card.name (IC-13)', async () => {
    const captured: { value: Record<string, string> | undefined } = {
      value: undefined,
    };
    const agent = makeMetaCapturingAgent(captured);
    host = createAgentHost(agent);

    await host.run({});

    expect(captured.value).toBeDefined();
    expect(captured.value!['agentName']).toBe('meta-agent');
  });

  it('correlationId in metadata matches correlationId in RunResponse (IC-13)', async () => {
    const captured: { value: Record<string, string> | undefined } = {
      value: undefined,
    };
    const agent = makeMetaCapturingAgent(captured);
    host = createAgentHost(agent);

    const response = await host.run({});

    expect(captured.value).toBeDefined();
    expect(captured.value!['correlationId']).toBe(response.correlationId);
  });

  it('all three metadata keys are present on sessionContext (IC-13)', async () => {
    const captured: { value: Record<string, string> | undefined } = {
      value: undefined,
    };
    const agent = makeMetaCapturingAgent(captured);
    host = createAgentHost(agent);

    await host.run({});

    expect(captured.value).toBeDefined();
    expect(Object.keys(captured.value!)).toContain('correlationId');
    expect(Object.keys(captured.value!)).toContain('sessionId');
    expect(Object.keys(captured.value!)).toContain('agentName');
  });
});

// ============================================================
// IC-12: handler.ts metadata population
// ============================================================

describe('createAgentHandler metadata (IC-12)', () => {
  it('populates metadata.correlationId as a UUID v4 on sessionContext (IC-12, AC-3)', async () => {
    const captured: { value: Record<string, string> | undefined } = {
      value: undefined,
    };
    const agent = makeMetaCapturingAgent(captured);
    const handler = createAgentHandler(agent);

    await handler(makeEvent(), makeLambdaContext());

    expect(captured.value).toBeDefined();
    expect(typeof captured.value!['correlationId']).toBe('string');
    expect(captured.value!['correlationId']).toMatch(UUID_PATTERN);
  });

  it('populates metadata.sessionId as a non-empty string (IC-12)', async () => {
    const captured: { value: Record<string, string> | undefined } = {
      value: undefined,
    };
    const agent = makeMetaCapturingAgent(captured);
    const handler = createAgentHandler(agent);

    await handler(makeEvent(), makeLambdaContext());

    expect(captured.value).toBeDefined();
    expect(typeof captured.value!['sessionId']).toBe('string');
    expect(captured.value!['sessionId'].length).toBeGreaterThan(0);
  });

  it('populates metadata.agentName matching composedAgent.card.name (IC-12)', async () => {
    const captured: { value: Record<string, string> | undefined } = {
      value: undefined,
    };
    const agent = makeMetaCapturingAgent(captured);
    const handler = createAgentHandler(agent);

    await handler(makeEvent(), makeLambdaContext());

    expect(captured.value).toBeDefined();
    expect(captured.value!['agentName']).toBe('meta-agent');
  });

  it('all three metadata keys are present on sessionContext (IC-12)', async () => {
    const captured: { value: Record<string, string> | undefined } = {
      value: undefined,
    };
    const agent = makeMetaCapturingAgent(captured);
    const handler = createAgentHandler(agent);

    await handler(makeEvent(), makeLambdaContext());

    expect(captured.value).toBeDefined();
    expect(Object.keys(captured.value!)).toContain('correlationId');
    expect(Object.keys(captured.value!)).toContain('sessionId');
    expect(Object.keys(captured.value!)).toContain('agentName');
  });
});
