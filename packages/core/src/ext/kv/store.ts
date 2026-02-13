/**
 * KV Store Implementation
 *
 * Provides JSON-based key-value persistence with schema validation.
 * Lifecycle: Load (read store file) -> Execute (in-memory operations) -> Flush (atomic write on dispose)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { RuntimeError } from '../../error-classes.js';
import type { RillValue } from '../../runtime/core/values.js';

// ============================================================
// TYPES
// ============================================================

/** Schema entry defining type and default for a key */
export interface SchemaEntry {
  type: 'string' | 'number' | 'bool' | 'list' | 'dict';
  default: RillValue;
  description?: string | undefined;
}

/** Store configuration */
export interface StoreConfig {
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
  /** Access mode: 'read', 'write', or 'read-write' (default: 'read-write') */
  mode?: 'read' | 'write' | 'read-write' | undefined;
}

// ============================================================
// STORE IMPLEMENTATION
// ============================================================

/**
 * Create KV store with JSON persistence.
 *
 * @param config - Store configuration
 * @returns Store operations object
 * @throws RuntimeError if store file is corrupt (EC-25)
 */
export async function createStore(config: StoreConfig): Promise<{
  get: (key: string) => RillValue | undefined;
  set: (key: string, value: RillValue) => Promise<void>;
  delete: (key: string) => boolean;
  keys: () => string[];
  has: (key: string) => boolean;
  clear: () => void;
  getAll: () => Record<string, RillValue>;
  flush: () => Promise<void>;
}> {
  // Apply defaults
  const maxEntries = config.maxEntries ?? 10000;
  const maxValueSize = config.maxValueSize ?? 102400; // 100KB
  const maxStoreSize = config.maxStoreSize ?? 10485760; // 10MB
  const writePolicy = config.writePolicy ?? 'dispose';
  const mode = config.mode ?? 'read-write';
  const schema = config.schema;

  // Resolve store path
  const storePath = path.resolve(config.store);
  const storeDir = path.dirname(storePath);

  // Ensure store directory exists
  await fs.mkdir(storeDir, { recursive: true });

  // In-memory data store
  const data = new Map<string, RillValue>();

  // ============================================================
  // LOAD PHASE
  // ============================================================

  // Load existing store file or initialize with schema defaults
  try {
    const fileContent = await fs.readFile(storePath, 'utf-8');
    const parsed = JSON.parse(fileContent) as Record<string, unknown>;

    // Validate and load entries
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      // EC-25: Store file corrupt
      throw new RuntimeError(
        'RILL-R004',
        'state file corrupt — reset or delete to recover',
        undefined,
        { path: storePath }
      );
    }

    // Apply schema validation if in declared mode
    if (schema) {
      // Load declared keys with defaults, validate existing values
      for (const [key, schemaEntry] of Object.entries(schema)) {
        if (key in parsed) {
          const value = parsed[key] as RillValue;
          validateType(key, value, schemaEntry.type, storePath);
          data.set(key, value);
        } else {
          // Missing key - use default from schema
          data.set(key, schemaEntry.default);
        }
      }
      // Extra keys in file are dropped (not in schema)
    } else {
      // Open mode - load all keys
      for (const [key, value] of Object.entries(parsed)) {
        data.set(key, value as RillValue);
      }
    }
  } catch (error) {
    if (error instanceof RuntimeError) {
      throw error; // Re-throw our error
    }

    // Check if file doesn't exist (first run)
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code: string }).code === 'ENOENT'
    ) {
      // First run - initialize with schema defaults if declared mode
      if (schema) {
        for (const [key, schemaEntry] of Object.entries(schema)) {
          data.set(key, schemaEntry.default);
        }
      }
      // If open mode and file doesn't exist, data remains empty
    } else if (error instanceof SyntaxError) {
      // JSON parse error
      throw new RuntimeError(
        'RILL-R004',
        'state file corrupt — reset or delete to recover',
        undefined,
        { path: storePath }
      );
    } else {
      // Other filesystem error
      throw error;
    }
  }

  // ============================================================
  // HELPERS
  // ============================================================

  /** Check if mode allows write operations */
  function checkWritePermission(): void {
    if (mode === 'read') {
      throw new RuntimeError(
        'RILL-R004',
        `Store is read-only (mode: ${mode})`,
        undefined,
        { mode, path: storePath }
      );
    }
  }

  /** Calculate size of a value in bytes */
  function calculateValueSize(value: RillValue): number {
    return Buffer.byteLength(JSON.stringify(value), 'utf-8');
  }

  /** Calculate total store size in bytes */
  function calculateStoreSize(): number {
    const entries: Record<string, RillValue> = {};
    for (const [key, value] of data.entries()) {
      entries[key] = value;
    }
    return Buffer.byteLength(JSON.stringify(entries), 'utf-8');
  }

  /** Validate value type against schema */
  function validateType(
    key: string,
    value: RillValue,
    expectedType: SchemaEntry['type'],
    location: string
  ): void {
    let actualType: string;

    if (typeof value === 'string') {
      actualType = 'string';
    } else if (typeof value === 'number') {
      actualType = 'number';
    } else if (typeof value === 'boolean') {
      actualType = 'bool';
    } else if (Array.isArray(value)) {
      actualType = 'list';
    } else if (typeof value === 'object' && value !== null) {
      actualType = 'dict';
    } else {
      actualType = typeof value;
    }

    // EC-21: Type mismatch
    if (actualType !== expectedType) {
      throw new RuntimeError(
        'RILL-R004',
        `key "${key}" expects ${expectedType}, got ${actualType}`,
        undefined,
        { key, expectedType, actualType, location }
      );
    }
  }

  // ============================================================
  // OPERATIONS
  // ============================================================

  /** Get value or schema default */
  function get(key: string): RillValue | undefined {
    // EC-20: Key not in schema (declared mode)
    if (schema && !(key in schema)) {
      throw new RuntimeError(
        'RILL-R004',
        `key "${key}" not declared in schema`,
        undefined,
        { key }
      );
    }

    return data.get(key);
  }

  /** Set value with validation */
  async function set(key: string, value: RillValue): Promise<void> {
    // IC-2, EC-3: Check write permission
    checkWritePermission();

    // EC-20: Key not in schema (declared mode)
    if (schema && !(key in schema)) {
      throw new RuntimeError(
        'RILL-R004',
        `key "${key}" not declared in schema`,
        undefined,
        { key }
      );
    }

    // Validate type if in declared mode
    if (schema && key in schema) {
      validateType(key, value, schema[key]!.type, storePath);
    }

    // EC-22: Value exceeds maxValueSize
    const valueSize = calculateValueSize(value);
    if (valueSize > maxValueSize) {
      throw new RuntimeError(
        'RILL-R004',
        `value for "${key}" exceeds size limit`,
        undefined,
        { key, size: valueSize, max: maxValueSize }
      );
    }

    // EC-24: Max entries exceeded (when adding new key)
    if (!data.has(key) && data.size >= maxEntries) {
      throw new RuntimeError(
        'RILL-R004',
        `store exceeds entry limit (${data.size + 1} > ${maxEntries})`,
        undefined,
        { count: data.size + 1, max: maxEntries }
      );
    }

    // Save old value for rollback (if key exists)
    const oldValue = data.get(key);
    const hadKey = data.has(key);

    // Set value
    data.set(key, value);

    // EC-23: Store exceeds maxStoreSize
    const storeSize = calculateStoreSize();
    if (storeSize > maxStoreSize) {
      // Rollback the set operation
      if (hadKey) {
        data.set(key, oldValue!);
      } else {
        data.delete(key);
      }
      throw new RuntimeError(
        'RILL-R004',
        `store exceeds size limit (${storeSize} > ${maxStoreSize})`,
        undefined,
        { size: storeSize, max: maxStoreSize }
      );
    }

    // Immediate write if policy is 'immediate'
    if (writePolicy === 'immediate') {
      await flush();
    }
  }

  /** Delete key */
  function deleteKey(key: string): boolean {
    // IC-2: Check write permission
    checkWritePermission();
    return data.delete(key);
  }

  /** Get all keys */
  function keys(): string[] {
    return Array.from(data.keys());
  }

  /** Check key existence */
  function has(key: string): boolean {
    return data.has(key);
  }

  /** Clear all keys */
  function clear(): void {
    // IC-2: Check write permission
    checkWritePermission();

    data.clear();

    // If in declared mode, restore schema defaults
    if (schema) {
      for (const [key, schemaEntry] of Object.entries(schema)) {
        data.set(key, schemaEntry.default);
      }
    }
  }

  /** Get all entries as dict */
  function getAll(): Record<string, RillValue> {
    const result: Record<string, RillValue> = {};
    for (const [key, value] of data.entries()) {
      result[key] = value;
    }
    return result;
  }

  /** Flush data to disk (atomic write) */
  async function flush(): Promise<void> {
    const entries = getAll();
    const content = JSON.stringify(entries, null, 2);

    // Atomic write: write to .tmp file, then rename
    const tmpPath = `${storePath}.tmp`;
    try {
      await fs.writeFile(tmpPath, content, 'utf-8');
      await fs.rename(tmpPath, storePath);
    } catch (error) {
      // Flush failure - log warning, don't throw (per spec)
      console.warn(`[KV Store] Failed to flush state to ${storePath}:`, error);

      // Clean up tmp file if it exists
      try {
        await fs.unlink(tmpPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  // ============================================================
  // RETURN STORE OPERATIONS
  // ============================================================

  return {
    get,
    set,
    delete: deleteKey,
    keys,
    has,
    clear,
    getAll,
    flush,
  };
}
