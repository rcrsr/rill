/**
 * Built-in Scheme Resolvers
 *
 * moduleResolver — reads Rill source files from the filesystem.
 * extResolver    — returns extension values from a host-provided config map.
 */

import { RuntimeError } from '../../error-classes.js';
import type { ResolverResult, SchemeResolver } from './types.js';
import type { RillValue } from './values.js';

// ============================================================
// MODULE RESOLVER
// ============================================================

/**
 * Resolves a module ID to Rill source text by reading a file.
 *
 * Config shape: `{ [moduleId: string]: string }`
 * - Each key is a module ID mapping to an absolute file path string.
 *   The caller is responsible for resolving paths before passing them in.
 *
 * Error codes:
 * - RILL-R059 when config is not a plain object
 * - RILL-R050 when the module ID is absent from the config map
 * - RILL-R051 when the file cannot be read
 */
export const moduleResolver: SchemeResolver = async (
  resource: string,
  config?: unknown
): Promise<ResolverResult> => {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new RuntimeError(
      'RILL-R059',
      'moduleResolver config must be a plain object'
    );
  }

  const cfg = config as Record<string, string>;

  const filePath = cfg[resource];
  if (typeof filePath !== 'string') {
    throw new RuntimeError(
      'RILL-R050',
      `Module '${resource}' not found in resolver config`,
      undefined,
      { resource }
    );
  }

  const { readFile } = await import('node:fs/promises');

  let text: string;
  try {
    text = await readFile(filePath, { encoding: 'utf8' });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new RuntimeError(
      'RILL-R051',
      `Failed to read module '${resource}': ${reason}`,
      undefined,
      { resource, reason }
    );
  }

  return { kind: 'source', text, sourceId: filePath };
};

// ============================================================
// EXTENSION RESOLVER
// ============================================================

/**
 * Resolves an extension name (or dot-path member) to a RillValue.
 *
 * Config shape: `Record<string, RillValue>` mapping extension name to value.
 *
 * Resource formats:
 * - `"qdrant"` — returns the full extension value from config.
 * - `"qdrant.search"` — returns the `search` member of the qdrant value.
 *
 * Dot-path: split by `.`, first segment is the extension name,
 * remaining segments traverse the dict structure of the extension value.
 *
 * Error codes:
 * - RILL-R052 when the extension name is absent from config
 * - RILL-R053 when a member path segment is not found in the extension value
 */
// ============================================================
// CONTEXT RESOLVER
// ============================================================

/**
 * Resolves a dot-path key to a value from a host-provided context config.
 *
 * Config shape: `Record<string, unknown>` (flat or nested).
 *
 * Resource formats:
 * - `"timeout"` — returns the top-level `timeout` value from config.
 * - `"limits.max_tokens"` — traverses into `limits`, returns `max_tokens`.
 *
 * Dot-path: split by `.`, walk nested dicts at each segment.
 *
 * Error codes:
 * - RILL-R062 when the top-level key is absent from config
 * - RILL-R063 when an intermediate segment is not a dict
 */
export const contextResolver: SchemeResolver = (
  resource: string,
  config?: unknown
): ResolverResult => {
  const cfg = (config ?? {}) as Record<string, unknown>;

  const segments = resource.split('.');
  const key = segments[0] ?? resource;

  if (!(key in cfg)) {
    throw new RuntimeError(
      'RILL-R062',
      `Context key '${resource}' not found`,
      undefined,
      { key: resource }
    );
  }

  let value: unknown = cfg[key];

  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i] as string;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      const path = segments.slice(0, i).join('.');
      throw new RuntimeError(
        'RILL-R063',
        `Context path '${resource}': '${path}' is not a dict`,
        undefined,
        { path, segment }
      );
    }
    value = (value as Record<string, unknown>)[segment];
    if (value === undefined) {
      throw new RuntimeError(
        'RILL-R062',
        `Context key '${resource}' not found`,
        undefined,
        { key: resource }
      );
    }
  }

  return { kind: 'value', value: value as RillValue };
};

export const extResolver: SchemeResolver = (
  resource: string,
  config?: unknown
): ResolverResult => {
  const cfg = (config ?? {}) as Record<string, RillValue>;

  const segments = resource.split('.');
  const name = segments[0] ?? resource;

  if (!(name in cfg)) {
    throw new RuntimeError(
      'RILL-R052',
      `Extension '${name}' not found in resolver config`,
      undefined,
      { name }
    );
  }

  let value: RillValue = cfg[name] as RillValue;

  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i] as string;
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      !(segment in (value as Record<string, RillValue>))
    ) {
      const path = segments.slice(1, i + 1).join('.');
      throw new RuntimeError(
        'RILL-R053',
        `Member '${path}' not found in extension '${name}'`,
        undefined,
        { path, name }
      );
    }
    value = (value as Record<string, RillValue>)[segment] as RillValue;
  }

  return { kind: 'value', value };
};
