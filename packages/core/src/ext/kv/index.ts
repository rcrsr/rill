/**
 * KV Extension Factory
 *
 * Provides key-value store operations with JSON persistence and schema validation.
 * Supports both open mode (any key/value) and declared mode (schema-defined keys only).
 */

import type { ExtensionResult } from '../../runtime/ext/extensions.js';
import type { RillValue } from '../../runtime/core/values.js';
import { createStore, type SchemaEntry } from './store.js';

// ============================================================
// TYPES
// ============================================================

/** KV extension configuration */
export interface KvConfig {
  /** Path to store file */
  store: string;
  /** Schema definitions (optional, enables declared mode) */
  schema?: Record<string, SchemaEntry> | undefined;
  /** Maximum entries (default: 10000) */
  maxEntries?: number | undefined;
  /** Maximum value size in bytes (default: 102400 = 100KB) */
  maxValueSize?: number | undefined;
  /** Maximum store size in bytes (default: 10485760 = 10MB) */
  maxStoreSize?: number | undefined;
  /** Write policy: 'dispose' (default) or 'immediate' */
  writePolicy?: 'dispose' | 'immediate' | undefined;
}

// Re-export SchemaEntry for consumers
export type { SchemaEntry };

// ============================================================
// FACTORY
// ============================================================

/**
 * Create KV extension with persistent storage.
 *
 * Initializes store by loading existing file or creating with schema defaults.
 * Returns 8 functions: get, set, delete, keys, has, clear, getAll, schema.
 *
 * @param config - Store configuration
 * @returns ExtensionResult with 8 KV functions and dispose handler
 * @throws RuntimeError if store file is corrupt (EC-25)
 *
 * @example
 * ```typescript
 * const kvExt = createKvExtension({
 *   store: './data/state.json',
 *   schema: {
 *     count: { type: 'number', default: 0 }
 *   }
 * });
 * ```
 */
export function createKvExtension(config: KvConfig): ExtensionResult {
  // Apply defaults
  const maxEntries = config.maxEntries ?? 10000;
  const maxValueSize = config.maxValueSize ?? 102400; // 100KB
  const maxStoreSize = config.maxStoreSize ?? 10485760; // 10MB
  const writePolicy = config.writePolicy ?? 'dispose';

  // Store will be initialized lazily on first operation
  let storePromise: Promise<Awaited<ReturnType<typeof createStore>>> | null =
    null;
  let storeInstance: Awaited<ReturnType<typeof createStore>> | null = null;

  // Helper to get or create store
  const getStore = async (): Promise<
    Awaited<ReturnType<typeof createStore>>
  > => {
    if (storeInstance) return storeInstance;
    if (!storePromise) {
      storePromise = createStore({
        store: config.store,
        schema: config.schema,
        maxEntries,
        maxValueSize,
        maxStoreSize,
        writePolicy,
      });
    }
    storeInstance = await storePromise;
    return storeInstance;
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
    const store = await getStore();
    const key = args[0] as string;
    const value = store.get(key);
    // In rill, functions cannot return undefined - return empty string for missing keys in open mode
    return value !== undefined ? value : '';
  };

  /**
   * Set value with validation.
   * IR-16, EC-20-24
   */
  const set = async (args: RillValue[]): Promise<boolean> => {
    const store = await getStore();
    const key = args[0] as string;
    const value = args[1] as RillValue;

    await store.set(key, value);
    return true;
  };

  /**
   * Delete key.
   * IR-17
   */
  const deleteKey = async (args: RillValue[]): Promise<boolean> => {
    const store = await getStore();
    const key = args[0] as string;
    return store.delete(key);
  };

  /**
   * Get all keys.
   * IR-18
   */
  const keys = async (): Promise<string[]> => {
    const store = await getStore();
    return store.keys();
  };

  /**
   * Check key existence.
   * IR-19
   */
  const has = async (args: RillValue[]): Promise<boolean> => {
    const store = await getStore();
    const key = args[0] as string;
    return store.has(key);
  };

  /**
   * Clear all keys (restores schema defaults if declared mode).
   * IR-20
   */
  const clear = async (): Promise<boolean> => {
    const store = await getStore();
    store.clear();
    return true;
  };

  /**
   * Get all entries as dict.
   * IR-21
   */
  const getAll = async (): Promise<Record<string, RillValue>> => {
    const store = await getStore();
    return store.getAll();
  };

  /**
   * Get schema information (empty list in open mode).
   * IR-22
   */
  const schema = async (): Promise<RillValue[]> => {
    if (!config.schema) {
      return []; // Open mode - no schema
    }

    // Declared mode - return schema entries as list of dicts
    const result: RillValue[] = [];
    for (const [key, entry] of Object.entries(config.schema)) {
      result.push({
        key,
        type: entry.type,
        description: entry.description ?? '',
      });
    }
    return result;
  };

  // ============================================================
  // DISPOSE
  // ============================================================

  /**
   * Flush state to disk on dispose.
   */
  const dispose = async (): Promise<void> => {
    if (storeInstance) {
      await storeInstance.flush();
    }
  };

  // ============================================================
  // EXTENSION RESULT
  // ============================================================

  const result: ExtensionResult = {
    get: {
      params: [{ name: 'key', type: 'string', description: 'Key to retrieve' }],
      fn: get,
      description: 'Get value or schema default',
      returnType: 'any',
    },
    set: {
      params: [
        { name: 'key', type: 'string', description: 'Key to set' },
        { name: 'value', type: 'string', description: 'Value to store' },
      ],
      fn: set,
      description: 'Set value with validation',
      returnType: 'bool',
    },
    delete: {
      params: [{ name: 'key', type: 'string', description: 'Key to delete' }],
      fn: deleteKey,
      description: 'Delete key',
      returnType: 'bool',
    },
    keys: {
      params: [],
      fn: keys,
      description: 'Get all keys',
      returnType: 'list',
    },
    has: {
      params: [{ name: 'key', type: 'string', description: 'Key to check' }],
      fn: has,
      description: 'Check key existence',
      returnType: 'bool',
    },
    clear: {
      params: [],
      fn: clear,
      description: 'Clear all keys',
      returnType: 'bool',
    },
    getAll: {
      params: [],
      fn: getAll,
      description: 'Get all entries as dict',
      returnType: 'dict',
    },
    schema: {
      params: [],
      fn: schema,
      description: 'Get schema information',
      returnType: 'list',
    },
  };

  result.dispose = dispose;
  return result;
}
