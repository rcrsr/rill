/**
 * KV Extension Factory
 *
 * Provides key-value store operations with JSON persistence and schema validation.
 * Supports both open mode (any key/value) and declared mode (schema-defined keys only).
 */

import type { ExtensionResult } from '../../runtime/ext/extensions.js';
import type { RillValue } from '../../runtime/core/values.js';
import { RuntimeError } from '../../error-classes.js';
import { isDict } from '../../runtime/core/callable.js';
import { createStore, type SchemaEntry } from './store.js';

// ============================================================
// TYPES
// ============================================================

/** Configuration for a single KV mount */
export interface KvMountConfig {
  /** Access mode: 'read', 'write', or 'read-write' */
  mode: 'read' | 'write' | 'read-write';
  /** Schema definitions (optional, enables declared mode) */
  schema?: Record<string, SchemaEntry> | undefined;
  /** Path to store file (required for JSON backend) */
  store: string;
  /** Maximum entries (default: 10000) */
  maxEntries?: number | undefined;
  /** Maximum value size in bytes (default: 102400 = 100KB) */
  maxValueSize?: number | undefined;
  /** Maximum store size in bytes (default: 10485760 = 10MB) */
  maxStoreSize?: number | undefined;
  /** Write policy: 'dispose' (default) or 'immediate' */
  writePolicy?: 'dispose' | 'immediate' | undefined;
}

/** KV extension configuration (supports both single-store and multi-mount) */
export interface KvConfig {
  /** Mount definitions keyed by mount name (new mount-based config) */
  mounts?: Record<string, KvMountConfig> | undefined;
  /** Path to store file (legacy single-store config - creates implicit "default" mount) */
  store?: string | undefined;
  /** Schema definitions (legacy, for single-store mode) */
  schema?: Record<string, SchemaEntry> | undefined;
  /** Maximum entries (legacy, default: 10000) */
  maxEntries?: number | undefined;
  /** Maximum value size in bytes (legacy, default: 102400 = 100KB) */
  maxValueSize?: number | undefined;
  /** Maximum store size in bytes (legacy, default: 10485760 = 10MB) */
  maxStoreSize?: number | undefined;
  /** Write policy (legacy): 'dispose' (default) or 'immediate' */
  writePolicy?: 'dispose' | 'immediate' | undefined;
  /** Access mode (legacy): 'read', 'write', or 'read-write' (default: 'read-write') */
  mode?: 'read' | 'write' | 'read-write' | undefined;
}

// Re-export SchemaEntry for consumers
export type { SchemaEntry };

// ============================================================
// FACTORY
// ============================================================

/**
 * Create KV extension with persistent storage.
 *
 * Supports both mount-based configuration (new) and single-store configuration (legacy).
 * Returns 11 functions: get, get_or, set, merge, delete, keys, has, clear, getAll, schema, mounts.
 *
 * @param config - Store configuration (mount-based or single-store)
 * @returns ExtensionResult with 11 KV functions and dispose handler
 * @throws RuntimeError if store file is corrupt (EC-25)
 *
 * @example
 * ```typescript
 * // Multi-mount configuration
 * const kvExt = createKvExtension({
 *   mounts: {
 *     user: {
 *       mode: 'read-write',
 *       store: './data/user.json',
 *       schema: { name: { type: 'string', default: '' } }
 *     },
 *     cache: {
 *       mode: 'read-write',
 *       store: './data/cache.json'
 *     }
 *   }
 * });
 *
 * // Single-store configuration (backward compatible - creates implicit "default" mount)
 * const kvExt = createKvExtension({
 *   store: './data/state.json',
 *   schema: { count: { type: 'number', default: 0 } }
 * });
 * ```
 */
export function createKvExtension(config: KvConfig): ExtensionResult {
  // Normalize config: convert single-store to mount-based
  let mounts: Record<string, KvMountConfig>;

  if (config.mounts) {
    // Mount-based configuration
    mounts = { ...config.mounts };
  } else if (config.store) {
    // Single-store configuration - create implicit "default" mount
    mounts = {
      default: {
        mode: config.mode ?? 'read-write',
        store: config.store,
        schema: config.schema,
        maxEntries: config.maxEntries,
        maxValueSize: config.maxValueSize,
        maxStoreSize: config.maxStoreSize,
        writePolicy: config.writePolicy,
      },
    };
  } else {
    throw new RuntimeError(
      'RILL-R004',
      'KV extension requires either "mounts" or "store" configuration',
      undefined,
      { config }
    );
  }

  // Store instances keyed by mount name
  const stores = new Map<
    string,
    {
      promise: Promise<Awaited<ReturnType<typeof createStore>>> | null;
      instance: Awaited<ReturnType<typeof createStore>> | null;
    }
  >();

  // Initialize stores map
  for (const mountName of Object.keys(mounts)) {
    stores.set(mountName, { promise: null, instance: null });
  }

  // Helper to get or create store for a mount
  const getStore = async (
    mountName: string
  ): Promise<Awaited<ReturnType<typeof createStore>>> => {
    const mountConfig = mounts[mountName];
    if (!mountConfig) {
      throw new RuntimeError(
        'RILL-R004',
        `Mount '${mountName}' not found`,
        undefined,
        { mountName, availableMounts: Object.keys(mounts) }
      );
    }

    const storeState = stores.get(mountName)!;

    if (storeState.instance) return storeState.instance;

    if (!storeState.promise) {
      storeState.promise = createStore({
        store: mountConfig.store,
        schema: mountConfig.schema,
        maxEntries: mountConfig.maxEntries ?? 10000,
        maxValueSize: mountConfig.maxValueSize ?? 102400,
        maxStoreSize: mountConfig.maxStoreSize ?? 10485760,
        writePolicy: mountConfig.writePolicy ?? 'dispose',
        mode: mountConfig.mode,
      });
    }

    storeState.instance = await storeState.promise;
    return storeState.instance;
  };

  // ============================================================
  // FUNCTIONS
  // ============================================================

  /**
   * Get value or schema default.
   * IR-15, EC-20 (key not in schema)
   * Returns empty string for missing keys in open mode.
   */
  const get = async (args: RillValue[]): Promise<RillValue> => {
    const mountName = args[0] as string;
    const key = args[1] as string;
    const store = await getStore(mountName);
    const value = store.get(key);
    // In rill, functions cannot return undefined - return empty string for missing keys in open mode
    return value !== undefined ? value : '';
  };

  /**
   * Get value or fallback if key missing.
   * IR-2
   * Never throws for missing keys (unlike get in declared mode).
   */
  const get_or = async (args: RillValue[]): Promise<RillValue> => {
    const mountName = args[0] as string;
    const key = args[1] as string;
    const fallback = args[2] as RillValue;
    const store = await getStore(mountName);

    // Check if key exists using has() to avoid schema validation errors
    if (store.has(key)) {
      return store.get(key)!;
    }

    // Key missing - return fallback without throwing
    return fallback;
  };

  /**
   * Set value with validation.
   * IR-16, EC-20-24
   */
  const set = async (args: RillValue[]): Promise<boolean> => {
    const mountName = args[0] as string;
    const key = args[1] as string;
    const value = args[2] as RillValue;
    const store = await getStore(mountName);

    await store.set(key, value);
    return true;
  };

  /**
   * Merge partial dict into existing dict value.
   * IR-4, EC-5, EC-6
   */
  const merge = async (args: RillValue[]): Promise<boolean> => {
    const mountName = args[0] as string;
    const key = args[1] as string;
    const partial = args[2] as Record<string, RillValue>;
    const store = await getStore(mountName);

    // Get current value
    const currentValue = store.get(key);

    // EC-5: Existing value must be a dict
    if (currentValue !== undefined && !isDict(currentValue)) {
      throw new RuntimeError(
        'RILL-R004',
        `Cannot merge into non-dict value at key "${key}"`,
        undefined,
        { key, currentType: typeof currentValue }
      );
    }

    // Merge partial into current dict (shallow merge)
    const mergedValue = {
      ...(currentValue as Record<string, RillValue> | undefined),
      ...partial,
    };

    // Set merged value (this handles permission check via store.set)
    await store.set(key, mergedValue);
    return true;
  };

  /**
   * Delete key.
   * IR-17
   */
  const deleteKey = async (args: RillValue[]): Promise<boolean> => {
    const mountName = args[0] as string;
    const key = args[1] as string;
    const store = await getStore(mountName);
    return store.delete(key);
  };

  /**
   * Get all keys.
   * IR-6
   */
  const keys = async (args: RillValue[]): Promise<string[]> => {
    const mountName = args[0] as string;
    const store = await getStore(mountName);
    return store.keys();
  };

  /**
   * Check key existence.
   * IR-7
   */
  const has = async (args: RillValue[]): Promise<boolean> => {
    const mountName = args[0] as string;
    const key = args[1] as string;
    const store = await getStore(mountName);
    return store.has(key);
  };

  /**
   * Clear all keys (restores schema defaults if declared mode).
   * IR-8
   */
  const clear = async (args: RillValue[]): Promise<boolean> => {
    const mountName = args[0] as string;
    const store = await getStore(mountName);
    store.clear();
    return true;
  };

  /**
   * Get all entries as dict.
   * IR-9
   */
  const getAll = async (
    args: RillValue[]
  ): Promise<Record<string, RillValue>> => {
    const mountName = args[0] as string;
    const store = await getStore(mountName);
    return store.getAll();
  };

  /**
   * Get schema information (empty list in open mode).
   * IR-10
   */
  const schema = async (args: RillValue[]): Promise<RillValue[]> => {
    const mountName = args[0] as string;
    const mountConfig = mounts[mountName];

    if (!mountConfig) {
      throw new RuntimeError(
        'RILL-R004',
        `Mount '${mountName}' not found`,
        undefined,
        { mountName, availableMounts: Object.keys(mounts) }
      );
    }

    if (!mountConfig.schema) {
      return []; // Open mode - no schema
    }

    // Declared mode - return schema entries as list of dicts
    const result: RillValue[] = [];
    for (const [key, entry] of Object.entries(mountConfig.schema)) {
      result.push({
        key,
        type: entry.type,
        description: entry.description ?? '',
      });
    }
    return result;
  };

  /**
   * Get list of mount metadata.
   * IR-11
   */
  const mountsList = async (): Promise<RillValue[]> => {
    const result: RillValue[] = [];

    for (const [name, config] of Object.entries(mounts)) {
      result.push({
        name,
        mode: config.mode,
        schema: config.schema ? 'declared' : 'open',
        maxEntries: config.maxEntries ?? 10000,
        maxValueSize: config.maxValueSize ?? 102400,
      });
    }

    return result;
  };

  // ============================================================
  // DISPOSE
  // ============================================================

  /**
   * Flush all mount stores to disk on dispose.
   */
  const dispose = async (): Promise<void> => {
    const flushPromises: Promise<void>[] = [];
    for (const storeState of stores.values()) {
      if (storeState.instance) {
        flushPromises.push(storeState.instance.flush());
      }
    }
    await Promise.all(flushPromises);
  };

  // ============================================================
  // EXTENSION RESULT
  // ============================================================

  const result: ExtensionResult = {
    get: {
      params: [
        { name: 'mount', type: 'string', description: 'Mount name' },
        { name: 'key', type: 'string', description: 'Key to retrieve' },
      ],
      fn: get,
      description: 'Get value or schema default',
      returnType: 'any',
    },
    get_or: {
      params: [
        { name: 'mount', type: 'string', description: 'Mount name' },
        { name: 'key', type: 'string', description: 'Key to retrieve' },
        {
          name: 'fallback',
          type: 'dict',
          description: 'Fallback value if key missing',
        },
      ],
      fn: get_or,
      description: 'Get value or return fallback if key missing',
      returnType: 'any',
    },
    set: {
      params: [
        { name: 'mount', type: 'string', description: 'Mount name' },
        { name: 'key', type: 'string', description: 'Key to set' },
        { name: 'value', type: 'string', description: 'Value to store' },
      ],
      fn: set,
      description: 'Set value with validation',
      returnType: 'bool',
    },
    merge: {
      params: [
        { name: 'mount', type: 'string', description: 'Mount name' },
        { name: 'key', type: 'string', description: 'Key to merge into' },
        { name: 'partial', type: 'dict', description: 'Partial dict to merge' },
      ],
      fn: merge,
      description: 'Merge partial dict into existing dict value',
      returnType: 'bool',
    },
    delete: {
      params: [
        { name: 'mount', type: 'string', description: 'Mount name' },
        { name: 'key', type: 'string', description: 'Key to delete' },
      ],
      fn: deleteKey,
      description: 'Delete key',
      returnType: 'bool',
    },
    keys: {
      params: [{ name: 'mount', type: 'string', description: 'Mount name' }],
      fn: keys,
      description: 'Get all keys in mount',
      returnType: 'list',
    },
    has: {
      params: [
        { name: 'mount', type: 'string', description: 'Mount name' },
        { name: 'key', type: 'string', description: 'Key to check' },
      ],
      fn: has,
      description: 'Check key existence',
      returnType: 'bool',
    },
    clear: {
      params: [{ name: 'mount', type: 'string', description: 'Mount name' }],
      fn: clear,
      description: 'Clear all keys in mount',
      returnType: 'bool',
    },
    getAll: {
      params: [{ name: 'mount', type: 'string', description: 'Mount name' }],
      fn: getAll,
      description: 'Get all entries as dict',
      returnType: 'dict',
    },
    schema: {
      params: [{ name: 'mount', type: 'string', description: 'Mount name' }],
      fn: schema,
      description: 'Get schema information',
      returnType: 'list',
    },
    mounts: {
      params: [],
      fn: mountsList,
      description: 'Get list of mount metadata',
      returnType: 'list',
    },
  };

  result.dispose = dispose;
  return result;
}
