#!/usr/bin/env node
/**
 * rill-run: Extension-aware rill script runner.
 * Loads extensions from rill-config.json, generates bindings, and executes scripts.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { config as dotenvConfig } from 'dotenv';
import { VERSION } from './cli-shared.js';
import { explainError } from './cli-explain.js';
import { loadConfig } from './run/config.js';
import {
  mergeEnvIntoConfig,
  validateRequiredFields,
  REQUIRED_FIELDS_BY_PACKAGE,
} from './run/env.js';
import { loadExtensions } from './run/loader.js';
import { buildBindingsSource } from './run/bindings.js';
import { runScript } from './run/runner.js';
import type { RunCliOptions } from './run/types.js';

// ============================================================
// HELP TEXT
// ============================================================

const USAGE = `\
Usage: rill-run <script.rill> [args...]

Options:
  --config <path>           Config file path (default: ./rill-config.json)
  --format <mode>           Output format: human, json, compact (default: human)
  --verbose                 Show full error details (default: false)
  --max-stack-depth <n>     Error stack frame limit (default: 10)
  --emit-bindings           Write bindings source to config-defined file and exit
  --explain <code>          Print error code documentation
  --help                    Print this help message and exit
  --version                 Print version and exit`.trimEnd();

// ============================================================
// PARSE ARGS
// ============================================================

export function parseCliArgs(
  argv: string[] = process.argv.slice(2)
): RunCliOptions {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      config: { type: 'string' },
      format: { type: 'string' },
      verbose: { type: 'boolean' },
      'max-stack-depth': { type: 'string' },
      'emit-bindings': { type: 'boolean' },
      help: { type: 'boolean' },
      version: { type: 'boolean' },
      explain: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values['help'] === true) {
    process.stdout.write(USAGE + '\n');
    process.exit(0);
  }

  if (values['version'] === true) {
    process.stdout.write(`rill-run ${VERSION}\n`);
    process.exit(0);
  }

  if (positionals.length === 0 && values['emit-bindings'] === undefined) {
    process.stderr.write('Error: no script path provided\n\n' + USAGE + '\n');
    process.exit(1);
  }

  const scriptPath = positionals[0];
  const scriptArgs = positionals.slice(1);

  const rawFormat = values['format'];
  const format =
    rawFormat === 'json' || rawFormat === 'compact' ? rawFormat : 'human';

  const rawDepth = values['max-stack-depth'] as string | undefined;
  const parsedDepth = rawDepth !== undefined ? parseInt(rawDepth, 10) : NaN;
  const maxStackDepth =
    !isNaN(parsedDepth) && parsedDepth >= 0 ? parsedDepth : 10;

  return {
    scriptPath,
    scriptArgs,
    config: (values['config'] as string | undefined) ?? './rill-config.json',
    format,
    verbose: values['verbose'] === true,
    maxStackDepth,
    explain: values['explain'] as string | undefined,
    emitBindings: values['emit-bindings'] === true,
  };
}

// ============================================================
// MAIN
// ============================================================

async function main(): Promise<void> {
  dotenvConfig({ quiet: true });

  const opts = parseCliArgs();

  if (opts.explain !== undefined) {
    const doc = explainError(opts.explain);
    if (doc !== null) {
      process.stdout.write(doc + '\n');
    } else {
      process.stdout.write(`${opts.explain}: No documentation available.\n`);
    }
    process.exit(0);
  }

  const config = loadConfig(opts.config);
  const mergedConfig = mergeEnvIntoConfig(config);

  for (const [namespace, entry] of Object.entries(mergedConfig.extensions)) {
    const requiredFields = REQUIRED_FIELDS_BY_PACKAGE[entry.package] ?? [];
    validateRequiredFields(namespace, entry.config ?? {}, [...requiredFields]);
  }

  const extTree = await loadExtensions(mergedConfig);
  const disposes: Array<() => void | Promise<void>> = [];

  const bindingsPath = mergedConfig.bindings ?? 'ext.rill';
  const generatedBindings = buildBindingsSource(extTree);

  if (opts.emitBindings === true) {
    writeFileSync(bindingsPath, generatedBindings + '\n');
    process.exit(0);
  }

  if (!existsSync(bindingsPath)) {
    writeFileSync(bindingsPath, generatedBindings + '\n');
  }
  const bindingsSrc = readFileSync(bindingsPath, 'utf-8');

  const runResult = await runScript(
    opts,
    mergedConfig,
    extTree,
    bindingsSrc,
    disposes
  );

  if (runResult.output !== undefined) {
    process.stdout.write(runResult.output + '\n');
  }

  if (runResult.errorOutput !== undefined) {
    process.stderr.write(runResult.errorOutput + '\n');
  }

  process.exit(runResult.exitCode);
}

// ============================================================
// ENTRY
// ============================================================

const shouldRunMain =
  process.env['NODE_ENV'] !== 'test' &&
  !process.env['VITEST'] &&
  !process.env['VITEST_WORKER_ID'];

if (shouldRunMain) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Fatal error: ${message}\n`);
    process.exit(1);
  });
}
