/**
 * Tests for the container target builder.
 * Covers AC-1, AC-8, AC-24, EC-22, EC-23, EC-24.
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
import { containerBuilder } from '../../src/targets/container.js';
import { ComposeError } from '../../src/errors.js';
import type { BuildContext } from '../../src/targets/index.js';
import type { AgentManifest } from '../../src/schema.js';

// ============================================================
// TEST SETUP
// ============================================================

let testDir: string;
let manifestDir: string;
let outputDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'container-test-'));
  manifestDir = join(testDir, 'project');
  outputDir = join(testDir, 'dist');
  mkdirSync(manifestDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });
  // Write a minimal .rill entry file in the manifestDir
  writeFileSync(join(manifestDir, 'agent.rill'), '"hello"\n', 'utf-8');
});

afterEach(() => {
  // Restore permissions before cleanup to avoid rmSync failures
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
 * Returns a minimal valid AgentManifest for container build tests.
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
  extra: Partial<Pick<BuildContext, 'outputDir' | 'manifestDir'>> = {}
): BuildContext {
  return {
    manifest,
    extensions: [],
    outputDir: extra.outputDir ?? outputDir,
    manifestDir: extra.manifestDir ?? manifestDir,
    env: {},
  };
}

// ============================================================
// AC-1: VALID MANIFEST PRODUCES REQUIRED ARTIFACTS
// ============================================================

describe('containerBuilder', () => {
  describe('AC-1: valid manifest produces all required artifacts', () => {
    it('produces host.js in the output directory', async () => {
      await containerBuilder.build(makeContext());

      expect(existsSync(join(outputDir, 'host.js'))).toBe(true);
    });

    it('produces agent.json in the output directory', async () => {
      await containerBuilder.build(makeContext());

      expect(existsSync(join(outputDir, 'agent.json'))).toBe(true);
    });

    it('produces scripts/ directory in the output directory', async () => {
      await containerBuilder.build(makeContext());

      expect(existsSync(join(outputDir, 'scripts'))).toBe(true);
    });

    it('copies .rill entry file into scripts/', async () => {
      await containerBuilder.build(makeContext());

      expect(existsSync(join(outputDir, 'scripts', 'agent.rill'))).toBe(true);
    });

    it('produces .well-known/agent-card.json in the output directory', async () => {
      await containerBuilder.build(makeContext());

      expect(
        existsSync(join(outputDir, '.well-known', 'agent-card.json'))
      ).toBe(true);
    });

    it('produces Dockerfile in the output directory', async () => {
      await containerBuilder.build(makeContext());

      expect(existsSync(join(outputDir, 'Dockerfile'))).toBe(true);
    });

    it('produces package.json in the output directory', async () => {
      await containerBuilder.build(makeContext());

      expect(existsSync(join(outputDir, 'package.json'))).toBe(true);
    });

    it('returns BuildResult with outputPath pointing to outputDir', async () => {
      const result = await containerBuilder.build(makeContext());

      expect(result.outputPath).toBe(outputDir);
    });

    it('returns BuildResult with target set to container', async () => {
      const result = await containerBuilder.build(makeContext());

      expect(result.target).toBe('container');
    });

    it('agent.json contains the manifest name and version', async () => {
      await containerBuilder.build(makeContext());

      const raw = readFileSync(join(outputDir, 'agent.json'), 'utf-8');
      const parsed = JSON.parse(raw) as { name: string; version: string };

      expect(parsed.name).toBe('test-agent');
      expect(parsed.version).toBe('1.0.0');
    });

    it('package.json has type set to module', async () => {
      await containerBuilder.build(makeContext());

      const raw = readFileSync(join(outputDir, 'package.json'), 'utf-8');
      const parsed = JSON.parse(raw) as { type: string };

      expect(parsed.type).toBe('module');
    });

    it('agent-card.json contains the agent name', async () => {
      await containerBuilder.build(makeContext());

      const raw = readFileSync(
        join(outputDir, '.well-known', 'agent-card.json'),
        'utf-8'
      );
      const card = JSON.parse(raw) as { name: string };

      expect(card.name).toBe('test-agent');
    });
  });

  // ============================================================
  // AC-8: DETERMINISTIC OUTPUT
  // ============================================================

  describe('AC-8: identical inputs produce byte-identical output', () => {
    it('two successive builds produce equivalent host.js content', async () => {
      const ctx = makeContext();

      // First build
      await containerBuilder.build(ctx);
      const firstContents = readFileSync(join(outputDir, 'host.js'));

      // Second build into a separate output directory
      const outputDir2 = join(testDir, 'dist2');
      mkdirSync(outputDir2, { recursive: true });
      const ctx2 = makeContext(makeManifest(), { outputDir: outputDir2 });
      await containerBuilder.build(ctx2);
      const secondContents = readFileSync(join(outputDir2, 'host.js'));

      // Normalize by stripping comment lines that may contain non-deterministic metadata
      const normalize = (buf: Buffer): string =>
        buf
          .toString('utf-8')
          .split('\n')
          .filter((line) => !line.trimStart().startsWith('//'))
          .join('\n');

      expect(normalize(firstContents)).toEqual(normalize(secondContents));
    });

    it('two successive builds produce byte-identical Dockerfile', async () => {
      const ctx = makeContext();

      await containerBuilder.build(ctx);
      const first = readFileSync(join(outputDir, 'Dockerfile'), 'utf-8');

      const outputDir2 = join(testDir, 'dist2');
      mkdirSync(outputDir2, { recursive: true });
      const ctx2 = makeContext(makeManifest(), { outputDir: outputDir2 });
      await containerBuilder.build(ctx2);
      const second = readFileSync(join(outputDir2, 'Dockerfile'), 'utf-8');

      expect(first).toBe(second);
    });

    it('two successive builds produce byte-identical agent.json', async () => {
      const ctx = makeContext();

      await containerBuilder.build(ctx);
      const first = readFileSync(join(outputDir, 'agent.json'), 'utf-8');

      const outputDir2 = join(testDir, 'dist2');
      mkdirSync(outputDir2, { recursive: true });
      const ctx2 = makeContext(makeManifest(), { outputDir: outputDir2 });
      await containerBuilder.build(ctx2);
      const second = readFileSync(join(outputDir2, 'agent.json'), 'utf-8');

      expect(first).toBe(second);
    });
  });

  // ============================================================
  // AC-24: ASSET GLOB MATCHING 0 FILES
  // ============================================================

  describe('AC-24: asset glob matching 0 files', () => {
    it('build completes when asset glob matches no files', async () => {
      const manifest = makeManifest({ assets: ['**/*.png'] });
      const ctx = makeContext(manifest);

      // Should not throw
      await expect(containerBuilder.build(ctx)).resolves.toBeDefined();
    });

    it('produces all required artifacts when asset glob matches 0 files', async () => {
      const manifest = makeManifest({ assets: ['**/*.png'] });
      await containerBuilder.build(makeContext(manifest));

      expect(existsSync(join(outputDir, 'host.js'))).toBe(true);
      expect(existsSync(join(outputDir, 'agent.json'))).toBe(true);
      expect(existsSync(join(outputDir, 'Dockerfile'))).toBe(true);
      expect(existsSync(join(outputDir, 'package.json'))).toBe(true);
      expect(
        existsSync(join(outputDir, '.well-known', 'agent-card.json'))
      ).toBe(true);
    });

    it('prints warning to stderr when asset glob matches 0 files', async () => {
      const stderrChunks: string[] = [];
      const original = process.stderr.write.bind(process.stderr);
      process.stderr.write = (chunk: unknown, ...args: unknown[]): boolean => {
        stderrChunks.push(String(chunk));
        return original(
          chunk,
          ...(args as Parameters<typeof original>).slice(1)
        );
      };

      try {
        const manifest = makeManifest({ assets: ['**/*.png'] });
        await containerBuilder.build(makeContext(manifest));
      } finally {
        process.stderr.write = original;
      }

      const combined = stderrChunks.join('');
      expect(combined).toContain('**/*.png');
      expect(combined).toContain('matched 0 files');
    });
  });

  // ============================================================
  // EC-22: OUTPUT DIRECTORY NOT WRITABLE
  // ============================================================

  describe('EC-22: output directory not writable', () => {
    it('throws ComposeError when outputDir has no write permission', async () => {
      chmodSync(outputDir, 0o444);

      await expect(
        containerBuilder.build(makeContext())
      ).rejects.toBeInstanceOf(ComposeError);
    });

    it('throws ComposeError with correct message for non-writable outputDir', async () => {
      chmodSync(outputDir, 0o444);

      await expect(containerBuilder.build(makeContext())).rejects.toMatchObject(
        {
          message: `Cannot write to output directory: ${outputDir}`,
          phase: 'bundling',
        }
      );
    });
  });

  // ============================================================
  // EC-23: ESBUILD COMPILATION FAILURE
  // ============================================================

  describe('EC-23: esbuild compilation failure', () => {
    it('throws ComposeError when extension alias produces unresolvable import', async () => {
      // Provide a ResolvedExtension whose alias generates an unresolvable
      // bare import specifier in the host.ts. esbuild bundles eagerly and
      // fails when it cannot locate "unresolvable-pkg-xyz".
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

      await expect(containerBuilder.build(ctx)).rejects.toBeInstanceOf(
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

      await expect(containerBuilder.build(ctx)).rejects.toMatchObject({
        message: expect.stringContaining('Build failed:'),
        phase: 'bundling',
      });
    });
  });

  // ============================================================
  // EC-24: DOCKERFILE TEMPLATE ERROR
  // ============================================================

  describe('EC-24: Dockerfile template error', () => {
    it('throws ComposeError when Dockerfile path is a directory', async () => {
      mkdirSync(join(outputDir, 'Dockerfile'), { recursive: true });

      await expect(
        containerBuilder.build(makeContext())
      ).rejects.toBeInstanceOf(ComposeError);
    });

    it('throws ComposeError with phase bundling and message starting with Failed to generate Dockerfile:', async () => {
      mkdirSync(join(outputDir, 'Dockerfile'), { recursive: true });

      await expect(containerBuilder.build(makeContext())).rejects.toMatchObject(
        {
          phase: 'bundling',
          message: expect.stringContaining('Failed to generate Dockerfile:'),
        }
      );
    });
  });

  // ============================================================
  // LOCAL EXTENSION BUNDLING
  // ============================================================

  describe('local extension bundling: source is inlined into host.js', () => {
    it('bundles a local extension into host.js via resolvedPath', async () => {
      // Write a local extension file with a unique sentinel string that esbuild
      // will inline when bundling. The sentinel lets us confirm the file was
      // bundled rather than left as an unresolved import.
      const localExtPath = join(manifestDir, 'myext.js');
      const sentinel = '__LOCAL_EXT_SENTINEL_D2__';
      writeFileSync(
        localExtPath,
        `export default function factory() { const id = '${sentinel}'; return { ping: () => id }; }\n`,
        'utf-8'
      );

      const ctx: BuildContext = {
        manifest: makeManifest(),
        extensions: [
          {
            alias: 'myExt',
            namespace: 'myExt',
            strategy: 'local',
            factory: () => ({}),
            resolvedPath: localExtPath,
            config: {},
          },
        ],
        outputDir,
        manifestDir,
        env: {},
      };

      await containerBuilder.build(ctx);

      const hostJs = readFileSync(join(outputDir, 'host.js'), 'utf-8');
      expect(hostJs).toContain(sentinel);
    });
  });

  // ============================================================
  // AC-7: INDEPENDENT BUILDS FROM DIFFERENT MANIFESTS
  // ============================================================

  describe('AC-7: two manifests referencing same script build independently', () => {
    it('each manifest produces valid artifacts in its own output directory', async () => {
      const manifestA = makeManifest({ name: 'agent-a', version: '1.0.0' });
      const manifestB = makeManifest({ name: 'agent-b', version: '2.0.0' });

      const outputDirA = join(testDir, 'dist-a');
      const outputDirB = join(testDir, 'dist-b');
      mkdirSync(outputDirA, { recursive: true });
      mkdirSync(outputDirB, { recursive: true });

      // Both manifests reference the same agent.rill script in manifestDir
      await containerBuilder.build(
        makeContext(manifestA, { outputDir: outputDirA })
      );
      await containerBuilder.build(
        makeContext(manifestB, { outputDir: outputDirB })
      );

      // Both output dirs contain independent valid artifacts
      expect(existsSync(join(outputDirA, 'host.js'))).toBe(true);
      expect(existsSync(join(outputDirA, 'agent.json'))).toBe(true);
      expect(existsSync(join(outputDirB, 'host.js'))).toBe(true);
      expect(existsSync(join(outputDirB, 'agent.json'))).toBe(true);

      // agent.json files reflect their respective manifest names — artifacts are distinct
      const cardA = JSON.parse(
        readFileSync(join(outputDirA, 'agent.json'), 'utf-8')
      ) as { name: string; version: string };
      const cardB = JSON.parse(
        readFileSync(join(outputDirB, 'agent.json'), 'utf-8')
      ) as { name: string; version: string };

      expect(cardA.name).toBe('agent-a');
      expect(cardA.version).toBe('1.0.0');
      expect(cardB.name).toBe('agent-b');
      expect(cardB.version).toBe('2.0.0');
    });
  });

  // ============================================================
  // AC-31: CONCURRENT BUILDS TO DIFFERENT OUTPUT DIRS
  // ============================================================

  describe('AC-31: concurrent builds to different output dirs both succeed', () => {
    it('Promise.all resolves both builds without interference (same manifest name)', async () => {
      // Both builds use the same manifest name to verify the UUID suffix on the
      // temp entry file prevents collision when builds run concurrently.
      const manifestA = makeManifest({
        name: 'concurrent-agent',
        version: '1.0.0',
      });
      const manifestB = makeManifest({
        name: 'concurrent-agent',
        version: '1.0.0',
      });

      const outputDirA = join(testDir, 'concurrent-dist-a');
      const outputDirB = join(testDir, 'concurrent-dist-b');
      mkdirSync(outputDirA, { recursive: true });
      mkdirSync(outputDirB, { recursive: true });

      const [resultA, resultB] = await Promise.all([
        containerBuilder.build(
          makeContext(manifestA, { outputDir: outputDirA })
        ),
        containerBuilder.build(
          makeContext(manifestB, { outputDir: outputDirB })
        ),
      ]);

      expect(resultA.outputPath).toBe(outputDirA);
      expect(resultA.target).toBe('container');
      expect(resultB.outputPath).toBe(outputDirB);
      expect(resultB.target).toBe('container');

      // Both output dirs contain independent valid artifacts
      expect(existsSync(join(outputDirA, 'host.js'))).toBe(true);
      expect(existsSync(join(outputDirB, 'host.js'))).toBe(true);
    });
  });
});
