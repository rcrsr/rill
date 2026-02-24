import { accessSync, constants } from 'node:fs';
import { ComposeError } from '../errors.js';
import type { BuildContext, ResolvedManifest } from './index.js';

// ============================================================
// SHARED TARGET BUILDER HELPERS
// ============================================================

/**
 * Asserts the output directory is writable.
 * Throws ComposeError (phase: 'bundling') per EC-22.
 */
export function assertOutputWritable(outputDir: string): void {
  try {
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
