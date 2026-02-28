/**
 * POST /run param validation tests for rill-host.
 *
 * Tests the HTTP-layer behavior of input schema validation in registerRoutes().
 * Uses Hono app.request() to exercise the route without a real HTTP server.
 *
 * Covered:
 *   AC-4   Valid params returns 200
 *   AC-5   Extra undeclared params returns 200
 *   AC-6   Missing optional param with declared default → 200, default injected
 *   AC-12, EC-11  Missing required param → 400 with invalid params error
 *   AC-13, EC-12  Type-mismatched param → 400 with type mismatch message
 *   EC-13  Multiple failures → single 400 with all issues
 *   AC-15  No session created on 400
 *   AC-16  Empty input: {} manifest → no validation → 200
 *   AC-17  Manifest without input → no validation → 200
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { registerRoutes } from '../src/routes.js';
import type { RouteHost, SseStore } from '../src/routes.js';
import type { InputValidationErrorBody } from '../src/routes.js';
import type { AgentCard } from '../src/index.js';
import type {
  LifecyclePhase,
  HealthStatus,
  SessionRecord,
  RunRequest,
  RunResponse,
} from '../src/types.js';
import type { InputSchema } from '@rcrsr/rill-agent-shared';

// ============================================================
// TEST FIXTURES
// ============================================================

const CARD: AgentCard = {
  name: 'test-agent',
  version: '1.0.0',
  capabilities: [],
};

const HEALTH: HealthStatus = {
  phase: 'ready',
  uptimeSeconds: 1,
  activeSessions: 0,
  extensions: {},
};

const RUN_RESPONSE: RunResponse = {
  sessionId: 'sess-ok',
  correlationId: 'corr-ok',
  state: 'completed',
  result: 'done',
  durationMs: 10,
};

// ============================================================
// MOCK HOST FACTORY
// ============================================================

function makeHost(overrides: Partial<RouteHost> = {}): RouteHost {
  return {
    phase: 'ready' as LifecyclePhase,
    run: async (_input: RunRequest): Promise<RunResponse> => RUN_RESPONSE,
    stop: async (): Promise<void> => undefined,
    health: (): HealthStatus => HEALTH,
    metrics: async (): Promise<string> => '# metrics\n',
    sessions: (): SessionRecord[] => [],
    abortSession: (_id: string): boolean => true,
    getSession: (_id: string): SessionRecord | undefined => undefined,
    ...overrides,
  };
}

// ============================================================
// HELPERS
// ============================================================

async function jsonBody(res: Response): Promise<unknown> {
  return res.json();
}

function postRun(app: Hono, body: Record<string, unknown>): Promise<Response> {
  return app.request('/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ============================================================
// TESTS
// ============================================================

describe('POST /run param validation', () => {
  let sseStore: SseStore;

  beforeEach(() => {
    sseStore = {
      eventBuffers: new Map(),
      subscribers: new Map(),
    };
  });

  function makeApp(
    host: RouteHost,
    inputSchema?: InputSchema | undefined
  ): Hono {
    const app = new Hono();
    registerRoutes(app, host, CARD, sseStore, inputSchema);
    return app;
  }

  // --------------------------------------------------------
  // AC-17: Manifest without input → no validation → 200
  // --------------------------------------------------------
  describe('AC-17: no input schema — no validation', () => {
    it('returns 200 when no inputSchema is provided [AC-17]', async () => {
      const app = makeApp(makeHost());
      const res = await postRun(app, { params: { anything: 'value' } });
      expect(res.status).toBe(200);
    });

    it('returns 200 with missing params when no inputSchema is provided [AC-17]', async () => {
      const app = makeApp(makeHost());
      const res = await postRun(app, {});
      expect(res.status).toBe(200);
    });
  });

  // --------------------------------------------------------
  // AC-16: Empty input: {} manifest → no validation → 200
  // --------------------------------------------------------
  describe('AC-16: empty input schema — no validation', () => {
    it('returns 200 when inputSchema is empty object [AC-16]', async () => {
      const app = makeApp(makeHost(), {});
      const res = await postRun(app, { params: { anything: 'value' } });
      expect(res.status).toBe(200);
    });

    it('returns 200 with no params when inputSchema is empty [AC-16]', async () => {
      const app = makeApp(makeHost(), {});
      const res = await postRun(app, {});
      expect(res.status).toBe(200);
    });
  });

  // --------------------------------------------------------
  // AC-4: Valid params returns 200
  // --------------------------------------------------------
  describe('AC-4: valid params', () => {
    it('returns 200 when all required params are provided with correct types [AC-4]', async () => {
      const schema: InputSchema = {
        query: { type: 'string', required: true },
        limit: { type: 'number', required: true },
      };
      const app = makeApp(makeHost(), schema);
      const res = await postRun(app, {
        params: { query: 'hello', limit: 10 },
      });
      expect(res.status).toBe(200);
    });

    it('returns 200 for valid bool param [AC-4]', async () => {
      const schema: InputSchema = {
        active: { type: 'bool', required: true },
      };
      const app = makeApp(makeHost(), schema);
      const res = await postRun(app, { params: { active: true } });
      expect(res.status).toBe(200);
    });

    it('returns 200 for valid list param [AC-4]', async () => {
      const schema: InputSchema = {
        tags: { type: 'list', required: true },
      };
      const app = makeApp(makeHost(), schema);
      const res = await postRun(app, { params: { tags: ['a', 'b'] } });
      expect(res.status).toBe(200);
    });
  });

  // --------------------------------------------------------
  // AC-5: Extra undeclared params returns 200
  // --------------------------------------------------------
  describe('AC-5: extra undeclared params', () => {
    it('returns 200 when extra params are provided alongside valid required params [AC-5]', async () => {
      const schema: InputSchema = {
        query: { type: 'string', required: true },
      };
      const app = makeApp(makeHost(), schema);
      const res = await postRun(app, {
        params: { query: 'hello', undeclared: 'ignored', extra: 99 },
      });
      expect(res.status).toBe(200);
    });

    it('returns 200 when all params are extra (schema has none required) [AC-5]', async () => {
      const schema: InputSchema = {
        limit: { type: 'number' },
      };
      const app = makeApp(makeHost(), schema);
      const res = await postRun(app, {
        params: { extra: 'value', another: true },
      });
      expect(res.status).toBe(200);
    });
  });

  // --------------------------------------------------------
  // AC-6: Missing optional param with default → 200, default injected
  // --------------------------------------------------------
  describe('AC-6: default injection for optional params', () => {
    it('returns 200 when optional param with default is absent [AC-6]', async () => {
      const schema: InputSchema = {
        limit: { type: 'number', default: 20 },
      };
      const app = makeApp(makeHost(), schema);
      const res = await postRun(app, { params: {} });
      expect(res.status).toBe(200);
    });

    it('injects default before calling host.run [AC-6]', async () => {
      const schema: InputSchema = {
        limit: { type: 'number', default: 20 },
      };
      let capturedParams: Record<string, unknown> | undefined;
      const host = makeHost({
        run: async (input: RunRequest): Promise<RunResponse> => {
          capturedParams = input.params as Record<string, unknown> | undefined;
          return RUN_RESPONSE;
        },
      });
      const app = makeApp(host, schema);
      await postRun(app, { params: {} });
      expect(capturedParams?.['limit']).toBe(20);
    });

    it('does not overwrite provided value with default [AC-6]', async () => {
      const schema: InputSchema = {
        limit: { type: 'number', default: 20 },
      };
      let capturedParams: Record<string, unknown> | undefined;
      const host = makeHost({
        run: async (input: RunRequest): Promise<RunResponse> => {
          capturedParams = input.params as Record<string, unknown> | undefined;
          return RUN_RESPONSE;
        },
      });
      const app = makeApp(host, schema);
      await postRun(app, { params: { limit: 99 } });
      expect(capturedParams?.['limit']).toBe(99);
    });

    it('injects null default when param is absent [AC-6, AC-19]', async () => {
      const schema: InputSchema = {
        token: { type: 'string', default: null },
      };
      let capturedParams: Record<string, unknown> | undefined;
      const host = makeHost({
        run: async (input: RunRequest): Promise<RunResponse> => {
          capturedParams = input.params as Record<string, unknown> | undefined;
          return RUN_RESPONSE;
        },
      });
      const app = makeApp(host, schema);
      await postRun(app, { params: {} });
      expect(
        Object.prototype.hasOwnProperty.call(capturedParams, 'token')
      ).toBe(true);
      expect(capturedParams?.['token']).toBeNull();
    });
  });

  // --------------------------------------------------------
  // AC-12, EC-11: Missing required param → 400
  // --------------------------------------------------------
  describe('AC-12, EC-11: missing required param → 400', () => {
    it('returns 400 when required param is absent [AC-12, EC-11]', async () => {
      const schema: InputSchema = {
        feedback: { type: 'string', required: true },
      };
      const app = makeApp(makeHost(), schema);
      const res = await postRun(app, { params: {} });
      expect(res.status).toBe(400);
    });

    it('returns error body with "invalid params" and fields array [AC-12, EC-11]', async () => {
      const schema: InputSchema = {
        feedback: { type: 'string', required: true },
      };
      const app = makeApp(makeHost(), schema);
      const res = await postRun(app, { params: {} });
      const body = (await jsonBody(res)) as InputValidationErrorBody;
      expect(body.error).toBe('invalid params');
      expect(Array.isArray(body.fields)).toBe(true);
      expect(body.fields).toHaveLength(1);
      expect(body.fields[0]).toEqual({
        param: 'feedback',
        message: 'required',
      });
    });

    it('returns 400 when params key is absent entirely [AC-12, EC-11]', async () => {
      const schema: InputSchema = {
        query: { type: 'string', required: true },
      };
      const app = makeApp(makeHost(), schema);
      const res = await postRun(app, {});
      expect(res.status).toBe(400);
    });

    it('returns 400 when null is provided for required param [AC-12, AC-18]', async () => {
      const schema: InputSchema = {
        feedback: { type: 'string', required: true },
      };
      const app = makeApp(makeHost(), schema);
      const res = await postRun(app, { params: { feedback: null } });
      expect(res.status).toBe(400);
      const body = (await jsonBody(res)) as InputValidationErrorBody;
      expect(body.fields[0]).toEqual({
        param: 'feedback',
        message: 'required',
      });
    });
  });

  // --------------------------------------------------------
  // AC-13, EC-12: Type-mismatched param → 400
  // --------------------------------------------------------
  describe('AC-13, EC-12: type-mismatched param → 400', () => {
    it('returns 400 when number param receives a string [AC-13, EC-12]', async () => {
      const schema: InputSchema = {
        score: { type: 'number', required: true },
      };
      const app = makeApp(makeHost(), schema);
      const res = await postRun(app, { params: { score: 'bad' } });
      expect(res.status).toBe(400);
    });

    it('returns type mismatch message in fields [AC-13, EC-12]', async () => {
      const schema: InputSchema = {
        score: { type: 'number', required: true },
      };
      const app = makeApp(makeHost(), schema);
      const res = await postRun(app, { params: { score: 'bad' } });
      const body = (await jsonBody(res)) as InputValidationErrorBody;
      expect(body.error).toBe('invalid params');
      expect(body.fields[0]).toEqual({
        param: 'score',
        message: 'expected number, got string',
      });
    });

    it('returns "expected boolean" for bool type mismatch [AC-13, EC-12]', async () => {
      const schema: InputSchema = {
        active: { type: 'bool', required: true },
      };
      const app = makeApp(makeHost(), schema);
      const res = await postRun(app, { params: { active: 'yes' } });
      const body = (await jsonBody(res)) as InputValidationErrorBody;
      expect(body.fields[0]?.message).toBe('expected boolean, got string');
    });
  });

  // --------------------------------------------------------
  // EC-13: Multiple failures → single 400 with all issues
  // --------------------------------------------------------
  describe('EC-13: multiple failures in single 400 response', () => {
    it('returns single 400 containing all field issues [EC-13]', async () => {
      const schema: InputSchema = {
        query: { type: 'string', required: true },
        limit: { type: 'number', required: true },
        active: { type: 'bool', required: true },
      };
      const app = makeApp(makeHost(), schema);
      const res = await postRun(app, { params: {} });
      expect(res.status).toBe(400);
      const body = (await jsonBody(res)) as InputValidationErrorBody;
      expect(body.error).toBe('invalid params');
      expect(body.fields).toHaveLength(3);
    });

    it('includes all param names in fields for multiple failures [EC-13]', async () => {
      const schema: InputSchema = {
        query: { type: 'string', required: true },
        limit: { type: 'number', required: true },
      };
      const app = makeApp(makeHost(), schema);
      const res = await postRun(app, { params: {} });
      const body = (await jsonBody(res)) as InputValidationErrorBody;
      const params = body.fields.map((f) => f.param);
      expect(params).toContain('query');
      expect(params).toContain('limit');
    });
  });

  // --------------------------------------------------------
  // AC-15: No session created on 400
  // --------------------------------------------------------
  describe('AC-15: no session created on 400', () => {
    it('does not call host.run when params validation fails [AC-15]', async () => {
      const schema: InputSchema = {
        query: { type: 'string', required: true },
      };
      let runCalled = false;
      const host = makeHost({
        run: async (_input: RunRequest): Promise<RunResponse> => {
          runCalled = true;
          return RUN_RESPONSE;
        },
        sessions: (): SessionRecord[] => [],
      });
      const app = makeApp(host, schema);
      const res = await postRun(app, { params: {} });
      expect(res.status).toBe(400);
      expect(runCalled).toBe(false);
    });

    it('GET /sessions returns empty array after failed POST /run [AC-15]', async () => {
      const schema: InputSchema = {
        query: { type: 'string', required: true },
      };
      const sessionList: SessionRecord[] = [];
      const host = makeHost({
        sessions: (): SessionRecord[] => sessionList,
      });
      const app = makeApp(host, schema);

      await postRun(app, { params: {} });

      const sessRes = await app.request('/sessions');
      expect(sessRes.status).toBe(200);
      const sessions = (await sessRes.json()) as SessionRecord[];
      expect(sessions).toHaveLength(0);
    });
  });
});
