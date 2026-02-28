import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { ComposeError } from '@rcrsr/rill-agent-shared';
import type { BundleManifest } from './build.js';

// ============================================================
// PUBLIC TYPES
// ============================================================

export interface PlatformCheckResult {
  readonly compatible: boolean;
  readonly issues: readonly PlatformIssue[];
}

export interface PlatformIssue {
  readonly level: 'error' | 'warning';
  readonly extension: string;
  readonly message: string;
}

// ============================================================
// VALID PLATFORMS
// ============================================================

const VALID_PLATFORMS = ['node', 'worker', 'lambda'] as const;
type Platform = (typeof VALID_PLATFORMS)[number];

// ============================================================
// BUILT-IN DETECTION SETS
// ============================================================

/**
 * Node.js built-in module names incompatible with Cloudflare Workers.
 * Detection checks both bare and `node:` prefixed forms.
 */
const RESTRICTED_BUILTINS = new Set(['fs', 'path', 'net', 'dns', 'tls']);

/**
 * Built-in module names that emit a non-blocking warning on worker target.
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
// BUNDLE.JSON VALIDATION HELPERS
// ============================================================

/**
 * Returns true if the parsed value has the shape of a BundleManifest.
 * Checks for required top-level fields; does not deeply validate agents.
 */
function isBundleManifest(value: unknown): value is BundleManifest {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['name'] === 'string' &&
    typeof v['version'] === 'string' &&
    typeof v['built'] === 'string' &&
    typeof v['checksum'] === 'string' &&
    typeof v['rillVersion'] === 'string' &&
    v['agents'] !== null &&
    typeof v['agents'] === 'object'
  );
}

// ============================================================
// NATIVE ADDON DETECTION
// ============================================================

interface PackageJson {
  main?: string | undefined;
  gypfile?: boolean | undefined;
  scripts?: Record<string, string> | undefined;
}

/**
 * Returns true if the package directory contains native C++ addon indicators.
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
 * Resolves the package directory for an npm package by name.
 * Walks up from bundlePath to the filesystem root, checking
 * node_modules/{packageName}/package.json at each level.
 */
function findPackageDir(
  packageName: string,
  startDir: string
): { packageDir: string; entryPoint: string } | undefined {
  let dir = startDir;

  while (true) {
    const candidate = join(dir, 'node_modules', packageName);
    const pkgJsonPath = join(candidate, 'package.json');

    if (existsSync(pkgJsonPath)) {
      let pkg: PackageJson;
      try {
        pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as PackageJson;
      } catch {
        return undefined;
      }

      const entryPoint = pkg.main
        ? join(candidate, pkg.main)
        : join(candidate, 'index.js');

      if (!existsSync(entryPoint)) return undefined;

      return { packageDir: candidate, entryPoint };
    }

    const parent = join(dir, '..');
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  return undefined;
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
// PLATFORM CHECK LOGIC
// ============================================================

/**
 * Analyzes a single extension package for worker/lambda compatibility.
 * Collects issues into the provided array.
 */
async function analyzeExtension(
  packageName: string,
  bundlePath: string,
  platform: 'worker' | 'lambda',
  issues: PlatformIssue[]
): Promise<void> {
  // Skip local and builtin references — only check real npm packages
  if (
    packageName.startsWith('.') ||
    packageName.startsWith('@rcrsr/rill/ext/')
  ) {
    return;
  }

  const resolved = findPackageDir(packageName, bundlePath);
  if (!resolved) return;

  const { packageDir, entryPoint } = resolved;

  // --- Native addon detection (error for both worker and lambda) ---
  if (hasNativeAddon(packageDir)) {
    issues.push({
      level: 'error',
      extension: packageName,
      message: `Extension ${packageName} has native deps; incompatible with ${platform} target`,
    });
    return;
  }

  // Lambda only checks for native addons; no built-in restrictions
  if (platform === 'lambda') return;

  // --- Built-in detection via esbuild metafile (worker only) ---
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
    // If bundling fails, skip built-in detection for this extension
    return;
  }

  // Check restricted built-ins (errors)
  for (const module of builtinImports) {
    if (RESTRICTED_BUILTINS.has(module)) {
      issues.push({
        level: 'error',
        extension: packageName,
        message: `Extension ${packageName} uses Node.js API ${module}; incompatible with worker target`,
      });
    }
  }

  // Check warning-only built-ins
  for (const module of builtinImports) {
    if (WARNING_BUILTINS.has(module)) {
      issues.push({
        level: 'warning',
        extension: packageName,
        message: `Extension ${packageName} uses ${module}; Cloudflare Workers provides non-functional stub`,
      });
    } else if (module === 'crypto') {
      issues.push({
        level: 'warning',
        extension: packageName,
        message: `Extension ${packageName} uses node:crypto; only partial support on Cloudflare Workers`,
      });
    }
  }
}

// ============================================================
// MAIN EXPORT
// ============================================================

/**
 * Check a built bundle for compatibility with a target platform.
 *
 * Reads bundle.json from bundlePath, validates it, then checks all extensions
 * declared across all agents for compatibility with the given platform.
 *
 * Valid platform names: 'node', 'worker', 'lambda'.
 * - 'node': always compatible, returns immediately with no issues.
 * - 'worker': checks for native addons (error) and restricted Node.js built-ins (error/warning).
 * - 'lambda': checks for native addons (error).
 *
 * Returns a PlatformCheckResult; never throws on incompatibility.
 *
 * @param bundlePath - Path to the bundle output directory containing bundle.json
 * @param platform - Target platform name ('node' | 'worker' | 'lambda')
 * @returns PlatformCheckResult with compatible flag and structured issues
 * @throws ComposeError (phase: 'validation') for missing/invalid bundle.json or unknown platform
 */
export async function checkPlatform(
  bundlePath: string,
  platform: string
): Promise<PlatformCheckResult> {
  // EC-16: bundle.json missing
  const bundleJsonPath = join(bundlePath, 'bundle.json');
  if (!existsSync(bundleJsonPath)) {
    throw new ComposeError(
      `bundle.json not found: ${bundleJsonPath}`,
      'validation'
    );
  }

  // EC-17: invalid bundle.json
  let manifest: BundleManifest;
  try {
    const raw = JSON.parse(readFileSync(bundleJsonPath, 'utf8')) as unknown;
    if (!isBundleManifest(raw)) {
      throw new Error('Missing required fields');
    }
    manifest = raw;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ComposeError(
      `Invalid bundle.json at ${bundleJsonPath}: ${msg}`,
      'validation'
    );
  }

  // Unknown platform → ComposeError
  if (!VALID_PLATFORMS.includes(platform as Platform)) {
    throw new ComposeError(
      `Unknown platform: ${platform}. Valid platforms: ${VALID_PLATFORMS.join(', ')}`,
      'validation'
    );
  }

  const typedPlatform = platform as Platform;

  // 'node' is always compatible
  if (typedPlatform === 'node') {
    return { compatible: true, issues: [] };
  }

  // Collect unique extension package names across all agents
  const packageNames = new Set<string>();
  for (const agentEntry of Object.values(manifest.agents)) {
    for (const ext of Object.values(agentEntry.extensions ?? {})) {
      packageNames.add(ext.package);
    }
  }

  // Run compatibility analysis per extension
  const issues: PlatformIssue[] = [];
  for (const packageName of packageNames) {
    await analyzeExtension(packageName, bundlePath, typedPlatform, issues);
  }

  const compatible = !issues.some((i) => i.level === 'error');
  return { compatible, issues };
}
