/**
 * Tests for the worker target builder.
 * Covers AC-3, EC-20, EC-21, EC-22, EC-23.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  existsSync,
  readFileSync,
  chmodSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { workerBuilder } from '../../src/targets/worker.js';
import { ComposeError } from '../../src/errors.js';
import type { BuildContext } from '../../src/targets/index.js';
import type { AgentManifest } from '../../src/schema.js';
import type { ResolvedExtension } from '../../src/resolve.js';

// ============================================================
// TEST SETUP
// ============================================================

let testDir: string;
let manifestDir: string;
let outputDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'worker-test-'));
  manifestDir = join(testDir, 'project');
  outputDir = join(testDir, 'dist');
  mkdirSync(manifestDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(manifestDir, 'agent.rill'), '"hello"\n', 'utf-8');
});

afterEach(() => {
  try {
    chmodSync(outputDir, 0o755);
  } catch {
    // outputDir may have been removed or never created
  }
  rmSync(testDir, { recursive: true, force: true });
});

// ============================================================
// HELPERS
// ============================================================

/**
 * Returns a minimal valid AgentManifest for worker build tests.
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
 * Returns a BuildContext wired to the test temp directories.
 */
function makeContext(
  manifest: AgentManifest = makeManifest(),
  extra: Partial<
    Pick<BuildContext, 'outputDir' | 'manifestDir' | 'extensions'>
  > = {}
): BuildContext {
  return {
    manifest,
    extensions: extra.extensions ?? [],
    outputDir: extra.outputDir ?? outputDir,
    manifestDir: extra.manifestDir ?? manifestDir,
    env: {},
  };
}

/**
 * Creates a ResolvedExtension with a local JS entry file that imports
 * a Node.js built-in. Sets factory.__source so compat.ts resolvePackageDir()
 * can derive the package directory.
 */
function makeIncompatibleExtension(
  namespace: string,
  entryFilePath: string
): ResolvedExtension {
  const factory = function factory() {
    return {};
  } as unknown as ResolvedExtension['factory'];
  (factory as unknown as Record<string, unknown>)['__source'] = entryFilePath;

  return {
    alias: namespace,
    namespace,
    strategy: 'local',
    factory,
    config: {},
  };
}

// ============================================================
// AC-3: VALID MANIFEST PRODUCES dist/worker.js AS SINGLE ESM BUNDLE
// ============================================================

describe('workerBuilder', () => {
  describe('AC-3: valid manifest produces dist/worker.js as single ESM bundle', () => {
    it('produces worker.js in the output directory', async () => {
      await workerBuilder.build(makeContext());

      expect(existsSync(join(outputDir, 'worker.js'))).toBe(true);
    });

    it('produces agent.json in the output directory', async () => {
      await workerBuilder.build(makeContext());

      expect(existsSync(join(outputDir, 'agent.json'))).toBe(true);
    });

    it('produces .well-known/agent-card.json in the output directory', async () => {
      await workerBuilder.build(makeContext());

      expect(
        existsSync(join(outputDir, '.well-known', 'agent-card.json'))
      ).toBe(true);
    });

    it('does NOT produce Dockerfile (worker is not a container)', async () => {
      await workerBuilder.build(makeContext());

      expect(existsSync(join(outputDir, 'Dockerfile'))).toBe(false);
    });

    it('does NOT produce node_modules/ (all deps inlined)', async () => {
      await workerBuilder.build(makeContext());

      expect(existsSync(join(outputDir, 'node_modules'))).toBe(false);
    });

    it('returns BuildResult with outputPath pointing to outputDir', async () => {
      const result = await workerBuilder.build(makeContext());

      expect(result.outputPath).toBe(outputDir);
    });

    it('returns BuildResult with target set to worker', async () => {
      const result = await workerBuilder.build(makeContext());

      expect(result.target).toBe('worker');
    });

    it('agent.json contains the manifest name and version', async () => {
      await workerBuilder.build(makeContext());

      const raw = readFileSync(join(outputDir, 'agent.json'), 'utf-8');
      const parsed = JSON.parse(raw) as { name: string; version: string };

      expect(parsed.name).toBe('test-agent');
      expect(parsed.version).toBe('1.0.0');
    });

    it('agent-card.json contains the agent name', async () => {
      await workerBuilder.build(makeContext());

      const raw = readFileSync(
        join(outputDir, '.well-known', 'agent-card.json'),
        'utf-8'
      );
      const card = JSON.parse(raw) as { name: string };

      expect(card.name).toBe('test-agent');
    });

    it('worker.js contains ESM export default syntax', async () => {
      await workerBuilder.build(makeContext());

      const contents = readFileSync(join(outputDir, 'worker.js'), 'utf-8');

      // ESM bundle from esbuild with format:'esm' should export a default handler
      expect(contents).toContain('export');
    });
  });

  // ============================================================
  // EC-20 / EC-21: INCOMPATIBLE EXTENSIONS BLOCKED BEFORE BUNDLING
  // ============================================================

  describe('EC-20/EC-21: incompatible extensions blocked before bundling', () => {
    it('throws ComposeError before bundling for extension with native dep (binding.gyp)', async () => {
      // Create a fake local package directory with binding.gyp
      const fakePkgDir = join(testDir, 'fake-native-ext');
      mkdirSync(fakePkgDir, { recursive: true });
      writeFileSync(join(fakePkgDir, 'binding.gyp'), '{}', 'utf-8');
      writeFileSync(
        join(fakePkgDir, 'package.json'),
        JSON.stringify({ name: 'fake-native-ext', version: '1.0.0' }),
        'utf-8'
      );
      const entryFile = join(fakePkgDir, 'index.js');
      writeFileSync(
        entryFile,
        'export default function factory() { return {}; }\n',
        'utf-8'
      );

      const ext = makeIncompatibleExtension('fake-native-ext', entryFile);
      const ctx = makeContext(makeManifest(), { extensions: [ext] });

      const error = await workerBuilder.build(ctx).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ComposeError);
      expect((error as ComposeError).phase).toBe('compatibility');
      // worker.js must NOT have been written — blocked before bundling
      expect(existsSync(join(outputDir, 'worker.js'))).toBe(false);
    });

    it('throws ComposeError before bundling for extension importing node:fs', async () => {
      const fakePkgDir = join(testDir, 'fake-fs-ext');
      mkdirSync(fakePkgDir, { recursive: true });
      const entryFile = join(fakePkgDir, 'index.js');
      writeFileSync(
        entryFile,
        "import fs from 'node:fs';\nexport default function factory() { return { readFile: fs.readFile }; }\n",
        'utf-8'
      );

      const ext = makeIncompatibleExtension('fake-fs-ext', entryFile);
      const ctx = makeContext(makeManifest(), { extensions: [ext] });

      const error = await workerBuilder.build(ctx).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ComposeError);
      expect((error as ComposeError).phase).toBe('compatibility');
      expect(existsSync(join(outputDir, 'worker.js'))).toBe(false);
    });

    it('throws ComposeError with phase compatibility (not bundling) for incompatible extension', async () => {
      const fakePkgDir = join(testDir, 'fake-path-ext');
      mkdirSync(fakePkgDir, { recursive: true });
      const entryFile = join(fakePkgDir, 'index.js');
      writeFileSync(
        entryFile,
        "import path from 'node:path';\nexport default function factory() { return { join: path.join }; }\n",
        'utf-8'
      );

      const ext = makeIncompatibleExtension('fake-path-ext', entryFile);
      const ctx = makeContext(makeManifest(), { extensions: [ext] });

      await expect(workerBuilder.build(ctx)).rejects.toMatchObject({
        phase: 'compatibility',
      });
    });
  });

  // ============================================================
  // EC-22: OUTPUT DIRECTORY NOT WRITABLE
  // ============================================================

  describe('EC-22: output directory not writable', () => {
    it('throws ComposeError when outputDir has no write permission', async () => {
      chmodSync(outputDir, 0o444);

      await expect(workerBuilder.build(makeContext())).rejects.toBeInstanceOf(
        ComposeError
      );
    });

    it('throws ComposeError with correct message for non-writable outputDir', async () => {
      chmodSync(outputDir, 0o444);

      await expect(workerBuilder.build(makeContext())).rejects.toMatchObject({
        message: `Cannot write to output directory: ${outputDir}`,
        phase: 'bundling',
      });
    });
  });

  // ============================================================
  // EC-23: ESBUILD COMPILATION FAILURE
  // ============================================================

  describe('EC-23: esbuild compilation failure', () => {
    it('throws ComposeError when extension alias produces unresolvable import', async () => {
      const ctx: BuildContext = {
        manifest: makeManifest(),
        extensions: [
          {
            alias: 'unresolvable-pkg-xyz',
            namespace: 'unresolvable-pkg-xyz',
            strategy: 'npm',
            factory: () => ({}),
            config: {},
            resolvedVersion: '1.0.0',
          },
        ],
        outputDir,
        manifestDir,
        env: {},
      };

      await expect(workerBuilder.build(ctx)).rejects.toBeInstanceOf(
        ComposeError
      );
    });

    it('throws ComposeError with Build failed: prefix for esbuild error', async () => {
      const ctx: BuildContext = {
        manifest: makeManifest(),
        extensions: [
          {
            alias: 'unresolvable-pkg-xyz',
            namespace: 'unresolvable-pkg-xyz',
            strategy: 'npm',
            factory: () => ({}),
            config: {},
            resolvedVersion: '1.0.0',
          },
        ],
        outputDir,
        manifestDir,
        env: {},
      };

      await expect(workerBuilder.build(ctx)).rejects.toMatchObject({
        message: expect.stringContaining('Build failed:'),
        phase: 'bundling',
      });
    });
  });
});
