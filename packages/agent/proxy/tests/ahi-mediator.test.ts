/**
 * AHI Mediator unit tests.
 *
 * AC-32: A calls B → proxy spawns B → result returned to A
 * AC-33: Chain A→B→C (tested via sequential mediator calls)
 * EC-12/AC-48: target not in catalog → error ahi.result written to child stdin
 */

import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import type {
  StdioAhiRequest,
  StdioAhiResponse,
  StdioRunResult,
} from '@rcrsr/rill-agent-shared';
import type { Catalog, CatalogEntry } from '../src/catalog.js';
import type { ProcessManager } from '../src/process-manager.js';
import { createAhiHandler } from '../src/ahi-mediator.js';
import { PROXY_AHI_TARGET_MISSING, ProxyError } from '../src/errors.js';

// ============================================================
// HELPERS
// ============================================================

/**
 * Build a minimal CatalogEntry mock.
 */
function makeMockEntry(name: string): CatalogEntry {
  return {
    name,
    version: '1.0.0',
    bundlePath: '/tmp/fake-bundle',
    checksum: 'sha256:test',
    card: {
      name,
      version: '1.0.0',
      description: '',
      url: 'http://localhost',
      capabilities: { streaming: false, pushNotifications: false },
      skills: [],
      defaultInputModes: ['application/json'],
      defaultOutputModes: ['application/json'],
    },
    agents: {},
    dependencies: [],
  };
}

/**
 * Build a minimal mock ChildProcess with a writable stdin (PassThrough).
 * Lines written to stdin are buffered for inspection via capturedStdinLines().
 */
function makeMockChild(): {
  child: ChildProcess;
  capturedStdinLines: () => StdioAhiResponse[];
} {
  const stdinStream = new PassThrough();
  const lines: StdioAhiResponse[] = [];
  let buffer = '';

  stdinStream.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf-8');
    const parts = buffer.split('\n');
    buffer = parts.pop() ?? '';
    for (const line of parts) {
      if (line.trim()) {
        lines.push(JSON.parse(line) as StdioAhiResponse);
      }
    }
  });

  const child = {
    stdin: stdinStream,
  } as unknown as ChildProcess;

  return { child, capturedStdinLines: () => lines };
}

/**
 * Build a minimal AHI request.
 */
function makeAhiRequest(
  target: string,
  overrides: Partial<StdioAhiRequest> = {}
): StdioAhiRequest {
  return {
    method: 'ahi',
    id: 'req-1',
    target,
    params: { key: 'value' },
    ...overrides,
  };
}

/**
 * Build a successful StdioRunResult.
 */
function makeRunResult(result: unknown = { ok: true }): StdioRunResult {
  return {
    method: 'run.result',
    state: 'completed',
    result,
    durationMs: 1,
  };
}

/**
 * Wait for at least one line to appear in the captured stdin buffer.
 */
async function waitForLine(
  capturedStdinLines: () => StdioAhiResponse[],
  timeoutMs = 500
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (capturedStdinLines().length === 0) {
    if (Date.now() > deadline)
      throw new Error('Timed out waiting for stdin line');
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

// ============================================================
// TEST SUITE
// ============================================================

describe('createAhiHandler', () => {
  // ----------------------------------------------------------
  // AC-32: A calls B → proxy spawns B → result returned to A
  // ----------------------------------------------------------

  describe('AC-32: successful AHI invocation', () => {
    it('spawns target agent and writes ahi.result to child A stdin', async () => {
      // Arrange
      const entryB = makeMockEntry('agent-b');
      const catalog: Catalog = {
        entries: new Map([['agent-b', entryB]]),
        get: (name: string) => (name === 'agent-b' ? entryB : undefined),
        refresh: vi.fn(),
      };

      const spawnFn = vi
        .fn()
        .mockResolvedValue(makeRunResult({ from: 'agent-b' }));
      const processManager: ProcessManager = {
        spawn: spawnFn,
        active: vi.fn().mockReturnValue([]),
        activeCount: 0,
      };

      const handler = createAhiHandler(
        catalog,
        processManager,
        5000,
        'corr-root'
      );
      const { child, capturedStdinLines } = makeMockChild();
      const request = makeAhiRequest('agent-b');

      // Act
      await handler(child, request);
      await waitForLine(capturedStdinLines);

      // Assert — spawn was called with the target entry
      expect(spawnFn).toHaveBeenCalledOnce();
      const [calledEntry, calledMessage] = spawnFn.mock.calls[0]!;
      expect(calledEntry.name).toBe('agent-b');
      expect(calledMessage.name).toBe('agent-b');
      expect(calledMessage.correlationId).toBe('corr-root');

      // Assert — ahi.result written to child A stdin
      const lines = capturedStdinLines();
      expect(lines).toHaveLength(1);
      expect(lines[0]!.method).toBe('ahi.result');
      expect(lines[0]!.id).toBe('req-1');
      expect(lines[0]!.result).toEqual({ from: 'agent-b' });
      expect(lines[0]!.error).toBeUndefined();
    });

    it('propagates params from AHI request to the spawned run message', async () => {
      // Arrange
      const entryB = makeMockEntry('agent-b');
      const catalog: Catalog = {
        entries: new Map([['agent-b', entryB]]),
        get: (name: string) => (name === 'agent-b' ? entryB : undefined),
        refresh: vi.fn(),
      };

      const spawnFn = vi.fn().mockResolvedValue(makeRunResult());
      const processManager: ProcessManager = {
        spawn: spawnFn,
        active: vi.fn().mockReturnValue([]),
        activeCount: 0,
      };

      const handler = createAhiHandler(
        catalog,
        processManager,
        5000,
        'corr-root'
      );
      const { child } = makeMockChild();
      const request = makeAhiRequest('agent-b', {
        params: { x: 42, y: 'hello' },
      });

      // Act
      await handler(child, request);

      // Assert — params forwarded to run message
      const calledMessage = spawnFn.mock.calls[0]![1];
      expect(calledMessage.params).toEqual({ x: 42, y: 'hello' });
    });

    it('applies defaultTimeoutMs when request.timeout is absent', async () => {
      // Arrange
      const entryB = makeMockEntry('agent-b');
      const catalog: Catalog = {
        entries: new Map([['agent-b', entryB]]),
        get: (name: string) => (name === 'agent-b' ? entryB : undefined),
        refresh: vi.fn(),
      };

      const spawnFn = vi.fn().mockResolvedValue(makeRunResult());
      const processManager: ProcessManager = {
        spawn: spawnFn,
        active: vi.fn().mockReturnValue([]),
        activeCount: 0,
      };

      const handler = createAhiHandler(
        catalog,
        processManager,
        7000,
        'corr-root'
      );
      const { child } = makeMockChild();
      // request.timeout is undefined (absent)
      const request = makeAhiRequest('agent-b');

      // Act
      await handler(child, request);

      // Assert — run message timeout uses default
      const calledMessage = spawnFn.mock.calls[0]![1];
      expect(calledMessage.timeout).toBe(7000);
    });

    it('uses request.timeout when provided', async () => {
      // Arrange
      const entryB = makeMockEntry('agent-b');
      const catalog: Catalog = {
        entries: new Map([['agent-b', entryB]]),
        get: (name: string) => (name === 'agent-b' ? entryB : undefined),
        refresh: vi.fn(),
      };

      const spawnFn = vi.fn().mockResolvedValue(makeRunResult());
      const processManager: ProcessManager = {
        spawn: spawnFn,
        active: vi.fn().mockReturnValue([]),
        activeCount: 0,
      };

      const handler = createAhiHandler(
        catalog,
        processManager,
        7000,
        'corr-root'
      );
      const { child } = makeMockChild();
      const request = makeAhiRequest('agent-b', { timeout: 1234 });

      // Act
      await handler(child, request);

      // Assert — run message uses the explicit timeout
      const calledMessage = spawnFn.mock.calls[0]![1];
      expect(calledMessage.timeout).toBe(1234);
    });
  });

  // ----------------------------------------------------------
  // AC-33: Chain A→B→C — mediator handles sequential calls
  // ----------------------------------------------------------

  describe('AC-33: chain A→B→C via two sequential mediator calls', () => {
    it('handles two sequential AHI calls from the same child', async () => {
      // Arrange — catalog has both agent-b and agent-c
      const entryB = makeMockEntry('agent-b');
      const entryC = makeMockEntry('agent-c');
      const catalog: Catalog = {
        entries: new Map([
          ['agent-b', entryB],
          ['agent-c', entryC],
        ]),
        get: (name: string) => {
          if (name === 'agent-b') return entryB;
          if (name === 'agent-c') return entryC;
          return undefined;
        },
        refresh: vi.fn(),
      };

      const spawnFn = vi
        .fn()
        .mockResolvedValueOnce(makeRunResult({ from: 'b' }))
        .mockResolvedValueOnce(makeRunResult({ from: 'c' }));
      const processManager: ProcessManager = {
        spawn: spawnFn,
        active: vi.fn().mockReturnValue([]),
        activeCount: 0,
      };

      const handler = createAhiHandler(
        catalog,
        processManager,
        5000,
        'corr-root'
      );
      const { child, capturedStdinLines } = makeMockChild();

      // Act — child A calls B, then calls C
      await handler(child, makeAhiRequest('agent-b', { id: 'req-b' }));
      await handler(child, makeAhiRequest('agent-c', { id: 'req-c' }));

      await waitForLine(capturedStdinLines);
      // Wait for second line too
      const deadline = Date.now() + 500;
      while (capturedStdinLines().length < 2 && Date.now() < deadline) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }

      // Assert — two spawn calls and two ahi.result lines
      expect(spawnFn).toHaveBeenCalledTimes(2);
      const lines = capturedStdinLines();
      expect(lines).toHaveLength(2);
      expect(lines[0]!.id).toBe('req-b');
      expect(lines[0]!.result).toEqual({ from: 'b' });
      expect(lines[1]!.id).toBe('req-c');
      expect(lines[1]!.result).toEqual({ from: 'c' });
    });
  });

  // ----------------------------------------------------------
  // EC-12/AC-48: target not in catalog → error ahi.result written to child stdin
  // ----------------------------------------------------------

  describe('EC-12/AC-48: target not in catalog', () => {
    it('writes ahi.result with error to child A stdin when target missing', async () => {
      // Arrange — catalog has no agents
      const catalog: Catalog = {
        entries: new Map(),
        get: () => undefined,
        refresh: vi.fn(),
      };

      const spawnFn = vi.fn();
      const processManager: ProcessManager = {
        spawn: spawnFn,
        active: vi.fn().mockReturnValue([]),
        activeCount: 0,
      };

      const handler = createAhiHandler(
        catalog,
        processManager,
        5000,
        'corr-root'
      );
      const { child, capturedStdinLines } = makeMockChild();
      const request = makeAhiRequest('agent-missing');

      // Act
      await handler(child, request);
      await waitForLine(capturedStdinLines);

      // Assert — no spawn attempted
      expect(spawnFn).not.toHaveBeenCalled();

      // Assert — error ahi.result written to child stdin
      const lines = capturedStdinLines();
      expect(lines).toHaveLength(1);
      expect(lines[0]!.method).toBe('ahi.result');
      expect(lines[0]!.id).toBe('req-1');
      expect(lines[0]!.error).toBeDefined();
      expect(lines[0]!.error!.code).toBe(PROXY_AHI_TARGET_MISSING);
      expect(lines[0]!.result).toBeUndefined();
    });

    it('error message mentions the missing target name', async () => {
      // Arrange
      const catalog: Catalog = {
        entries: new Map(),
        get: () => undefined,
        refresh: vi.fn(),
      };

      const processManager: ProcessManager = {
        spawn: vi.fn(),
        active: vi.fn().mockReturnValue([]),
        activeCount: 0,
      };

      const handler = createAhiHandler(
        catalog,
        processManager,
        5000,
        'corr-root'
      );
      const { child, capturedStdinLines } = makeMockChild();

      // Act
      await handler(child, makeAhiRequest('my-special-agent'));
      await waitForLine(capturedStdinLines);

      // Assert
      const errorMsg = capturedStdinLines()[0]!.error!.message;
      expect(errorMsg).toContain('my-special-agent');
    });
  });

  // ----------------------------------------------------------
  // Spawn error propagated as ahi.result error
  // ----------------------------------------------------------

  describe('spawn error propagated back to child A', () => {
    it('writes ahi.result with error when processManager.spawn rejects', async () => {
      // Arrange
      const entryB = makeMockEntry('agent-b');
      const catalog: Catalog = {
        entries: new Map([['agent-b', entryB]]),
        get: (name: string) => (name === 'agent-b' ? entryB : undefined),
        refresh: vi.fn(),
      };

      const proxyErr = new ProxyError(
        'Child crashed',
        'PROXY_CHILD_CRASH',
        'agent-b'
      );
      const processManager: ProcessManager = {
        spawn: vi.fn().mockRejectedValue(proxyErr),
        active: vi.fn().mockReturnValue([]),
        activeCount: 0,
      };

      const handler = createAhiHandler(
        catalog,
        processManager,
        5000,
        'corr-root'
      );
      const { child, capturedStdinLines } = makeMockChild();

      // Act
      await handler(child, makeAhiRequest('agent-b', { id: 'req-fail' }));
      await waitForLine(capturedStdinLines);

      // Assert — error ahi.result with ProxyError code written to child A
      const lines = capturedStdinLines();
      expect(lines).toHaveLength(1);
      expect(lines[0]!.method).toBe('ahi.result');
      expect(lines[0]!.id).toBe('req-fail');
      expect(lines[0]!.error).toBeDefined();
      expect(lines[0]!.error!.code).toBe('PROXY_CHILD_CRASH');
    });
  });
});
