import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { build } from 'esbuild';
import { ComposeError } from './errors.js';
import type { BuildTarget } from './schema.js';
import type { ResolvedExtension } from './resolve.js';

// ============================================================
// BUILT-IN DETECTION SETS
// ============================================================

/**
 * Node.js built-in module names that are incompatible with Cloudflare Workers.
 * Throws ComposeError when detected. Keys are bare names; detection checks both
 * bare and `node:` prefixed forms.
 */
const RESTRICTED_BUILTINS = new Set(['fs', 'path', 'net', 'dns', 'tls']);

/**
 * Built-in module names that emit a non-blocking warning on the worker target.
 * Cloudflare Workers provides non-functional stubs for these.
 */
const WARNING_BUILTINS = new Set([
  'child_process',
  'cluster',
  'dgram',
  'os',
  'readline',
  'repl',
  'v8',
  'vm',
]);

// ============================================================
// NATIVE ADDON DETECTION
// ============================================================

interface PackageJson {
  main?: string | undefined;
  exports?: unknown;
  gypfile?: boolean | undefined;
  scripts?: Record<string, string> | undefined;
}

/**
 * Returns true if the package directory contains native C++ addon indicators:
 * - package.json has `gypfile: true`
 * - package.json scripts contain `node-gyp rebuild`
 * - `binding.gyp` exists in the package root
 * - `build/Release/` contains `.node` files
 */
function hasNativeAddon(packageDir: string): boolean {
  const pkgJsonPath = join(packageDir, 'package.json');

  if (existsSync(pkgJsonPath)) {
    let pkg: PackageJson;
    try {
      pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as PackageJson;
    } catch {
      pkg = {};
    }

    if (pkg.gypfile === true) return true;

    if (pkg.scripts) {
      for (const script of Object.values(pkg.scripts)) {
        if (script.includes('node-gyp rebuild')) return true;
      }
    }
  }

  if (existsSync(join(packageDir, 'binding.gyp'))) return true;

  const releaseDir = join(packageDir, 'build', 'Release');
  if (existsSync(releaseDir)) {
    try {
      const entries = readdirSync(releaseDir);
      if (entries.some((f) => f.endsWith('.node'))) return true;
    } catch {
      // Directory unreadable — skip check
    }
  }

  return false;
}

// ============================================================
// PACKAGE DIRECTORY RESOLUTION
// ============================================================

/**
 * Resolves the package directory for an npm-strategy extension.
 * Walks up the directory tree from cwd to the filesystem root, checking
 * node_modules/{namespace}/package.json at each level. Mirrors Node.js
 * module resolution for nested workspace support.
 */
function findNpmPackageDir(namespace: string): string | undefined {
  let dir = process.cwd();

  while (true) {
    const candidate = join(dir, 'node_modules', namespace);
    if (existsSync(join(candidate, 'package.json'))) return candidate;

    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  return undefined;
}

/**
 * Resolves the package directory and entry point for an extension.
 * Returns undefined for 'builtin' strategy (always compatible).
 */
function resolvePackageDir(
  ext: ResolvedExtension
): { packageDir: string; entryPoint: string } | undefined {
  if (ext.strategy === 'builtin') return undefined;

  if (ext.strategy === 'local') {
    // factory source is a local file path; derive directory from it
    const factorySource = (ext.factory as { __source?: string }).__source;
    if (factorySource) {
      const packageDir = dirname(factorySource);
      return { packageDir, entryPoint: factorySource };
    }
    return undefined;
  }

  // npm strategy
  const packageDir = findNpmPackageDir(ext.namespace);
  if (!packageDir) return undefined;

  const pkgJsonPath = join(packageDir, 'package.json');
  if (!existsSync(pkgJsonPath)) return undefined;

  let pkg: PackageJson;
  try {
    pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as PackageJson;
  } catch {
    return undefined;
  }

  const entryPoint = pkg.main
    ? join(packageDir, pkg.main)
    : join(packageDir, 'index.js');

  if (!existsSync(entryPoint)) return undefined;

  return { packageDir, entryPoint };
}

// ============================================================
// METAFILE IMPORT ANALYSIS
// ============================================================

/**
 * Strips the `node:` protocol prefix if present, returning the bare module name.
 */
function bareModuleName(path: string): string {
  return path.startsWith('node:') ? path.slice(5) : path;
}

/**
 * Returns true if the given import refers to a Node.js built-in module.
 * Matches `node:`-prefixed paths unconditionally.
 * For bare names (no slash, no dot prefix), requires `external === true` so that
 * bundled npm packages resolved to file paths are never misidentified as built-ins.
 */
function isNodeBuiltin(imp: { path: string; external?: boolean }): boolean {
  if (imp.path.startsWith('node:')) return true;
  return (
    imp.external === true &&
    !imp.path.includes('/') &&
    !imp.path.startsWith('.')
  );
}

/**
 * Collects all Node.js built-in module names referenced in an esbuild metafile.
 * Returns the set of bare names (without `node:` prefix).
 */
function collectBuiltinImports(
  metafileInputs: Record<
    string,
    { imports: { path: string; external?: boolean }[] }
  >
): Set<string> {
  const found = new Set<string>();

  for (const inputData of Object.values(metafileInputs)) {
    for (const imp of inputData.imports) {
      if (isNodeBuiltin(imp)) {
        found.add(bareModuleName(imp.path));
      }
    }
  }

  return found;
}

// ============================================================
// MAIN EXPORT
// ============================================================

/**
 * Checks all resolved extensions for compatibility with the given build target.
 *
 * Only the `worker` target triggers compatibility checks. For all other targets
 * this function returns immediately without performing any checks.
 *
 * On the worker target:
 * - Native C++ addons trigger a ComposeError (phase: 'compatibility').
 * - Restricted Node.js built-ins (fs, path, net, dns, tls) trigger a ComposeError.
 * - Warning-only built-ins emit a warning to stderr (non-blocking).
 * - `node:crypto` emits a partial-support warning to stderr (non-blocking).
 *
 * @throws ComposeError (phase: 'compatibility') for incompatible extensions.
 */
export async function checkTargetCompatibility(
  extensions: ResolvedExtension[],
  target: BuildTarget
): Promise<void> {
  if (target !== 'worker') return;

  for (const ext of extensions) {
    const resolved = resolvePackageDir(ext);
    if (!resolved) continue;

    const { packageDir, entryPoint } = resolved;
    const packageLabel = ext.namespace;

    // --- Native addon detection ---
    if (hasNativeAddon(packageDir)) {
      throw new ComposeError(
        `Extension ${packageLabel} has native deps; incompatible with worker target`,
        'compatibility'
      );
    }

    // --- Built-in detection via esbuild metafile ---
    let builtinImports: Set<string>;
    try {
      const result = await build({
        entryPoints: [entryPoint],
        bundle: true,
        write: false,
        metafile: true,
        target: 'node22',
        platform: 'node',
        logLevel: 'silent',
      });

      builtinImports = collectBuiltinImports(result.metafile.inputs);
    } catch {
      // If bundling fails, skip built-in detection for this extension.
      continue;
    }

    // Check restricted built-ins first (errors)
    for (const module of builtinImports) {
      if (RESTRICTED_BUILTINS.has(module)) {
        throw new ComposeError(
          `Extension ${packageLabel} uses Node.js API ${module}; incompatible with worker target`,
          'compatibility'
        );
      }
    }

    // Emit warnings for warning-only built-ins
    for (const module of builtinImports) {
      if (WARNING_BUILTINS.has(module)) {
        process.stderr.write(
          `Warning: ${packageLabel} uses ${module}; Cloudflare Workers provides non-functional stub\n`
        );
      } else if (module === 'crypto') {
        process.stderr.write(
          `Warning: ${packageLabel} uses node:crypto; only partial support on Cloudflare Workers\n`
        );
      }
    }
  }
}
