// rill-compose programmatic API
export type { ComposePhase, ManifestIssue } from './errors.js';
export { ComposeError, ManifestValidationError } from './errors.js';
export type {
  AgentManifest,
  BuildTarget,
  ManifestExtension,
  ManifestHostOptions,
  ManifestDeployOptions,
  InputParamDescriptor,
  InputSchema,
  OutputSchema,
  EnvSource,
} from './schema.js';
export { validateManifest } from './schema.js';
export type { ExtensionFactory } from '@rcrsr/rill';
export type { AgentCard, AgentCapabilities, AgentSkill } from './card.js';
export type { ResolvedExtension, ResolveOptions } from './resolve.js';
export { resolveExtensions } from './resolve.js';
export { checkTargetCompatibility } from './compat.js';
export type { InitOptions } from './init.js';
export { initProject } from './init.js';

import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { build as esbuild, type BuildFailure } from 'esbuild';
import {
  type ScriptNode,
  type RuntimeContext,
  type RillValue,
  type HostFunctionDefinition,
  type ExtensionResult,
  hoistExtension,
  createRuntimeContext,
  parse,
  execute,
} from '@rcrsr/rill';
import { ComposeError } from './errors.js';
import type { AgentManifest } from './schema.js';
import { interpolateEnv } from './interpolate.js';
import { resolveExtensions } from './resolve.js';
import { type AgentCard, generateAgentCard } from './card.js';
import { loadEnv } from './env.js';

// ============================================================
// PUBLIC INTERFACES
// ============================================================

export interface ComposeOptions {
  readonly basePath?: string | undefined;
  readonly env?: Record<string, string> | undefined;
}

export interface ComposedAgent {
  readonly context: RuntimeContext;
  readonly ast: ScriptNode;
  readonly modules: Record<string, Record<string, RillValue>>;
  dispose(): Promise<void>;
  readonly card: AgentCard;
  readonly extensions: Record<string, ExtensionResult>;
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

/**
 * Apply interpolateEnv to all string values in an extension config object.
 */
function interpolateConfig(
  config: Record<string, unknown>,
  env: Record<string, string | undefined>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string') {
      result[key] = interpolateEnv(value, env).value;
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Compile a TypeScript custom function file using esbuild.
 * Returns the compiled ESM file path (caller must clean up).
 * Throws ComposeError on file-not-found or compilation error.
 */
async function compileFunctionFile(srcPath: string): Promise<string> {
  if (!existsSync(srcPath)) {
    throw new ComposeError(
      `Function source not found: ${srcPath}`,
      'compilation'
    );
  }

  const tmpFile = path.join(
    os.tmpdir(),
    `rill-fn-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`
  );

  try {
    await esbuild({
      entryPoints: [srcPath],
      bundle: true,
      format: 'esm',
      platform: 'node',
      outfile: tmpFile,
      logLevel: 'silent',
    });
  } catch (err) {
    // esbuild throws BuildFailure with .errors array on compilation error
    const failure = err as BuildFailure;
    if (Array.isArray(failure.errors) && failure.errors.length > 0) {
      const first = failure.errors[0]!;
      const file = first.location?.file ?? srcPath;
      const line = first.location?.line ?? 0;
      const msg = first.text;
      throw new ComposeError(
        `Compilation error in ${file}:${line}: ${msg}`,
        'compilation'
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new ComposeError(
      `Compilation error in ${srcPath}:0: ${msg}`,
      'compilation'
    );
  }

  return tmpFile;
}

/**
 * Load custom host functions from manifest.functions.
 * Keys are "app::name" → .ts source path.
 * Returns a Record<string, HostFunctionDefinition> keyed without "app::" prefix.
 */
async function loadCustomFunctions(
  functions: Record<string, string>,
  basePath: string
): Promise<Record<string, HostFunctionDefinition>> {
  const result: Record<string, HostFunctionDefinition> = {};

  for (const [qualifiedName, relSrcPath] of Object.entries(functions)) {
    const srcPath = path.resolve(basePath, relSrcPath);
    const tmpFile = await compileFunctionFile(srcPath);

    let mod: unknown;
    try {
      mod = await import(pathToFileURL(tmpFile).href);
    } finally {
      try {
        unlinkSync(tmpFile);
      } catch {
        // Best-effort cleanup
      }
    }

    // Extract all HostFunctionDefinition values from the module
    if (mod !== null && typeof mod === 'object') {
      for (const [exportName, exportValue] of Object.entries(
        mod as Record<string, unknown>
      )) {
        if (exportName === 'default') continue;
        if (typeof exportValue === 'object' && exportValue !== null) {
          // Strip "app::" prefix for the name key in context registration
          const fnName = qualifiedName.startsWith('app::')
            ? qualifiedName.slice('app::'.length)
            : qualifiedName;
          result[fnName] = exportValue as HostFunctionDefinition;
          break;
        }
      }
    }
  }

  return result;
}

// ============================================================
// COMPOSE AGENT
// ============================================================

/**
 * Compose an agent from an AgentManifest.
 * Resolves extensions, compiles custom functions, loads modules,
 * and parses the entry script — returning a ComposedAgent ready to execute.
 *
 * @param manifest - Validated agent manifest
 * @param options - Optional basePath (defaults to cwd) and env overrides
 * @returns ComposedAgent with context, AST, modules, card, and dispose()
 * @throws ComposeError on any composition failure
 */
export async function composeAgent(
  manifest: AgentManifest,
  options?: ComposeOptions
): Promise<ComposedAgent> {
  const basePath = options?.basePath ?? process.cwd();
  const env: Record<string, string> =
    options?.env ?? loadEnv(manifest.env, basePath);

  // Step 2: Interpolate env placeholders in extension configs
  const interpolatedExtensions: typeof manifest.extensions = {};
  for (const [alias, ext] of Object.entries(manifest.extensions)) {
    interpolatedExtensions[alias] = {
      ...ext,
      config: interpolateConfig(ext.config, env),
    };
  }

  // Step 3: Resolve extensions (handles EC-3, EC-4, EC-5)
  const resolved = await resolveExtensions(interpolatedExtensions, {
    manifestDir: basePath,
    env,
  });

  // Steps 4–6: Detect namespace collisions (delegated to resolveExtensions above),
  // hoist each extension and collect functions
  const disposeHandlers: Array<() => void | Promise<void>> = [];
  let mergedFunctions: Record<string, HostFunctionDefinition> = {};
  const extensions: Record<string, ExtensionResult> = {};

  for (const ext of resolved) {
    let instance: ExtensionResult;
    try {
      instance = ext.factory(ext.config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ComposeError(
        `Extension ${ext.alias} failed to initialize: ${msg}`,
        'init'
      );
    }

    extensions[ext.alias] = instance;

    const hoisted = hoistExtension(ext.namespace, instance);
    mergedFunctions = { ...mergedFunctions, ...hoisted.functions };

    if (hoisted.dispose !== undefined) {
      disposeHandlers.push(hoisted.dispose);
    }
  }

  // Compile and merge custom functions (EC-6, EC-7)
  if (Object.keys(manifest.functions).length > 0) {
    const customFns = await loadCustomFunctions(manifest.functions, basePath);
    mergedFunctions = { ...mergedFunctions, ...customFns };
  }

  // Step 7: Create runtime context
  const runtimeOptions: Parameters<typeof createRuntimeContext>[0] = {
    functions: mergedFunctions,
  };
  if (manifest.host !== undefined) {
    if (manifest.host.timeout !== undefined) {
      runtimeOptions.timeout = manifest.host.timeout;
    }
    runtimeOptions.maxCallStackDepth = manifest.host.maxCallStackDepth;
    runtimeOptions.requireDescriptions = manifest.host.requireDescriptions;
  }
  const context = createRuntimeContext(runtimeOptions);

  // Step 8: Load modules
  const modules: Record<string, Record<string, RillValue>> = {};
  for (const [alias, relPath] of Object.entries(manifest.modules)) {
    const absPath = path.resolve(basePath, relPath);
    if (!existsSync(absPath)) {
      throw new ComposeError(
        `Module file not found: ${alias} -> ${absPath}`,
        'compilation'
      );
    }
    const source = readFileSync(absPath, 'utf-8');
    const moduleAst = parse(source);
    const result = await execute(moduleAst, context);
    modules[alias] = result.variables;
  }

  // Step 9: Parse entry file
  const entryAbsPath = path.resolve(basePath, manifest.entry);
  if (!existsSync(entryAbsPath)) {
    throw new ComposeError(
      `Entry file not found: ${entryAbsPath}`,
      'compilation'
    );
  }
  const entrySource = readFileSync(entryAbsPath, 'utf-8');
  const ast = parse(entrySource);

  const card = generateAgentCard(manifest);

  // Step 10: dispose() in reverse declaration order
  const reverseDispose = [...disposeHandlers].reverse();

  return {
    context,
    ast,
    modules,
    card,
    extensions,
    async dispose(): Promise<void> {
      for (const handler of reverseDispose) {
        try {
          await handler();
        } catch {
          // Ignore individual dispose errors
        }
      }
    },
  };
}
