/**
 * Unit tests for harness schema validation, type detection, and composition.
 *
 * Coverage: AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-22, AC-23, AC-24, AC-27, AC-28
 *           EC-1, EC-2, EC-3, EC-4, EC-5, EC-14
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  validateHarnessManifest,
  detectManifestType,
  composeHarness,
  ManifestValidationError,
  ComposeError,
  type AgentRunner,
  type HarnessManifest,
  type ComposeOptions,
} from '../../src/compose.js';

// ============================================================
// TEST SETUP
// ============================================================

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'harness-test-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ============================================================
// HELPERS
// ============================================================

/**
 * Writes a minimal valid .rill entry file to dir.
 * Returns the filename (relative, not absolute).
 */
function writeEntryFile(dir: string, filename = 'agent.rill'): string {
  writeFileSync(join(dir, filename), `"hello"\n`);
  return filename;
}

/**
 * Writes an ESM factory file whose factory tracks calls via a spy.
 * The spy is provided by the caller so tests can assert on it.
 * Returns the relative path string.
 *
 * Because the factory file must be a real .mjs module loaded at runtime,
 * we use a global side-channel: the file calls a globally-registered callback
 * so tests can count instantiation calls without module mocking.
 */
function writeCountingFactoryFile(
  dir: string,
  filename: string,
  globalCallbackName: string
): string {
  writeFileSync(
    join(dir, filename),
    `export default function factory(config) {
  if (typeof globalThis['${globalCallbackName}'] === 'function') {
    globalThis['${globalCallbackName}']();
  }
  return {};
}\n`
  );
  return `./${filename}`;
}

/**
 * Writes an ESM factory file whose factory registers a dispose handler
 * that calls a globally-registered dispose callback.
 */
function writeDisposableFactoryFile(
  dir: string,
  filename: string,
  globalDisposeCallbackName: string
): string {
  writeFileSync(
    join(dir, filename),
    `export default function factory(config) {
  return {
    functions: {},
    dispose() {
      if (typeof globalThis['${globalDisposeCallbackName}'] === 'function') {
        globalThis['${globalDisposeCallbackName}']();
      }
    }
  };
}\n`
  );
  return `./${filename}`;
}

/**
 * Returns ComposeOptions pointing to testDir.
 */
function makeOptions(dir = testDir): ComposeOptions {
  return { basePath: dir, env: {} };
}

/**
 * Builds a minimal valid HarnessManifest with one agent.
 */
function makeHarnessManifest(
  overrides: Partial<HarnessManifest> = {}
): HarnessManifest {
  return {
    agents: [
      {
        name: 'agent-a',
        entry: 'agent.rill',
      },
    ],
    shared: {},
    ...overrides,
  };
}

// ============================================================
// detectManifestType [AC-6, AC-24, EC-14]
// ============================================================

describe('detectManifestType', () => {
  describe('AC-6: returns harness for objects with agents key', () => {
    it('returns harness for object with agents array', () => {
      expect(detectManifestType({ agents: [] })).toBe('harness');
    });

    it('returns harness for object with agents key and other fields', () => {
      expect(detectManifestType({ agents: [{ name: 'a' }], shared: {} })).toBe(
        'harness'
      );
    });
  });

  describe('AC-6: returns agent for objects without agents key', () => {
    it('returns agent for object with name field only', () => {
      expect(detectManifestType({ name: 'foo' })).toBe('agent');
    });

    it('returns agent for empty object', () => {
      expect(detectManifestType({})).toBe('agent');
    });
  });

  describe('AC-24/EC-14: null and non-object inputs return agent without throwing', () => {
    it('returns agent for null without throwing', () => {
      expect(() => detectManifestType(null)).not.toThrow();
      expect(detectManifestType(null)).toBe('agent');
    });

    it('returns agent for undefined without throwing', () => {
      expect(() => detectManifestType(undefined)).not.toThrow();
      expect(detectManifestType(undefined)).toBe('agent');
    });

    it('returns agent for number without throwing', () => {
      expect(() => detectManifestType(42)).not.toThrow();
      expect(detectManifestType(42)).toBe('agent');
    });

    it('returns agent for string without throwing', () => {
      expect(detectManifestType('harness')).toBe('agent');
    });

    it('returns agent for boolean without throwing', () => {
      expect(detectManifestType(true)).toBe('agent');
    });
  });
});

// ============================================================
// validateHarnessManifest [AC-1, AC-2, AC-3, AC-23, EC-1, EC-2, EC-3, EC-4]
// ============================================================

describe('validateHarnessManifest', () => {
  describe('AC-1: accepts valid manifest with 1+ agents', () => {
    it('accepts manifest with one agent', () => {
      const raw = {
        agents: [{ name: 'agent-a', entry: 'a.rill' }],
      };
      const result = validateHarnessManifest(raw);
      expect(result.agents).toHaveLength(1);
      expect(result.agents[0]!.name).toBe('agent-a');
    });

    it('accepts manifest with two agents', () => {
      const raw = {
        agents: [
          { name: 'agent-a', entry: 'a.rill' },
          { name: 'agent-b', entry: 'b.rill' },
        ],
      };
      const result = validateHarnessManifest(raw);
      expect(result.agents).toHaveLength(2);
    });

    it('returns validated manifest with defaults applied', () => {
      const raw = {
        agents: [{ name: 'agent-a', entry: 'a.rill' }],
      };
      const result = validateHarnessManifest(raw);
      expect(result.shared).toEqual({});
    });
  });

  describe('EC-1: missing required fields throw ManifestValidationError', () => {
    it('throws ManifestValidationError for empty object', () => {
      expect(() => validateHarnessManifest({})).toThrow(
        ManifestValidationError
      );
    });

    it('throws ManifestValidationError for null input', () => {
      expect(() => validateHarnessManifest(null)).toThrow(
        ManifestValidationError
      );
    });

    it('throws ManifestValidationError for empty agents array', () => {
      // agents: [] violates min(1)
      expect(() => validateHarnessManifest({ agents: [] })).toThrow(
        ManifestValidationError
      );
    });

    it('throws ManifestValidationError for agent missing name', () => {
      expect(() =>
        validateHarnessManifest({ agents: [{ entry: 'a.rill' }] })
      ).toThrow(ManifestValidationError);
    });

    it('throws ManifestValidationError for agent missing entry', () => {
      expect(() =>
        validateHarnessManifest({ agents: [{ name: 'a' }] })
      ).toThrow(ManifestValidationError);
    });

    it('error is instance of ComposeError', () => {
      let caught: unknown;
      try {
        validateHarnessManifest({});
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ComposeError);
      expect((caught as ComposeError).phase).toBe('validation');
    });
  });

  describe('AC-2/EC-2: duplicate agent names rejection', () => {
    it('throws ManifestValidationError for two agents with the same name', () => {
      const raw = {
        agents: [
          { name: 'agent-a', entry: 'a.rill' },
          { name: 'agent-a', entry: 'b.rill' },
        ],
      };
      expect(() => validateHarnessManifest(raw)).toThrow(
        ManifestValidationError
      );
    });

    it('error message identifies the duplicate name', () => {
      const raw = {
        agents: [
          { name: 'agent-a', entry: 'a.rill' },
          { name: 'agent-a', entry: 'b.rill' },
        ],
      };
      let caught: unknown;
      try {
        validateHarnessManifest(raw);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ManifestValidationError);
      expect((caught as ManifestValidationError).message).toContain('agent-a');
    });

    it('accepts manifest where all agent names are distinct', () => {
      const raw = {
        agents: [
          { name: 'agent-a', entry: 'a.rill' },
          { name: 'agent-b', entry: 'b.rill' },
          { name: 'agent-c', entry: 'c.rill' },
        ],
      };
      expect(() => validateHarnessManifest(raw)).not.toThrow();
    });
  });

  describe('AC-3/EC-3: per-agent cap sum exceeding host.maxConcurrency', () => {
    it('throws ManifestValidationError when sum exceeds host cap', () => {
      const raw = {
        host: { maxConcurrency: 30 },
        agents: [
          { name: 'agent-a', entry: 'a.rill', maxConcurrency: 20 },
          { name: 'agent-b', entry: 'b.rill', maxConcurrency: 15 },
        ],
      };
      // sum = 35, cap = 30 → should throw
      expect(() => validateHarnessManifest(raw)).toThrow(
        ManifestValidationError
      );
    });

    it('error message includes sum and cap values', () => {
      const raw = {
        host: { maxConcurrency: 30 },
        agents: [
          { name: 'agent-a', entry: 'a.rill', maxConcurrency: 20 },
          { name: 'agent-b', entry: 'b.rill', maxConcurrency: 15 },
        ],
      };
      let caught: unknown;
      try {
        validateHarnessManifest(raw);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ManifestValidationError);
      const msg = (caught as ManifestValidationError).message;
      expect(msg).toContain('35');
      expect(msg).toContain('30');
    });

    it('accepts manifest where sum equals host cap exactly', () => {
      const raw = {
        host: { maxConcurrency: 30 },
        agents: [
          { name: 'agent-a', entry: 'a.rill', maxConcurrency: 15 },
          { name: 'agent-b', entry: 'b.rill', maxConcurrency: 15 },
        ],
      };
      // sum = 30, cap = 30 → equal, not exceeding → should pass
      expect(() => validateHarnessManifest(raw)).not.toThrow();
    });

    it('accepts manifest when no host.maxConcurrency is set', () => {
      const raw = {
        agents: [
          { name: 'agent-a', entry: 'a.rill', maxConcurrency: 999 },
          { name: 'agent-b', entry: 'b.rill', maxConcurrency: 999 },
        ],
      };
      expect(() => validateHarnessManifest(raw)).not.toThrow();
    });
  });

  describe('AC-23/EC-4: namespace collision reports colliding namespace', () => {
    it('throws ManifestValidationError for shared/agent namespace collision', () => {
      const raw = {
        shared: {
          llm: { package: '@some/llm', config: {} },
        },
        agents: [
          {
            name: 'agent-a',
            entry: 'a.rill',
            extensions: {
              llm: { package: '@other/llm', config: {} },
            },
          },
        ],
      };
      expect(() => validateHarnessManifest(raw)).toThrow(
        ManifestValidationError
      );
    });

    it('error message contains the colliding namespace name', () => {
      const raw = {
        shared: {
          llm: { package: '@some/llm', config: {} },
        },
        agents: [
          {
            name: 'agent-a',
            entry: 'a.rill',
            extensions: {
              llm: { package: '@other/llm', config: {} },
            },
          },
        ],
      };
      let caught: unknown;
      try {
        validateHarnessManifest(raw);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ManifestValidationError);
      expect((caught as ManifestValidationError).message).toContain('llm');
    });

    it('accepts manifest where shared and agent extensions have distinct namespaces', () => {
      const raw = {
        shared: {
          llm: { package: '@some/llm', config: {} },
        },
        agents: [
          {
            name: 'agent-a',
            entry: 'a.rill',
            extensions: {
              kv: { package: '@some/kv', config: {} },
            },
          },
        ],
      };
      expect(() => validateHarnessManifest(raw)).not.toThrow();
    });
  });
});

// ============================================================
// composeHarness [AC-4, AC-5, AC-22, AC-27, AC-28, EC-5]
// ============================================================

describe('composeHarness', () => {
  describe('AC-4: returns ComposedHarness with one entry per declared agent', () => {
    it('returns harness with agents.size === 1 for single-agent manifest', async () => {
      writeEntryFile(testDir);
      const manifest = makeHarnessManifest();

      const harness = await composeHarness(manifest, makeOptions());

      try {
        expect(harness.agents).toBeInstanceOf(Map);
        expect(harness.agents.size).toBe(1);
        expect(harness.agents.has('agent-a')).toBe(true);
      } finally {
        await harness.dispose();
      }
    });

    it('returns harness with agents.size === 3 for 3-agent manifest', async () => {
      writeEntryFile(testDir, 'a.rill');
      writeEntryFile(testDir, 'b.rill');
      writeEntryFile(testDir, 'c.rill');

      const manifest = makeHarnessManifest({
        agents: [
          { name: 'agent-a', entry: 'a.rill' },
          { name: 'agent-b', entry: 'b.rill' },
          { name: 'agent-c', entry: 'c.rill' },
        ],
      });

      const harness = await composeHarness(manifest, makeOptions());

      try {
        expect(harness.agents.size).toBe(3);
        expect(harness.agents.has('agent-a')).toBe(true);
        expect(harness.agents.has('agent-b')).toBe(true);
        expect(harness.agents.has('agent-c')).toBe(true);
      } finally {
        await harness.dispose();
      }
    });

    it('each ComposedAgent has context and ast', async () => {
      writeEntryFile(testDir);
      const manifest = makeHarnessManifest();

      const harness = await composeHarness(manifest, makeOptions());

      try {
        const agent = harness.agents.get('agent-a')!;
        expect(agent.context).toBeDefined();
        expect(agent.ast).toBeDefined();
        expect(agent.ast.type).toBe('Script');
      } finally {
        await harness.dispose();
      }
    });

    it('ComposedHarness exposes sharedExtensions', async () => {
      writeEntryFile(testDir);
      const manifest = makeHarnessManifest();

      const harness = await composeHarness(manifest, makeOptions());

      try {
        expect(harness.sharedExtensions).toBeDefined();
        expect(typeof harness.sharedExtensions).toBe('object');
      } finally {
        await harness.dispose();
      }
    });
  });

  describe('AC-5: shared extension instantiated exactly 1 time for 3-agent harness', () => {
    it('calls shared factory once regardless of agent count', async () => {
      writeEntryFile(testDir, 'a.rill');
      writeEntryFile(testDir, 'b.rill');
      writeEntryFile(testDir, 'c.rill');

      const callbackName = `__sharedFactoryCalls_${Date.now()}`;
      const spy = vi.fn();
      (globalThis as Record<string, unknown>)[callbackName] = spy;

      writeCountingFactoryFile(testDir, 'shared-ext.mjs', callbackName);

      const manifest = makeHarnessManifest({
        shared: {
          sharedExt: { package: './shared-ext.mjs', config: {} },
        },
        agents: [
          { name: 'agent-a', entry: 'a.rill' },
          { name: 'agent-b', entry: 'b.rill' },
          { name: 'agent-c', entry: 'c.rill' },
        ],
      });

      const harness = await composeHarness(manifest, makeOptions());

      try {
        expect(spy).toHaveBeenCalledTimes(1);
      } finally {
        await harness.dispose();
        delete (globalThis as Record<string, unknown>)[callbackName];
      }
    });
  });

  describe('AC-22/EC-5: failed extension factory disposes already-instantiated', () => {
    it('disposes first extension when second extension factory throws', async () => {
      writeEntryFile(testDir);

      const disposeCallbackName = `__dispose_${Date.now()}`;
      const disposeSpy = vi.fn();
      (globalThis as Record<string, unknown>)[disposeCallbackName] = disposeSpy;

      // First factory: succeeds and registers a dispose handler
      writeDisposableFactoryFile(testDir, 'good-ext.mjs', disposeCallbackName);

      // Second factory: throws during instantiation
      writeFileSync(
        join(testDir, 'bad-ext.mjs'),
        `export default function factory(config) {
  throw new Error('bad extension init failure');
}\n`
      );

      const manifest = makeHarnessManifest({
        shared: {
          goodExt: { package: './good-ext.mjs', config: {} },
          badExt: { package: './bad-ext.mjs', config: {} },
        },
        agents: [{ name: 'agent-a', entry: 'agent.rill' }],
      });

      let caught: unknown;
      try {
        await composeHarness(manifest, makeOptions());
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(ComposeError);
      expect((caught as ComposeError).message).toContain(
        'bad extension init failure'
      );
      expect(disposeSpy).toHaveBeenCalledTimes(1);

      delete (globalThis as Record<string, unknown>)[disposeCallbackName];
    });
  });

  describe('AC-27: dispose() without bindHost() disposes cleanly', () => {
    it('dispose() resolves without throwing when bindHost was never called', async () => {
      writeEntryFile(testDir);
      const manifest = makeHarnessManifest();

      const harness = await composeHarness(manifest, makeOptions());

      await expect(harness.dispose()).resolves.toBeUndefined();
    });

    it('dispose() called twice is safe (idempotent)', async () => {
      writeEntryFile(testDir);
      const manifest = makeHarnessManifest();

      const harness = await composeHarness(manifest, makeOptions());

      await harness.dispose();
      await expect(harness.dispose()).resolves.toBeUndefined();
    });
  });

  describe('AC-28: bindHost() after dispose() is a no-op', () => {
    it('bindHost() after dispose() does not throw', async () => {
      writeEntryFile(testDir);
      const manifest = makeHarnessManifest();

      const harness = await composeHarness(manifest, makeOptions());

      await harness.dispose();

      expect(() => harness.bindHost({})).not.toThrow();
    });

    it('bindHost() after dispose() does not re-register agents', async () => {
      writeEntryFile(testDir);
      const manifest = makeHarnessManifest();

      const harness = await composeHarness(manifest, makeOptions());

      await harness.dispose();

      // bindHost after dispose is a no-op; calling it should succeed silently
      const mockHost = { register: vi.fn() };
      expect(() => harness.bindHost(mockHost)).not.toThrow();
      // No registration should have occurred
      expect(mockHost.register).not.toHaveBeenCalled();
    });
  });

  describe('EC-11: bindHost() silently skips agents with no ahi:: functions', () => {
    it('does not call runForAgent when no agent has ahi:: functions', async () => {
      // Arrange: one agent with no extensions — its functions map contains
      // no ahi::* keys. bindHost() must iterate and skip silently.
      writeEntryFile(testDir);
      const manifest = makeHarnessManifest();
      const harness = await composeHarness(manifest, makeOptions());

      const mockRunner: AgentRunner = {
        runForAgent: vi.fn().mockResolvedValue({ state: 'completed' }),
      };

      try {
        // Act + Assert — must not throw
        expect(() => harness.bindHost(mockRunner)).not.toThrow();
        // The real bindHost only calls runForAgent via in-process functions
        // registered for ahi:: keys. With no ahi:: keys, it must never fire.
        expect(mockRunner.runForAgent).not.toHaveBeenCalled();
      } finally {
        await harness.dispose();
      }
    });
  });
});
