#!/usr/bin/env node
/**
 * rill-run: Extension-aware rill script runner.
 * Loads extensions from rill-config.json, generates bindings, and executes scripts.
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { config as dotenvConfig } from 'dotenv';
import {
  parse,
  execute,
  createRuntimeContext,
  invokeCallable,
  isScriptCallable,
  VERSION,
  type RuntimeOptions,
} from '@rcrsr/rill';
import {
  resolveConfigPath,
  loadProject,
  parseMainField,
  introspectHandler,
  marshalCliArgs,
  ConfigError,
} from '@rcrsr/rill-config';
import { CLI_VERSION } from './cli-shared.js';
import { explainError } from './cli-explain.js';
import { runScript } from './run/runner.js';
import type { RunCliOptions } from './run/types.js';

// ============================================================
// HELP TEXT
// ============================================================

const USAGE = `\
Usage: rill-run [root-dir]

Arguments:
  root-dir                  Optional directory containing rill-config.json (default: cwd)

Options:
  --config <path>           Config file path (default: search from cwd)
  --format <mode>           Output format: human, json, compact (default: human)
  --verbose                 Show full error details (default: false)
  --max-stack-depth <n>     Error stack frame limit (default: 10)
  --create-bindings         Write bindings source to config-defined file and exit
  --explain <code>          Print error code documentation
  --help                    Print this help message and exit
  --version                 Print version and exit`.trimEnd();

// ============================================================
// BASE OPTIONS (used to separate known flags from handler args)
// ============================================================

const BASE_OPTIONS = {
  config: { type: 'string' as const },
  format: { type: 'string' as const },
  verbose: { type: 'boolean' as const },
  'max-stack-depth': { type: 'string' as const },
  'create-bindings': { type: 'boolean' as const },
  help: { type: 'boolean' as const },
  version: { type: 'boolean' as const },
  explain: { type: 'string' as const },
};

// ============================================================
// PARSE ARGS
// ============================================================

export function parseCliArgs(
  argv: string[] = process.argv.slice(2)
): RunCliOptions & { rootDir?: string | undefined } {
  const { values, positionals } = parseArgs({
    args: argv,
    options: BASE_OPTIONS,
    allowPositionals: true,
    strict: false,
  });

  if (values['help'] === true) {
    process.stdout.write(USAGE + '\n');
    process.exit(0);
  }

  if (values['version'] === true) {
    process.stdout.write(`rill-run ${CLI_VERSION} (rill ${VERSION})\n`);
    process.exit(0);
  }

  const rootDir = positionals[0];
  const scriptArgs: string[] = [];

  const rawFormat = values['format'];
  const format =
    rawFormat === 'json' || rawFormat === 'compact' ? rawFormat : 'human';

  const rawDepth = values['max-stack-depth'] as string | undefined;
  const parsedDepth = rawDepth !== undefined ? parseInt(rawDepth, 10) : NaN;
  const maxStackDepth =
    !isNaN(parsedDepth) && parsedDepth >= 0 ? parsedDepth : 10;

  return {
    scriptPath: undefined,
    scriptArgs,
    rootDir,
    config: (values['config'] as string | undefined) ?? './rill-config.json',
    format,
    verbose: values['verbose'] === true,
    maxStackDepth,
    explain: values['explain'] as string | undefined,
    createBindings: values['create-bindings'] === true,
  };
}

// ============================================================
// HANDLER ARG EXTRACTION
// ============================================================

/**
 * Extract unknown flags from argv as handler parameter strings.
 * Filters out known base options and their values.
 */
function extractHandlerArgs(argv: string[]): Record<string, string> {
  const { values } = parseArgs({
    args: argv,
    options: BASE_OPTIONS,
    allowPositionals: true,
    strict: false,
  });

  const knownKeys = new Set(Object.keys(BASE_OPTIONS));
  const handlerArgs: Record<string, string> = {};

  for (const [key, value] of Object.entries(values)) {
    if (knownKeys.has(key)) continue;
    if (typeof value === 'string') {
      handlerArgs[key] = value;
    } else if (value === true) {
      handlerArgs[key] = '';
    }
  }

  return handlerArgs;
}

// ============================================================
// MAIN
// ============================================================

export async function main(): Promise<void> {
  dotenvConfig({ quiet: true });

  const argv = process.argv.slice(2);
  const opts = parseCliArgs(argv);

  if (opts.explain !== undefined) {
    const doc = explainError(opts.explain);
    if (doc !== null) {
      process.stdout.write(doc + '\n');
    } else {
      process.stdout.write(`${opts.explain}: No documentation available.\n`);
    }
    process.exit(0);
  }

  const hasExplicitConfig = opts.config !== './rill-config.json';

  const rootDir = opts.rootDir ?? process.cwd();

  let configPath: string;
  try {
    configPath = resolveConfigPath({
      ...(hasExplicitConfig ? { configFlag: opts.config } : {}),
      cwd: rootDir,
    });
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
    throw err;
  }

  let project: Awaited<ReturnType<typeof loadProject>>;
  try {
    project = await loadProject({
      configPath,
      env: process.env as Record<string, string>,
      rillVersion: VERSION,
    });
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
    throw err;
  }

  // Create bindings and exit early if --create-bindings was set
  if (opts.createBindings === true) {
    const extBindingsPath = resolve(
      process.cwd(),
      project.config.extensions?.bindings ?? 'bindings/ext.rill'
    );
    mkdirSync(dirname(extBindingsPath), { recursive: true });
    writeFileSync(extBindingsPath, project.extensionBindings + '\n');
    if (project.config.context !== undefined) {
      const ctxBindingsPath = resolve(
        process.cwd(),
        project.config.context.bindings ?? 'bindings/context.rill'
      );
      mkdirSync(dirname(ctxBindingsPath), { recursive: true });
      writeFileSync(ctxBindingsPath, project.contextBindings + '\n');
    }
    process.exit(0);
  }

  // Handler mode: main field contains "file.rill:handlerName"
  const mainField = project.config.main;
  if (mainField !== undefined && mainField.includes(':')) {
    const { filePath, handlerName } = parseMainField(mainField);

    const absolutePath = resolve(rootDir, filePath);
    let source: string;
    try {
      source = readFileSync(absolutePath, 'utf-8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(message + '\n');
      process.exit(1);
    }

    let ast: ReturnType<typeof parse>;
    try {
      ast = parse(source);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(message + '\n');
      process.exit(1);
    }

    const runtimeOptions: RuntimeOptions = {
      ...project.resolverConfig,
      parseSource: parse,
      callbacks: {
        onLog: (msg: string) => {
          process.stdout.write(msg + '\n');
        },
      },
      maxCallStackDepth: opts.maxStackDepth,
    };

    const ctx = createRuntimeContext(runtimeOptions);

    try {
      await execute(ast, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(message + '\n');
      process.exit(1);
    }

    const handlerValue =
      handlerName !== undefined ? ctx.variables.get(handlerName) : undefined;

    if (handlerValue === undefined || !isScriptCallable(handlerValue)) {
      process.stderr.write(
        `Handler not found: $${handlerName ?? '(none)'} is not a closure\n`
      );
      process.exit(1);
    }

    const introspection = introspectHandler(handlerValue);
    const rawHandlerArgs = extractHandlerArgs(argv);

    let handlerArgs: Record<string, unknown>;
    try {
      handlerArgs = marshalCliArgs(rawHandlerArgs, introspection.params);
    } catch (err) {
      if (err instanceof ConfigError) {
        process.stderr.write(err.message + '\n');
        process.exit(1);
      }
      throw err;
    }

    ctx.pipeValue = handlerArgs as unknown as import('@rcrsr/rill').RillValue;

    let handlerResult: import('@rcrsr/rill').RillValue;
    try {
      handlerResult = await invokeCallable(handlerValue, [], ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(message + '\n');
      process.exit(1);
    } finally {
      for (const dispose of project.disposes) {
        try {
          await dispose();
        } catch {
          // Ignore dispose errors
        }
      }
    }

    if (typeof handlerResult === 'string' && handlerResult.length > 0) {
      process.stdout.write(handlerResult + '\n');
    }
    process.exit(0);
  }

  // Module mode: main field in config is required
  if (mainField === undefined) {
    process.stderr.write(
      'Error: no main field in rill-config.json\n' +
        'Add a "main" field pointing to your entry script, e.g.: "main": "src/index.rill"\n'
    );
    process.exit(1);
  }

  const scriptPath = resolve(rootDir, mainField);

  const runOpts: RunCliOptions = {
    ...opts,
    scriptPath,
  };

  const runResult = await runScript(
    runOpts,
    project.config,
    project.extTree,
    project.extensionBindings,
    [...project.disposes]
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
