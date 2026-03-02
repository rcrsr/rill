/**
 * End-to-end integration tests for createProxy.
 *
 * AC-18/AC-20: createProxy → listen → HTTP request → result
 * AC-36: Graceful shutdown via proxy.close()
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createProxy } from '../src/proxy.js';
import type { AgentProxy } from '../src/proxy.js';

// ============================================================
// HELPERS
// ============================================================

/**
 * Find a free TCP port by binding to port 0 and reading the assigned port.
 */
function getFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        server.close(() => reject(new Error('Unexpected address type')));
        return;
      }
      const port = addr.port;
      server.close(() => resolve(port));
    });
    server.once('error', reject);
  });
}

/**
 * Build a valid bundle.json manifest string.
 */
function makeBundleManifest(agentName: string, version = '1.0.0'): string {
  return JSON.stringify({
    name: 'test-bundle',
    version,
    built: new Date().toISOString(),
    checksum: 'sha256:deadbeef',
    rillVersion: '0.8.0',
    agents: {
      [agentName]: {
        entry: 'agent.js',
        modules: {},
        extensions: {},
        card: {
          name: agentName,
          description: `${agentName} test agent`,
          version,
          url: 'http://localhost',
          capabilities: {
            streaming: false,
            pushNotifications: false,
            stateTransitionHistory: false,
          },
          skills: [],
          defaultInputModes: ['application/json'],
          defaultOutputModes: ['application/json'],
        },
      },
    },
  });
}

/**
 * Harness script: reads stdin, writes a run.result to stdout, then exits.
 */
const ECHO_HARNESS = `
import { createInterface } from 'node:readline';
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.once('line', (line) => {
  const msg = JSON.parse(line);
  process.stdout.write(JSON.stringify({
    method: 'run.result',
    state: 'completed',
    result: { echo: msg.params },
    durationMs: 1
  }) + '\\n');
  process.exit(0);
});
`.trim();

/**
 * Harness script: echoes both params and config fields from the run message.
 */
const ECHO_CONFIG_HARNESS = `
import { createInterface } from 'node:readline';
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.once('line', (line) => {
  const msg = JSON.parse(line);
  process.stdout.write(JSON.stringify({
    method: 'run.result',
    state: 'completed',
    result: { params: msg.params, config: msg.config },
    durationMs: 1
  }) + '\\n');
  process.exit(0);
});
`.trim();

/**
 * Write a bundle directory with bundle.json and harness.js.
 */
function writeBundle(
  bundlesDir: string,
  agentName: string,
  harnessContent = ECHO_HARNESS
): void {
  const bundleDir = path.join(bundlesDir, 'test-bundle');
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(
    path.join(bundleDir, 'bundle.json'),
    makeBundleManifest(agentName)
  );
  fs.writeFileSync(path.join(bundleDir, 'harness.js'), harnessContent);
}

// ============================================================
// TEST SUITE
// ============================================================

describe('createProxy', () => {
  let tmpDir: string;
  let proxy: AgentProxy | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rill-proxy-e2e-'));
    proxy = undefined;
  });

  afterEach(async () => {
    if (proxy !== undefined) {
      await proxy.close();
      proxy = undefined;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ----------------------------------------------------------
  // AC-18: listen() starts HTTP server
  // ----------------------------------------------------------
  describe('listen()', () => {
    it('AC-18: listen starts HTTP server that responds to /healthz', async () => {
      // Arrange
      writeBundle(tmpDir, 'agentAlpha');
      const port = await getFreePort();

      proxy = await createProxy({
        bundlesDir: tmpDir,
        port,
        host: '127.0.0.1',
      });

      // Act
      await proxy.listen();
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      const body = (await res.json()) as { status: string };

      // Assert
      expect(res.status).toBe(200);
      expect(body.status).toBe('ok');
    });
  });

  // ----------------------------------------------------------
  // AC-20: run request goes end-to-end through child process
  // ----------------------------------------------------------
  describe('POST /agents/:name/run', () => {
    it('AC-20: end-to-end run returns completed result from child process', async () => {
      // Arrange
      writeBundle(tmpDir, 'agentAlpha');
      const port = await getFreePort();

      proxy = await createProxy({
        bundlesDir: tmpDir,
        port,
        host: '127.0.0.1',
        concurrency: {
          maxConcurrent: 5,
          maxConcurrentPerAgent: 5,
          queueSize: 0,
          requestTimeoutMs: 10000,
        },
      });

      await proxy.listen();

      // Act
      const res = await fetch(
        `http://127.0.0.1:${port}/agents/agentAlpha/run`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ params: { message: 'hello' } }),
        }
      );
      const body = (await res.json()) as {
        state: string;
        result: { echo: Record<string, unknown> };
      };

      // Assert
      expect(res.status).toBe(200);
      expect(body.state).toBe('completed');
      expect(body.result.echo).toEqual({ message: 'hello' });
    });

    it('returns 404 for unknown agent', async () => {
      // Arrange
      writeBundle(tmpDir, 'agentAlpha');
      const port = await getFreePort();

      proxy = await createProxy({
        bundlesDir: tmpDir,
        port,
        host: '127.0.0.1',
      });

      await proxy.listen();

      // Act
      const res = await fetch(
        `http://127.0.0.1:${port}/agents/nonExistent/run`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ params: {} }),
        }
      );
      const body = (await res.json()) as { error: { code: string } };

      // Assert
      expect(res.status).toBe(404);
      expect(body.error.code).toBe('PROXY_NOT_FOUND');
    });
  });

  // ----------------------------------------------------------
  // AC-36: Graceful shutdown via proxy.close()
  // ----------------------------------------------------------
  describe('close()', () => {
    it('AC-36: close() shuts down the HTTP server gracefully', async () => {
      // Arrange
      writeBundle(tmpDir, 'agentAlpha');
      const port = await getFreePort();

      proxy = await createProxy({
        bundlesDir: tmpDir,
        port,
        host: '127.0.0.1',
      });

      await proxy.listen();

      // Verify server is up before closing
      const resBeforeClose = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(resBeforeClose.status).toBe(200);

      // Act
      await proxy.close();
      proxy = undefined;

      // Assert: server no longer accepts connections
      await expect(fetch(`http://127.0.0.1:${port}/healthz`)).rejects.toThrow();
    });

    it('close() resolves without error when called before listen', async () => {
      // Arrange
      writeBundle(tmpDir, 'agentAlpha');
      proxy = await createProxy({ bundlesDir: tmpDir });

      // Act & Assert — must not throw
      await expect(proxy.close()).resolves.toBeUndefined();
      proxy = undefined;
    });
  });

  // ----------------------------------------------------------
  // catalog() and refreshCatalog() via AgentProxy interface
  // ----------------------------------------------------------
  describe('catalog()', () => {
    it('returns catalog entries after startup', async () => {
      // Arrange
      writeBundle(tmpDir, 'agentAlpha');
      proxy = await createProxy({ bundlesDir: tmpDir });

      // Act
      const entries = proxy.catalog();

      // Assert
      expect(entries).toHaveLength(1);
      expect(entries[0]?.name).toBe('agentAlpha');
    });
  });

  // ----------------------------------------------------------
  // AC-34: agentConfig injected into StdioRunMessage.config
  // ----------------------------------------------------------
  describe('AC-34: agentConfig injection', () => {
    it('AC-34: publicRun injects agentConfig into StdioRunMessage.config', async () => {
      // Arrange
      writeBundle(tmpDir, 'agentAlpha', ECHO_CONFIG_HARNESS);
      const port = await getFreePort();

      proxy = await createProxy({
        bundlesDir: tmpDir,
        port,
        host: '127.0.0.1',
        concurrency: {
          maxConcurrent: 5,
          maxConcurrentPerAgent: 5,
          queueSize: 0,
          requestTimeoutMs: 10000,
        },
        agentConfig: {
          agentAlpha: { apiKey: 'secret-key', model: 'gpt-4' },
        },
      });

      await proxy.listen();

      // Act
      const res = await fetch(
        `http://127.0.0.1:${port}/agents/agentAlpha/run`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ params: { input: 'hello' } }),
        }
      );
      const body = (await res.json()) as {
        state: string;
        result: {
          params: Record<string, unknown>;
          config: Record<string, unknown>;
        };
      };

      // Assert
      expect(res.status).toBe(200);
      expect(body.state).toBe('completed');
      expect(body.result.config).toEqual({
        apiKey: 'secret-key',
        model: 'gpt-4',
      });
    });

    it('uses empty config object when agent has no entry in agentConfig', async () => {
      // Arrange
      writeBundle(tmpDir, 'agentAlpha', ECHO_CONFIG_HARNESS);
      const port = await getFreePort();

      proxy = await createProxy({
        bundlesDir: tmpDir,
        port,
        host: '127.0.0.1',
        concurrency: {
          maxConcurrent: 5,
          maxConcurrentPerAgent: 5,
          queueSize: 0,
          requestTimeoutMs: 10000,
        },
        // agentConfig omitted — no config for agentAlpha
      });

      await proxy.listen();

      // Act
      const res = await fetch(
        `http://127.0.0.1:${port}/agents/agentAlpha/run`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ params: {} }),
        }
      );
      const body = (await res.json()) as {
        state: string;
        result: {
          params: Record<string, unknown>;
          config: Record<string, unknown>;
        };
      };

      // Assert
      expect(res.status).toBe(200);
      expect(body.result.config).toEqual({});
    });
  });
});
