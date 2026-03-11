/**
 * Extension loader for rill-run.
 * Dynamically imports extension packages, discovers the factory function,
 * invokes it, and hoists the result into a nested config tree.
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type ExtensionResult, type RillFunction } from '@rcrsr/rill';
import type { ConfigFile } from './types.js';

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

// ============================================================
// TYPES
// ============================================================

/**
 * Nested dict of hoisted extension functions.
 * Leaf values are RillFunction objects ({ fn, params }).
 * Intermediate nodes are nested dicts.
 */
export type NestedExtConfig = {
  [key: string]: NestedExtConfig | RillFunction;
};

// ============================================================
// HELPERS
// ============================================================

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

// ============================================================
// FACTORY DISCOVERY
// ============================================================

function findFactory(
  exports: Record<string, unknown>,
  packageName: string
): (
  config: Record<string, unknown>
) => ExtensionResult | Promise<ExtensionResult> {
  for (const [key, value] of Object.entries(exports)) {
    if (
      key.startsWith('create') &&
      key.endsWith('Extension') &&
      typeof value === 'function'
    ) {
      return value as (
        config: Record<string, unknown>
      ) => ExtensionResult | Promise<ExtensionResult>;
    }
  }
  throw new Error(`No create*Extension export in ${packageName}`);
}

// ============================================================
// LOADER
// ============================================================

/**
 * Load all extensions from config and return a nested ext config tree.
 * Collects all missing packages before exiting (fails fast with full list).
 */
export async function loadExtensions(
  config: ConfigFile
): Promise<NestedExtConfig> {
  const tree: NestedExtConfig = {};
  const missingPackages: string[] = [];

  // First pass: check for missing packages
  for (const [, entry] of Object.entries(config.extensions)) {
    const pkgName = entry.package;
    try {
      await import(resolveSpecifier(pkgName));
    } catch (err: unknown) {
      const isNotFound =
        err instanceof Error &&
        (err.message.includes('Cannot find') ||
          err.message.includes('MODULE_NOT_FOUND') ||
          err.message.includes('ERR_MODULE_NOT_FOUND') ||
          (err as { code?: string }).code === 'ERR_MODULE_NOT_FOUND' ||
          (err as { code?: string }).code === 'MODULE_NOT_FOUND');
      if (isNotFound) {
        missingPackages.push(pkgName);
      }
    }
  }

  if (missingPackages.length > 0) {
    for (const pkg of missingPackages) {
      process.stderr.write(`Cannot find package: ${pkg}\n`);
    }
    process.exit(1);
  }

  // Second pass: load, discover factory, invoke
  for (const [nsKey, entry] of Object.entries(config.extensions)) {
    const pkgName = entry.package;

    let mod: Record<string, unknown>;
    try {
      mod = (await import(resolveSpecifier(pkgName))) as Record<
        string,
        unknown
      >;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`${message}\n`);
      process.exit(1);
    }

    let factory: (
      config: Record<string, unknown>
    ) => ExtensionResult | Promise<ExtensionResult>;
    try {
      factory = findFactory(mod, pkgName);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`${message}\n`);
      process.exit(1);
    }

    let result: ExtensionResult;
    try {
      result = await factory(entry.config ?? {});
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`${message}\n`);
      process.exit(1);
    }

    const functions: Record<string, RillFunction> = {};
    for (const [key, value] of Object.entries(result)) {
      if (
        key !== 'dispose' &&
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

    insertIntoTree(tree, nsKey, functions);
  }

  return tree;
}
