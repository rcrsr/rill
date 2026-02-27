/**
 * Registry mode tests for createAhiExtension.
 *
 * Tests AC-12 through AC-16 and EC-3 for the registry-mode pathway.
 * Uses a mocked RegistryClient to avoid spinning up a real HTTP server.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { RillValue, HostFunctionDefinition } from '@rcrsr/rill';
import type { ResolvedAgent } from '@rcrsr/rill-registry-client';

// ============================================================
// MODULE MOCK
// ============================================================

// Mock @rcrsr/rill-registry-client BEFORE importing the module under test.
// The mock replaces createRegistryClient with a factory that returns a
// mocked RegistryClient. Tests update mockResolve to control behavior.
const mockResolve = vi.fn<(name: string) => Promise<ResolvedAgent>>();
const mockRegister = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockDeregister = vi
  .fn<() => Promise<void>>()
  .mockResolvedValue(undefined);
const mockHeartbeat = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockList = vi.fn<() => Promise<ResolvedAgent[]>>().mockResolvedValue([]);
const mockDispose = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

vi.mock('@rcrsr/rill-registry-client', () => ({
  createRegistryClient: vi.fn(() => ({
    resolve: mockResolve,
    register: mockRegister,
    deregister: mockDeregister,
    heartbeat: mockHeartbeat,
    list: mockList,
    dispose: mockDispose,
  })),
}));

// Import AFTER vi.mock so the hoisted mock is in place.
import { createAhiExtension } from '../src/index.js';
import { createRegistryClient } from '@rcrsr/rill-registry-client';

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
 * Stub global fetch to capture calls and return a successful result.
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

/**
 * Build a resolved agent record with required fields.
 * input is optional — omit it to simulate no contract (AC-16 skip).
 */
function makeResolvedAgent(
  name: string,
  endpoint: string,
  input?: ResolvedAgent['input']
): ResolvedAgent {
  return {
    name,
    version: '1.0.0',
    endpoint,
    input,
    status: 'active',
    lastHeartbeat: new Date().toISOString(),
  };
}

/** Build a minimal call context with required metadata fields */
function makeCtx(overrides?: Partial<Record<string, string>>): {
  metadata: Record<string, string>;
} {
  return {
    metadata: {
      correlationId: 'corr-test',
      sessionId: 'sess-test',
      agentName: 'caller',
      ...overrides,
    },
  };
}

/**
 * Extract a named ahi:: host function from an extension result and call it.
 * Mirrors the pattern used in static-success.test.ts.
 */
async function callAhi(
  ext: ReturnType<typeof createAhiExtension>,
  agentName: string,
  args: RillValue[] = [],
  metadata?: Record<string, string>
): Promise<RillValue> {
  const fnDef = (ext as Record<string, HostFunctionDefinition>)[agentName];
  return fnDef.fn(args, { metadata: metadata ?? makeCtx().metadata });
}

// ============================================================
// TEST SUITE
// ============================================================

describe('AHI registry mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: mockResolve throws (not-found) unless overridden per test
    mockResolve.mockRejectedValue(new Error('agent not found'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ============================================================
  // AC-12: resolve() called for each name at boot
  // ============================================================

  describe('AC-12: resolve() called for each symbolic name at boot', () => {
    it('calls resolve() once per name in a two-name config', async () => {
      // Arrange: resolve succeeds immediately for both agents
      mockResolve.mockImplementation((name) =>
        Promise.resolve(makeResolvedAgent(name, `http://${name}:8080`))
      );

      // Act: factory creation triggers boot resolution
      createAhiExtension({
        agents: ['parser', 'formatter'],
        registry: 'http://registry:8080',
      });

      // Yield to the microtask queue so the async boot promises can run
      await Promise.resolve();

      // Assert: resolve was called for each agent name
      expect(mockResolve).toHaveBeenCalledTimes(2);
      expect(mockResolve).toHaveBeenCalledWith('parser');
      expect(mockResolve).toHaveBeenCalledWith('formatter');
    });

    it('registers createRegistryClient with the configured registry URL', () => {
      mockResolve.mockResolvedValue(
        makeResolvedAgent('parser', 'http://parser:8080')
      );

      createAhiExtension({
        agents: ['parser'],
        registry: 'http://registry:8080',
      });

      expect(createRegistryClient).toHaveBeenCalledWith({
        url: 'http://registry:8080',
      });
    });

    it('registers ahi::<name> for each symbolic agent name', () => {
      mockResolve.mockResolvedValue(
        makeResolvedAgent('parser', 'http://parser:8080')
      );

      const ext = createAhiExtension({
        agents: ['parser', 'formatter'],
        registry: 'http://registry:8080',
      });

      expect('parser' in ext).toBe(true);
      expect('formatter' in ext).toBe(true);
    });
  });

  // ============================================================
  // AC-13: Successful resolve — uses resolved endpoint for HTTP POST
  // ============================================================

  describe('AC-13: successful boot resolve uses resolved endpoint for HTTP POST', () => {
    it('sends POST to the resolved endpoint /run path', async () => {
      mockResolve.mockResolvedValue(
        makeResolvedAgent('parser', 'http://parser-resolved:9001')
      );
      const calls = stubFetch('ok');

      const ext = createAhiExtension({
        agents: ['parser'],
        registry: 'http://registry:8080',
      });

      await callAhi(ext, 'parser');

      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toBe('http://parser-resolved:9001/run');
    });

    it('sends POST with method POST', async () => {
      mockResolve.mockResolvedValue(
        makeResolvedAgent('parser', 'http://parser-resolved:9001')
      );
      const calls = stubFetch();

      const ext = createAhiExtension({
        agents: ['parser'],
        registry: 'http://registry:8080',
      });

      await callAhi(ext, 'parser');

      expect(calls[0]!.init.method).toBe('POST');
    });

    it('returns the json.result value from the response', async () => {
      mockResolve.mockResolvedValue(
        makeResolvedAgent('parser', 'http://parser-resolved:9001')
      );
      stubFetch('parsed-output');

      const ext = createAhiExtension({
        agents: ['parser'],
        registry: 'http://registry:8080',
      });

      const result = await callAhi(ext, 'parser');

      expect(result).toBe('parsed-output');
    });
  });

  // ============================================================
  // AC-14: Failed boot resolve — console.warn + lazy flag
  // ============================================================

  describe('AC-14: failed boot resolve logs warning and registers lazy agent', () => {
    it('calls console.warn when resolve() fails at boot', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockResolve.mockRejectedValue(new Error('registry unavailable'));

      createAhiExtension({
        agents: ['parser'],
        registry: 'http://registry:8080',
      });

      // Yield to flush the boot promise rejection handler
      await Promise.resolve();
      await Promise.resolve();

      expect(warnSpy).toHaveBeenCalledOnce();
      warnSpy.mockRestore();
    });

    it('warning message includes the agent name', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockResolve.mockRejectedValue(new Error('registry unavailable'));

      createAhiExtension({
        agents: ['parser'],
        registry: 'http://registry:8080',
      });

      await Promise.resolve();
      await Promise.resolve();

      const warnArgs = warnSpy.mock.calls[0] as unknown[];
      const firstArg = String(warnArgs[0]);
      expect(firstArg).toContain('parser');
      warnSpy.mockRestore();
    });

    it('still registers ahi::<name> even when boot resolve fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockResolve.mockRejectedValue(new Error('registry unavailable'));

      const ext = createAhiExtension({
        agents: ['parser'],
        registry: 'http://registry:8080',
      });

      await Promise.resolve();
      await Promise.resolve();
      warnSpy.mockRestore();

      expect('parser' in ext).toBe(true);
      expect(
        typeof (ext as Record<string, HostFunctionDefinition>)['parser']!.fn
      ).toBe('function');
    });
  });

  // ============================================================
  // AC-15 (success): Lazy retry succeeds; result cached for next call
  // ============================================================

  describe('AC-15 (success): lazy retry resolves on first call; cached for subsequent calls', () => {
    it('calls resolve() again on first invocation of a lazy-flagged agent', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Boot: fail to resolve
      mockResolve.mockRejectedValueOnce(new Error('not yet'));
      // Lazy retry on first call: succeed
      mockResolve.mockResolvedValueOnce(
        makeResolvedAgent('parser', 'http://parser-lazy:9002')
      );
      stubFetch('lazy-result');

      const ext = createAhiExtension({
        agents: ['parser'],
        registry: 'http://registry:8080',
      });

      // Wait for boot promise to settle (rejected → null cached)
      await Promise.resolve();
      await Promise.resolve();
      warnSpy.mockRestore();

      // First call triggers lazy retry
      const result = await callAhi(ext, 'parser');

      expect(result).toBe('lazy-result');
      // Boot call + one lazy retry = 2 total
      expect(mockResolve).toHaveBeenCalledTimes(2);
    });

    it('uses the lazy-resolved endpoint for the HTTP POST', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      mockResolve.mockRejectedValueOnce(new Error('not yet'));
      mockResolve.mockResolvedValueOnce(
        makeResolvedAgent('parser', 'http://parser-lazy:9002')
      );
      const calls = stubFetch();

      const ext = createAhiExtension({
        agents: ['parser'],
        registry: 'http://registry:8080',
      });

      await Promise.resolve();
      await Promise.resolve();
      warnSpy.mockRestore();

      await callAhi(ext, 'parser');

      expect(calls[0]!.url).toBe('http://parser-lazy:9002/run');
    });

    it('does NOT call resolve() again on the second call after lazy success', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      mockResolve.mockRejectedValueOnce(new Error('not yet'));
      mockResolve.mockResolvedValueOnce(
        makeResolvedAgent('parser', 'http://parser-lazy:9002')
      );
      stubFetch('cached-result');

      const ext = createAhiExtension({
        agents: ['parser'],
        registry: 'http://registry:8080',
      });

      await Promise.resolve();
      await Promise.resolve();
      warnSpy.mockRestore();

      // First call — triggers lazy resolve
      await callAhi(ext, 'parser');
      // Second call — should use cached entry, not resolve again
      await callAhi(ext, 'parser');

      // Boot (1) + lazy retry (1) = 2 total; NOT 3
      expect(mockResolve).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================
  // AC-15 (failure) / EC-3: Lazy retry fails — RILL-R035 thrown
  // ============================================================

  describe('AC-15 (failure) / EC-3: lazy retry fails → RILL-R035', () => {
    it('throws RuntimeError with code RILL-R035 when lazy retry fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Both boot and lazy retry fail
      mockResolve.mockRejectedValue(new Error('still unavailable'));

      const ext = createAhiExtension({
        agents: ['parser'],
        registry: 'http://registry:8080',
      });

      await Promise.resolve();
      await Promise.resolve();
      warnSpy.mockRestore();

      await expect(callAhi(ext, 'parser')).rejects.toMatchObject({
        name: 'RuntimeError',
        errorId: 'RILL-R035',
      });
    });

    it('error message contains the agent name', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockResolve.mockRejectedValue(new Error('not found'));

      const ext = createAhiExtension({
        agents: ['parser'],
        registry: 'http://registry:8080',
      });

      await Promise.resolve();
      await Promise.resolve();
      warnSpy.mockRestore();

      await expect(callAhi(ext, 'parser')).rejects.toThrow('parser');
    });

    it('error message matches EC-3 format "Agent <name> could not be resolved"', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockResolve.mockRejectedValue(new Error('not found'));

      const ext = createAhiExtension({
        agents: ['parser'],
        registry: 'http://registry:8080',
      });

      await Promise.resolve();
      await Promise.resolve();
      warnSpy.mockRestore();

      await expect(callAhi(ext, 'parser')).rejects.toThrow(
        'Agent parser could not be resolved'
      );
    });

    it('does NOT invoke fetch when lazy retry fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockResolve.mockRejectedValue(new Error('not found'));
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      const ext = createAhiExtension({
        agents: ['parser'],
        registry: 'http://registry:8080',
      });

      await Promise.resolve();
      await Promise.resolve();
      warnSpy.mockRestore();

      await expect(callAhi(ext, 'parser')).rejects.toMatchObject({
        errorId: 'RILL-R035',
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // AC-16: InputSchema validation when contract is present
  // ============================================================

  describe('AC-16: InputSchema validation before HTTP call', () => {
    describe('AC-16 (pass): valid params proceed to fetch', () => {
      it('sends HTTP POST when required param is provided with correct type', async () => {
        mockResolve.mockResolvedValue(
          makeResolvedAgent('parser', 'http://parser:8080', {
            text: { type: 'string', required: true, description: 'Input text' },
          })
        );
        const calls = stubFetch('validated-ok');

        const ext = createAhiExtension({
          agents: ['parser'],
          registry: 'http://registry:8080',
        });

        const result = await callAhi(ext, 'parser', [{ text: 'hello' }]);

        expect(result).toBe('validated-ok');
        expect(calls).toHaveLength(1);
      });

      it('proceeds to fetch when optional param is absent', async () => {
        mockResolve.mockResolvedValue(
          makeResolvedAgent('parser', 'http://parser:8080', {
            text: {
              type: 'string',
              required: false,
              description: 'Optional text',
            },
          })
        );
        const calls = stubFetch('ok');

        const ext = createAhiExtension({
          agents: ['parser'],
          registry: 'http://registry:8080',
        });

        await callAhi(ext, 'parser', [{}]);

        expect(calls).toHaveLength(1);
      });
    });

    describe('AC-16 (fail): invalid params throw error before fetch', () => {
      it('throws RuntimeError when required param is missing', async () => {
        mockResolve.mockResolvedValue(
          makeResolvedAgent('parser', 'http://parser:8080', {
            text: { type: 'string', required: true, description: 'Input text' },
          })
        );
        const mockFetch = vi.fn();
        vi.stubGlobal('fetch', mockFetch);

        const ext = createAhiExtension({
          agents: ['parser'],
          registry: 'http://registry:8080',
        });

        await expect(callAhi(ext, 'parser', [{}])).rejects.toMatchObject({
          name: 'RuntimeError',
        });

        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('throws RuntimeError with code RILL-R027 for validation failure', async () => {
        mockResolve.mockResolvedValue(
          makeResolvedAgent('parser', 'http://parser:8080', {
            count: {
              type: 'number',
              required: true,
              description: 'Item count',
            },
          })
        );
        vi.stubGlobal('fetch', vi.fn());

        const ext = createAhiExtension({
          agents: ['parser'],
          registry: 'http://registry:8080',
        });

        // Pass a string where a number is required
        await expect(
          callAhi(ext, 'parser', [{ count: 'not-a-number' }])
        ).rejects.toMatchObject({
          name: 'RuntimeError',
          errorId: 'RILL-R027',
        });
      });

      it('error message contains the failing param name', async () => {
        mockResolve.mockResolvedValue(
          makeResolvedAgent('parser', 'http://parser:8080', {
            text: { type: 'string', required: true, description: 'Input text' },
          })
        );
        vi.stubGlobal('fetch', vi.fn());

        const ext = createAhiExtension({
          agents: ['parser'],
          registry: 'http://registry:8080',
        });

        await expect(callAhi(ext, 'parser', [{}])).rejects.toThrow('text');
      });
    });

    describe('AC-16 (skip): no contract — validation skipped', () => {
      it('proceeds to fetch without error when no input schema is present', async () => {
        // No input field on the resolved agent
        mockResolve.mockResolvedValue(
          makeResolvedAgent('parser', 'http://parser:8080')
        );
        const calls = stubFetch('no-schema-ok');

        const ext = createAhiExtension({
          agents: ['parser'],
          registry: 'http://registry:8080',
        });

        const result = await callAhi(ext, 'parser', [{}]);

        expect(result).toBe('no-schema-ok');
        expect(calls).toHaveLength(1);
      });
    });
  });
});
