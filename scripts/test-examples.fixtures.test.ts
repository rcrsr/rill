/**
 * Fixture-driven regression coverage for scripts/test-examples.ts.
 *
 * Runs the CLI as a child process against the hand-built fixtures under
 * scripts/fixtures/test-examples/ and asserts on both the exit code and the
 * `--json` output, so a regression in marker-line splitting or the
 * unapplied-callable check fails a real test run instead of only being
 * discoverable by manually invoking the CLI.
 */

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const tsxBin = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
const cliPath = path.join(repoRoot, 'scripts', 'test-examples.ts');
const fixturesDir = path.join(repoRoot, 'scripts', 'fixtures', 'test-examples');

interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
  error: Error | undefined;
}

function runCli(args: string[]): CliRun {
  const result = spawnSync(tsxBin, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf-8',
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
  };
}

// Takes the full CliRun, not just stdout, so a spawn/resolution failure (an
// absent generated file the process can't import, tsx exiting before it
// prints anything) surfaces status/stderr/error in the assertion failure
// instead of an unexplained empty stdout — see the CI incident where the
// `deps:` job's tsx process errored to stderr with nothing on stdout.
function parseSummary(run: CliRun): {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
} {
  const match = run.stdout.match(
    /(\d+) passed, (\d+) failed, (\d+) skipped, (\d+) total/
  );
  if (!match) {
    throw new Error(
      `No summary line found in stdout.\n` +
        `status: ${run.status}\n` +
        `error: ${run.error ?? '(none)'}\n` +
        `stderr:\n${run.stderr}\n` +
        `stdout:\n${run.stdout}`
    );
  }
  return {
    passed: Number(match[1]),
    failed: Number(match[2]),
    skipped: Number(match[3]),
    total: Number(match[4]),
  };
}

function parseJsonLines(stdout: string): Array<Record<string, unknown>> {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('test-examples.ts fixture: marker-and-callable.md', () => {
  const fixture = path.join(fixturesDir, 'marker-and-callable.md');

  it('runs Case A (marked block executes and halts as expected), fails Case B (unapplied callable), passes Case C, and exits 1', () => {
    const run = runCli([fixture]);

    expect(run.status).toBe(1);

    // 3 rill fences total: Case A passes (the `# Error:` marker no longer
    // skips the block — it runs, halts on the bogus method call, and the
    // halt satisfies the marker's expectation), Case B fails on the
    // unapplied callable, Case C passes.
    const summary = parseSummary(run);
    expect(summary).toEqual({ passed: 2, failed: 1, skipped: 0, total: 3 });
  });

  it('reports exactly the Case B failure with an unapplied-callable message in --json output', () => {
    const { status, stdout } = runCli(['--json', fixture]);

    expect(status).toBe(1);

    const failures = parseJsonLines(stdout);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/unapplied callable/i);
    expect(String(failures[0]?.file)).toContain('marker-and-callable.md');
  });
});

describe('test-examples.ts fixture: expected-halt.md', () => {
  const fixture = path.join(fixturesDir, 'expected-halt.md');

  it('passes the block that genuinely halts, fails the one that completes despite its marker, and exits 1', () => {
    const run = runCli([fixture]);

    expect(run.status).toBe(1);

    const summary = parseSummary(run);
    expect(summary).toEqual({ passed: 1, failed: 1, skipped: 0, total: 2 });
  });

  it('reports the non-halting block with an expected-execution-to-halt message in --json output', () => {
    const { status, stdout } = runCli(['--json', fixture]);

    expect(status).toBe(1);

    const failures = parseJsonLines(stdout);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/expected execution to halt/i);
    expect(String(failures[0]?.file)).toContain('expected-halt.md');
  });
});

describe('test-examples.ts fixture: skip-ratio-guard.md', () => {
  const fixture = path.join(fixturesDir, 'skip-ratio-guard.md');

  it('trips the skip-ratio guard and exits 1 when 3 of 4 blocks are comment-only', () => {
    const run = runCli([fixture]);

    expect(run.status).toBe(1);

    const summary = parseSummary(run);
    expect(summary).toEqual({ passed: 1, failed: 0, skipped: 3, total: 4 });
    expect(run.stdout).toMatch(/Skip ratio guard/);
  });

  it('emits a skip-ratio-exceeded object in --json output with the pinned threshold', () => {
    const { status, stdout } = runCli(['--json', fixture]);

    expect(status).toBe(1);

    const lines = parseJsonLines(stdout);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      kind: 'skip-ratio-exceeded',
      skipped: 3,
      total: 4,
      threshold: 0.0035,
    });
  });
});
