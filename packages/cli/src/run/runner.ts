/**
 * Script runner for rill-run.
 * Builds runtime options, executes rill scripts, and maps results to exit codes.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  parse,
  execute,
  createRuntimeContext,
  extResolver,
  moduleResolver,
  toNative,
  isTuple,
  type RillValue,
  type RillTuple,
  type RuntimeOptions,
  type SchemeResolver,
} from '@rcrsr/rill';
import {
  ParseError,
  RillError,
  formatRillError,
  formatRillErrorJson,
} from '@rcrsr/rill';
import type { RillConfigFile } from '@rcrsr/rill-config';
import type { RunCliOptions } from './types.js';

// ============================================================
// TYPES
// ============================================================

export interface RunResult {
  readonly exitCode: number;
  readonly output?: string | undefined;
  readonly errorOutput?: string | undefined;
}

// ============================================================
// MODULE RESOLVER
// ============================================================

/**
 * Build a custom module scheme resolver using folder aliasing.
 * Each config key maps to a directory. Dot-paths resolve to files within:
 * - `module:alias.sub.path` → `{dir}/sub/path.rill`
 * - `module:alias` → `{dir}/index.rill`
 */
export function buildModuleResolver(
  modulesConfig: Record<string, string>,
  configDir: string
): SchemeResolver {
  const moduleDirs: Record<string, string> = {};
  for (const [id, value] of Object.entries(modulesConfig)) {
    moduleDirs[id] = resolve(configDir, value);
  }

  const resolver: SchemeResolver = (resource: string) => {
    const dotIndex = resource.indexOf('.');
    const alias = dotIndex === -1 ? resource : resource.slice(0, dotIndex);

    const dirPath = moduleDirs[alias];
    if (dirPath === undefined) {
      return moduleResolver(resource, {});
    }

    const subPath = dotIndex === -1 ? '' : resource.slice(dotIndex + 1);
    const relPath =
      subPath.length > 0
        ? subPath.replaceAll('.', '/') + '.rill'
        : 'index.rill';
    const filePath = resolve(dirPath, relPath);

    return moduleResolver(resource, { [resource]: filePath });
  };
  return resolver;
}

// ============================================================
// EXIT CODE MAPPING
// ============================================================

function mapResultToRunResult(
  result: RillValue,
  format: RunCliOptions['format']
): RunResult {
  if (isTuple(result)) {
    const tuple = result as RillTuple;
    if (tuple.entries.length === 2) {
      const code = tuple.entries[0];
      const message = tuple.entries[1];
      if (typeof code === 'number' && typeof message === 'string') {
        return {
          exitCode: code,
          output: message.length > 0 ? message : undefined,
        };
      }
    }
  }

  if (result === false || result === '') {
    return { exitCode: 1 };
  }

  const formatted = formatOutput(result, format);
  return { exitCode: 0, output: formatted };
}

function formatOutput(
  value: RillValue,
  format: RunCliOptions['format']
): string {
  const native = toNative(value);
  if (format === 'json' || format === 'compact') {
    return JSON.stringify(native.value);
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(native.value, null, 2);
}

// ============================================================
// RUNNER
// ============================================================

/**
 * Run a rill script file with the given extension tree and config.
 */
export async function runScript(
  opts: RunCliOptions,
  config: RillConfigFile,
  extTree: Record<string, RillValue>,
  disposes: Array<() => void | Promise<void>>
): Promise<RunResult> {
  if (!opts.scriptPath) {
    return { exitCode: 1, errorOutput: 'no script path provided' };
  }

  let source: string;
  try {
    source = readFileSync(opts.scriptPath, 'utf-8');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, errorOutput: message };
  }

  const modulesConfig = config.modules ?? {};
  const configDir = dirname(resolve(opts.config));
  const customModuleResolver = buildModuleResolver(modulesConfig, configDir);

  const runtimeOptions: RuntimeOptions = {
    resolvers: {
      ext: extResolver,
      module: customModuleResolver,
    },
    configurations: {
      resolvers: {
        ext: extTree,
      },
    },
    parseSource: parse,
    callbacks: {
      onLog: (msg: string) => {
        process.stdout.write(msg + '\n');
      },
    },
    maxCallStackDepth: opts.maxStackDepth,
  };

  const ctx = createRuntimeContext(runtimeOptions);

  if (opts.scriptArgs.length > 0) {
    ctx.pipeValue = opts.scriptArgs.join(' ');
  }

  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source);
  } catch (err: unknown) {
    if (err instanceof ParseError) {
      const formatted =
        opts.format === 'json'
          ? formatRillErrorJson(err, {
              maxStackDepth: opts.maxStackDepth,
              filePath: opts.scriptPath,
            })
          : formatRillError(err, {
              verbose: opts.verbose,
              maxStackDepth: opts.maxStackDepth,
              filePath: opts.scriptPath,
              sources: { script: source },
            });
      return { exitCode: 1, errorOutput: formatted };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, errorOutput: message };
  }

  let result: RillValue;
  try {
    const execResult = await execute(ast, ctx);
    result = execResult.result;
  } catch (err: unknown) {
    if (err instanceof RillError) {
      const formatted =
        opts.format === 'json'
          ? formatRillErrorJson(err, {
              maxStackDepth: opts.maxStackDepth,
              filePath: opts.scriptPath,
            })
          : formatRillError(err, {
              verbose: opts.verbose,
              maxStackDepth: opts.maxStackDepth,
              filePath: opts.scriptPath,
              sources: { script: source },
            });
      return { exitCode: 1, errorOutput: formatted };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, errorOutput: message };
  } finally {
    for (const dispose of disposes) {
      try {
        await dispose();
      } catch {
        // Ignore dispose errors
      }
    }
  }

  return mapResultToRunResult(result, opts.format);
}
