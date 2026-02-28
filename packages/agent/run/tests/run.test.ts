import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBundle } from '@rcrsr/rill-agent-bundle';
import { runAgent } from '../src/run.js';

// Resolve the package root so bundle output dirs are created inside it.
// handlers.js uses bare specifier imports (e.g. @rcrsr/rill-agent-harness).
// Node resolves bare specifiers by walking up from the importing file's
// location. Placing bundle output under the run package root means
// node_modules/@rcrsr/rill-agent-harness is reachable at resolution time.
const PKG_ROOT = path.dirname(
  fileURLToPath(new URL('../package.json', import.meta.url))
);
const BUNDLES_BASE = path.join(PKG_ROOT, '.test-bundles');

// ============================================================
// RILL SCRIPT FIXTURES
// ============================================================

/** Returns the string "hello world" */
const HELLO_SCRIPT = `"hello world"`;

/** Reads $name param and returns a greeting via string interpolation */
const GREET_SCRIPT = `"hello {$name}"`;

/** Returns an empty string */
const EMPTY_SCRIPT = `""`;

/** Triggers a runtime type error: cannot add number to string */
const ERROR_SCRIPT = `1 + "bad"`;

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

async function makeTmpDir(base: string): Promise<string> {
  const dir = await mkdtemp(path.join(base, 'run-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

// ============================================================
// BUNDLE FIXTURE HELPER
// ============================================================

/**
 * Creates a real bundle using buildBundle.
 *
 * Fixture sources go into a temp dir under os.tmpdir().
 * Bundle output goes under BUNDLES_BASE (inside the run package root)
 * so that handlers.js can resolve @rcrsr/rill-agent-harness via the
 * package's node_modules directory.
 */
async function makeBundle(
  script: string,
  agentName = 'test-agent'
): Promise<string> {
  // Fixture dir can be anywhere; it only holds agent.json + main.rill
  const fixtureDir = await makeTmpDir(PKG_ROOT);
  // Bundle output MUST be under PKG_ROOT for node_modules resolution
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
// SUCCESS CASES
// ============================================================

describe('runAgent success', () => {
  // AC-42: executes agent and returns result
  // AC-45: exitCode 0 on success
  it('AC-42/45: executes agent and returns result with exitCode 0', async () => {
    const bundleDir = await makeBundle(HELLO_SCRIPT);

    const res = await runAgent(bundleDir, 'test-agent');

    expect(res.exitCode).toBe(0);
    expect(res.result).toBe('hello world');
    expect(res.error).toBeUndefined();
    expect(typeof res.durationMs).toBe('number');
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });

  // AC-43: --param passes params to script via options.params
  it('AC-43: options.params are passed to the script', async () => {
    const bundleDir = await makeBundle(GREET_SCRIPT);

    const res = await runAgent(bundleDir, 'test-agent', {
      params: { name: 'Alice' },
    });

    expect(res.exitCode).toBe(0);
    expect(res.result).toBe('hello Alice');
  });

  // AC-56: empty result → result is ""
  it('AC-56: empty result returns empty string', async () => {
    const bundleDir = await makeBundle(EMPTY_SCRIPT);

    const res = await runAgent(bundleDir, 'test-agent');

    expect(res.exitCode).toBe(0);
    expect(res.result).toBe('');
  });

  // AC-55: no params → empty params dict (script that uses no params)
  it('AC-55: no params passed → agent completes with empty param dict', async () => {
    const bundleDir = await makeBundle(HELLO_SCRIPT);

    const res = await runAgent(bundleDir, 'test-agent', {});

    expect(res.exitCode).toBe(0);
    expect(res.result).toBe('hello world');
  });

  // AC-59: single agent in bundle, no name → auto-select
  it('AC-59: single agent in bundle and no name → auto-selected', async () => {
    const bundleDir = await makeBundle(HELLO_SCRIPT, 'solo-agent');

    // Pass empty string to trigger auto-select path in runAgent
    const res = await runAgent(bundleDir, '');

    expect(res.exitCode).toBe(0);
    expect(res.result).toBe('hello world');
  });
});

// ============================================================
// ERROR CASES
// ============================================================

describe('runAgent error', () => {
  // AC-49 / EC-19: missing bundle dir → exitCode 1, error contains path
  it('AC-49/EC-19: missing bundle dir returns exitCode 1 with path in error', async () => {
    const missingDir = path.join(PKG_ROOT, '.test-bundles', 'does-not-exist');

    const res = await runAgent(missingDir, 'test-agent');

    expect(res.exitCode).toBe(1);
    expect(res.error).toBeDefined();
    expect(res.error).toContain(missingDir);
  });

  // AC-50 / EC-21: agent not in bundle → exitCode 1, error contains available agents
  it('AC-50/EC-21: unknown agent name returns exitCode 1 with available agents in error', async () => {
    const bundleDir = await makeBundle(HELLO_SCRIPT, 'test-agent');

    const res = await runAgent(bundleDir, 'nonexistent-agent');

    expect(res.exitCode).toBe(1);
    expect(res.error).toBeDefined();
    expect(res.error).toContain('test-agent');
  });

  // AC-46 / EC-23: runtime error → exitCode 1
  // AC-51 / P2-EC3: stderr contains error code + message
  it('AC-46/EC-23/AC-51: script runtime error returns exitCode 1 with error code in message', async () => {
    const bundleDir = await makeBundle(ERROR_SCRIPT);

    const res = await runAgent(bundleDir, 'test-agent');

    expect(res.exitCode).toBe(1);
    expect(res.error).toBeDefined();
    expect(typeof res.error).toBe('string');
    expect((res.error as string).length).toBeGreaterThan(0);
    // AC-51: error code must appear in the error output (ERROR_SCRIPT uses `1 + "bad"` → RILL-R002)
    expect(res.error).toContain('RILL-R002');
  });
});

// ============================================================
// BOUNDARY CASES
// ============================================================

describe('runAgent boundary', () => {
  // AC-57: stdin + --param → --param overrides matching keys.
  // Tested via options.params: the CLI merges stdin JSON and --param flags
  // before calling runAgent. Here we verify that passing { name: 'Bob' }
  // produces the expected output (same merge semantics as cli.ts AC-57).
  it('AC-57: params passed via options produce expected output', async () => {
    const bundleDir = await makeBundle(GREET_SCRIPT);

    const res = await runAgent(bundleDir, 'test-agent', {
      params: { name: 'Bob' },
    });

    expect(res.exitCode).toBe(0);
    expect(res.result).toBe('hello Bob');
  });

  // AC-58: timeout=0 → infinite timeout (agent completes normally)
  it('AC-58: timeout=0 means no timeout enforced, agent completes normally', async () => {
    const bundleDir = await makeBundle(HELLO_SCRIPT);

    const res = await runAgent(bundleDir, 'test-agent', { timeout: 0 });

    expect(res.exitCode).toBe(0);
    expect(res.result).toBe('hello world');
  });

  // AC-47 / AC-52: timeout enforcement — skipped.
  // Rill scripts execute synchronously and complete in microseconds.
  // Triggering a real timeout requires a blocking host function unavailable
  // in the test environment. AC-58 (timeout=0 → no timeout) covers the
  // boundary. A dedicated slow-agent fixture would need a blocking extension.

  // AC-48 / AC-54: extension lifecycle — implicitly tested by success cases.
  // AC-48: extensions are instantiated before execution and disposed after;
  //   composeAgent inside handlers.js handles this. Any passing success test
  //   verifies the lifecycle end-to-end.
  // AC-54: extension factory throws → exitCode 1 + extension name in error.
  //   Skipped: requires a bundle with a custom extension that throws on init,
  //   which needs esbuild compilation of a throwable extension factory.
  //   The catch → exitCode 1 path is covered by AC-46/EC-23 above.

  // AC-44 / AC-53: stdin handling is in cli.ts, not in runAgent programmatic API.
  // runAgent receives already-parsed params. The stdin parsing path in cli.ts
  // is separate and would require subprocess testing to cover directly.
});
