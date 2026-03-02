#!/usr/bin/env node
import { generateHarness, type HarnessType } from './generate.js';

// ============================================================
// ARG PARSING HELPERS
// ============================================================

/**
 * Extract a named flag value from an argv array.
 * Returns the value following --flag, or undefined if absent.
 */
function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

// ============================================================
// ENTRY POINT
// ============================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Extract positional args (args that are not flags or flag values)
  const flagsWithValues = new Set<number>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if ((arg === '--harness' || arg === '--output') && i + 1 < args.length) {
      flagsWithValues.add(i);
      flagsWithValues.add(i + 1);
      i += 1;
    }
  }
  const positionals = args.filter(
    (_, i) => !flagsWithValues.has(i) && !args[i]!.startsWith('-')
  );

  const harnessType = parseFlag(args, '--harness');
  const outputPath = parseFlag(args, '--output');
  const bundleDir = positionals[0];

  // --harness is required
  if (harnessType === undefined || harnessType === '') {
    process.stderr.write(
      'Error: --harness is required\nUsage: rill-agent-build --harness <type> [--output <path>] <bundle-dir>\nValid harness types: http, stdio, gateway, worker\n'
    );
    process.exit(1);
  }

  // bundle-dir is required
  if (bundleDir === undefined || bundleDir === '') {
    process.stderr.write(
      'Error: bundle-dir is required\nUsage: rill-agent-build --harness <type> [--output <path>] <bundle-dir>\n'
    );
    process.exit(1);
  }

  try {
    const result = await generateHarness(
      bundleDir,
      harnessType as HarnessType,
      outputPath !== undefined ? { outputPath } : undefined
    );

    process.stdout.write(
      `Generated ${result.harnessType} harness for ${result.agentCount} agent(s): ${result.outputPath}\n`
    );
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal: ${msg}\n`);
  process.exit(1);
});
