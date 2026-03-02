import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { build as esbuild, type BuildFailure } from 'esbuild';
import {
  type RillValue,
  type HostFunctionDefinition,
  type ExtensionResult,
  hoistExtension,
  createRuntimeContext,
  parse,
  execute,
  RuntimeError,
  callable,
  isDict,
} from '@rcrsr/rill';
import {
  type AgentManifest,
  type HarnessManifest,
  type HarnessAgentEntry,
  type AgentRunner,
  type InProcessRunRequest,
  type InProcessRunResponse,
  type ComposedAgent,
  type ResolvedExtension,
  ComposeError,
  resolveExtensions,
  extractConfigSchema,
  generateAgentCard,
} from '@rcrsr/rill-agent-shared';

// ============================================================
// PUBLIC INTERFACES
// ============================================================

export interface ComposeOptions {
  readonly basePath?: string | undefined;
  readonly config: Record<string, Record<string, unknown>>;
}

export interface ComposedHarness {
  readonly agents: Map<string, ComposedAgent>;
  readonly sharedExtensions: Record<string, ExtensionResult>;
  bindHost(host: AgentRunner): void;
  dispose(): Promise<void>;
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

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
// INTERNAL: INSTANTIATE EXTENSIONS
// ============================================================

/**
 * Instantiate resolved extensions into ExtensionResult instances.
 * Returns merged functions, per-alias extension results, and dispose handlers.
 * On instantiation failure, disposes already-instantiated extensions before throwing (EC-5).
 */
async function instantiateExtensions(
  resolved: Array<
    ResolvedExtension & { readonly config: Record<string, unknown> }
  >,
  alreadyDispose?: Array<() => void | Promise<void>>
): Promise<{
  functions: Record<string, HostFunctionDefinition>;
  extensions: Record<string, ExtensionResult>;
  disposeHandlers: Array<() => void | Promise<void>>;
}> {
  const disposeHandlers: Array<() => void | Promise<void>> = [];
  let mergedFunctions: Record<string, HostFunctionDefinition> = {};
  const extensions: Record<string, ExtensionResult> = {};

  for (const ext of resolved) {
    let instance: ExtensionResult;
    try {
      instance = ext.factory(ext.config);
    } catch (err) {
      // EC-5: dispose already-instantiated extensions before throwing
      const toDispose = [
        ...(alreadyDispose ?? []),
        ...disposeHandlers,
      ].reverse();
      for (const handler of toDispose) {
        try {
          await handler();
        } catch {
          // Ignore individual dispose errors
        }
      }
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

  return { functions: mergedFunctions, extensions, disposeHandlers };
}

// ============================================================
// INTERNAL: BIND HOST
// ============================================================

/**
 * Wire in-process AHI routing for a ComposedHarness.
 * For each agent in the harness, replaces ahi:: function entries that
 * target other agents in the harness with in-process callables.
 */
export function bindHost(
  agents: Map<string, ComposedAgent>,
  host: AgentRunner
): void {
  const harnessAgentNames = new Set(agents.keys());

  for (const [callerAgentName, agent] of agents) {
    for (const [fnKey] of agent.context.functions) {
      if (!fnKey.startsWith('ahi::')) continue;

      const targetName = fnKey.slice('ahi::'.length);

      // Resolution order 1: target is in the harness → in-process shortcut
      if (!harnessAgentNames.has(targetName)) continue;

      const inProcessFn = callable(async (args, ctx): Promise<RillValue> => {
        // Extract params from args[0] if it is a dict
        const firstArg = args[0];
        const params: Record<string, unknown> =
          firstArg !== undefined && isDict(firstArg)
            ? (firstArg as Record<string, unknown>)
            : {};

        // Extract caller context from metadata
        const meta = ctx.metadata;
        const callerSessionId = meta?.['sessionId'];
        const callerCorrelationId = meta?.['correlationId'];
        const timeoutDeadlineStr = meta?.['timeoutDeadline'];

        // Compute effectiveTimeout: if deadline set, use max(1, deadline - now), else 0 (no timeout)
        let effectiveTimeout = 0;
        if (timeoutDeadlineStr !== undefined) {
          const deadline = Number(timeoutDeadlineStr);
          effectiveTimeout = Math.max(1, deadline - Date.now());
        }

        const request: InProcessRunRequest = {
          params,
          correlationId: callerCorrelationId,
          trigger: {
            type: 'agent',
            agentName: callerAgentName,
            sessionId: callerSessionId ?? '',
          },
          timeout: effectiveTimeout === 0 ? undefined : effectiveTimeout,
        };

        let response: InProcessRunResponse;
        try {
          response = await host.runForAgent(targetName, request);
        } catch (err) {
          // Duck-type AgentHostError capacity check (avoids value import / circular dep)
          if (
            err instanceof Error &&
            'phase' in err &&
            (err as { phase: unknown }).phase === 'capacity'
          ) {
            throw new RuntimeError('RILL-R032', 'AHI: rate limited');
          }
          throw err;
        }

        if (response.state === 'failed') {
          throw new RuntimeError(
            'RILL-R029',
            'AHI: downstream execution failed'
          );
        }

        return response.result ?? null;
      });

      agent.context.functions.set(fnKey, inProcessFn);
    }
  }
}

// ============================================================
// COMPOSE AGENT
// ============================================================

/**
 * Compose an agent from an AgentManifest.
 * Resolves extensions, validates config schemas, compiles custom functions,
 * loads modules, and parses the entry script — returning a ComposedAgent ready
 * to execute.
 *
 * @param manifest - Validated agent manifest
 * @param options - Required: basePath (defaults to cwd) and config per extension alias
 * @returns ComposedAgent with context, AST, modules, card, and dispose()
 * @throws ComposeError on any composition failure
 */
export async function composeAgent(
  manifest: AgentManifest,
  options: ComposeOptions
): Promise<ComposedAgent> {
  const basePath = options.basePath ?? process.cwd();

  // Step 2: Resolve extensions (handles EC-3, EC-4, EC-5)
  const resolvedRaw = await resolveExtensions(manifest.extensions, {
    manifestDir: basePath,
  });

  // Step 3: Validate config schemas and attach config slices to resolved extensions
  const missingFields: string[] = [];
  const resolved = resolvedRaw.map((ext) => {
    const schema = extractConfigSchema(ext.mod, ext.packageName);
    const configSlice = options.config[ext.alias] ?? {};
    for (const [field, descriptor] of Object.entries(schema)) {
      if (descriptor.required === true && !(field in configSlice)) {
        missingFields.push(`${ext.alias}.${field}`);
      }
    }
    return { ...ext, config: configSlice };
  });

  if (missingFields.length > 0) {
    throw new ComposeError(
      `Missing required config fields: ${missingFields.join(', ')}`,
      'resolution'
    );
  }

  // Steps 4–6: Detect namespace collisions (delegated to resolveExtensions above),
  // hoist each extension and collect functions
  const { functions, extensions, disposeHandlers } =
    await instantiateExtensions(resolved);
  let mergedFunctions = functions;

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

// ============================================================
// COMPOSE HARNESS
// ============================================================

/**
 * Builds a synthetic AgentManifest from a HarnessAgentEntry for card generation.
 * Uses placeholder values for required manifest fields not present in the entry.
 */
function buildSyntheticManifest(entry: HarnessAgentEntry): AgentManifest {
  return {
    name: entry.name,
    version: '0.0.0',
    runtime: '@rcrsr/rill@*',
    entry: entry.entry,
    modules: entry.modules ?? {},
    extensions: entry.extensions ?? {},
    functions: {},
    assets: [],
    skills: [],
    ...(entry.input !== undefined ? { input: entry.input } : {}),
    ...(entry.output !== undefined ? { output: entry.output } : {}),
  };
}

/**
 * Compose a harness from a HarnessManifest.
 * Instantiates shared extensions once, then composes each agent with merged
 * shared + per-agent functions. Returns a ComposedHarness ready to bind to a host.
 *
 * @param manifest - Validated harness manifest
 * @param options - Required: basePath (defaults to cwd) and config per extension alias
 * @returns ComposedHarness with agents map, sharedExtensions, bindHost(), and dispose()
 * @throws ComposeError on any composition failure (EC-5)
 */
export async function composeHarness(
  manifest: HarnessManifest,
  options: ComposeOptions
): Promise<ComposedHarness> {
  const basePath = options.basePath ?? process.cwd();

  // Step 3: Resolve shared extensions, validate config schemas, attach config slices
  const resolvedSharedRaw = await resolveExtensions(manifest.shared, {
    manifestDir: basePath,
  });

  const sharedMissingFields: string[] = [];
  const resolvedShared = resolvedSharedRaw.map((ext) => {
    const schema = extractConfigSchema(ext.mod, ext.packageName);
    const configSlice = options.config[ext.alias] ?? {};
    for (const [field, descriptor] of Object.entries(schema)) {
      if (descriptor.required === true && !(field in configSlice)) {
        sharedMissingFields.push(`${ext.alias}.${field}`);
      }
    }
    return { ...ext, config: configSlice };
  });

  if (sharedMissingFields.length > 0) {
    throw new ComposeError(
      `Missing required config fields: ${sharedMissingFields.join(', ')}`,
      'resolution'
    );
  }

  const {
    functions: sharedFunctions,
    extensions: sharedExtensions,
    disposeHandlers: sharedDisposeHandlers,
  } = await instantiateExtensions(resolvedShared);

  // Step 4: Compose each agent
  const agents = new Map<string, ComposedAgent>();
  const agentDisposeHandlers: Array<() => Promise<void>> = [];

  for (const agentEntry of manifest.agents) {
    // Step 4a: Resolve and instantiate per-agent extensions
    const perAgentExtDefs = agentEntry.extensions ?? {};

    const resolvedPerAgentRaw = await resolveExtensions(perAgentExtDefs, {
      manifestDir: basePath,
    });

    const perAgentMissingFields: string[] = [];
    const resolvedPerAgent = resolvedPerAgentRaw.map((ext) => {
      const schema = extractConfigSchema(ext.mod, ext.packageName);
      const configSlice = options.config[ext.alias] ?? {};
      for (const [field, descriptor] of Object.entries(schema)) {
        if (descriptor.required === true && !(field in configSlice)) {
          perAgentMissingFields.push(`${ext.alias}.${field}`);
        }
      }
      return { ...ext, config: configSlice };
    });

    if (perAgentMissingFields.length > 0) {
      // EC-5: dispose already-instantiated shared extensions before throwing
      const toDispose = [...sharedDisposeHandlers].reverse();
      for (const handler of toDispose) {
        try {
          await handler();
        } catch {
          // Ignore individual dispose errors
        }
      }
      throw new ComposeError(
        `Missing required config fields: ${perAgentMissingFields.join(', ')}`,
        'resolution'
      );
    }

    const {
      functions: perAgentFunctions,
      extensions: perAgentExtensions,
      disposeHandlers: perAgentExtDisposeHandlers,
    } = await instantiateExtensions(resolvedPerAgent, sharedDisposeHandlers);

    // Step 4b: Merge shared + per-agent functions; per-agent overrides shared
    const mergedFunctions: Record<string, HostFunctionDefinition> = {
      ...sharedFunctions,
      ...perAgentFunctions,
    };

    // Step 4c: Parse entry .rill file and load modules
    const entryAbsPath = path.resolve(basePath, agentEntry.entry);
    if (!existsSync(entryAbsPath)) {
      // EC-5: dispose already-instantiated before throwing
      const toDispose = [
        ...[...perAgentExtDisposeHandlers].reverse(),
        ...[...sharedDisposeHandlers].reverse(),
      ];
      for (const handler of toDispose) {
        try {
          await handler();
        } catch {
          // Ignore individual dispose errors
        }
      }
      throw new ComposeError(
        `Entry file not found: ${entryAbsPath}`,
        'compilation'
      );
    }
    const entrySource = readFileSync(entryAbsPath, 'utf-8');
    const ast = parse(entrySource);

    // Step 4d: Create RuntimeContext with merged function map
    const context = createRuntimeContext({ functions: mergedFunctions });

    // Load modules
    const modules: Record<string, Record<string, RillValue>> = {};
    for (const [alias, relPath] of Object.entries(agentEntry.modules ?? {})) {
      const absPath = path.resolve(basePath, relPath);
      if (!existsSync(absPath)) {
        // EC-5: dispose already-instantiated before throwing
        const toDispose = [
          ...[...perAgentExtDisposeHandlers].reverse(),
          ...[...sharedDisposeHandlers].reverse(),
        ];
        for (const handler of toDispose) {
          try {
            await handler();
          } catch {
            // Ignore individual dispose errors
          }
        }
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

    // Step 4e: Generate AgentCard from agent-level fields
    const syntheticManifest = buildSyntheticManifest(agentEntry);
    const card = generateAgentCard(syntheticManifest);

    // Step 4f: Construct ComposedAgent
    const allExtensions: Record<string, ExtensionResult> = {
      ...sharedExtensions,
      ...perAgentExtensions,
    };

    const reversePerAgentDispose = [...perAgentExtDisposeHandlers].reverse();
    const agentDispose = async (): Promise<void> => {
      for (const handler of reversePerAgentDispose) {
        try {
          await handler();
        } catch {
          // Ignore individual dispose errors
        }
      }
    };

    agentDisposeHandlers.push(agentDispose);

    agents.set(agentEntry.name, {
      context,
      ast,
      modules,
      card,
      extensions: allExtensions,
      dispose: agentDispose,
    });
  }

  // Build ComposedHarness
  let disposed = false;

  return {
    agents,
    sharedExtensions,

    bindHost(host: AgentRunner): void {
      // AC-28: no-op after dispose()
      if (disposed) return;
      bindHost(agents, host);
    },

    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;

      // Dispose per-agent extensions first (one agent at a time)
      for (const agentDispose of agentDisposeHandlers) {
        try {
          await agentDispose();
        } catch {
          // Ignore individual dispose errors
        }
      }

      // Then dispose shared extensions in reverse declaration order
      const reverseSharedDispose = [...sharedDisposeHandlers].reverse();
      for (const handler of reverseSharedDispose) {
        try {
          await handler();
        } catch {
          // Ignore individual dispose errors
        }
      }
    },
  };
}
