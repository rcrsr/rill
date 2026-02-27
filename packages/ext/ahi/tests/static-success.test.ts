import { describe, it, expect, afterEach, vi } from 'vitest';
import { createAhiExtension } from '../src/index.js';
import type { ExtensionResult } from '@rcrsr/rill';
import type { RillValue } from '@rcrsr/rill';
import type { HostFunctionDefinition } from '@rcrsr/rill';

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

/** Parsed body captured from a mocked fetch call */
interface CapturedCall {
  url: string;
  init: FetchInit;
  parsedBody: {
    params: Record<string, RillValue>;
    trigger: {
      type: string;
      agentName: string;
      sessionId: string;
    };
    timeout: number;
  };
}

/**
 * Stub global fetch and capture all calls.
 * Returns the capture array; each entry is populated after the call resolves.
 */
function stubFetch(result: RillValue = 'mocked-result'): Array<CapturedCall> {
  const calls: Array<CapturedCall> = [];

  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string, init: FetchInit) => {
      const parsedBody = JSON.parse(
        init.body as string
      ) as CapturedCall['parsedBody'];
      calls.push({ url, init, parsedBody });
      return {
        ok: true,
        json: async () => ({ result }),
      };
    })
  );

  return calls;
}

/** Build a context object with full metadata */
function makeCtx(overrides?: Partial<Record<string, string>>): {
  metadata: Record<string, string>;
} {
  return {
    metadata: {
      correlationId: 'corr-123',
      sessionId: 'sess-456',
      agentName: 'caller-agent',
      ...overrides,
    },
  };
}

/** Invoke a named ahi:: function from an ExtensionResult */
async function callAhi(
  ext: ExtensionResult,
  agentName: string,
  args: RillValue[],
  metadata: Record<string, string>
): Promise<RillValue> {
  const fnDef = (ext as Record<string, HostFunctionDefinition>)[
    `ahi::${agentName}`
  ];
  return fnDef.fn(args, { metadata });
}

// ============================================================
// AC-2: POST URL and body shape
// ============================================================

describe('AHI static success path', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('AC-2: request URL and method', () => {
    it('sends a POST request to <url>/run', async () => {
      const calls = stubFetch();
      const ext = createAhiExtension({
        agents: { parser: { url: 'http://parser:8080' } },
      });

      await callAhi(ext, 'parser', [], makeCtx().metadata);

      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toBe('http://parser:8080/run');
      expect(calls[0]!.init.method).toBe('POST');
    });

    it('appends /run to the configured URL regardless of path', async () => {
      const calls = stubFetch();
      const ext = createAhiExtension({
        agents: { writer: { url: 'http://writer:9090' } },
      });

      await callAhi(ext, 'writer', [], makeCtx().metadata);

      expect(calls[0]!.url).toBe('http://writer:9090/run');
    });
  });

  // ============================================================
  // AC-2: body params field
  // ============================================================

  describe('AC-2: request body params field', () => {
    it('sends params as an empty object when no args supplied', async () => {
      const calls = stubFetch();
      const ext = createAhiExtension({
        agents: { parser: { url: 'http://parser:8080' } },
      });

      await callAhi(ext, 'parser', [], makeCtx().metadata);

      expect(calls[0]!.parsedBody.params).toEqual({});
    });

    it('spreads a dict arg into the params field', async () => {
      const calls = stubFetch();
      const ext = createAhiExtension({
        agents: { parser: { url: 'http://parser:8080' } },
      });

      await callAhi(
        ext,
        'parser',
        [{ text: 'hello', count: 3 }],
        makeCtx().metadata
      );

      expect(calls[0]!.parsedBody.params).toEqual({ text: 'hello', count: 3 });
    });
  });

  // ============================================================
  // AC-3: X-Correlation-ID header
  // ============================================================

  describe('AC-3: X-Correlation-ID header forwarded from ctx.metadata', () => {
    it('sets X-Correlation-ID header to ctx.metadata.correlationId', async () => {
      const calls = stubFetch();
      const ext = createAhiExtension({
        agents: { parser: { url: 'http://parser:8080' } },
      });

      await callAhi(
        ext,
        'parser',
        [],
        makeCtx({ correlationId: 'corr-xyz' }).metadata
      );

      const headers = calls[0]!.init.headers as Record<string, string>;
      expect(headers['X-Correlation-ID']).toBe('corr-xyz');
    });
  });

  // ============================================================
  // AC-4: trigger fields in request body
  // ============================================================

  describe('AC-4: trigger fields in request body', () => {
    it('sets trigger.type to "agent"', async () => {
      const calls = stubFetch();
      const ext = createAhiExtension({
        agents: { parser: { url: 'http://parser:8080' } },
      });

      await callAhi(ext, 'parser', [], makeCtx().metadata);

      expect(calls[0]!.parsedBody.trigger.type).toBe('agent');
    });

    it('sets trigger.agentName to ctx.metadata.agentName', async () => {
      const calls = stubFetch();
      const ext = createAhiExtension({
        agents: { parser: { url: 'http://parser:8080' } },
      });

      await callAhi(
        ext,
        'parser',
        [],
        makeCtx({ agentName: 'my-agent' }).metadata
      );

      expect(calls[0]!.parsedBody.trigger.agentName).toBe('my-agent');
    });

    it('sets trigger.sessionId to ctx.metadata.sessionId', async () => {
      const calls = stubFetch();
      const ext = createAhiExtension({
        agents: { parser: { url: 'http://parser:8080' } },
      });

      await callAhi(
        ext,
        'parser',
        [],
        makeCtx({ sessionId: 'sess-789' }).metadata
      );

      expect(calls[0]!.parsedBody.trigger.sessionId).toBe('sess-789');
    });
  });

  // ============================================================
  // AC-5: remaining timeout budget forwarded
  // ============================================================

  describe('AC-5: timeout budget forwarded when less than default', () => {
    it('sends approximately 5000 ms timeout when deadline is 5 s away', async () => {
      const calls = stubFetch();
      const ext = createAhiExtension({
        agents: { parser: { url: 'http://parser:8080' } },
        timeout: 30000,
      });

      const deadline = Date.now() + 5000;
      await callAhi(
        ext,
        'parser',
        [],
        makeCtx({ timeoutDeadline: String(deadline) }).metadata
      );

      const sentTimeout = calls[0]!.parsedBody.timeout;
      // Remaining must be <= 5000 and > 4500 (allowing test run time)
      expect(sentTimeout).toBeLessThanOrEqual(5000);
      expect(sentTimeout).toBeGreaterThan(4500);
    });
  });

  // ============================================================
  // AC-22: 1 ms remaining in deadline
  // ============================================================

  describe('AC-22: 1 ms remaining sends timeout: 1', () => {
    it('sends timeout: 1 when caller has 1 ms remaining', async () => {
      const calls = stubFetch();
      const ext = createAhiExtension({
        agents: { parser: { url: 'http://parser:8080' } },
        timeout: 30000,
      });

      // Deadline already in the past by the time the body is built;
      // implementation clamps to minimum of 1 ms.
      const deadline = Date.now() + 1;
      await callAhi(
        ext,
        'parser',
        [],
        makeCtx({ timeoutDeadline: String(deadline) }).metadata
      );

      expect(calls[0]!.parsedBody.timeout).toBe(1);
    });
  });

  // ============================================================
  // AC-21: timeout: 0 — no AbortController, call completes
  // ============================================================

  describe('AC-21: timeout 0 means no deadline', () => {
    it('completes the request when extension timeout is 0', async () => {
      stubFetch('no-deadline-result');
      const ext = createAhiExtension({
        agents: { parser: { url: 'http://parser:8080' } },
        timeout: 0,
      });

      const result = await callAhi(ext, 'parser', [], makeCtx().metadata);

      expect(result).toBe('no-deadline-result');
    });

    it('does not attach an AbortSignal when timeout is 0', async () => {
      const calls = stubFetch();
      const ext = createAhiExtension({
        agents: { parser: { url: 'http://parser:8080' } },
        timeout: 0,
      });

      await callAhi(ext, 'parser', [], makeCtx().metadata);

      // signal is null when no AbortController is created (AC-21)
      expect(calls[0]!.init.signal).toBeNull();
    });
  });

  // ============================================================
  // Return value: json.result from response body
  // ============================================================

  describe('return value', () => {
    it('returns json.result from the response body', async () => {
      stubFetch('expected-output');
      const ext = createAhiExtension({
        agents: { parser: { url: 'http://parser:8080' } },
      });

      const result = await callAhi(ext, 'parser', [], makeCtx().metadata);

      expect(result).toBe('expected-output');
    });

    it('returns a dict value from json.result', async () => {
      const returnedDict = { score: 42, label: 'positive' };
      stubFetch(returnedDict as unknown as RillValue);
      const ext = createAhiExtension({
        agents: { parser: { url: 'http://parser:8080' } },
      });

      const result = await callAhi(ext, 'parser', [], makeCtx().metadata);

      expect(result).toEqual(returnedDict);
    });
  });
});
