import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateHarness, type HarnessType } from '../src/generate.js';

// ============================================================
// FIXTURES
// ============================================================

const MINIMAL_BUNDLE_JSON = JSON.stringify(
  { agents: { 'test-agent': {} } },
  null,
  2
);

const MINIMAL_HANDLERS_JS = `export const handlers = {};`;

// ============================================================
// TMP DIR HELPERS
// ============================================================

const tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rill-generate-test-'));
  tmpDirs.push(dir);
  return dir;
}

/**
 * Create a bundle fixture with bundle.json and handlers.js.
 * Returns the bundle directory path.
 */
async function makeBundleFixture(
  bundleJsonContent: string = MINIMAL_BUNDLE_JSON
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

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

// ============================================================
// SUCCESS CASES
// ============================================================

describe('generateHarness success cases', () => {
  // ----------------------------------------------------------
  // AC-1: --harness http generates dist/harness.js with HTTP template content
  // ----------------------------------------------------------
  it('generates harness.js with HTTP template content [AC-1]', async () => {
    const bundleDir = await makeBundleFixture();

    const result = await generateHarness(bundleDir, 'http');

    expect(result.outputPath).toBe(path.join(bundleDir, 'harness.js'));
    expect(result.harnessType).toBe('http');

    const content = await readFile(result.outputPath, 'utf-8');
    expect(content).toContain('createHttpHarness');
    expect(content).toContain('handlers.js');
  });

  // ----------------------------------------------------------
  // AC-4: --harness stdio generates stdio template
  // ----------------------------------------------------------
  it('generates harness.js with stdio template content [AC-4]', async () => {
    const bundleDir = await makeBundleFixture();

    const result = await generateHarness(bundleDir, 'stdio');

    expect(result.harnessType).toBe('stdio');

    const content = await readFile(result.outputPath, 'utf-8');
    expect(content).toContain('createStdioHarness');
  });

  // ----------------------------------------------------------
  // AC-6: --harness gateway generates gateway template
  // ----------------------------------------------------------
  it('generates harness.js with gateway template content [AC-6]', async () => {
    const bundleDir = await makeBundleFixture();

    const result = await generateHarness(bundleDir, 'gateway');

    expect(result.harnessType).toBe('gateway');

    const content = await readFile(result.outputPath, 'utf-8');
    expect(content).toContain('createGatewayHarness');
    expect(content).toContain('export const handler');
  });

  // ----------------------------------------------------------
  // AC-8: --harness worker generates worker template
  // ----------------------------------------------------------
  it('generates harness.js with worker template content [AC-8]', async () => {
    const bundleDir = await makeBundleFixture();

    const result = await generateHarness(bundleDir, 'worker');

    expect(result.harnessType).toBe('worker');

    const content = await readFile(result.outputPath, 'utf-8');
    expect(content).toContain('createWorkerHarness');
    expect(content).toContain('export default');
  });

  // ----------------------------------------------------------
  // AC-10: --output custom/path.js writes to specified path
  // ----------------------------------------------------------
  it('writes to a custom output path when outputPath option is set [AC-10]', async () => {
    const bundleDir = await makeBundleFixture();
    const customDir = await makeTmpDir();
    const customOutput = path.join(customDir, 'custom-harness.js');

    const result = await generateHarness(bundleDir, 'http', {
      outputPath: customOutput,
    });

    expect(result.outputPath).toBe(customOutput);

    const content = await readFile(customOutput, 'utf-8');
    expect(content).toContain('createHttpHarness');
  });

  // ----------------------------------------------------------
  // AC-38/39/40/41: agentCount matches bundle.json agents (object)
  // ----------------------------------------------------------
  it('returns agentCount matching agents object keys in bundle.json [AC-38/39/40/41]', async () => {
    const bundleJson = JSON.stringify({
      agents: {
        'agent-1': {},
        'agent-2': {},
        'agent-3': {},
      },
    });
    const bundleDir = await makeBundleFixture(bundleJson);

    const result = await generateHarness(bundleDir, 'http');

    expect(result.agentCount).toBe(3);
  });

  // ----------------------------------------------------------
  // AC-38/39/40/41: agentCount matches bundle.json agents (array)
  // ----------------------------------------------------------
  it('returns agentCount matching agents array length in bundle.json [AC-38/39/40/41]', async () => {
    const bundleJson = JSON.stringify({
      agents: [{ name: 'agent-1' }, { name: 'agent-2' }],
    });
    const bundleDir = await makeBundleFixture(bundleJson);

    const result = await generateHarness(bundleDir, 'http');

    expect(result.agentCount).toBe(2);
  });

  // ----------------------------------------------------------
  // AC-42: Idempotency — calling twice with same args produces identical output
  // ----------------------------------------------------------
  it('produces identical output on repeated calls with same args [AC-42]', async () => {
    const bundleDir = await makeBundleFixture();

    const result1 = await generateHarness(bundleDir, 'http');
    const content1 = await readFile(result1.outputPath, 'utf-8');

    const result2 = await generateHarness(bundleDir, 'http');
    const content2 = await readFile(result2.outputPath, 'utf-8');

    expect(content1).toBe(content2);
    expect(result1.outputPath).toBe(result2.outputPath);
    expect(result1.agentCount).toBe(result2.agentCount);
  });
});

// ============================================================
// ERROR CASES
// ============================================================

describe('generateHarness error cases', () => {
  // ----------------------------------------------------------
  // EC-1: bundle dir missing -> throws Error with path
  // ----------------------------------------------------------
  it('throws Error with path when bundle directory does not exist [EC-1]', async () => {
    const nonExistentDir = path.join(
      os.tmpdir(),
      'rill-does-not-exist-' + Date.now()
    );

    await expect(generateHarness(nonExistentDir, 'http')).rejects.toSatisfy(
      (e: unknown) => {
        return (
          e instanceof Error &&
          e.message.includes('Bundle directory not found') &&
          e.message.includes(nonExistentDir)
        );
      }
    );
  });

  // ----------------------------------------------------------
  // EC-2: bundle.json missing -> throws Error
  // ----------------------------------------------------------
  it('throws Error when bundle.json is missing [EC-2]', async () => {
    const bundleDir = await makeTmpDir();
    // Create handlers.js but no bundle.json
    await writeFile(
      path.join(bundleDir, 'handlers.js'),
      MINIMAL_HANDLERS_JS,
      'utf-8'
    );

    await expect(generateHarness(bundleDir, 'http')).rejects.toSatisfy(
      (e: unknown) => {
        return (
          e instanceof Error && e.message.includes('bundle.json not found')
        );
      }
    );
  });

  // ----------------------------------------------------------
  // EC-3: handlers.js missing -> throws Error
  // ----------------------------------------------------------
  it('throws Error when handlers.js is missing [EC-3]', async () => {
    const bundleDir = await makeTmpDir();
    // Create bundle.json but no handlers.js
    await writeFile(
      path.join(bundleDir, 'bundle.json'),
      MINIMAL_BUNDLE_JSON,
      'utf-8'
    );

    await expect(generateHarness(bundleDir, 'http')).rejects.toSatisfy(
      (e: unknown) => {
        return (
          e instanceof Error && e.message.includes('handlers.js not found')
        );
      }
    );
  });

  // ----------------------------------------------------------
  // EC-4: unknown harness type -> throws Error listing valid types
  // ----------------------------------------------------------
  it('throws Error listing valid types when harness type is invalid [EC-4]', async () => {
    const bundleDir = await makeBundleFixture();

    await expect(
      generateHarness(bundleDir, 'invalid-type' as HarnessType)
    ).rejects.toSatisfy((e: unknown) => {
      return (
        e instanceof Error &&
        e.message.includes('Invalid harness type') &&
        e.message.includes('http') &&
        e.message.includes('stdio') &&
        e.message.includes('gateway') &&
        e.message.includes('worker')
      );
    });
  });

  // ----------------------------------------------------------
  // EC-5: output path not writable -> throws Error with OS error
  // ----------------------------------------------------------
  it('throws Error with OS error when output path parent is not writable [EC-5]', async () => {
    const bundleDir = await makeBundleFixture();

    // Create a read-only directory as the intended parent of the output file.
    const readOnlyParent = await makeTmpDir();
    const blockedOutput = path.join(readOnlyParent, 'subdir', 'harness.js');

    await chmod(readOnlyParent, 0o000);

    try {
      await expect(
        generateHarness(bundleDir, 'http', { outputPath: blockedOutput })
      ).rejects.toSatisfy((e: unknown) => {
        return (
          e instanceof Error && e.message.includes('Cannot write harness to')
        );
      });
    } finally {
      // Restore permissions so afterEach cleanup can remove the dir.
      await chmod(readOnlyParent, 0o755);
    }
  });
});
