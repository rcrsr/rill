/**
 * Tests for LocalBuilder — local target build output.
 * AC-4: Valid manifest → unbundled dist/ with source files, no node_modules/
 * EC-22: Output directory not writable → ComposeError
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  existsSync,
  chmodSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from '../../src/targets/index.js';
import { ComposeError } from '../../src/errors.js';
import type { BuildContext } from '../../src/targets/index.js';

// ============================================================
// TEST SETUP
// ============================================================

let testDir: string;
let manifestDir: string;
let outputDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'local-test-'));
  manifestDir = join(testDir, 'project');
  outputDir = join(testDir, 'dist');
  mkdirSync(manifestDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });
});

afterEach(() => {
  // Restore permissions before cleanup to avoid rmSync failures on locked dirs.
  try {
    chmodSync(outputDir, 0o755);
  } catch {
    // Already writable or already removed — ignore.
  }
  rmSync(testDir, { recursive: true, force: true });
});

// ============================================================
// HELPERS
// ============================================================

const VALID_MANIFEST = {
  name: 'my-agent',
  version: '1.0.0',
  runtime: '@rcrsr/rill@^0.8.0',
  entry: 'main.rill',
  modules: {},
  extensions: {},
  functions: {},
  assets: [],
} as const;

function makeContext(overrides: Partial<BuildContext> = {}): BuildContext {
  return {
    manifest: VALID_MANIFEST,
    extensions: [],
    outputDir,
    manifestDir,
    env: {},
    ...overrides,
  };
}

// ============================================================
// AC-4: Valid manifest produces unbundled dist/
// ============================================================

describe('LocalBuilder', () => {
  describe('valid manifest [AC-4]', () => {
    it('returns outputPath equal to outputDir', async () => {
      const result = await build('local', makeContext());
      expect(result.outputPath).toBe(outputDir);
    });

    it('returns target equal to "local"', async () => {
      const result = await build('local', makeContext());
      expect(result.target).toBe('local');
    });

    it('writes host.ts as source TypeScript (not compiled)', async () => {
      await build('local', makeContext());
      expect(existsSync(join(outputDir, 'host.ts'))).toBe(true);
    });

    it('does NOT write a compiled host.js', async () => {
      await build('local', makeContext());
      expect(existsSync(join(outputDir, 'host.js'))).toBe(false);
    });

    it('copies .rill entry file to scripts/', async () => {
      writeFileSync(join(manifestDir, 'main.rill'), '"hello"');
      await build('local', makeContext());
      expect(existsSync(join(outputDir, 'scripts', 'main.rill'))).toBe(true);
    });

    it('copies nested .rill files preserving directory structure', async () => {
      mkdirSync(join(manifestDir, 'lib'), { recursive: true });
      writeFileSync(join(manifestDir, 'lib', 'util.rill'), '"util"');
      await build('local', makeContext());
      expect(existsSync(join(outputDir, 'scripts', 'lib', 'util.rill'))).toBe(
        true
      );
    });

    it('writes agent.json with resolved manifest', async () => {
      await build('local', makeContext());
      expect(existsSync(join(outputDir, 'agent.json'))).toBe(true);
    });

    it('writes .well-known/agent-card.json', async () => {
      await build('local', makeContext());
      expect(
        existsSync(join(outputDir, '.well-known', 'agent-card.json'))
      ).toBe(true);
    });

    it('returns resolvedManifest with correct name', async () => {
      const result = await build('local', makeContext());
      expect(result.resolvedManifest.name).toBe('my-agent');
    });

    it('returns card with correct name', async () => {
      const result = await build('local', makeContext());
      expect(result.card.name).toBe('my-agent');
    });
  });

  // ============================================================
  // AC-4: node_modules/ absent from output
  // ============================================================

  describe('node_modules/ absent from output [AC-4]', () => {
    it('does NOT create node_modules/ in dist/', async () => {
      // Simulate a project with node_modules — local target must NOT copy it.
      mkdirSync(join(manifestDir, 'node_modules', 'some-pkg'), {
        recursive: true,
      });
      writeFileSync(
        join(manifestDir, 'node_modules', 'some-pkg', 'index.js'),
        'export default {};'
      );

      await build('local', makeContext());

      expect(existsSync(join(outputDir, 'node_modules'))).toBe(false);
    });

    it('does NOT create node_modules/ when none exist in manifestDir', async () => {
      await build('local', makeContext());
      expect(existsSync(join(outputDir, 'node_modules'))).toBe(false);
    });
  });

  // ============================================================
  // EC-22: Output directory not writable
  // ============================================================

  describe('output directory not writable [EC-22]', () => {
    it('throws ComposeError when outputDir is not writable', async () => {
      chmodSync(outputDir, 0o444);
      await expect(build('local', makeContext())).rejects.toThrow(ComposeError);
    });

    it('includes the output path in the error message', async () => {
      chmodSync(outputDir, 0o444);
      try {
        await build('local', makeContext());
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ComposeError);
        const err = e as ComposeError;
        expect(err.message).toContain(
          `Cannot write to output directory: ${outputDir}`
        );
      }
    });

    it('sets phase to "bundling" on write failure', async () => {
      chmodSync(outputDir, 0o444);
      try {
        await build('local', makeContext());
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ComposeError);
        const err = e as ComposeError;
        expect(err.phase).toBe('bundling');
      }
    });
  });
});
