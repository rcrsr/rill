/**
 * Script runner for rill-run.
 * Builds runtime options, executes rill scripts, and maps results to exit codes.
 */

import { readFileSync } from 'node:fs';
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
import { ParseError, RillError, getCallStack } from '@rcrsr/rill';
import { buildExtensionBindings, isLeafFunction } from '@rcrsr/rill-config';
import type { NestedExtConfig, RillConfigFile } from '@rcrsr/rill-config';
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
// TREE CONVERSION
// ============================================================

function convertTreeToRillValues(
  tree: NestedExtConfig
): Record<string, RillValue> {
  const result: Record<string, RillValue> = {};

  for (const [key, value] of Object.entries(tree)) {
    if (
      typeof value === 'object' &&
      value !== null &&
      'fn' in value &&
      typeof (value as { fn: unknown }).fn === 'function' &&
      'params' in value
    ) {
      const rillFn = value as unknown as {
        fn: (...args: unknown[]) => unknown;
        params: readonly unknown[];
      };
      result[key] = {
        __type: 'callable' as const,
        kind: 'application' as const,
        isProperty: false,
        fn: rillFn.fn,
        params: rillFn.params,
      } as unknown as RillValue;
    } else {
      result[key] = convertTreeToRillValues(
        value as NestedExtConfig
      ) as unknown as RillValue;
    }
  }

  return result;
}

// ============================================================
// MODULE RESOLVER
// ============================================================

/**
 * Build a custom module scheme resolver.
 * - ID 'ext' → returns generated bindings source
 * - ID 'ext.*' → drills into extTree subtree and returns bindings for that node
 * - All other IDs → delegates to moduleResolver with the modules config
 */
export function buildModuleResolver(
  bindingsSource: string,
  modulesConfig: Record<string, string>,
  extTree: NestedExtConfig
): SchemeResolver {
  const moduleConfig: Record<string, string> = {};
  for (const [id, path] of Object.entries(modulesConfig)) {
    if (id !== 'ext') {
      moduleConfig[id] = path;
    }
  }

  const resolver: SchemeResolver = (resource: string) => {
    if (resource === 'ext') {
      return { kind: 'source', text: bindingsSource };
    }
    if (resource.startsWith('ext.')) {
      const suffix = resource.slice('ext.'.length);
      const segments = suffix.split('.');
      let node: NestedExtConfig | { fn: unknown; params: unknown } = extTree;
      let fullyResolved = true;
      for (const segment of segments) {
        const child = (node as NestedExtConfig)[segment];
        if (child === undefined) {
          fullyResolved = false;
          break;
        }
        if (isLeafFunction(child)) {
          fullyResolved = false;
          break;
        }
        node = child as NestedExtConfig;
      }
      if (fullyResolved && node !== extTree) {
        const subtreeSource = buildExtensionBindings(
          node as NestedExtConfig,
          suffix
        );
        return { kind: 'source', text: subtreeSource };
      }
    }
    return moduleResolver(resource, moduleConfig);
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
// ERROR FORMATTING
// ============================================================

function resolveSourceSnippet(
  location: { line: number; column: number },
  sources: { script?: string; bindings?: string },
  filePath?: string
): { label: string; sourceLine?: string } {
  if (sources.script !== undefined) {
    const lines = sources.script.split('\n');
    const idx = location.line - 1;
    if (
      idx >= 0 &&
      idx < lines.length &&
      location.column <= lines[idx]!.length + 1
    ) {
      return {
        label: filePath ?? '<script>',
        ...(lines[idx] !== undefined ? { sourceLine: lines[idx] } : {}),
      };
    }
  }
  if (sources.bindings !== undefined) {
    const lines = sources.bindings.split('\n');
    const idx = location.line - 1;
    if (idx >= 0 && idx < lines.length) {
      return {
        label: '<generated bindings>',
        ...(lines[idx] !== undefined ? { sourceLine: lines[idx] } : {}),
      };
    }
  }
  return { label: filePath ?? '<unknown>' };
}

function formatRillError(
  error: RillError,
  verbose: boolean,
  maxStackDepth: number,
  filePath?: string,
  sources?: { script?: string; bindings?: string }
): string {
  const data = error.toData();
  const parts: string[] = [];

  parts.push(`${data.errorId}: ${data.message}`);

  if (data.location !== undefined && sources !== undefined) {
    const match = resolveSourceSnippet(data.location, sources, filePath);
    parts.push(
      `  at ${match.label}:${data.location.line}:${data.location.column}`
    );
    if (match.sourceLine !== undefined) {
      parts.push('');
      const lineNum = String(data.location.line);
      parts.push(`  ${lineNum} | ${match.sourceLine}`);
      const caretCol = Math.max(0, data.location.column - 1);
      parts.push(`  ${' '.repeat(lineNum.length)} | ${' '.repeat(caretCol)}^`);
    }
  } else if (data.location !== undefined) {
    parts.push(
      `  at line ${data.location.line}, column ${data.location.column}`
    );
  }

  if (
    verbose &&
    data.context !== undefined &&
    Object.keys(data.context).length > 0
  ) {
    parts.push(`  context: ${JSON.stringify(data.context, null, 2)}`);
  }

  if (verbose && data.helpUrl !== undefined) {
    parts.push(`  help: ${data.helpUrl}`);
  }

  const frames = getCallStack(error);
  const visibleFrames = frames.slice(0, maxStackDepth);
  for (const frame of visibleFrames) {
    const loc = `${frame.location.start.line}:${frame.location.start.column}`;
    const name =
      frame.functionName !== undefined ? ` in ${frame.functionName}` : '';
    const ctx = frame.context !== undefined ? ` (${frame.context})` : '';
    parts.push(`  at ${loc}${name}${ctx}`);
  }

  return parts.join('\n');
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
  extTree: NestedExtConfig,
  bindingsSrc: string,
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

  const extConfig = convertTreeToRillValues(extTree);
  const modulesConfig = config.modules ?? {};
  const customModuleResolver = buildModuleResolver(
    bindingsSrc,
    modulesConfig,
    extTree
  );

  const runtimeOptions: RuntimeOptions = {
    resolvers: {
      ext: extResolver,
      module: customModuleResolver,
    },
    configurations: {
      resolvers: {
        ext: extConfig,
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
      const formatted = formatRillError(
        err,
        opts.verbose,
        opts.maxStackDepth,
        opts.scriptPath,
        { script: source }
      );
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
      const formatted = formatRillError(
        err,
        opts.verbose,
        opts.maxStackDepth,
        opts.scriptPath,
        { script: source, bindings: bindingsSrc }
      );
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
