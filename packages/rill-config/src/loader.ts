/**
 * Extension loader for rill-config.
 * Validates manifests, checks versions, detects collisions, invokes factories,
 * and builds the nested extension config tree.
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import semver from 'semver';
import type { ExtensionResult, RillFunction } from '@rcrsr/rill';
import {
  ConfigValidationError,
  ExtensionLoadError,
  ExtensionVersionError,
} from './errors.js';
import { detectNamespaceCollisions } from './mounts.js';
import type {
  ExtensionManifest,
  LoadedProject,
  NestedExtConfig,
  ResolvedMount,
} from './types.js';

// ============================================================
// HELPERS
// ============================================================

/**
 * Resolve a package specifier for dynamic import.
 * Relative paths are resolved against CWD and converted to file URLs.
 * Bare specifiers (npm package names) are returned as-is.
 */
function resolveSpecifier(specifier: string): string {
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return pathToFileURL(resolve(process.cwd(), specifier)).href;
  }
  return specifier;
}

function isModuleNotFoundError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  return (
    code === 'ERR_MODULE_NOT_FOUND' ||
    code === 'MODULE_NOT_FOUND' ||
    err.message.includes('Cannot find') ||
    err.message.includes('MODULE_NOT_FOUND') ||
    err.message.includes('ERR_MODULE_NOT_FOUND')
  );
}

function insertIntoTree(
  tree: NestedExtConfig,
  nsKey: string,
  fns: Record<string, RillFunction>
): void {
  const parts = nsKey.split('.');

  let node: NestedExtConfig = tree;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const existing = node[part];
    if (
      existing === undefined ||
      typeof (existing as RillFunction).fn === 'function'
    ) {
      node[part] = {};
    }
    node = node[part] as NestedExtConfig;
  }

  const leaf = parts[parts.length - 1]!;
  let leafNode = node[leaf];
  if (
    leafNode === undefined ||
    typeof (leafNode as RillFunction).fn === 'function'
  ) {
    node[leaf] = {};
    leafNode = node[leaf];
  }
  const leafDict = leafNode as NestedExtConfig;
  for (const [fnName, fn] of Object.entries(fns)) {
    leafDict[fnName] = fn;
  }
}

function extractRillFunctions(
  result: ExtensionResult
): Record<string, RillFunction> {
  const functions: Record<string, RillFunction> = {};
  for (const [key, value] of Object.entries(result)) {
    if (
      key !== 'dispose' &&
      key !== 'suspend' &&
      key !== 'restore' &&
      typeof value === 'object' &&
      value !== null &&
      'fn' in value &&
      typeof (value as { fn: unknown }).fn === 'function' &&
      'params' in value &&
      Array.isArray((value as { params: unknown }).params)
    ) {
      functions[key] = value as RillFunction;
    }
  }
  return functions;
}

// ============================================================
// LOADER
// ============================================================

export async function loadExtensions(
  mounts: ResolvedMount[],
  config: Record<string, Record<string, unknown>>
): Promise<LoadedProject> {
  // ---- Step 1: Missing packages pre-pass ----
  const missingPackages: string[] = [];
  for (const mount of mounts) {
    try {
      await import(resolveSpecifier(mount.packageSpecifier));
    } catch (err) {
      if (isModuleNotFoundError(err)) {
        missingPackages.push(mount.packageSpecifier);
      }
    }
  }
  if (missingPackages.length > 0) {
    throw new ExtensionLoadError(
      `Cannot find packages: ${missingPackages.join(', ')}`
    );
  }

  // ---- Step 2: Load modules, validate manifests, check versions ----
  const manifests = new Map<string, ExtensionManifest>();

  for (const mount of mounts) {
    const pkg = mount.packageSpecifier;

    // Import module
    let mod: Record<string, unknown>;
    try {
      mod = (await import(resolveSpecifier(pkg))) as Record<string, unknown>;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new ExtensionLoadError(`Factory for ${pkg} threw: ${reason}`);
    }

    // Check for extensionManifest export
    if (
      !('extensionManifest' in mod) ||
      mod['extensionManifest'] === null ||
      typeof mod['extensionManifest'] !== 'object'
    ) {
      throw new ExtensionLoadError(`${pkg} does not export extensionManifest`);
    }

    const manifest = mod['extensionManifest'] as ExtensionManifest;

    // Version check
    if (mount.versionConstraint !== undefined) {
      const installedVersion = manifest.version;
      if (installedVersion !== undefined) {
        if (!semver.satisfies(installedVersion, mount.versionConstraint)) {
          throw new ExtensionVersionError(
            `${pkg} v${installedVersion} does not satisfy ${mount.versionConstraint}`
          );
        }
      }
    }

    manifests.set(mount.mountPath, manifest);
  }

  // ---- Step 3: Cross-package collision check ----
  detectNamespaceCollisions(mounts);

  // ---- Step 4: Orphaned config key check ----
  const mountFirstSegments = new Set<string>();
  const mountPaths = new Set<string>();
  for (const mount of mounts) {
    mountPaths.add(mount.mountPath);
    mountFirstSegments.add(mount.mountPath.split('.')[0]!);
  }

  for (const key of Object.keys(config)) {
    if (!mountFirstSegments.has(key) && !mountPaths.has(key)) {
      throw new ConfigValidationError(
        `Config key ${key} does not match any mount`
      );
    }
  }

  // ---- Step 5: Factory invocation ----
  const tree: NestedExtConfig = {};
  const disposes: Array<() => void | Promise<void>> = [];

  for (const mount of mounts) {
    const pkg = mount.packageSpecifier;
    const manifest = manifests.get(mount.mountPath)!;

    const factory = manifest.factory;
    if (typeof factory !== 'function') {
      throw new ExtensionLoadError(
        `${pkg} extensionManifest has no factory function`
      );
    }

    type FactoryFn = (
      cfg: Record<string, unknown>
    ) => ExtensionResult | Promise<ExtensionResult>;

    let result: ExtensionResult;
    try {
      result = await (factory as FactoryFn)(config[mount.mountPath] ?? {});
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new ExtensionLoadError(`Factory for ${pkg} threw: ${reason}`);
    }

    if (result.dispose !== undefined) {
      disposes.push(result.dispose);
    }

    const functions = extractRillFunctions(result);
    insertIntoTree(tree, mount.mountPath, functions);
  }

  return { extTree: tree, disposes, manifests };
}
