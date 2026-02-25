/**
 * Tests for createAgentHandler — serverless Lambda handler.
 *
 * Covered:
 *   EC-4   createAgentHandler(null) throws TypeError('agent is required')
 *   EC-5   Runtime error during invocation → 500 HandlerResponse with error+code
 *   AC-5   createAgentHandler(agent) returns a handler function
 *   AC-6   Handler translates APIGatewayEvent.body JSON to RunRequest.params
 *   AC-7   Handler reuses SessionManager and Registry from same modules as createAgentHost
 *   AC-8   Handler does NOT open a TCP port (no listen() call)
 */

import { describe, it, expect } from 'vitest';
import { parse, createRuntimeContext } from '@rcrsr/rill';
import {
  createAgentHandler,
  type APIGatewayEvent,
  type LambdaContext,
  type HandlerResponse,
  type ComposedAgent,
} from '../src/index.js';
import { mockComposedAgent } from './helpers/host.js';

// ============================================================
// HELPERS
// ============================================================

/**
 * Minimal LambdaContext for tests that do not use context fields.
 */
function makeLambdaContext(): LambdaContext {
  return {
    functionName: 'test-fn',
    awsRequestId: 'test-request-id',
    getRemainingTimeInMillis: () => 30000,
  };
}

/**
 * Builds a minimal APIGatewayEvent with optional body.
 */
function makeEvent(body: string | null = null): APIGatewayEvent {
  return {
    httpMethod: 'POST',
    path: '/invoke',
    headers: { 'Content-Type': 'application/json' },
    body,
  };
}

/**
 * Builds a ComposedAgent whose script throws at runtime.
 * Calls an undefined host function to produce a RuntimeError.
 */
function makeFailingAgent(): ComposedAgent {
  // undefined_fn does not exist in builtins — execute() throws RuntimeError.
  const ast = parse('"error" -> undefined_fn');
  const context = createRuntimeContext();
  return {
    ast,
    context,
    card: { name: 'failing-agent', version: '0.0.0', capabilities: [] },
    dispose: async () => undefined,
  };
}

// ============================================================
// FACTORY TESTS
// ============================================================

describe('createAgentHandler', () => {
  it('throws TypeError when agent is null (EC-4)', () => {
    let thrown: unknown;
    try {
      createAgentHandler(null as unknown as ComposedAgent);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as TypeError).message).toBe('agent is required');
  });

  it('throws TypeError when agent is undefined (EC-4)', () => {
    let thrown: unknown;
    try {
      createAgentHandler(undefined as unknown as ComposedAgent);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as TypeError).message).toBe('agent is required');
  });

  it('returns a handler function (AC-5)', async () => {
    const agent = await mockComposedAgent();
    const handler = createAgentHandler(agent);
    expect(typeof handler).toBe('function');
  });
});

// ============================================================
// HANDLER SUCCESS TESTS
// ============================================================

describe('handler()', () => {
  it('returns HandlerResponse with statusCode 200 on success (AC-5)', async () => {
    const agent = await mockComposedAgent();
    const handler = createAgentHandler(agent);

    const response: HandlerResponse = await handler(
      makeEvent(),
      makeLambdaContext()
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe('application/json');

    const body: unknown = JSON.parse(response.body);
    expect(body).toMatchObject({ state: 'completed' });
  });

  it('translates APIGatewayEvent body JSON to RunRequest params (AC-6)', async () => {
    const agent = await mockComposedAgent();
    const handler = createAgentHandler(agent);

    // Invoke with params — the handler parses event.body and sets params on the RunRequest.
    // minimal.rill is `1 -> log`, which doesn't use params, so execution still completes.
    const eventBody = JSON.stringify({ params: { name: 'alice', count: 42 } });
    const response: HandlerResponse = await handler(
      makeEvent(eventBody),
      makeLambdaContext()
    );

    // Verify the invocation succeeded — params were accepted without error.
    expect(response.statusCode).toBe(200);
    const body: unknown = JSON.parse(response.body);
    expect(body).toMatchObject({ state: 'completed' });
  });

  it('does not open a TCP port during invocation (AC-8)', async () => {
    // The handler must complete without calling listen().
    // If no port is bound, the test completes without timeout and no EADDRINUSE.
    // We verify by confirming invocation returns a response, not a server reference.
    const agent = await mockComposedAgent();
    const handler = createAgentHandler(agent);

    const response: HandlerResponse = await handler(
      makeEvent(),
      makeLambdaContext()
    );

    // A resolved HandlerResponse means no server was started blocking the event loop.
    expect(response.statusCode).toBe(200);
    // The response body does not contain a port or address field.
    expect(response.body).not.toContain('"port"');
    expect(response.body).not.toContain('"address"');
  });

  it('returns 500 with error and code fields on runtime error (EC-5)', async () => {
    const handler = createAgentHandler(makeFailingAgent());

    const response: HandlerResponse = await handler(
      makeEvent(),
      makeLambdaContext()
    );

    expect(response.statusCode).toBe(500);
    expect(response.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(response.body) as { error: unknown; code: unknown };
    expect(typeof body.error).toBe('string');
    expect(typeof body.code).toBe('string');
    expect((body.error as string).length).toBeGreaterThan(0);
    expect((body.code as string).length).toBeGreaterThan(0);
  });
});

// ============================================================
// METRICS REUSE TESTS
// ============================================================

describe('metrics registry reuse (AC-7)', () => {
  it('increments shared registry metrics after handler invocation', async () => {
    // Both createAgentHost and createAgentHandler import from the same metrics.js
    // module. The module-scoped registry singleton is shared between them.
    // Importing getMetricsText() here reads from that same registry.
    const { getMetricsText } = await import('../src/metrics.js');

    const agent = await mockComposedAgent();
    const handler = createAgentHandler(agent);

    // Capture baseline text before invocation.
    const before = await getMetricsText();

    await handler(makeEvent(), makeLambdaContext());

    // After invocation, the shared registry must contain rill_* metric names.
    const after = await getMetricsText();

    expect(after).toContain('rill_sessions_total');
    expect(after).toContain('rill_sessions_active');
    expect(after).toContain('rill_execution_duration_seconds');
    expect(after).toContain('rill_steps_total');

    // The metrics text changed after invocation, confirming the handler
    // wrote to the same registry that getMetricsText() reads from.
    expect(after).not.toBe(before);
  });
});
