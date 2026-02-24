#!/usr/bin/env node
import { realpathSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComposeError, ManifestValidationError } from './errors.js';
import { validateManifest } from './schema.js';
import { resolveExtensions } from './resolve.js';
import { checkTargetCompatibility } from './compat.js';
import { initProject } from './init.js';
import { build } from './targets/index.js';
import type { BuildTarget } from './schema.js';

// ============================================================
// VALID TARGETS
// ============================================================

const VALID_TARGETS: readonly BuildTarget[] = [
  'container',
  'lambda',
  'worker',
  'local',
];

function isValidTarget(value: string): value is BuildTarget {
  return (VALID_TARGETS as readonly string[]).includes(value);
}

// ============================================================
// USAGE STRINGS
// ============================================================

const BUILD_USAGE = `Usage: rill-compose <manifest-path> [--target <target>] [--output <dir>]

Arguments:
  manifest-path          Path to agent.json (required)

Options:
  --target <target>      Build target: container, lambda, worker, local (default: container)
  --output <dir>         Output directory (default: dist/)
  --help                 Print usage summary

Exit codes:
  0   Build succeeded
  1   Error (validation, resolution, compilation, or bundling)
`;

const INIT_USAGE = `Usage: rill-compose init <project-name> [--extensions <ext1,ext2>]

Arguments:
  project-name           Directory name and package name (required)

Options:
  --extensions <list>    Comma-separated extension names (optional)
  --help                 Print usage summary

Exit codes:
  0   Project created
  1   Error (directory exists, invalid name, unknown extension)
`;

const GLOBAL_USAGE = `Usage: rill-compose <manifest-path> [options]
       rill-compose init <project-name> [options]

Run 'rill-compose --help' for build options.
Run 'rill-compose init --help' for init options.
`;

// ============================================================
// ARG PARSING
// ============================================================

interface BuildArgs {
  readonly subcommand: 'build';
  readonly manifestPath: string;
  readonly target: BuildTarget;
  readonly outputDir: string;
}

interface InitArgs {
  readonly subcommand: 'init';
  readonly projectName: string;
  readonly extensions: string[];
}

type ParsedArgs = BuildArgs | InitArgs;

/**
 * Parses CLI args for the build subcommand.
 * Returns null if --help was requested (caller prints usage and exits 0).
 */
function parseBuildArgs(args: string[]): BuildArgs | null {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(BUILD_USAGE);
    process.exit(0);
  }

  const manifestPath = args[0];
  if (!manifestPath || manifestPath.startsWith('--')) {
    process.stderr.write('Error: missing manifest path\n');
    process.exit(1);
  }

  let target: BuildTarget = 'container';
  let outputDir = 'dist/';

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--target') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) {
        process.stderr.write('Error: --target requires a value\n');
        process.exit(1);
      }
      if (!isValidTarget(value)) {
        process.stderr.write(
          `Error: unknown target: ${value}. Valid: container, lambda, worker, local\n`
        );
        process.exit(1);
      }
      target = value;
      i++;
    } else if (arg === '--output') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) {
        process.stderr.write('Error: --output requires a value\n');
        process.exit(1);
      }
      outputDir = value;
      i++;
    }
  }

  return { subcommand: 'build', manifestPath, target, outputDir };
}

/**
 * Parses CLI args for the init subcommand.
 * Returns null if --help was requested (caller prints usage and exits 0).
 */
function parseInitArgs(args: string[]): InitArgs | null {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(INIT_USAGE);
    process.exit(0);
  }

  const projectName = args[0];
  if (!projectName || projectName.startsWith('--')) {
    process.stderr.write('Error: missing project name\n');
    process.exit(1);
  }

  let extensions: string[] = [];

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--extensions') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) {
        process.stderr.write('Error: --extensions requires a value\n');
        process.exit(1);
      }
      extensions = value
        .split(',')
        .map((e) => e.trim())
        .filter((e) => e.length > 0);
      i++;
    }
  }

  return { subcommand: 'init', projectName, extensions };
}

/**
 * Parses the top-level CLI args and dispatches to build or init parsing.
 */
function parseArgs(args: string[]): ParsedArgs {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(GLOBAL_USAGE);
    process.exit(0);
  }

  if (args[0] === 'init') {
    const parsed = parseInitArgs(args.slice(1));
    // parseInitArgs exits on --help, so parsed is always non-null here
    return parsed!;
  }

  const parsed = parseBuildArgs(args);
  // parseBuildArgs exits on --help, so parsed is always non-null here
  return parsed!;
}

// ============================================================
// DISPATCH
// ============================================================

/**
 * Executes the build subcommand.
 */
async function runBuild(args: BuildArgs): Promise<void> {
  const { manifestPath, target, outputDir } = args;

  const absoluteManifestPath = path.resolve(manifestPath);

  if (!existsSync(absoluteManifestPath)) {
    throw new ComposeError(`manifest not found: ${manifestPath}`, 'validation');
  }

  const content = readFileSync(absoluteManifestPath, 'utf-8');
  const manifest = validateManifest(JSON.parse(content));
  const manifestDir = path.dirname(absoluteManifestPath);

  const extensions = await resolveExtensions(manifest.extensions, {
    manifestDir,
  });

  await checkTargetCompatibility(extensions, target);

  const result = await build(target, {
    manifest,
    extensions,
    outputDir,
    manifestDir,
    env: process.env as Record<string, string | undefined>,
  });

  process.stdout.write(
    `Build succeeded: ${result.target} → ${result.outputPath}\n`
  );
}

/**
 * Executes the init subcommand.
 */
async function runInit(args: InitArgs): Promise<void> {
  await initProject(args.projectName, { extensions: args.extensions });
  process.stdout.write(`Created project: ${args.projectName}\n`);
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================

/**
 * Main CLI entry point. Accepts raw process.argv.slice(2) args.
 * Exported for testability.
 */
export async function main(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  try {
    if (parsed.subcommand === 'init') {
      await runInit(parsed);
    } else {
      await runBuild(parsed);
    }
  } catch (error) {
    if (error instanceof ManifestValidationError) {
      const firstIssue = error.issues[0];
      const message = firstIssue ? firstIssue.message : error.message;
      process.stderr.write(`Error: ${message}\n`);
      process.exit(1);
    }
    if (error instanceof ComposeError) {
      process.stderr.write(`Error: ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

// ============================================================
// CLI EXECUTION
// ============================================================

// Only run main if this file is executed directly (not imported).
// Use realpathSync to resolve symlinks created by npx, global install, etc.
const __thisFile = realpathSync(fileURLToPath(import.meta.url));
const __execFile = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (__execFile === __thisFile) {
  main(process.argv.slice(2)).catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
