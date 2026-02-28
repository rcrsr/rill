import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { EnvSource } from './schema.js';

// ============================================================
// DOTENV PARSER
// ============================================================

/**
 * Parses a .env file string into a key-value record.
 *
 * Supported syntax:
 * - KEY=value         (unquoted)
 * - KEY="value"       (double-quoted)
 * - KEY='value'       (single-quoted)
 * - # comment lines   (skipped)
 * - blank lines       (skipped)
 *
 * Values are not interpolated. Inline comments are not stripped.
 */
function parseDotenv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;

    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }
  return result;
}

// ============================================================
// LOAD ENV
// ============================================================

/**
 * Builds an env map by merging the given sources in declaration order.
 * Later sources override earlier ones.
 *
 * Sources:
 * - `{ type: 'process' }` — merges process.env
 * - `{ type: 'dotenv', path }` — reads and parses a .env file relative to basePath;
 *   missing files emit a warning to stderr and are skipped (non-fatal)
 *
 * If `sources` is undefined or empty, returns process.env.
 */
export function loadEnv(
  sources: readonly EnvSource[] | undefined,
  basePath: string
): Record<string, string> {
  if (sources === undefined || sources.length === 0) {
    return process.env as Record<string, string>;
  }

  let merged: Record<string, string> = {};

  for (const source of sources) {
    if (source.type === 'process') {
      merged = { ...merged, ...(process.env as Record<string, string>) };
    } else if (source.type === 'dotenv') {
      const absPath = path.resolve(basePath, source.path);
      if (!existsSync(absPath)) {
        process.stderr.write(
          `Warning: env source dotenv "${source.path}" not found at ${absPath} — skipped\n`
        );
        continue;
      }
      const content = readFileSync(absPath, 'utf-8');
      merged = { ...merged, ...parseDotenv(content) };
    }
  }

  return merged;
}
