/**
 * Built-in Scheme Resolvers
 *
 * moduleResolver — reads Rill source files from the filesystem.
 * extResolver    — returns extension values from a host-provided config map.
 */

import { RuntimeError } from '../../error-classes.js';
import type { ResolverResult, SchemeResolver } from './types/runtime.js';
import type { RillValue } from './types/structures.js';
import { ERROR_IDS } from '../../error-registry.js';
import { isObjectRecord, isPlainDict } from './types/guards.js';

// ============================================================
// HOST CONFIG BOUNDARY
// ============================================================

// SchemeResolver config is publicly typed unknown; host-supplied maps pass
// through unchecked, so the cast documents the trust boundary.
function hostConfigRecord(config: unknown): Record<string, unknown> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- config is publicly typed unknown and the host owns its shape; a guard would change which hosts resolve today
  return (config ?? {}) as Record<string, unknown>;
}

function hostConfigValue(value: unknown): RillValue {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- config values are host-supplied through an unknown-typed boundary and pass through unchecked
  return value as RillValue;
}

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
  if (!isObjectRecord(config) || Array.isArray(config)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R059,
      'moduleResolver config must be a plain object'
    );
  }

  const filePath = config[resource];
  if (typeof filePath !== 'string') {
    throw new RuntimeError(
      ERROR_IDS.RILL_R050,
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
      ERROR_IDS.RILL_R051,
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
 * Intermediate segments must be dicts; a callable may be the final segment
 * but is never traversed.
 *
 * Error codes:
 * - RILL-R052 when the extension name is absent from config
 * - RILL-R053 when a member path segment is not found in the extension value,
 *   or the walk would descend into a callable, tuple, ordered, vector, or stream
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
 * Dot-path: split by `.`, walk nested dicts at each segment. Intermediate
 * segments must be dicts; a callable may be the final segment but is never
 * traversed.
 *
 * Error codes:
 * - RILL-R062 when the top-level key is absent from config
 * - RILL-R063 when an intermediate segment is not a dict (a callable, tuple,
 *   ordered, vector, or stream is not a dict)
 */
export const contextResolver: SchemeResolver = (
  resource: string,
  config?: unknown
): ResolverResult => {
  const cfg = hostConfigRecord(config);

  const segments = resource.split('.');
  const key = segments[0] ?? resource;

  // Object.hasOwn (not `in`) so inherited members (constructor, __proto__, ...)
  // are never resolvable as config keys.
  if (!Object.hasOwn(cfg, key)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R062,
      `Context key '${resource}' not found`,
      undefined,
      { key: resource }
    );
  }

  let value: unknown = cfg[key];

  for (const [i, segment] of segments.entries()) {
    if (i === 0) continue;
    const current = hostConfigValue(value);
    if (!isPlainDict(current)) {
      const path = segments.slice(0, i).join('.');
      throw new RuntimeError(
        ERROR_IDS.RILL_R063,
        `Context path '${resource}': '${path}' is not a dict`,
        undefined,
        { path, segment }
      );
    }
    if (!Object.hasOwn(current, segment)) {
      throw new RuntimeError(
        ERROR_IDS.RILL_R062,
        `Context key '${resource}' not found`,
        undefined,
        { key: resource }
      );
    }
    value = current[segment];
    if (value === undefined) {
      throw new RuntimeError(
        ERROR_IDS.RILL_R062,
        `Context key '${resource}' not found`,
        undefined,
        { key: resource }
      );
    }
  }

  return { kind: 'value', value: hostConfigValue(value) };
};

export const extResolver: SchemeResolver = (
  resource: string,
  config?: unknown
): ResolverResult => {
  const cfg = hostConfigRecord(config);

  const segments = resource.split('.');
  const name = segments[0] ?? resource;

  // Object.hasOwn (not `in`) so inherited members (constructor, __proto__, ...)
  // are never resolvable as extension names or member paths.
  if (!Object.hasOwn(cfg, name)) {
    throw new RuntimeError(
      ERROR_IDS.RILL_R052,
      `Extension '${name}' not found in resolver config`,
      undefined,
      { name }
    );
  }

  let value: RillValue = hostConfigValue(cfg[name]);

  for (const [i, segment] of segments.entries()) {
    if (i === 0) continue;
    if (!isPlainDict(value) || !Object.hasOwn(value, segment)) {
      const path = segments.slice(1, i + 1).join('.');
      throw new RuntimeError(
        ERROR_IDS.RILL_R053,
        `Member '${path}' not found in extension '${name}'`,
        undefined,
        { path, name }
      );
    }
    value = hostConfigValue(value[segment]);
  }

  return { kind: 'value', value };
};
