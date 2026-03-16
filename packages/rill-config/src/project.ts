/**
 * Top-level project loader for rill-config.
 * Orchestrates config reading, validation, extension loading, and resolver assembly.
 */

import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ConfigNotFoundError } from './errors.js';
import { parseConfig } from './parse.js';
import { checkRuntimeVersion, validateContext } from './validate.js';
import { resolveMounts } from './mounts.js';
import { loadExtensions } from './loader.js';
import { buildContextBindings, buildExtensionBindings } from './bindings.js';
import { buildResolvers } from './resolvers.js';
import type { RillValue } from '@rcrsr/rill';
import type { ContextFieldSchema, ProjectResult } from './types.js';

// ============================================================
// LOAD PROJECT
// ============================================================

/**
 * Top-level orchestrator that loads and assembles a rill project.
 * Reads config, validates, loads extensions, builds bindings and resolvers.
 * Never calls process.exit(). Propagates sub-function errors unchanged.
 * File read error: wraps ENOENT as ConfigNotFoundError, rethrows others.
 */
export async function loadProject(options: {
  configPath: string;
  env: Record<string, string>;
  rillVersion: string;
}): Promise<ProjectResult> {
  const { configPath, env, rillVersion } = options;

  // Step 1: Read config file
  let raw: string;
  try {
    raw = await readFile(configPath, { encoding: 'utf8' });
  } catch (err) {
    const isEnoent =
      err instanceof Error && (err as { code?: string }).code === 'ENOENT';
    if (isEnoent) {
      throw new ConfigNotFoundError(`Config file not found: ${configPath}`);
    }
    throw err;
  }

  // Step 2: Parse and interpolate config
  const config = parseConfig(raw, env);

  // Step 3: Runtime version check
  if (config.runtime !== undefined) {
    checkRuntimeVersion(config.runtime, rillVersion);
  }

  // Step 4: Load extensions
  let extTree: Record<string, RillValue> = {};
  let disposes: ReadonlyArray<() => void | Promise<void>> = [];

  if (config.extensions !== undefined) {
    const mounts = resolveMounts(config.extensions.mounts);
    const loaded = await loadExtensions(
      mounts,
      (config.extensions.config ?? {}) as Record<
        string,
        Record<string, unknown>
      >
    );
    extTree = loaded.extTree;
    disposes = loaded.disposes;
  }

  // Step 5: Validate context
  let contextSchema: Record<string, ContextFieldSchema> = {};
  let contextValues: Record<string, unknown> = {};

  if (config.context !== undefined) {
    contextValues = validateContext(config.context);
    contextSchema = config.context.schema;
  }

  // Step 6: Build extension bindings
  const extensionBindings = buildExtensionBindings(extTree);

  // Step 7: Build context bindings
  const contextBindings = buildContextBindings(contextSchema, contextValues);

  // Step 8: Build resolvers
  const resolverConfig = buildResolvers({
    extTree,
    contextValues,
    extensionBindings,
    contextBindings,
    modulesConfig: config.modules ?? {},
    configDir: dirname(configPath),
  });

  return {
    config,
    extTree,
    disposes,
    resolverConfig,
    hostOptions: config.host ?? {},
    extensionBindings,
    contextBindings,
  };
}
