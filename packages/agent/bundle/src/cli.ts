#!/usr/bin/env node
import { buildBundle } from './build.js';
import { checkPlatform } from './check.js';
import { initProject } from './init.js';

// ============================================================
// ARG PARSING HELPERS
// ============================================================

/**
 * Extract a named flag value from an argv array.
 * Returns the value following --flag, or undefined if not present.
 * Example: parseFlag(['--output', 'dist/'], '--output') → 'dist/'
 */
function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

// ============================================================
// SUBCOMMAND HANDLERS
// ============================================================

async function runBuild(args: string[]): Promise<void> {
  // Positional: first non-flag arg is manifest path
  const positionals = args.filter((a) => !a.startsWith('-'));
  const manifestPath = positionals[0];

  if (manifestPath === undefined || manifestPath === '') {
    process.stderr.write('Error: build requires <manifest-path>\n');
    process.exit(1);
  }

  const outputDir = parseFlag(args, '--output');

  try {
    const result = await buildBundle(manifestPath, {
      ...(outputDir !== undefined ? { outputDir } : {}),
    });
    process.stdout.write(`${result.outputPath}\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }
}

async function runCheck(args: string[]): Promise<void> {
  const platform = parseFlag(args, '--platform');

  if (platform === undefined || platform === '') {
    process.stderr.write('Error: check requires --platform <name>\n');
    process.exit(1);
  }

  // Positional: first non-flag arg that is not the platform value
  const platformIdx = args.indexOf('--platform');
  const positionals = args.filter((a, i) => {
    if (a.startsWith('-')) return false;
    // Skip the value immediately following --platform
    if (i === platformIdx + 1) return false;
    return true;
  });
  const bundlePath = positionals[0] ?? '.';

  try {
    const result = await checkPlatform(bundlePath, platform);

    for (const issue of result.issues) {
      process.stdout.write(
        `[${issue.level.toUpperCase()}] ${issue.extension}: ${issue.message}\n`
      );
    }

    if (!result.compatible) {
      process.exit(1);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }
}

async function runInit(args: string[]): Promise<void> {
  const positionals = args.filter((a) => !a.startsWith('-'));
  const projectName = positionals[0];

  if (projectName === undefined || projectName === '') {
    process.stderr.write('Error: init requires <project-name>\n');
    process.exit(1);
  }

  const extensionsFlag = parseFlag(args, '--extensions');
  const extensions =
    extensionsFlag !== undefined
      ? extensionsFlag
          .split(',')
          .map((e) => e.trim())
          .filter((e) => e !== '')
      : undefined;

  try {
    await initProject(projectName, {
      ...(extensions !== undefined ? { extensions } : {}),
    });
    process.stdout.write(`Created project: ${projectName}\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }
}

// ============================================================
// ENTRY POINT
// ============================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const subcommand = args[0];
  const subArgs = args.slice(1);

  if (subcommand === 'build') {
    await runBuild(subArgs);
  } else if (subcommand === 'check') {
    await runCheck(subArgs);
  } else if (subcommand === 'init') {
    await runInit(subArgs);
  } else {
    const cmd =
      subcommand !== undefined
        ? `Unknown subcommand: ${subcommand}`
        : 'No subcommand provided';
    process.stderr.write(
      `${cmd}\nUsage: rill-agent-bundle <build|init|check> [options]\n`
    );
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal: ${msg}\n`);
  process.exit(1);
});
