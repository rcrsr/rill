/**
 * Tests for the lambda target builder.
 * Covers AC-2, AC-8, EC-22, EC-23.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  readFileSync,
  chmodSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { lambdaBuilder } from '../../src/targets/lambda.js';
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

/**
 * Extracts and decompresses all non-directory entries from a zip buffer.
 * Returns a Map of entry name → decompressed content.
 * Uses the zip central directory for reliable offset resolution.
 */
function extractZipEntries(buf: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  // Locate End of Central Directory record (signature 0x06054b50)
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return entries;

  const cdOffset = buf.readUInt32LE(eocd + 16);
  const cdCount = buf.readUInt16LE(eocd + 8);

  let pos = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    const method = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf-8', pos + 46, pos + 46 + nameLen);

    // Skip directory entries
    if (!name.endsWith('/')) {
      const localNameLen = buf.readUInt16LE(localOffset + 26);
      const localExtraLen = buf.readUInt16LE(localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLen + localExtraLen;
      const compressed = buf.subarray(dataOffset, dataOffset + compressedSize);
      // method 8 = DEFLATE (used by archiver zlib level 9)
      const content = method === 8 ? inflateRawSync(compressed) : compressed;
      entries.set(name, content);
    }

    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Normalizes JS content by stripping full-line comments.
 * Removes non-deterministic metadata (e.g., debug IDs) that bundlers
 * embed in comment lines between builds.
 */
function normalizeJs(buf: Buffer): string {
  return buf
    .toString('utf-8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
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
    it('two successive builds produce equivalent dist.zip content', async () => {
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

      const e1 = extractZipEntries(firstBytes);
      const e2 = extractZipEntries(secondBytes);

      // Same set of entry names
      expect([...e1.keys()].sort()).toEqual([...e2.keys()].sort());

      // Same content per entry — normalize .js to strip non-deterministic comment lines
      for (const [name, content1] of e1) {
        const content2 = e2.get(name)!;
        if (name.endsWith('.js')) {
          expect(normalizeJs(content1)).toEqual(normalizeJs(content2));
        } else {
          expect(content1.equals(content2)).toBe(true);
        }
      }
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
