/**
 * Tests for composeAgent() — orchestration, success paths, and all 9 error conditions.
 *
 * IC-18: packages/compose/tests/compose.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  composeAgent,
  validateManifest,
  ComposeError,
  type ComposeOptions,
  type AgentManifest,
} from '../src/compose.js';

// ============================================================
// TEST SETUP
// ============================================================

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'compose-test-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ============================================================
// HELPERS
// ============================================================

/**
 * Writes a minimal valid .rill entry file.
 * Returns the absolute file path.
 */
function writeEntryFile(dir: string, filename = 'agent.rill'): string {
  const filePath = join(dir, filename);
  writeFileSync(filePath, `"hello"\n`);
  return filePath;
}

/**
 * Writes a minimal ESM factory file exporting a default function.
 * Returns the relative path string (e.g., "./my-ext.mjs").
 */
function writeFactoryFile(dir: string, filename: string): string {
  const filePath = join(dir, filename);
  writeFileSync(
    filePath,
    `export default function factory(config) { return {}; }\n`
  );
  return `./${filename}`;
}

/**
 * Builds a minimal valid AgentManifest for use in tests.
 * The entry file must exist at basePath/entry.
 */
function makeManifest(overrides: Partial<AgentManifest> = {}): AgentManifest {
  return {
    name: 'test-agent',
    version: '1.0.0',
    runtime: '@rcrsr/rill@^0.1.0',
    entry: 'agent.rill',
    modules: {},
    extensions: {},
    functions: {},
    assets: [],
    ...overrides,
  };
}

/**
 * Returns ComposeOptions pointing to testDir.
 */
function makeOptions(dir = testDir): ComposeOptions {
  return { basePath: dir, env: {} };
}

// ============================================================
// SUCCESS PATHS
// ============================================================

describe('composeAgent', () => {
  describe('AC-5: returns ComposedAgent with valid RuntimeContext', () => {
    it('returns ComposedAgent with context, ast, modules, and card', async () => {
      writeEntryFile(testDir);
      const manifest = makeManifest();

      const agent = await composeAgent(manifest, makeOptions());

      expect(agent.context).toBeDefined();
      expect(agent.ast).toBeDefined();
      expect(agent.ast.type).toBe('Script');
      expect(agent.modules).toBeDefined();
      expect(agent.card).toBeDefined();
      expect(agent.card.name).toBe('test-agent');
      expect(agent.card.version).toBe('1.0.0');
    });

    it('dispose() resolves without throwing', async () => {
      writeEntryFile(testDir);
      const manifest = makeManifest();

      const agent = await composeAgent(manifest, makeOptions());

      await expect(agent.dispose()).resolves.toBeUndefined();
    });

    it('context has a Map for variables', async () => {
      writeEntryFile(testDir);
      const manifest = makeManifest();

      const agent = await composeAgent(manifest, makeOptions());

      expect(agent.context.variables).toBeInstanceOf(Map);
    });
  });

  describe('AC-10: host.timeout maps to context.timeout', () => {
    it('sets context.timeout to 5000 when manifest.host.timeout is 5000', async () => {
      writeEntryFile(testDir);
      const manifest = makeManifest({
        host: {
          timeout: 5000,
          maxCallStackDepth: 100,
          requireDescriptions: false,
        },
      });

      const agent = await composeAgent(manifest, makeOptions());

      expect(agent.context.timeout).toBe(5000);
    });

    it('context.timeout is undefined when host.timeout is not set', async () => {
      writeEntryFile(testDir);
      const manifest = makeManifest();

      const agent = await composeAgent(manifest, makeOptions());

      expect(agent.context.timeout).toBeUndefined();
    });
  });

  describe('AC-23: extensions: {} succeeds', () => {
    it('composes successfully with no extensions', async () => {
      writeEntryFile(testDir);
      const manifest = makeManifest({ extensions: {} });

      const agent = await composeAgent(manifest, makeOptions());

      expect(agent.card.capabilities).toEqual([]);
    });
  });

  describe('AC-25: modules: {} succeeds', () => {
    it('composes successfully with no modules', async () => {
      writeEntryFile(testDir);
      const manifest = makeManifest({ modules: {} });

      const agent = await composeAgent(manifest, makeOptions());

      expect(agent.modules).toEqual({});
    });
  });

  describe('AC-26: functions: {} succeeds', () => {
    it('composes successfully with no custom functions', async () => {
      writeEntryFile(testDir);
      const manifest = makeManifest({ functions: {} });

      const agent = await composeAgent(manifest, makeOptions());

      expect(agent.context).toBeDefined();
    });
  });

  describe('AC-27: env var resolves to empty string', () => {
    it('empty string env var is a valid resolved value, not an error', async () => {
      writeEntryFile(testDir);
      writeFactoryFile(testDir, 'ext.mjs');

      // Extension config references an env var whose value is "".
      // interpolateEnv only replaces defined env vars, so this must be ""
      // when the env record explicitly maps it to "".
      const manifest = makeManifest({
        extensions: {
          myExt: { package: './ext.mjs', config: { apiKey: '${API_KEY}' } },
        },
      });

      const agent = await composeAgent(manifest, {
        basePath: testDir,
        env: { API_KEY: '' },
      });

      // Composition succeeds — empty string is a valid resolved value.
      expect(agent.context).toBeDefined();
    });
  });

  describe('AC-28: 20 extensions complete within 10s', () => {
    it('composes 20 minimal local extensions within 10000ms', async () => {
      writeEntryFile(testDir);

      // Create 20 minimal factory files and build extension record.
      const extensions: AgentManifest['extensions'] = {};
      for (let i = 0; i < 20; i++) {
        const filename = `ext${i}.mjs`;
        writeFileSync(
          join(testDir, filename),
          `export default function factory(config) { return {}; }\n`
        );
        extensions[`ext${i}`] = { package: `./${filename}`, config: {} };
      }

      const manifest = makeManifest({ extensions });

      const start = Date.now();
      const agent = await composeAgent(manifest, makeOptions());
      const elapsed = Date.now() - start;

      expect(agent.card.capabilities).toHaveLength(20);
      expect(elapsed).toBeLessThan(10000);
    }, 15000);
  });

  // ============================================================
  // ERROR CONDITIONS
  // ============================================================

  describe('EC-1: schema validation fails → ComposeError', () => {
    it('validateManifest throws ComposeError for missing required fields', () => {
      const invalidJson = { name: 123 };

      expect(() => validateManifest(invalidJson)).toThrow(ComposeError);
    });

    it('validateManifest throws ComposeError for invalid version format', () => {
      const invalidJson = {
        name: 'test',
        version: 'not-semver',
        runtime: '@rcrsr/rill@^0.1.0',
        entry: 'agent.rill',
      };

      expect(() => validateManifest(invalidJson)).toThrow(ComposeError);
    });

    it('validateManifest error has validation phase', () => {
      const invalidJson = {};

      let caught: unknown;
      try {
        validateManifest(invalidJson);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ComposeError);
      expect((caught as ComposeError).phase).toBe('validation');
    });
  });

  describe('EC-2: entry file missing → ComposeError', () => {
    it('throws ComposeError when entry .rill file does not exist', async () => {
      // Do NOT create the entry file.
      const manifest = makeManifest({ entry: 'missing.rill' });

      await expect(
        composeAgent(manifest, makeOptions())
      ).rejects.toBeInstanceOf(ComposeError);
    });

    it('error message includes the missing file path', async () => {
      const manifest = makeManifest({ entry: 'missing.rill' });

      const error = await composeAgent(manifest, makeOptions()).catch(
        (e: unknown) => e
      );

      expect(error).toBeInstanceOf(ComposeError);
      expect((error as ComposeError).message).toContain('missing.rill');
    });
  });

  describe('EC-3: extension local path missing → ComposeError', () => {
    it('throws ComposeError when local extension path does not exist', async () => {
      writeEntryFile(testDir);
      const manifest = makeManifest({
        extensions: {
          myExt: { package: './does-not-exist.mjs', config: {} },
        },
      });

      await expect(
        composeAgent(manifest, makeOptions())
      ).rejects.toBeInstanceOf(ComposeError);
    });

    it('error message contains path not found text', async () => {
      writeEntryFile(testDir);
      const manifest = makeManifest({
        extensions: {
          myExt: { package: './does-not-exist.mjs', config: {} },
        },
      });

      const error = await composeAgent(manifest, makeOptions()).catch(
        (e: unknown) => e
      );

      expect((error as ComposeError).message).toContain(
        'Extension path not found'
      );
    });
  });

  describe('EC-4: extension missing factory export → ComposeError', () => {
    it('throws ComposeError when extension file has no default export', async () => {
      writeEntryFile(testDir);
      const filename = 'no-factory.mjs';
      writeFileSync(
        join(testDir, filename),
        `export const notAFactory = 'not-a-function';\n`
      );
      const manifest = makeManifest({
        extensions: {
          myExt: { package: `./${filename}`, config: {} },
        },
      });

      await expect(
        composeAgent(manifest, makeOptions())
      ).rejects.toBeInstanceOf(ComposeError);
    });

    it('error message indicates missing ExtensionFactory export', async () => {
      writeEntryFile(testDir);
      const filename = 'no-factory.mjs';
      writeFileSync(
        join(testDir, filename),
        `export const notAFactory = 'not-a-function';\n`
      );
      const manifest = makeManifest({
        extensions: {
          myExt: { package: `./${filename}`, config: {} },
        },
      });

      const error = await composeAgent(manifest, makeOptions()).catch(
        (e: unknown) => e
      );

      expect((error as ComposeError).message).toContain(
        'does not export a valid ExtensionFactory'
      );
    });
  });

  describe('EC-5: namespace collision → ComposeError (structural analysis)', () => {
    it('two extensions with distinct aliases have distinct namespaces — collision unreachable', async () => {
      // Since namespace = alias (the manifest key), and JSON object keys must be
      // unique, two extensions in the same manifest cannot share a namespace.
      // EC-5 is structurally unreachable via a well-formed AgentManifest.
      // This test documents the invariant: distinct aliases → distinct namespaces.
      writeEntryFile(testDir);
      writeFactoryFile(testDir, 'ext-a.mjs');
      writeFactoryFile(testDir, 'ext-b.mjs');

      const manifest = makeManifest({
        extensions: {
          extA: { package: './ext-a.mjs', config: {} },
          extB: { package: './ext-b.mjs', config: {} },
        },
      });

      const agent = await composeAgent(manifest, makeOptions());

      const namespaces = agent.card.capabilities.map((c) => c.namespace);
      expect(new Set(namespaces).size).toBe(namespaces.length);
    });
  });

  describe('EC-6: function source file missing → ComposeError', () => {
    it('throws ComposeError when custom function .ts source does not exist', async () => {
      writeEntryFile(testDir);
      const manifest = makeManifest({
        functions: { 'app::myFn': './missing-fn.ts' },
      });

      await expect(
        composeAgent(manifest, makeOptions())
      ).rejects.toBeInstanceOf(ComposeError);
    });

    it('error message includes the missing source path', async () => {
      writeEntryFile(testDir);
      const manifest = makeManifest({
        functions: { 'app::myFn': './missing-fn.ts' },
      });

      const error = await composeAgent(manifest, makeOptions()).catch(
        (e: unknown) => e
      );

      expect((error as ComposeError).message).toContain('missing-fn.ts');
    });
  });

  describe('EC-7: function compilation error → ComposeError', () => {
    it('throws ComposeError when function .ts file has a syntax error', async () => {
      writeEntryFile(testDir);
      const badFile = join(testDir, 'bad-fn.ts');
      // Intentional syntax error: unclosed brace
      writeFileSync(badFile, `export const fn = { broken syntax here !!!;\n`);
      const manifest = makeManifest({
        functions: { 'app::myFn': './bad-fn.ts' },
      });

      await expect(
        composeAgent(manifest, makeOptions())
      ).rejects.toBeInstanceOf(ComposeError);
    });

    it('error message contains compilation error text', async () => {
      writeEntryFile(testDir);
      const badFile = join(testDir, 'bad-fn.ts');
      writeFileSync(badFile, `export const fn = { broken syntax here !!!;\n`);
      const manifest = makeManifest({
        functions: { 'app::myFn': './bad-fn.ts' },
      });

      const error = await composeAgent(manifest, makeOptions()).catch(
        (e: unknown) => e
      );

      expect((error as ComposeError).message).toContain('Compilation error');
    });
  });

  describe('EC-8: module file missing → ComposeError', () => {
    it('throws ComposeError when module .rill file does not exist', async () => {
      writeEntryFile(testDir);
      const manifest = makeManifest({
        modules: { utils: './missing-module.rill' },
      });

      await expect(
        composeAgent(manifest, makeOptions())
      ).rejects.toBeInstanceOf(ComposeError);
    });

    it('error message includes the module alias and missing path', async () => {
      writeEntryFile(testDir);
      const manifest = makeManifest({
        modules: { utils: './missing-module.rill' },
      });

      const error = await composeAgent(manifest, makeOptions()).catch(
        (e: unknown) => e
      );

      expect((error as ComposeError).message).toContain('utils');
    });
  });

  describe('EC-9: extension factory throws → ComposeError', () => {
    it('throws ComposeError when extension factory throws during initialization', async () => {
      writeEntryFile(testDir);
      const filename = 'throwing-factory.mjs';
      writeFileSync(
        join(testDir, filename),
        `export default function factory(config) {
  throw new Error('factory initialization failed');
}\n`
      );
      const manifest = makeManifest({
        extensions: {
          badExt: { package: `./${filename}`, config: {} },
        },
      });

      await expect(
        composeAgent(manifest, makeOptions())
      ).rejects.toBeInstanceOf(ComposeError);
    });

    it('error message wraps the original factory error message', async () => {
      writeEntryFile(testDir);
      const filename = 'throwing-factory.mjs';
      writeFileSync(
        join(testDir, filename),
        `export default function factory(config) {
  throw new Error('factory initialization failed');
}\n`
      );
      const manifest = makeManifest({
        extensions: {
          badExt: { package: `./${filename}`, config: {} },
        },
      });

      const error = await composeAgent(manifest, makeOptions()).catch(
        (e: unknown) => e
      );

      expect(error).toBeInstanceOf(ComposeError);
      expect((error as ComposeError).message).toContain(
        'factory initialization failed'
      );
    });

    it('phase is init when factory throws', async () => {
      writeEntryFile(testDir);
      const filename = 'throwing-factory2.mjs';
      writeFileSync(
        join(testDir, filename),
        `export default function factory(config) {
  throw new Error('boom');
}\n`
      );
      const manifest = makeManifest({
        extensions: {
          badExt: { package: `./${filename}`, config: {} },
        },
      });

      const error = await composeAgent(manifest, makeOptions()).catch(
        (e: unknown) => e
      );

      expect((error as ComposeError).phase).toBe('init');
    });
  });

  // ============================================================
  // MODULES LOADING
  // ============================================================

  describe('modules loading', () => {
    it('loads a valid module .rill file and exposes its variables', async () => {
      writeEntryFile(testDir);
      const moduleFile = join(testDir, 'utils.rill');
      writeFileSync(moduleFile, `42 => $answer\n`);
      const manifest = makeManifest({
        modules: { utils: './utils.rill' },
      });

      const agent = await composeAgent(manifest, makeOptions());

      expect(agent.modules['utils']).toBeDefined();
      expect(agent.modules['utils']!['answer']).toBe(42);
    });
  });
});
