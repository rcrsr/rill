/**
 * Environment variable loading and config merging for rill-run.
 * Derives env var prefixes from extension keys and merges with JSON config.
 */

import type { ConfigFile } from './types.js';

// ============================================================
// ENV PREFIX DERIVATION
// ============================================================

/**
 * Convert an extension key to its env var prefix.
 * Dots are replaced with underscores, all letters uppercased.
 *
 * @example deriveEnvPrefix('llm.anthropic') === 'LLM_ANTHROPIC'
 * @example deriveEnvPrefix('kv.redis') === 'KV_REDIS'
 */
export function deriveEnvPrefix(extensionKey: string): string {
  return extensionKey.replace(/\./g, '_').toUpperCase();
}

function envKeyToField(prefix: string, envKey: string): string {
  return envKey.slice(prefix.length + 1).toLowerCase();
}

// ============================================================
// MERGE
// ============================================================

/**
 * Merge env vars into extension configs from the parsed config file.
 * Env vars override JSON config values.
 * Missing .env file is not an error.
 */
export function mergeEnvIntoConfig(configFile: ConfigFile): ConfigFile {
  const mergedExtensions: ConfigFile['extensions'] = {};

  for (const [key, entry] of Object.entries(configFile.extensions)) {
    const prefix = deriveEnvPrefix(key);
    const prefixWithUnderscore = prefix + '_';

    const merged: Record<string, unknown> = { ...(entry.config ?? {}) };

    for (const [envKey, envValue] of Object.entries(process.env)) {
      if (envKey.startsWith(prefixWithUnderscore) && envValue !== undefined) {
        const field = envKeyToField(prefix, envKey);
        merged[field] = envValue;
      }
    }

    mergedExtensions[key] = {
      package: entry.package,
      config: merged,
    };
  }

  return {
    extensions: mergedExtensions,
    modules: configFile.modules,
    bindings: configFile.bindings,
  };
}

// ============================================================
// REQUIRED FIELDS REGISTRY
// ============================================================

/**
 * Required config fields per extension package name.
 */
export const REQUIRED_FIELDS_BY_PACKAGE: Readonly<
  Record<string, readonly string[]>
> = {
  '@rcrsr/rill-ext-anthropic': ['api_key'],
  '@rcrsr/rill-ext-openai': ['api_key'],
  '@rcrsr/rill-ext-gemini': ['api_key'],
  '@rcrsr/rill-ext-mcp': ['transport'],
  '@rcrsr/rill-ext-kv-sqlite': ['mounts'],
  '@rcrsr/rill-ext-kv-redis': ['url', 'mounts'],
  '@rcrsr/rill-ext-chroma': ['collection'],
  '@rcrsr/rill-ext-pinecone': ['apiKey', 'index'],
  '@rcrsr/rill-ext-qdrant': ['url', 'collection'],
  '@rcrsr/rill-ext-fs-s3': ['region', 'mounts'],
};

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validate that all required fields are present in a merged extension config.
 * Exits process with code 1 on missing field.
 */
export function validateRequiredFields(
  namespace: string,
  config: Record<string, unknown>,
  requiredFields: string[]
): void {
  const prefix = deriveEnvPrefix(namespace);

  for (const field of requiredFields) {
    const value = config[field];
    if (value === undefined || value === null || value === '') {
      const envVar = `${prefix}_${field.toUpperCase()}`;
      process.stderr.write(
        `${namespace}: missing '${field}'. Set ${envVar} or add to config.\n`
      );
      process.exit(1);
    }
  }
}
