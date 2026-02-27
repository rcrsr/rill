import { describe, it, expect, afterEach, vi } from 'vitest';
import { createAhiExtension } from '../src/index.js';
import type {
  ExtensionResult,
  RillValue,
  HostFunctionDefinition,
} from '@rcrsr/rill';

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
    trigger: { type: string; agentName: string; sessionId: string };
    timeout: number;
  };
}

/**
 * Stub global fetch and capture all calls.
 * Returns the capture array; each entry is populated after the call resolves.
 */
function stubFetch(result: RillValue = 'ok'): Array<CapturedCall> {
  const calls: Array<CapturedCall> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string, init: FetchInit) => {
      const parsedBody = JSON.parse(
        init.body as string
      ) as CapturedCall['parsedBody'];
      calls.push({ url, init, parsedBody });
      return { ok: true, json: async () => ({ result }) };
    })
  );
  return calls;
}

/** Build a minimal call context */
function makeCtx(overrides?: Partial<Record<string, string>>): {
  metadata: Record<string, string>;
} {
  return {
    metadata: {
      correlationId: 'corr-test',
      sessionId: 'sess-test',
      agentName: 'test-agent',
      ...overrides,
    },
  };
}

/** Invoke a named ahi:: function from an ExtensionResult */
async function callAhi(
  ext: ExtensionResult,
  agentName: string,
  args: RillValue[],
  metadata?: Record<string, string>
): Promise<RillValue> {
  const fnDef = (ext as Record<string, HostFunctionDefinition>)[agentName];
  return fnDef.fn(args, { metadata: metadata ?? makeCtx().metadata });
}

// ============================================================
// AC-18: ahi::unknown is not registered when not in config
// ============================================================

describe('AHI static mode — boundary and registration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('AC-18: calling ahi::unknown when not in config', () => {
    it('ahi::unknown is not registered when config only declares parser', () => {
      const ext = createAhiExtension({
        agents: { parser: { url: 'http://parser:8080' } },
      });

      expect((ext as Record<string, unknown>)['unknown']).toBeUndefined();
    });

    it('formatter is not registered when config only declares parser', () => {
      const ext = createAhiExtension({
        agents: { parser: { url: 'http://parser:8080' } },
      });

      expect((ext as Record<string, unknown>)['formatter']).toBeUndefined();
    });

    it('only the declared agent names appear as function keys', () => {
      const ext = createAhiExtension({
        agents: {
          parser: { url: 'http://parser:8080' },
          writer: { url: 'http://writer:9090' },
        },
      });

      const fnKeys = Object.keys(ext).filter((k) => k !== 'dispose');

      expect(fnKeys.sort()).toEqual(['parser', 'writer']);
    });
  });

  // ============================================================
  // extractParams fallback: non-dict arg sends empty params
  // ============================================================

  describe('non-dict arg sends empty params (extractParams fallback)', () => {
    it('sends empty params when first arg is a string', async () => {
      const calls = stubFetch();
      const ext = createAhiExtension({
        agents: { parser: { url: 'http://parser:8080' } },
      });

      await callAhi(ext, 'parser', ['some-string-arg']);

      expect(calls[0]!.parsedBody.params).toEqual({});
    });

    it('sends empty params when first arg is a number', async () => {
      const calls = stubFetch();
      const ext = createAhiExtension({
        agents: { parser: { url: 'http://parser:8080' } },
      });

      await callAhi(ext, 'parser', [42]);

      expect(calls[0]!.parsedBody.params).toEqual({});
    });

    it('sends empty params when first arg is a boolean', async () => {
      const calls = stubFetch();
      const ext = createAhiExtension({
        agents: { parser: { url: 'http://parser:8080' } },
      });

      await callAhi(ext, 'parser', [true]);

      expect(calls[0]!.parsedBody.params).toEqual({});
    });
  });

  // ============================================================
  // Custom timeout: body.timeout reflects configured value
  // ============================================================

  describe('custom timeout is sent in request body', () => {
    it('sends configured timeout in body when no deadline metadata', async () => {
      const calls = stubFetch();
      const ext = createAhiExtension({
        agents: { parser: { url: 'http://parser:8080' } },
        timeout: 5000,
      });

      await callAhi(ext, 'parser', [], makeCtx().metadata);

      expect(calls[0]!.parsedBody.timeout).toBe(5000);
    });

    it('sends default timeout of 30000 when timeout is not specified', async () => {
      const calls = stubFetch();
      const ext = createAhiExtension({
        agents: { parser: { url: 'http://parser:8080' } },
      });

      await callAhi(ext, 'parser', [], makeCtx().metadata);

      expect(calls[0]!.parsedBody.timeout).toBe(30000);
    });
  });

  // ============================================================
  // Multiple agents: each is independently callable
  // ============================================================

  describe('multiple agents are independently callable', () => {
    it('routes each call to its respective URL', async () => {
      const calls = stubFetch();
      const ext = createAhiExtension({
        agents: {
          parser: { url: 'http://parser:8080' },
          formatter: { url: 'http://formatter:9090' },
        },
      });

      await callAhi(ext, 'parser', [], makeCtx().metadata);
      await callAhi(ext, 'formatter', [], makeCtx().metadata);

      expect(calls).toHaveLength(2);
      expect(calls[0]!.url).toBe('http://parser:8080/run');
      expect(calls[1]!.url).toBe('http://formatter:9090/run');
    });

    it('both agents return their own response values', async () => {
      let callCount = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (url: string) => {
          callCount++;
          const result = url.includes('parser')
            ? 'parser-result'
            : 'formatter-result';
          return { ok: true, json: async () => ({ result }) };
        })
      );

      const ext = createAhiExtension({
        agents: {
          parser: { url: 'http://parser:8080' },
          formatter: { url: 'http://formatter:9090' },
        },
      });

      const parserResult = await callAhi(ext, 'parser', [], makeCtx().metadata);
      const formatterResult = await callAhi(
        ext,
        'formatter',
        [],
        makeCtx().metadata
      );

      expect(parserResult).toBe('parser-result');
      expect(formatterResult).toBe('formatter-result');
      expect(callCount).toBe(2);
    });
  });
});
