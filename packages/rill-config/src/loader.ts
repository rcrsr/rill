/**
 * Extension loader for rill-config.
 * Validates manifests, checks versions, detects collisions, invokes factories,
 * and builds the nested extension config tree.
 */

import { createRequire } from 'node:module';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import semver from 'semver';
import {
  isApplicationCallable,
  isTuple,
  isVector,
  type ExtensionFactoryResult,
  type RillValue,
} from '@rcrsr/rill';
import {
  ConfigValidationError,
  ExtensionLoadError,
  ExtensionVersionError,
} from './errors.js';
import { detectNamespaceCollisions } from './mounts.js';
import type {
  ExtensionManifest,
  LoadedProject,
  ResolvedMount,
} from './types.js';

// ============================================================
// HELPERS
// ============================================================

/**
 * Resolve a package specifier for dynamic import.
 * Relative paths are resolved against CWD and converted to file URLs.
 * Bare specifiers resolve from the project directory via createRequire.
 * @internal
 */
export function resolveSpecifier(specifier: string): string {
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return pathToFileURL(resolve(process.cwd(), specifier)).href;
  }
  if (isAbsolute(specifier) || specifier.startsWith('file://')) {
    return specifier;
  }
  // Bare specifiers: resolve from project directory, not from this file's location
  const projectRequire = createRequire(
    pathToFileURL(resolve(process.cwd(), 'package.json')).href
  );
  return pathToFileURL(projectRequire.resolve(specifier)).href;
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

/**
 * Mount a RillValue into the tree at a dot-path.
 * Single-segment: tree[name] = value.
 * Dot-path: creates intermediate dicts, places value at leaf (GAP-7).
 */
function mountValue(
  tree: Record<string, RillValue>,
  mountPath: string,
  value: RillValue
): void {
  const parts = mountPath.split('.');

  if (parts.length === 1) {
    tree[mountPath] = value;
    return;
  }

  // Dot-path: create intermediate dict nodes
  let node: Record<string, RillValue> = tree;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const existing = node[part];
    if (existing === undefined) {
      const intermediate: Record<string, RillValue> = {};
      node[part] = intermediate as unknown as RillValue;
    } else if (
      typeof existing !== 'object' ||
      existing === null ||
      Array.isArray(existing) ||
      isApplicationCallable(existing) ||
      isTuple(existing) ||
      isVector(existing)
    ) {
      const prefix = parts.slice(0, i + 1).join('.');
      throw new ExtensionLoadError(
        `Mount collision at "${prefix}": existing value is not a plain dict`
      );
    }
    node = node[part] as unknown as Record<string, RillValue>;
  }

  node[parts[parts.length - 1]!] = value;
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
  const tree: Record<string, RillValue> = {};
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
    ) => ExtensionFactoryResult | Promise<ExtensionFactoryResult>;

    let result: ExtensionFactoryResult;
    try {
      result = await (factory as FactoryFn)(config[mount.mountPath] ?? {});
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new ExtensionLoadError(`Factory for ${pkg} threw: ${reason}`);
    }

    // EC-5 / AC-13: Factory must return an object with a value property
    if (!('value' in result)) {
      throw new ExtensionLoadError(
        `Factory for ${pkg} returned result without value property`
      );
    }

    // EC-6 / AC-14: value must not be undefined
    if (result.value === undefined) {
      throw new ExtensionLoadError(
        `Factory for ${pkg} returned undefined value`
      );
    }

    if (result.dispose !== undefined) {
      disposes.push(result.dispose);
    }

    // DD-2: Store value at mount path by reference
    mountValue(tree, mount.mountPath, result.value);
  }

  return { extTree: tree, disposes, manifests };
}
