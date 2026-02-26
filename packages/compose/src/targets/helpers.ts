import { accessSync, mkdirSync, constants } from 'node:fs';
import { ComposeError } from '../errors.js';
import type { BuildContext, ResolvedManifest } from './index.js';
import type { ManifestStateBackendConfig } from '../schema.js';

// ============================================================
// STATE BACKEND CODE GENERATION
// ============================================================

/**
 * Returns import line and instantiation expression for state backend.
 * Returns null when no stateBackend is configured (caller uses default).
 */
export function generateStateBackendSnippet(
  stateBackend: ManifestStateBackendConfig | undefined
): { importLine: string; instantiation: string } | null {
  if (stateBackend === undefined) return null;

  switch (stateBackend.type) {
    case 'memory':
      return {
        importLine: "import { createMemoryBackend } from '@rcrsr/rill-host';",
        instantiation: 'createMemoryBackend()',
      };
    case 'file':
      return {
        importLine: "import { createFileBackend } from '@rcrsr/rill-state-fs';",
        instantiation: `createFileBackend(${JSON.stringify(stateBackend.config ?? {})})`,
      };
    case 'sqlite':
      return {
        importLine:
          "import { createSqliteBackend } from '@rcrsr/rill-state-sqlite';",
        instantiation: `createSqliteBackend(${JSON.stringify(stateBackend.config ?? {})})`,
      };
    case 'redis':
      return {
        importLine:
          "import { createRedisBackend } from '@rcrsr/rill-state-redis';",
        instantiation: `createRedisBackend(${JSON.stringify(stateBackend.config ?? {})})`,
      };
  }
}

// ============================================================
// SHARED TARGET BUILDER HELPERS
// ============================================================

/**
 * Ensures the output directory exists and is writable.
 * Creates the directory (recursively) if it does not exist.
 * Throws ComposeError (phase: 'bundling') per EC-22.
 */
export function assertOutputWritable(outputDir: string): void {
  try {
    mkdirSync(outputDir, { recursive: true });
    accessSync(outputDir, constants.W_OK);
  } catch {
    throw new ComposeError(
      `Cannot write to output directory: ${outputDir}`,
      'bundling'
    );
  }
}

/**
 * Builds the resolved manifest from the context.
 * Attaches resolvedVersion from each ResolvedExtension.
 */
export function buildResolvedManifest(context: BuildContext): ResolvedManifest {
  const { manifest, extensions } = context;

  if (
    manifest.extensions === undefined ||
    Object.keys(manifest.extensions).length === 0
  ) {
    return manifest as ResolvedManifest;
  }

  const resolvedExtensions: Record<
    string,
    (typeof manifest.extensions)[string] & { resolvedVersion: string }
  > = {};

  for (const [alias, extConfig] of Object.entries(manifest.extensions)) {
    const resolved = extensions.find((e) => e.alias === alias);
    resolvedExtensions[alias] = {
      ...extConfig,
      resolvedVersion: resolved?.resolvedVersion ?? 'unknown',
    };
  }

  return {
    ...manifest,
    extensions: resolvedExtensions,
  };
}
