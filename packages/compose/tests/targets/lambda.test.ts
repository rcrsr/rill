/**
 * Tests for the lambda target builder.
 * Covers AC-2, AC-8, EC-22, EC-23.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from 'vitest';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  readFileSync,
  chmodSync,
  symlinkSync,
  existsSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { lambdaBuilder } from '../../src/targets/lambda.js';
import { ComposeError } from '../../src/errors.js';
import type { BuildContext } from '../../src/targets/index.js';
import type { AgentManifest } from '../../src/schema.js';

// ============================================================
// ESBUILD NODE_MODULES SHIM
// ============================================================
//
// The lambda builder writes the host entry to os.tmpdir() and runs esbuild
// from there (bundle: true, no external). esbuild resolves node_modules by
// walking up from the entry file. From /tmp, it cannot find @rcrsr/rill.
//
// We create a /tmp/node_modules/@rcrsr/rill symlink before tests so esbuild
// can bundle the lambda host entry in the happy-path cases.
//
const TMP_NODE_MODULES_RCRSR = join(tmpdir(), 'node_modules', '@rcrsr');
const TMP_RILL_SYMLINK = join(TMP_NODE_MODULES_RCRSR, 'rill');
const COMPOSE_DIR = dirname(
  fileURLToPath(import.meta.url.replace('/tests/targets/', '/'))
);
const RILL_CORE_PKG = join(COMPOSE_DIR, 'node_modules', '@rcrsr', 'rill');

let createdSymlink = false;

beforeAll(() => {
  if (!existsSync(TMP_RILL_SYMLINK)) {
    mkdirSync(TMP_NODE_MODULES_RCRSR, { recursive: true });
    symlinkSync(RILL_CORE_PKG, TMP_RILL_SYMLINK);
    createdSymlink = true;
  }
});

afterAll(() => {
  if (createdSymlink && existsSync(TMP_RILL_SYMLINK)) {
    rmSync(TMP_RILL_SYMLINK, { force: true });
    // Remove @rcrsr dir only if empty
    try {
      rmSync(TMP_NODE_MODULES_RCRSR, { recursive: false });
    } catch {
      // Not empty — leave it
    }
  }
});

// ============================================================
// TEST SETUP
// ============================================================

let testDir: string;
let manifestDir: string;
let outputDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'lambda-test-'));
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
 * Returns a minimal valid AgentManifest for lambda build tests.
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

/**
 * Lists all entry names in a zip file using the system unzip command.
 * Returns lines from the file listing (trimmed, non-empty).
 */
function listZipEntries(zipPath: string): string {
  return execSync(`unzip -l ${zipPath}`, { encoding: 'utf-8' });
}

// ============================================================
// AC-2: VALID MANIFEST PRODUCES dist.zip WITH REQUIRED CONTENTS
// ============================================================

describe('lambdaBuilder', () => {
  describe('AC-2: valid manifest produces dist.zip with required contents', () => {
    it('produces dist.zip in the output directory', async () => {
      const result = await lambdaBuilder.build(makeContext());

      expect(result.outputPath).toBe(join(outputDir, 'dist.zip'));
    });

    it('dist.zip has non-zero size', async () => {
      await lambdaBuilder.build(makeContext());

      const zipBytes = readFileSync(join(outputDir, 'dist.zip'));
      expect(zipBytes.length).toBeGreaterThan(0);
    });

    it('dist.zip contains host.js', async () => {
      await lambdaBuilder.build(makeContext());

      const listing = listZipEntries(join(outputDir, 'dist.zip'));
      expect(listing).toContain('host.js');
    });

    it('dist.zip contains agent.json', async () => {
      await lambdaBuilder.build(makeContext());

      const listing = listZipEntries(join(outputDir, 'dist.zip'));
      expect(listing).toContain('agent.json');
    });

    it('dist.zip contains .well-known/agent-card.json', async () => {
      await lambdaBuilder.build(makeContext());

      const listing = listZipEntries(join(outputDir, 'dist.zip'));
      expect(listing).toContain('.well-known/agent-card.json');
    });

    it('dist.zip contains the .rill entry file under scripts/', async () => {
      await lambdaBuilder.build(makeContext());

      const listing = listZipEntries(join(outputDir, 'dist.zip'));
      expect(listing).toContain('scripts/agent.rill');
    });

    it('returns BuildResult with target set to lambda', async () => {
      const result = await lambdaBuilder.build(makeContext());

      expect(result.target).toBe('lambda');
    });

    it('returns BuildResult with card containing the agent name', async () => {
      const result = await lambdaBuilder.build(makeContext());

      expect(result.card.name).toBe('test-agent');
    });

    it('returns BuildResult with resolvedManifest containing the agent name', async () => {
      const result = await lambdaBuilder.build(makeContext());

      expect(result.resolvedManifest.name).toBe('test-agent');
    });
  });

  // ============================================================
  // AC-8: DETERMINISTIC OUTPUT
  // ============================================================

  describe('AC-8: identical inputs produce byte-identical output', () => {
    it('two successive builds produce byte-identical dist.zip', async () => {
      const ctx = makeContext();

      // First build
      await lambdaBuilder.build(ctx);
      const firstBytes = readFileSync(join(outputDir, 'dist.zip'));

      // Second build into a separate output directory
      const outputDir2 = join(testDir, 'dist2');
      mkdirSync(outputDir2, { recursive: true });
      const ctx2 = makeContext(makeManifest(), { outputDir: outputDir2 });
      await lambdaBuilder.build(ctx2);
      const secondBytes = readFileSync(join(outputDir2, 'dist.zip'));

      expect(firstBytes.equals(secondBytes)).toBe(true);
    });
  });

  // ============================================================
  // EC-22: OUTPUT DIRECTORY NOT WRITABLE
  // ============================================================

  describe('EC-22: output directory not writable', () => {
    it('throws ComposeError when outputDir has no write permission', async () => {
      chmodSync(outputDir, 0o444);

      await expect(lambdaBuilder.build(makeContext())).rejects.toBeInstanceOf(
        ComposeError
      );
    });

    it('throws ComposeError with correct message for non-writable outputDir', async () => {
      chmodSync(outputDir, 0o444);

      await expect(lambdaBuilder.build(makeContext())).rejects.toMatchObject({
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

      await expect(lambdaBuilder.build(ctx)).rejects.toBeInstanceOf(
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

      await expect(lambdaBuilder.build(ctx)).rejects.toMatchObject({
        message: expect.stringContaining('Build failed:'),
        phase: 'bundling',
      });
    });
  });
});
