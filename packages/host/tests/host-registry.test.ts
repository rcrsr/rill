/**
 * Success-path tests for AgentHost registry integration.
 *
 * Covered:
 *   AC-33  listen() with RILL_REGISTRY_URL set calls register() after port bind
 *   AC-34  Heartbeat fires every 30 s while listen() active
 *   AC-35  stop() calls deregister() before drain begins
 *   AC-37  ahiDependencies extracted from manifest.extensions.ahi.config.agents (string[])
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

// ============================================================
// MODULE MOCK
// ============================================================

// Mock @rcrsr/rill-registry-client BEFORE importing any module that uses it.
// vi.mock is hoisted — intercepts the dynamic import('@rcrsr/rill-registry-client')
// in host.ts listen() automatically.

const mockRegister = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockDeregister = vi
  .fn<() => Promise<void>>()
  .mockResolvedValue(undefined);
const mockHeartbeat = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockDispose = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

vi.mock('@rcrsr/rill-registry-client', () => ({
  createRegistryClient: vi.fn(() => ({
    register: mockRegister,
    deregister: mockDeregister,
    heartbeat: mockHeartbeat,
    dispose: mockDispose,
    resolve: vi.fn(),
    list: vi.fn(),
  })),
}));

// Import AFTER vi.mock so the hoisted mock is in place.
import type { AgentHost } from '../src/index.js';
import { createTestHost } from './helpers/host.js';
import type { AgentManifest } from '../src/index.js';

// ============================================================
// TEARDOWN STATE
// ============================================================

const hostsToClean: AgentHost[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  // Ensure RILL_REGISTRY_URL is unset between tests.
  delete process.env['RILL_REGISTRY_URL'];
});

afterEach(async () => {
  vi.useRealTimers();
  delete process.env['RILL_REGISTRY_URL'];

  for (const host of hostsToClean.splice(0)) {
    await host.close().catch(() => undefined);
    if (host.phase !== 'stopped') {
      await host.stop().catch(() => undefined);
    }
  }
});

// ============================================================
// AC-33: register() called after port bind
// ============================================================

describe('AC-33: register() called after listen() port bind', () => {
  it('calls register() exactly once when RILL_REGISTRY_URL is set', async () => {
    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    const host = await createTestHost();
    hostsToClean.push(host);

    await host.listen(0);

    expect(mockRegister).toHaveBeenCalledOnce();

    await host.close();
  });

  it('register() receives correct name from composedAgent.card.name', async () => {
    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    const host = await createTestHost();
    hostsToClean.push(host);

    await host.listen(0);

    const payload = mockRegister.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.name).toBe('test-agent');

    await host.close();
  });

  it('register() receives correct version from composedAgent.card.version', async () => {
    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    const host = await createTestHost();
    hostsToClean.push(host);

    await host.listen(0);

    const payload = mockRegister.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.version).toBe('0.0.1');

    await host.close();
  });

  it('register() endpoint contains the bound port number', async () => {
    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    const host = await createTestHost({ port: 19990 });
    hostsToClean.push(host);

    await host.listen(19990);

    const payload = mockRegister.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof payload.endpoint).toBe('string');
    const endpoint = payload.endpoint as string;
    expect(endpoint).toContain('19990');
    expect(endpoint).toMatch(/^http:\/\//);

    await host.close();
  });

  it('register() payload includes card object', async () => {
    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    const host = await createTestHost();
    hostsToClean.push(host);

    await host.listen(0);

    const payload = mockRegister.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.card).toBeDefined();
    expect(typeof payload.card).toBe('object');

    await host.close();
  });

  it('register() payload includes dependencies array', async () => {
    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    const host = await createTestHost();
    hostsToClean.push(host);

    await host.listen(0);

    const payload = mockRegister.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Array.isArray(payload.dependencies)).toBe(true);

    await host.close();
  });

  it('uses options.registryEndpoint when provided instead of default', async () => {
    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    const host = await createTestHost({
      registryEndpoint: 'http://10.0.0.5:19991',
    });
    hostsToClean.push(host);

    await host.listen(0);

    const payload = mockRegister.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.endpoint).toBe('http://10.0.0.5:19991');

    await host.close();
  });
});

// ============================================================
// AC-34: Heartbeat fires every 30 s
// ============================================================

describe('AC-34: heartbeat fires every 30 s while listen() is active', () => {
  it('heartbeat is called once after 30 000 ms', async () => {
    vi.useFakeTimers();

    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    const host = await createTestHost();
    hostsToClean.push(host);

    await host.listen(0);

    // Advance 30 s to trigger the first heartbeat interval.
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockHeartbeat).toHaveBeenCalledOnce();

    await host.close();
    vi.useRealTimers();
  });

  it('heartbeat is called twice after 60 000 ms', async () => {
    vi.useFakeTimers();

    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    const host = await createTestHost();
    hostsToClean.push(host);

    await host.listen(0);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockHeartbeat).toHaveBeenCalledTimes(2);

    await host.close();
    vi.useRealTimers();
  });

  it('heartbeat is called with the agent name', async () => {
    vi.useFakeTimers();

    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    const host = await createTestHost();
    hostsToClean.push(host);

    await host.listen(0);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockHeartbeat).toHaveBeenCalledWith('test-agent');

    await host.close();
    vi.useRealTimers();
  });

  it('heartbeat is not called before the first 30 s interval', async () => {
    vi.useFakeTimers();

    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    const host = await createTestHost();
    hostsToClean.push(host);

    await host.listen(0);

    // Advance less than the interval — heartbeat must not fire yet.
    await vi.advanceTimersByTimeAsync(29_999);

    expect(mockHeartbeat).not.toHaveBeenCalled();

    await host.close();
    vi.useRealTimers();
  });
});

// ============================================================
// AC-35: deregister() called before drain begins on stop()
// ============================================================

describe('AC-35: deregister() called before stop() resolves', () => {
  it('calls deregister() when stop() is invoked after listen()', async () => {
    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    const host = await createTestHost();
    hostsToClean.push(host);

    await host.listen(0);

    // register must complete before deregister can be expected (AC-35 guard).
    expect(mockRegister).toHaveBeenCalledOnce();

    await host.close();
    await host.stop();

    expect(mockDeregister).toHaveBeenCalledOnce();
  });

  it('deregister() is called with the agent name', async () => {
    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    const host = await createTestHost();
    hostsToClean.push(host);

    await host.listen(0);
    await host.close();
    await host.stop();

    expect(mockDeregister).toHaveBeenCalledWith('test-agent');
  });

  it('dispose() is called on the registry client after deregister()', async () => {
    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    const host = await createTestHost();
    hostsToClean.push(host);

    await host.listen(0);
    await host.close();
    await host.stop();

    // deregister must happen before dispose per stop() implementation.
    const deregisterOrder = mockDeregister.mock.invocationCallOrder[0];
    const disposeOrder = mockDispose.mock.invocationCallOrder[0];
    expect(deregisterOrder).toBeDefined();
    expect(disposeOrder).toBeDefined();
    expect(deregisterOrder!).toBeLessThan(disposeOrder!);
  });

  it('stop() resolves and host reaches stopped phase', async () => {
    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    const host = await createTestHost();
    hostsToClean.push(host);

    await host.listen(0);
    await host.close();
    await host.stop();

    expect(host.phase).toBe('stopped');
  });

  it('heartbeat interval is cleared before deregister on stop()', async () => {
    vi.useFakeTimers();

    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    const host = await createTestHost();
    hostsToClean.push(host);

    await host.listen(0);
    await host.close();
    await host.stop();

    // After stop(), advancing timers must not trigger any additional heartbeats.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockHeartbeat).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});

// ============================================================
// AC-37: ahiDependencies from manifest.extensions.ahi.config.agents string[]
// ============================================================

describe('AC-37: ahiDependencies extracted from manifest ahi config agents', () => {
  it('register() dependencies equals agents string[] from manifest ahi config', async () => {
    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';

    const manifest: AgentManifest = {
      name: 'test-agent',
      version: '0.0.1',
      runtime: '@rcrsr/rill@*',
      entry: 'minimal.rill',
      modules: {},
      extensions: {
        ahi: {
          package: '@rcrsr/rill-ext-ahi',
          config: {
            agents: ['parser', 'formatter'],
          },
        },
      },
      functions: {},
      assets: [],
    };

    const host = await createTestHost({ manifest });
    hostsToClean.push(host);

    await host.listen(0);

    const payload = mockRegister.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.dependencies).toEqual(['parser', 'formatter']);

    await host.close();
  });

  it('dependencies defaults to [] when manifest is absent', async () => {
    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    const host = await createTestHost();
    hostsToClean.push(host);

    await host.listen(0);

    const payload = mockRegister.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.dependencies).toEqual([]);

    await host.close();
  });

  it('dependencies defaults to [] when manifest has no ahi extension', async () => {
    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';

    const manifest: AgentManifest = {
      name: 'test-agent',
      version: '0.0.1',
      runtime: '@rcrsr/rill@*',
      entry: 'minimal.rill',
      modules: {},
      extensions: {},
      functions: {},
      assets: [],
    };

    const host = await createTestHost({ manifest });
    hostsToClean.push(host);

    await host.listen(0);

    const payload = mockRegister.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.dependencies).toEqual([]);

    await host.close();
  });

  it('dependencies defaults to [] when ahi config.agents is not an array', async () => {
    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';

    const manifest: AgentManifest = {
      name: 'test-agent',
      version: '0.0.1',
      runtime: '@rcrsr/rill@*',
      entry: 'minimal.rill',
      modules: {},
      extensions: {
        ahi: {
          package: '@rcrsr/rill-ext-ahi',
          config: {
            agents: { parser: { url: 'http://parser:8080' } },
          },
        },
      },
      functions: {},
      assets: [],
    };

    const host = await createTestHost({ manifest });
    hostsToClean.push(host);

    await host.listen(0);

    const payload = mockRegister.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.dependencies).toEqual([]);

    await host.close();
  });

  it('dependencies matches exactly when single agent in string[]', async () => {
    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';

    const manifest: AgentManifest = {
      name: 'test-agent',
      version: '0.0.1',
      runtime: '@rcrsr/rill@*',
      entry: 'minimal.rill',
      modules: {},
      extensions: {
        ahi: {
          package: '@rcrsr/rill-ext-ahi',
          config: {
            agents: ['parser'],
          },
        },
      },
      functions: {},
      assets: [],
    };

    const host = await createTestHost({ manifest });
    hostsToClean.push(host);

    await host.listen(0);

    const payload = mockRegister.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.dependencies).toEqual(['parser']);

    await host.close();
  });
});

// ============================================================
// AC-36: register() network error — listen() resolves, warn logged
// ============================================================

describe('AC-36: register() network error does not prevent listen() from resolving', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn');
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('listen() resolves normally when register() rejects with a network error', async () => {
    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    mockRegister.mockRejectedValueOnce(new Error('network error'));

    const host = await createTestHost();
    hostsToClean.push(host);

    await expect(host.listen(0)).resolves.toBeUndefined();

    await host.close();
    await host.stop();
  });

  it('console.warn is called mentioning the error when register() rejects', async () => {
    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    mockRegister.mockRejectedValueOnce(new Error('network error'));

    const host = await createTestHost();
    hostsToClean.push(host);

    await host.listen(0);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('network error')
    );

    await host.close();
    await host.stop();
  });
});

// ============================================================
// AC-39: register() HTTP 409 — listen() resolves, warn logged
// ============================================================

describe('AC-39: register() HTTP 409 does not prevent listen() from resolving', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn');
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('listen() resolves normally when register() rejects with a 409 error', async () => {
    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    mockRegister.mockRejectedValueOnce(new Error('HTTP 409 Conflict'));

    const host = await createTestHost();
    hostsToClean.push(host);

    await expect(host.listen(0)).resolves.toBeUndefined();

    await host.close();
    await host.stop();
  });

  it('console.warn is called when register() rejects with 409', async () => {
    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    mockRegister.mockRejectedValueOnce(new Error('HTTP 409 Conflict'));

    const host = await createTestHost();
    hostsToClean.push(host);

    await host.listen(0);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('409'));

    await host.close();
    await host.stop();
  });
});

// ============================================================
// AC-38: deregister() failure — stop() resolves, warn logged, phase=stopped
// ============================================================

describe('AC-38: deregister() failure does not prevent stop() from resolving', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn');
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('stop() resolves normally when deregister() rejects', async () => {
    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    // register() succeeds so registrationComplete becomes true.
    mockRegister.mockResolvedValueOnce(undefined);
    mockDeregister.mockRejectedValueOnce(new Error('network gone'));

    const host = await createTestHost();
    hostsToClean.push(host);

    await host.listen(0);
    await host.close();

    await expect(host.stop()).resolves.toBeUndefined();
  });

  it('console.warn is called when deregister() rejects', async () => {
    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    mockRegister.mockResolvedValueOnce(undefined);
    mockDeregister.mockRejectedValueOnce(new Error('network gone'));

    const host = await createTestHost();
    hostsToClean.push(host);

    await host.listen(0);
    await host.close();
    await host.stop();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('network gone')
    );
  });

  it('host phase is stopped after stop() when deregister() rejects', async () => {
    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    mockRegister.mockResolvedValueOnce(undefined);
    mockDeregister.mockRejectedValueOnce(new Error('network gone'));

    const host = await createTestHost();
    hostsToClean.push(host);

    await host.listen(0);
    await host.close();
    await host.stop();

    expect(host.phase).toBe('stopped');
  });
});

// ============================================================
// AC-40: Heartbeat failure — warn logged, interval continues
// ============================================================

describe('AC-40: heartbeat failure is logged and subsequent intervals still fire', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn');
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('console.warn is called when heartbeat() rejects', async () => {
    vi.useFakeTimers();

    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    mockHeartbeat.mockRejectedValueOnce(new Error('heartbeat failed'));

    const host = await createTestHost();
    hostsToClean.push(host);

    await host.listen(0);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('heartbeat failed')
    );

    await host.close();
    vi.useRealTimers();
  });

  it('heartbeat interval continues firing after a failure', async () => {
    vi.useFakeTimers();

    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    // First call rejects; subsequent calls resolve normally.
    mockHeartbeat.mockRejectedValueOnce(new Error('heartbeat failed'));

    const host = await createTestHost();
    hostsToClean.push(host);

    await host.listen(0);

    // First interval fires and rejects.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockHeartbeat).toHaveBeenCalledTimes(1);

    // Second interval fires despite the first failure.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockHeartbeat).toHaveBeenCalledTimes(2);

    await host.close();
    vi.useRealTimers();
  });
});

// ============================================================
// AC-41: RILL_REGISTRY_URL unset — no registry client, no error
// ============================================================

describe('AC-41: RILL_REGISTRY_URL unset means register() is never called', () => {
  it('listen() resolves normally when RILL_REGISTRY_URL is not set', async () => {
    // Ensure variable is absent (beforeEach already deletes it).
    const host = await createTestHost();
    hostsToClean.push(host);

    await expect(host.listen(0)).resolves.toBeUndefined();

    await host.close();
    await host.stop();
  });

  it('register() is never called when RILL_REGISTRY_URL is not set', async () => {
    const host = await createTestHost();
    hostsToClean.push(host);

    await host.listen(0);

    expect(mockRegister).not.toHaveBeenCalled();

    await host.close();
    await host.stop();
  });
});

// ============================================================
// AC-42: stop() before register() completes — deregister is a no-op
// ============================================================

describe('AC-42: stop() before register() completes skips deregister()', () => {
  it('deregister() is never called when stop() is invoked before register() resolves', async () => {
    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    // register() returns a promise that never settles — simulates in-flight registration.
    mockRegister.mockReturnValueOnce(new Promise<void>(() => {}));

    const host = await createTestHost();
    hostsToClean.push(host);

    // Start listen() but do NOT await — it is blocked waiting for register().
    const listenPromise = host.listen(0);
    // Give the event loop a tick so listen() can bind the port and reach the
    // register() await before stop() is called.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    await host.stop();

    expect(mockDeregister).not.toHaveBeenCalled();

    // Clean up the dangling listenPromise to avoid unhandled rejections.
    listenPromise.catch(() => undefined);
  });

  it('stop() resolves normally when stop() is called before register() completes', async () => {
    process.env['RILL_REGISTRY_URL'] = 'http://registry:8080';
    mockRegister.mockReturnValueOnce(new Promise<void>(() => {}));

    const host = await createTestHost();
    hostsToClean.push(host);

    const listenPromise = host.listen(0);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    await expect(host.stop()).resolves.toBeUndefined();

    listenPromise.catch(() => undefined);
  });
});
