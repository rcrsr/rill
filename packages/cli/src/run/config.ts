/**
 * Config file loader for rill-run.
 * Reads and parses rill-config.json.
 */

import { readFileSync, existsSync } from 'node:fs';
import type { ConfigFile } from './types.js';

// ============================================================
// LOADER
// ============================================================

/**
 * Load and parse a rill-ext config JSON file.
 * Exits process with code 1 on file not found or parse error.
 *
 * @param configPath - Absolute or relative path to the config file
 * @returns Parsed ConfigFile with defaults applied
 */
export function loadConfig(configPath: string): ConfigFile {
  if (!existsSync(configPath)) {
    process.stderr.write(`Config not found: ${configPath}\n`);
    process.exit(1);
  }

  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Failed to read config: ${message}\n`);
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }

  const data = parsed as Record<string, unknown>;

  const extensions =
    data['extensions'] !== undefined && typeof data['extensions'] === 'object'
      ? (data['extensions'] as Record<string, unknown>)
      : {};

  const modules =
    data['modules'] !== undefined && typeof data['modules'] === 'object'
      ? (data['modules'] as Record<string, string>)
      : {};

  const bindings =
    typeof data['bindings'] === 'string' ? data['bindings'] : undefined;

  // Normalize each extension entry to ensure config defaults to {}
  const normalizedExtensions: ConfigFile['extensions'] = {};
  for (const [key, entry] of Object.entries(extensions)) {
    const e = entry as Record<string, unknown>;
    normalizedExtensions[key] = {
      package: typeof e['package'] === 'string' ? e['package'] : '',
      config:
        e['config'] !== undefined && typeof e['config'] === 'object'
          ? (e['config'] as Record<string, unknown>)
          : {},
    };
  }

  return {
    extensions: normalizedExtensions,
    modules,
    bindings,
  };
}
