/**
 * Catalog: scans the bundles directory and provides per-agent CatalogEntry
 * records keyed by agent name.
 *
 * IR-14: Catalog interface with entries, get(), and refresh().
 * IR-15: refresh() replaces the internal map atomically.
 * EC-6: bundlesDir missing → throws Error at startup.
 * EC-7: zero valid bundles → throws Error at startup.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { AgentCard } from '@rcrsr/rill-agent-shared';
import type {
  BundleAgentEntry,
  BundleManifest,
} from '@rcrsr/rill-agent-bundle';

// ============================================================
// PUBLIC TYPES
// ============================================================

export interface CatalogEntry {
  readonly name: string;
  readonly version: string;
  readonly bundlePath: string;
  readonly checksum: string;
  readonly card: AgentCard;
  readonly agents: Record<string, BundleAgentEntry>;
  readonly dependencies: string[];
}

export interface Catalog {
  readonly entries: ReadonlyMap<string, CatalogEntry>;
  get(name: string): CatalogEntry | undefined;
  refresh(): Promise<void>;
}

// ============================================================
// INTERNAL CONSTANTS
// ============================================================

const AHI_PACKAGE = '@rcrsr/rill-agent-ext-ahi';

// ============================================================
// INTERNAL HELPERS
// ============================================================

/**
 * Compute a SHA-256 checksum over the raw string contents of bundle.json.
 * Returns `sha256:<hex>`.
 */
function checksumBundleJson(contents: string): string {
  return `sha256:${createHash('sha256').update(contents).digest('hex')}`;
}

/**
 * Extract AHI target names from a BundleAgentEntry's extensions map.
 * Any extension whose package is the AHI package contributes its namespace
 * alias as a dependency name.
 */
function extractAhiDependencies(
  extensions: Record<string, { package: string }>
): string[] {
  return Object.entries(extensions)
    .filter(([, ext]) => ext.package === AHI_PACKAGE)
    .map(([alias]) => alias);
}

/**
 * Scan a single bundle subdirectory.
 *
 * Returns one CatalogEntry per agent declared in bundle.json.
 * Skips the directory (with a stderr warning) when harness.js is absent.
 * Returns an empty array when bundle.json is absent or unparseable.
 */
function scanBundleDir(bundleDir: string): CatalogEntry[] {
  const bundleJsonPath = path.join(bundleDir, 'bundle.json');
  const harnessPath = path.join(bundleDir, 'harness.js');

  if (!existsSync(bundleJsonPath)) {
    return [];
  }

  if (!existsSync(harnessPath)) {
    process.stderr.write(
      `[catalog] skipping bundle at ${bundleDir}: harness.js not found\n`
    );
    return [];
  }

  let bundleContents: string;
  let manifest: BundleManifest;
  try {
    bundleContents = readFileSync(bundleJsonPath, 'utf-8');
    manifest = JSON.parse(bundleContents) as BundleManifest;
  } catch {
    process.stderr.write(
      `[catalog] skipping bundle at ${bundleDir}: failed to parse bundle.json\n`
    );
    return [];
  }

  const checksum = checksumBundleJson(bundleContents);
  const entries: CatalogEntry[] = [];

  for (const [agentName, agentEntry] of Object.entries(manifest.agents)) {
    const card = agentEntry.card;
    const dependencies = extractAhiDependencies(agentEntry.extensions ?? {});

    entries.push({
      name: agentName,
      version: manifest.version,
      bundlePath: bundleDir,
      checksum,
      card,
      agents: manifest.agents,
      dependencies,
    });
  }

  return entries;
}

/**
 * Scan all subdirectories under bundlesDir and return a populated map.
 * Throws Error when bundlesDir does not exist.
 */
async function scanEntryMap(
  bundlesDir: string
): Promise<Map<string, CatalogEntry>> {
  if (!existsSync(bundlesDir)) {
    throw new Error(`Bundles directory not found: ${bundlesDir}`);
  }

  const subdirs = await readdir(bundlesDir, { withFileTypes: true });
  const map = new Map<string, CatalogEntry>();

  for (const dirent of subdirs) {
    if (!dirent.isDirectory()) continue;
    const bundleDir = path.join(bundlesDir, dirent.name);
    const bundleEntries = scanBundleDir(bundleDir);
    for (const entry of bundleEntries) {
      map.set(entry.name, entry);
    }
  }

  return map;
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create a Catalog by scanning bundlesDir at startup.
 *
 * EC-6: Throws Error when bundlesDir does not exist.
 * EC-7: Throws Error when no valid bundles are found.
 *
 * @param bundlesDir - Absolute path to the directory containing bundle subdirectories
 * @returns Initialized Catalog
 */
export async function createCatalog(bundlesDir: string): Promise<Catalog> {
  const initial = await scanEntryMap(bundlesDir);
  if (initial.size === 0) {
    throw new Error(`No valid bundles found in: ${bundlesDir}`);
  }
  let entries: ReadonlyMap<string, CatalogEntry> = initial;

  return {
    get entries() {
      return entries;
    },

    get(name: string): CatalogEntry | undefined {
      return entries.get(name);
    },

    async refresh(): Promise<void> {
      // AC-65: empty result after refresh is allowed; catalog becomes empty.
      entries = await scanEntryMap(bundlesDir);
    },
  };
}
