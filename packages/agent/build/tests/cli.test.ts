import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateHarness } from '../src/generate.js';

// ============================================================
// PATHS
// ============================================================

const PKG_ROOT = path.dirname(
  fileURLToPath(new URL('../package.json', import.meta.url))
);
const CLI_PATH = path.join(PKG_ROOT, 'dist', 'cli.js');

// ============================================================
// FIXTURES
// ============================================================

const MINIMAL_BUNDLE_JSON_SINGLE = JSON.stringify(
  { agents: { 'solo-agent': {} } },
  null,
  2
);

const MINIMAL_BUNDLE_JSON_MULTI = JSON.stringify(
  {
    agents: {
      'agent-alpha': {},
      'agent-beta': {},
      'agent-gamma': {},
    },
  },
  null,
  2
);

const MINIMAL_HANDLERS_JS = `export const handlers = {};`;

// ============================================================
// TMP DIR HELPERS
// ============================================================

const tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rill-cli-test-'));
  tmpDirs.push(dir);
  return dir;
}

/**
 * Creates a minimal bundle fixture with bundle.json and handlers.js.
 */
async function makeBundleFixture(
  bundleJsonContent: string = MINIMAL_BUNDLE_JSON_SINGLE
): Promise<string> {
  const bundleDir = await makeTmpDir();
  await writeFile(
    path.join(bundleDir, 'bundle.json'),
    bundleJsonContent,
    'utf-8'
  );
  await writeFile(
    path.join(bundleDir, 'handlers.js'),
    MINIMAL_HANDLERS_JS,
    'utf-8'
  );
  return bundleDir;
}

/**
 * Invokes dist/cli.js via spawnSync.
 * Returns { status, stdout, stderr }.
 */
function runCli(args: string[]): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync('node', [CLI_PATH, ...args], {
    encoding: 'utf-8',
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

// ============================================================
// CLI SUCCESS CASES
// ============================================================

describe('CLI integration: success cases', () => {
  // AC-1: --harness http produces valid output file containing createHttpHarness
  it('AC-1: --harness http exits 0 and writes output file', async () => {
    const bundleDir = await makeBundleFixture();

    const result = runCli(['--harness', 'http', bundleDir]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Generated http harness');
    expect(result.stdout).toContain('harness.js');

    const harnessPath = path.join(bundleDir, 'harness.js');
    const content = await readFile(harnessPath, 'utf-8');
    expect(content).toContain('createHttpHarness');
    expect(content).toContain('handlers.js');
  });

  // AC-4: --harness stdio produces valid output file containing createStdioHarness
  it('AC-4: --harness stdio exits 0 and writes output file', async () => {
    const bundleDir = await makeBundleFixture();

    const result = runCli(['--harness', 'stdio', bundleDir]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Generated stdio harness');

    const harnessPath = path.join(bundleDir, 'harness.js');
    const content = await readFile(harnessPath, 'utf-8');
    expect(content).toContain('createStdioHarness');
  });

  // AC-10: --output custom/path.js writes to specified path
  it('AC-10: --output flag writes to custom path', async () => {
    const bundleDir = await makeBundleFixture();
    const outputDir = await makeTmpDir();
    const customOutput = path.join(outputDir, 'my-harness.js');

    const result = runCli([
      '--harness',
      'http',
      '--output',
      customOutput,
      bundleDir,
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(customOutput);

    const content = await readFile(customOutput, 'utf-8');
    expect(content).toContain('createHttpHarness');
  });
});

// ============================================================
// CLI ERROR CASES
// ============================================================

describe('CLI integration: error cases', () => {
  // AC-7: missing --harness flag -> exit 1
  it('AC-7: missing --harness flag exits 1 with error message', () => {
    const result = runCli(['/tmp/some-bundle-dir']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--harness is required');
  });

  // AC-9: invalid harness type -> exit 1, stderr lists valid types
  it('AC-9: invalid harness type exits 1 and stderr lists valid types', async () => {
    const bundleDir = await makeBundleFixture();

    const result = runCli(['--harness', 'turbo', bundleDir]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid harness type');
    expect(result.stderr).toContain('http');
    expect(result.stderr).toContain('stdio');
    expect(result.stderr).toContain('gateway');
    expect(result.stderr).toContain('worker');
  });

  // AC-6: missing bundle dir -> exit 1
  it('AC-6: missing bundle-dir argument exits 1', () => {
    const result = runCli(['--harness', 'http']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('bundle-dir is required');
  });

  // EC-1 via CLI: bundle dir does not exist -> exit 1, stderr contains path
  it('EC-1: non-existent bundle dir exits 1 with path in stderr', () => {
    const missingDir = path.join(
      os.tmpdir(),
      'rill-does-not-exist-' + Date.now()
    );

    const result = runCli(['--harness', 'http', missingDir]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(missingDir);
  });
});

// ============================================================
// PIPELINE INTEGRATION: BOUNDARY CASES
// ============================================================

describe('CLI integration: boundary cases via programmatic API', () => {
  // P3-BC1: single-agent bundle HTTP harness generates successfully [AC-53]
  it('P3-BC1: single-agent bundle generates HTTP harness with agentCount 1 [AC-53]', async () => {
    const bundleDir = await makeBundleFixture(MINIMAL_BUNDLE_JSON_SINGLE);

    const result = await generateHarness(bundleDir, 'http');

    expect(result.agentCount).toBe(1);
    expect(result.harnessType).toBe('http');

    const content = await readFile(result.outputPath, 'utf-8');
    expect(content).toContain('createHttpHarness');
    expect(content).toContain('handlers.js');
  });

  // P3-BC2: multi-agent bundle HTTP harness generates successfully [AC-54]
  it('P3-BC2: multi-agent bundle generates HTTP harness with agentCount 3 [AC-54]', async () => {
    const bundleDir = await makeBundleFixture(MINIMAL_BUNDLE_JSON_MULTI);

    const result = await generateHarness(bundleDir, 'http');

    expect(result.agentCount).toBe(3);
    expect(result.harnessType).toBe('http');

    const content = await readFile(result.outputPath, 'utf-8');
    expect(content).toContain('createHttpHarness');
  });

  // P3-BC4: gateway with single-agent bundle produces gateway template [AC-55]
  it('P3-BC4: gateway harness with single-agent bundle produces gateway template [AC-55]', async () => {
    const bundleDir = await makeBundleFixture(MINIMAL_BUNDLE_JSON_SINGLE);

    const result = await generateHarness(bundleDir, 'gateway');

    expect(result.agentCount).toBe(1);
    expect(result.harnessType).toBe('gateway');

    const content = await readFile(result.outputPath, 'utf-8');
    expect(content).toContain('createGatewayHarness');
    expect(content).toContain('export const handler');
    expect(content).toContain('handlers.js');
  });

  // AC-38/AC-39: full pipeline - stdout reports agent count correctly for single-agent bundle
  it('AC-38/AC-39: CLI stdout reports correct agent count for single-agent bundle', async () => {
    const bundleDir = await makeBundleFixture(MINIMAL_BUNDLE_JSON_SINGLE);

    const result = runCli(['--harness', 'http', bundleDir]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('1 agent(s)');
  });

  // AC-40/AC-41: full pipeline - stdout reports agent count correctly for multi-agent bundle
  it('AC-40/AC-41: CLI stdout reports correct agent count for multi-agent bundle', async () => {
    const bundleDir = await makeBundleFixture(MINIMAL_BUNDLE_JSON_MULTI);

    const result = runCli(['--harness', 'http', bundleDir]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('3 agent(s)');
  });

  // AC-56: output path in stdout matches actual written file location
  it('AC-56: CLI stdout output path matches actual harness.js location', async () => {
    const bundleDir = await makeBundleFixture();
    const expectedPath = path.join(bundleDir, 'harness.js');

    const result = runCli(['--harness', 'http', bundleDir]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(expectedPath);
  });
});
