import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ExtensionFactory } from '@rcrsr/rill';
import { ComposeError } from './errors.js';
import type { ManifestExtension } from './schema.js';

// ============================================================
// VALID BUILT-IN NAMES
// ============================================================

const BUILTIN_NAMES = ['fs', 'fetch', 'exec', 'kv', 'crypto'] as const;
type BuiltinName = (typeof BUILTIN_NAMES)[number];

function isBuiltinName(name: string): name is BuiltinName {
  return (BUILTIN_NAMES as readonly string[]).includes(name);
}

// ============================================================
// RESOLUTION STRATEGY DETECTION
// ============================================================

type ResolutionStrategy = 'npm' | 'local' | 'builtin';

function detectStrategy(packageField: string): ResolutionStrategy {
  if (packageField.startsWith('./') || packageField.startsWith('../')) {
    return 'local';
  }
  if (packageField.startsWith('@rcrsr/rill/ext/')) {
    return 'builtin';
  }
  return 'npm';
}

// ============================================================
// FACTORY VALIDATION
// ============================================================

/**
 * Validates that a loaded module exports a callable function as default.
 * Throws ComposeError (phase: 'resolution') if not valid.
 */
function extractFactory(
  mod: unknown,
  packageField: string
): ExtensionFactory<unknown> {
  const defaultExport =
    mod !== null && typeof mod === 'object' && 'default' in mod
      ? (mod as Record<string, unknown>)['default']
      : mod;

  if (typeof defaultExport !== 'function') {
    throw new ComposeError(
      `${packageField} does not export a valid ExtensionFactory`,
      'resolution'
    );
  }

  return defaultExport as ExtensionFactory<unknown>;
}

// ============================================================
// VERSION READING
// ============================================================

/**
 * Reads the installed version of a package by walking up from the resolved
 * module file path to find the nearest package.json.
 * Returns undefined if the package.json cannot be found or read.
 */
function readInstalledVersion(resolvedFilePath: string): string | undefined {
  let dir = path.dirname(resolvedFilePath);

  // Walk up until we find a package.json or exhaust the path
  while (true) {
    const candidate = path.join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const raw = readFileSync(candidate, 'utf-8');
        const parsed = JSON.parse(raw) as unknown;
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          'version' in parsed &&
          typeof (parsed as Record<string, unknown>)['version'] === 'string'
        ) {
          return (parsed as Record<string, string>)['version'];
        }
      } catch {
        // Unreadable package.json — continue walking up
      }
    }

    const parent = path.dirname(dir);
    // Stop at filesystem root
    if (parent === dir) break;
    dir = parent;
  }

  return undefined;
}

// ============================================================
// STRATEGY IMPLEMENTATIONS
// ============================================================

async function resolveNpm(
  alias: string,
  extension: ManifestExtension,
  manifestDir: string
): Promise<ResolvedExtension> {
  const packageName = extension.package;
  const baseUrl = pathToFileURL(manifestDir + '/').href;

  let resolvedUrl: string;
  try {
    resolvedUrl = import.meta.resolve(packageName, baseUrl);
  } catch {
    throw new ComposeError(
      `Extension package not found: ${packageName}. Run pnpm add ${packageName}`,
      'resolution'
    );
  }

  const resolvedFilePath = fileURLToPath(resolvedUrl);
  const resolvedVersion = readInstalledVersion(resolvedFilePath);

  const mod = await import(resolvedUrl);
  const factory = extractFactory(mod, packageName);

  return {
    alias,
    namespace: alias,
    strategy: 'npm',
    factory,
    resolvedVersion,
    config: extension.config ?? {},
  };
}

async function resolveLocal(
  alias: string,
  extension: ManifestExtension,
  manifestDir: string
): Promise<ResolvedExtension> {
  const packageField = extension.package;

  // AC-32: path.resolve normalizes traversal segments
  const resolvedPath = path.resolve(manifestDir, packageField);

  // Security: path traversal prevention
  // Ensure resolved path starts with manifestDir
  const normalizedManifestDir = path.resolve(manifestDir);
  if (
    !resolvedPath.startsWith(normalizedManifestDir + path.sep) &&
    resolvedPath !== normalizedManifestDir
  ) {
    throw new ComposeError(
      `Extension path not found: ${packageField}`,
      'resolution'
    );
  }

  // EC-16: file must exist on disk
  if (!existsSync(resolvedPath)) {
    throw new ComposeError(
      `Extension path not found: ${packageField}`,
      'resolution'
    );
  }

  const fileUrl = pathToFileURL(resolvedPath).href;
  const mod = await import(fileUrl);
  const factory = extractFactory(mod, packageField);

  return {
    alias,
    namespace: alias,
    strategy: 'local',
    factory,
    resolvedPath,
    config: extension.config ?? {},
  };
}

async function resolveBuiltin(
  alias: string,
  extension: ManifestExtension
): Promise<ResolvedExtension> {
  const packageField = extension.package;

  // Extract name from "@rcrsr/rill/ext/<name>"
  const name = packageField.slice('@rcrsr/rill/ext/'.length);

  // EC-17: validate built-in name
  if (!isBuiltinName(name)) {
    throw new ComposeError(
      `Unknown built-in extension: ${name}. Valid: fs, fetch, exec, kv, crypto`,
      'resolution'
    );
  }

  const mod = await import(`@rcrsr/rill/ext/${name}`);
  const factory = extractFactory(mod, packageField);

  return {
    alias,
    namespace: alias,
    strategy: 'builtin',
    factory,
    config: extension.config ?? {},
  };
}

// ============================================================
// PUBLIC INTERFACES
// ============================================================

export interface ResolveOptions {
  readonly manifestDir: string;
  readonly env?: Record<string, string> | undefined;
}

export interface ResolvedExtension {
  readonly alias: string;
  readonly namespace: string;
  readonly strategy: 'npm' | 'local' | 'builtin';
  readonly factory: ExtensionFactory<unknown>;
  readonly resolvedVersion?: string | undefined;
  /** Absolute file path for local-strategy extensions. Used by builders to bundle the source. */
  readonly resolvedPath?: string | undefined;
  readonly config: Record<string, unknown>;
}

// ============================================================
// MAIN FUNCTION
// ============================================================

/**
 * Resolves all extensions declared in a manifest to their loaded factories.
 *
 * Strategies:
 * - `local`: paths starting with `./` or `../`, resolved relative to manifestDir
 * - `builtin`: `@rcrsr/rill/ext/<name>` sub-path exports
 * - `npm`: all other package names, resolved via import.meta.resolve
 *
 * @param extensions - Record of alias → ManifestExtension from the manifest
 * @param options - Resolution options including manifest directory path
 * @returns Array of resolved extensions in declaration order
 * @throws ComposeError (phase: 'resolution') for all resolution failures
 */
export async function resolveExtensions(
  extensions: Record<string, ManifestExtension>,
  options: ResolveOptions
): Promise<ResolvedExtension[]> {
  const { manifestDir } = options;
  const entries = Object.entries(extensions);
  const resolved: ResolvedExtension[] = [];

  for (const [alias, extension] of entries) {
    const strategy = detectStrategy(extension.package);

    let result: ResolvedExtension;

    switch (strategy) {
      case 'npm':
        result = await resolveNpm(alias, extension, manifestDir);
        break;
      case 'local':
        result = await resolveLocal(alias, extension, manifestDir);
        break;
      case 'builtin':
        result = await resolveBuiltin(alias, extension);
        break;
    }

    resolved.push(result);
  }

  // EC-19: Namespace collision detection
  const namespaceToAlias = new Map<string, string>();
  for (const ext of resolved) {
    const existing = namespaceToAlias.get(ext.namespace);
    if (existing !== undefined) {
      throw new ComposeError(
        `Namespace collision: ${ext.namespace} defined by ${existing} and ${ext.alias}`,
        'resolution'
      );
    }
    namespaceToAlias.set(ext.namespace, ext.alias);
  }

  return resolved;
}
