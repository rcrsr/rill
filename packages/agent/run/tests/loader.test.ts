import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBundle } from '@rcrsr/rill-agent-bundle';
import { loadBundle } from '../src/loader.js';

// Bundle output must be under the run package root so that handlers.js
// can resolve @rcrsr/rill-agent-harness via the package's node_modules.
const PKG_ROOT = path.dirname(
  fileURLToPath(new URL('../package.json', import.meta.url))
);
const BUNDLES_BASE = path.join(PKG_ROOT, '.test-bundles');

// ============================================================
// MINIMAL AGENT MANIFEST TEMPLATE
// ============================================================

function makeManifest(name: string): Record<string, unknown> {
  return {
    name,
    version: '0.1.0',
    runtime: '@rcrsr/rill@*',
    entry: 'main.rill',
    extensions: {},
    modules: {},
    functions: {},
    assets: [],
    skills: [],
  };
}

// ============================================================
// TEMP DIR MANAGEMENT
// ============================================================

const tmpDirs: string[] = [];

async function makeTmpDir(base: string = PKG_ROOT): Promise<string> {
  const dir = await mkdtemp(path.join(base, 'loader-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

// ============================================================
// BUNDLE FIXTURE HELPER (for AC-59 success case)
// ============================================================

async function makeBundle(
  script: string,
  agentName = 'test-agent'
): Promise<string> {
  const fixtureDir = await makeTmpDir(PKG_ROOT);
  const bundleDir = await makeTmpDir(BUNDLES_BASE);

  await writeFile(
    path.join(fixtureDir, 'agent.json'),
    JSON.stringify(makeManifest(agentName), null, 2),
    'utf-8'
  );
  await writeFile(path.join(fixtureDir, 'main.rill'), script, 'utf-8');

  await buildBundle(path.join(fixtureDir, 'agent.json'), {
    outputDir: bundleDir,
  });

  return bundleDir;
}

// ============================================================
// MINIMAL BUNDLE.JSON FOR MANUAL FIXTURES
// ============================================================

function makeMinimalBundleJson(agentName: string): string {
  return JSON.stringify({
    name: 'test',
    version: '0.1.0',
    built: '',
    checksum: '',
    rillVersion: '',
    agents: {
      [agentName]: {
        entry: 'entry.rill',
        modules: {},
        extensions: {},
        card: { name: agentName },
      },
    },
  });
}

// ============================================================
// ERROR CASES
// ============================================================

describe('loadBundle error cases', () => {
  // EC-19: bundle dir missing → Error with path
  it('EC-19: missing bundle dir throws Error containing the path', async () => {
    const missingDir = path.join(
      PKG_ROOT,
      '.test-bundles',
      'does-not-exist-ec19'
    );

    await expect(loadBundle(missingDir)).rejects.toThrow(missingDir);
  });

  // EC-20: invalid JSON in bundle.json → Error with parse error detail
  it('EC-20: invalid bundle.json JSON throws Error with parse error detail', async () => {
    const bundleDir = await makeTmpDir();

    await writeFile(
      path.join(bundleDir, 'bundle.json'),
      'not-valid-json',
      'utf-8'
    );

    await expect(loadBundle(bundleDir)).rejects.toThrow('Invalid bundle.json');
  });

  // EC-20: bundle.json schema mismatch → Error
  it('EC-20: bundle.json schema mismatch throws Error', async () => {
    const bundleDir = await makeTmpDir();

    await writeFile(
      path.join(bundleDir, 'bundle.json'),
      JSON.stringify({ name: 'incomplete' }),
      'utf-8'
    );

    await expect(loadBundle(bundleDir)).rejects.toThrow('Invalid bundle.json');
  });

  // EC-21: agent not in bundle → Error with available agent names
  it('EC-21: unknown agent name throws Error containing available agent names', async () => {
    const bundleDir = await makeTmpDir();

    await writeFile(
      path.join(bundleDir, 'bundle.json'),
      makeMinimalBundleJson('known-agent'),
      'utf-8'
    );

    await expect(loadBundle(bundleDir, 'unknown-agent')).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error &&
        e.message.includes('unknown-agent') &&
        e.message.includes('known-agent')
    );
  });

  // EC-22: entry.rill missing → Error with file path
  it('EC-22: missing entry.rill throws Error containing the entry file path', async () => {
    const bundleDir = await makeTmpDir();

    await writeFile(
      path.join(bundleDir, 'bundle.json'),
      makeMinimalBundleJson('test-agent'),
      'utf-8'
    );
    // Create the agent directory but do NOT create entry.rill
    await mkdir(path.join(bundleDir, 'agents', 'test-agent'), {
      recursive: true,
    });

    const expectedEntryPath = path.join(
      bundleDir,
      'agents',
      'test-agent',
      'entry.rill'
    );

    await expect(loadBundle(bundleDir, 'test-agent')).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error && e.message.includes(expectedEntryPath)
    );
  });
});

// ============================================================
// SUCCESS CASES
// ============================================================

describe('loadBundle success cases', () => {
  // AC-59: single agent in bundle, no name arg → auto-select
  it('AC-59: single agent and no agentName → auto-selects the agent', async () => {
    const bundleDir = await makeBundle('"hello world"', 'solo-agent');

    const result = await loadBundle(bundleDir);

    expect(result.agentName).toBe('solo-agent');
    expect(typeof result.handler).toBe('function');
    expect(result.bundleEntry).toBeDefined();
    expect(result.bundleEntry.entry).toBe('entry.rill');
  });
});
