/**
 * Integration tests for composeHarness() using real file I/O.
 *
 * Coverage: AC-4, AC-5, IC-5
 *
 * These tests create actual temp files on disk and call composeHarness()
 * directly (bypassing validateHarnessManifest) to exercise composition
 * logic including shared-extension deduplication, per-agent override
 * semantics, and dispose ordering.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  composeHarness,
  type HarnessManifest,
  type ComposeOptions,
} from '../../src/compose.js';

// ============================================================
// TEST SETUP
// ============================================================

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'harness-integration-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ============================================================
// HELPERS
// ============================================================

/**
 * Writes a minimal valid .rill entry file to dir.
 * Returns the filename (not the absolute path).
 */
function writeEntryFile(dir: string, filename: string): void {
  writeFileSync(join(dir, filename), `"hello"\n`);
}

/**
 * Writes an ESM factory file that increments a globalThis counter on each
 * instantiation. The counter key is unique per test to avoid cross-test leakage.
 * Returns the relative path string (e.g. "./shared-ext.mjs").
 */
function writeCountingFactory(
  dir: string,
  filename: string,
  counterKey: string
): string {
  writeFileSync(
    join(dir, filename),
    `export default function factory(config) {
  if (typeof globalThis['${counterKey}'] !== 'number') {
    globalThis['${counterKey}'] = 0;
  }
  globalThis['${counterKey}']++;
  return {};
}\n`
  );
  return `./${filename}`;
}

/**
 * Writes an ESM factory file that pushes a marker string into a globalThis
 * array when its dispose() handler is called.
 *
 * ExtensionResult shape: top-level keys are HostFunctionDefinition entries;
 * 'dispose' is a reserved top-level key for cleanup.
 * Returns the relative path string.
 */
function writeOrderTrackingFactory(
  dir: string,
  filename: string,
  orderKey: string,
  marker: string
): string {
  writeFileSync(
    join(dir, filename),
    `export default function factory(config) {
  return {
    dispose() {
      if (!Array.isArray(globalThis['${orderKey}'])) {
        globalThis['${orderKey}'] = [];
      }
      globalThis['${orderKey}'].push('${marker}');
    }
  };
}\n`
  );
  return `./${filename}`;
}

/**
 * Writes an ESM factory file that exposes a 'probe' HostFunctionDefinition.
 * The probe function returns markerValue so tests can distinguish which
 * factory was used for a given namespace.
 *
 * ExtensionResult shape: top-level keys are HostFunctionDefinition entries.
 * Each HostFunctionDefinition requires params: [] (empty array for zero-param fns).
 * Returns the relative path string.
 */
function writeMarkerFactory(
  dir: string,
  filename: string,
  markerValue: string
): string {
  writeFileSync(
    join(dir, filename),
    `export default function factory(config) {
  return {
    probe: {
      params: [],
      description: 'probe',
      fn: () => '${markerValue}',
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

// ============================================================
// AC-4 + AC-5: 3-agent harness with shared extension
// ============================================================

describe('3-agent harness with shared extension', () => {
  describe('AC-4: ComposedHarness contains one entry per declared agent', () => {
    it('harness.agents.size equals 3 for a 3-agent manifest', async () => {
      writeEntryFile(testDir, 'a.rill');
      writeEntryFile(testDir, 'b.rill');
      writeEntryFile(testDir, 'c.rill');

      const counterKey = `__cnt_ac4_${Date.now()}`;
      writeCountingFactory(testDir, 'shared.mjs', counterKey);

      const manifest: HarnessManifest = {
        shared: {
          sharedExt: { package: './shared.mjs', config: {} },
        },
        agents: [
          { name: 'agent-a', entry: 'a.rill' },
          { name: 'agent-b', entry: 'b.rill' },
          { name: 'agent-c', entry: 'c.rill' },
        ],
      };

      const harness = await composeHarness(manifest, makeOptions());

      try {
        expect(harness.agents).toBeInstanceOf(Map);
        expect(harness.agents.size).toBe(3);
      } finally {
        await harness.dispose();
        delete (globalThis as Record<string, unknown>)[counterKey];
      }
    });

    it('all 3 agent names are present as Map keys', async () => {
      writeEntryFile(testDir, 'a.rill');
      writeEntryFile(testDir, 'b.rill');
      writeEntryFile(testDir, 'c.rill');

      const manifest: HarnessManifest = {
        shared: {},
        agents: [
          { name: 'agent-a', entry: 'a.rill' },
          { name: 'agent-b', entry: 'b.rill' },
          { name: 'agent-c', entry: 'c.rill' },
        ],
      };

      const harness = await composeHarness(manifest, makeOptions());

      try {
        expect(harness.agents.has('agent-a')).toBe(true);
        expect(harness.agents.has('agent-b')).toBe(true);
        expect(harness.agents.has('agent-c')).toBe(true);
      } finally {
        await harness.dispose();
      }
    });

    it('each agent has a parsed AST and a runtime context', async () => {
      writeEntryFile(testDir, 'a.rill');
      writeEntryFile(testDir, 'b.rill');
      writeEntryFile(testDir, 'c.rill');

      const manifest: HarnessManifest = {
        shared: {},
        agents: [
          { name: 'agent-a', entry: 'a.rill' },
          { name: 'agent-b', entry: 'b.rill' },
          { name: 'agent-c', entry: 'c.rill' },
        ],
      };

      const harness = await composeHarness(manifest, makeOptions());

      try {
        for (const [, agent] of harness.agents) {
          expect(agent.context).toBeDefined();
          expect(agent.ast).toBeDefined();
          expect(agent.ast.type).toBe('Script');
        }
      } finally {
        await harness.dispose();
      }
    });

    it('dispose() resolves cleanly for a 3-agent harness', async () => {
      writeEntryFile(testDir, 'a.rill');
      writeEntryFile(testDir, 'b.rill');
      writeEntryFile(testDir, 'c.rill');

      const manifest: HarnessManifest = {
        shared: {},
        agents: [
          { name: 'agent-a', entry: 'a.rill' },
          { name: 'agent-b', entry: 'b.rill' },
          { name: 'agent-c', entry: 'c.rill' },
        ],
      };

      const harness = await composeHarness(manifest, makeOptions());

      await expect(harness.dispose()).resolves.toBeUndefined();
    });
  });

  describe('AC-5: shared extension factory called exactly once', () => {
    it('shared factory is called 1 time for a 3-agent harness', async () => {
      writeEntryFile(testDir, 'a.rill');
      writeEntryFile(testDir, 'b.rill');
      writeEntryFile(testDir, 'c.rill');

      const counterKey = `__cnt_ac5_${Date.now()}`;
      // Initialise counter to 0 before composing
      (globalThis as Record<string, unknown>)[counterKey] = 0;
      writeCountingFactory(testDir, 'shared-ac5.mjs', counterKey);

      const manifest: HarnessManifest = {
        shared: {
          sharedExt: { package: './shared-ac5.mjs', config: {} },
        },
        agents: [
          { name: 'agent-a', entry: 'a.rill' },
          { name: 'agent-b', entry: 'b.rill' },
          { name: 'agent-c', entry: 'c.rill' },
        ],
      };

      const harness = await composeHarness(manifest, makeOptions());

      try {
        expect((globalThis as Record<string, unknown>)[counterKey]).toBe(1);
      } finally {
        await harness.dispose();
        delete (globalThis as Record<string, unknown>)[counterKey];
      }
    });

    it('shared factory is called 1 time regardless of whether per-agent extensions exist', async () => {
      writeEntryFile(testDir, 'a.rill');
      writeEntryFile(testDir, 'b.rill');
      writeEntryFile(testDir, 'c.rill');

      const counterKey = `__cnt_ac5b_${Date.now()}`;
      (globalThis as Record<string, unknown>)[counterKey] = 0;
      writeCountingFactory(testDir, 'shared-ac5b.mjs', counterKey);

      // Give agent-a its own (non-colliding) extension
      writeCountingFactory(
        testDir,
        'per-agent.mjs',
        `__per_agent_${Date.now()}`
      );

      const manifest: HarnessManifest = {
        shared: {
          sharedExt: { package: './shared-ac5b.mjs', config: {} },
        },
        agents: [
          {
            name: 'agent-a',
            entry: 'a.rill',
            extensions: {
              perAgentExt: { package: './per-agent.mjs', config: {} },
            },
          },
          { name: 'agent-b', entry: 'b.rill' },
          { name: 'agent-c', entry: 'c.rill' },
        ],
      };

      const harness = await composeHarness(manifest, makeOptions());

      try {
        // sharedExt factory must have been called exactly once
        expect((globalThis as Record<string, unknown>)[counterKey]).toBe(1);
      } finally {
        await harness.dispose();
        delete (globalThis as Record<string, unknown>)[counterKey];
      }
    });

    it('sharedExtensions record is populated with the instantiated extension', async () => {
      writeEntryFile(testDir, 'a.rill');
      writeEntryFile(testDir, 'b.rill');
      writeEntryFile(testDir, 'c.rill');

      const counterKey = `__cnt_ac5c_${Date.now()}`;
      writeCountingFactory(testDir, 'shared-ac5c.mjs', counterKey);

      const manifest: HarnessManifest = {
        shared: {
          sharedExt: { package: './shared-ac5c.mjs', config: {} },
        },
        agents: [
          { name: 'agent-a', entry: 'a.rill' },
          { name: 'agent-b', entry: 'b.rill' },
          { name: 'agent-c', entry: 'c.rill' },
        ],
      };

      const harness = await composeHarness(manifest, makeOptions());

      try {
        expect(harness.sharedExtensions).toBeDefined();
        expect('sharedExt' in harness.sharedExtensions).toBe(true);
      } finally {
        await harness.dispose();
        delete (globalThis as Record<string, unknown>)[counterKey];
      }
    });
  });
});

// ============================================================
// IC-5: Per-agent extension merge — per-agent wins on same namespace key
// ============================================================

describe('per-agent extension merge', () => {
  describe('IC-5: per-agent extension wins over shared when namespace key is the same', () => {
    /**
     * Schema validation rejects shared/agent namespace collision, so this test
     * calls composeHarness() directly with a manifest that bypasses
     * validateHarnessManifest to exercise the merge logic at line:
     *   mergedFunctions = { ...sharedFunctions, ...perAgentFunctions }
     *
     * The shared extension and per-agent extension both use namespace key 'llm'.
     * After hoistExtension, each produces functions prefixed 'llm::*'.
     * The spread means per-agent 'llm::probe' replaces the shared 'llm::probe'.
     */
    it('per-agent probe function overrides shared probe function when alias is the same', async () => {
      writeEntryFile(testDir, 'agent.rill');

      // shared extension: namespace 'llm', probe returns 'shared-marker'
      writeMarkerFactory(testDir, 'shared-llm.mjs', 'shared-marker');
      // per-agent extension: namespace 'llm', probe returns 'per-agent-marker'
      writeMarkerFactory(testDir, 'per-agent-llm.mjs', 'per-agent-marker');

      // Construct manifest directly — bypasses validateHarnessManifest
      // which would reject the duplicate 'llm' namespace key.
      const manifest: HarnessManifest = {
        shared: {
          llm: { package: './shared-llm.mjs', config: {} },
        },
        agents: [
          {
            name: 'agent-a',
            entry: 'agent.rill',
            // This 'llm' key collides with shared.llm; only reachable via
            // direct composeHarness() call (schema rejects it via validateHarnessManifest).
            extensions: {
              llm: { package: './per-agent-llm.mjs', config: {} },
            },
          },
        ],
      };

      const harness = await composeHarness(manifest, makeOptions());

      try {
        const agent = harness.agents.get('agent-a')!;
        // context.functions is a Map<string, ApplicationCallable>.
        // Per-agent overrides shared, so 'llm::probe' must be the per-agent fn.
        const fnsMap = agent.context.functions as Map<
          string,
          { fn: (args: unknown[], ctx: unknown) => unknown }
        >;
        expect(fnsMap).toBeInstanceOf(Map);
        const probe = fnsMap.get('llm::probe');
        expect(probe).toBeDefined();
        // Call fn with empty args and a stub context to retrieve the marker
        expect(probe!.fn([], {})).toBe('per-agent-marker');
      } finally {
        await harness.dispose();
      }
    });
  });
});

// ============================================================
// IC-5: Dispose sequence — per-agent first, then shared
// ============================================================

describe('dispose sequence', () => {
  describe('IC-5: per-agent extensions are disposed before shared extensions', () => {
    it('per-agent dispose markers appear before shared dispose markers in call order', async () => {
      writeEntryFile(testDir, 'agent.rill');

      const orderKey = `__dispose_order_${Date.now()}`;
      (globalThis as Record<string, unknown>)[orderKey] = [];

      // Shared extension: dispose pushes 'shared'
      writeOrderTrackingFactory(
        testDir,
        'shared-disposable.mjs',
        orderKey,
        'shared'
      );

      // Per-agent extension: dispose pushes 'per-agent'
      writeOrderTrackingFactory(
        testDir,
        'per-agent-disposable.mjs',
        orderKey,
        'per-agent'
      );

      const manifest: HarnessManifest = {
        shared: {
          sharedExt: { package: './shared-disposable.mjs', config: {} },
        },
        agents: [
          {
            name: 'agent-a',
            entry: 'agent.rill',
            extensions: {
              perAgentExt: {
                package: './per-agent-disposable.mjs',
                config: {},
              },
            },
          },
        ],
      };

      const harness = await composeHarness(manifest, makeOptions());

      await harness.dispose();

      const order = (globalThis as Record<string, unknown>)[
        orderKey
      ] as string[];

      // per-agent dispose must come before shared dispose
      const perAgentIdx = order.indexOf('per-agent');
      const sharedIdx = order.indexOf('shared');

      expect(perAgentIdx).toBeGreaterThanOrEqual(0);
      expect(sharedIdx).toBeGreaterThanOrEqual(0);
      expect(perAgentIdx).toBeLessThan(sharedIdx);

      delete (globalThis as Record<string, unknown>)[orderKey];
    });

    it('per-agent extensions across multiple agents are all disposed before shared', async () => {
      writeEntryFile(testDir, 'a.rill');
      writeEntryFile(testDir, 'b.rill');

      const orderKey = `__dispose_order2_${Date.now()}`;
      (globalThis as Record<string, unknown>)[orderKey] = [];

      writeOrderTrackingFactory(testDir, 'shared-d.mjs', orderKey, 'shared');
      writeOrderTrackingFactory(
        testDir,
        'per-a-d.mjs',
        orderKey,
        'per-agent-a'
      );
      writeOrderTrackingFactory(
        testDir,
        'per-b-d.mjs',
        orderKey,
        'per-agent-b'
      );

      const manifest: HarnessManifest = {
        shared: {
          sharedExt: { package: './shared-d.mjs', config: {} },
        },
        agents: [
          {
            name: 'agent-a',
            entry: 'a.rill',
            extensions: {
              extA: { package: './per-a-d.mjs', config: {} },
            },
          },
          {
            name: 'agent-b',
            entry: 'b.rill',
            extensions: {
              extB: { package: './per-b-d.mjs', config: {} },
            },
          },
        ],
      };

      const harness = await composeHarness(manifest, makeOptions());

      await harness.dispose();

      const order = (globalThis as Record<string, unknown>)[
        orderKey
      ] as string[];

      // shared must be the last dispose call
      const sharedIdx = order.indexOf('shared');
      const perAIdx = order.indexOf('per-agent-a');
      const perBIdx = order.indexOf('per-agent-b');

      expect(sharedIdx).toBeGreaterThanOrEqual(0);
      expect(perAIdx).toBeGreaterThanOrEqual(0);
      expect(perBIdx).toBeGreaterThanOrEqual(0);

      // Both per-agent markers appear before shared
      expect(perAIdx).toBeLessThan(sharedIdx);
      expect(perBIdx).toBeLessThan(sharedIdx);

      delete (globalThis as Record<string, unknown>)[orderKey];
    });
  });
});
