/**
 * Extension factory for SQLite kv storage backend.
 * Creates extension instance with config validation and database lifecycle management.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ExtensionResult, RillValue } from '@rcrsr/rill';
import type { SqliteKvConfig, SqliteKvMountConfig } from './types.js';

// ============================================================
// INTERNAL TYPES
// ============================================================

/**
 * Database instance for a mount.
 * Tracks Database connection and prepared statements.
 */
interface MountDatabase {
  /** better-sqlite3 Database instance */
  db: Database.Database;
  /** Table name for this mount */
  table: string;
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create SQLite kv extension instance.
 * Validates configuration and returns host functions with cleanup.
 *
 * @param config - Extension configuration
 * @returns ExtensionResult with kv storage functions and dispose
 * @throws Error for invalid configuration (AC-10)
 *
 * @example
 * ```typescript
 * const ext = createSqliteKvExtension({
 *   mounts: {
 *     user: {
 *       mode: 'read-write',
 *       database: './data/app.db',
 *       table: 'user_state'
 *     }
 *   }
 * });
 * // Use with rill runtime...
 * await ext.dispose();
 * ```
 */
export function createSqliteKvExtension(
  config: SqliteKvConfig
): ExtensionResult {
  // Validate required configuration (AC-10)
  if (!config.mounts || Object.keys(config.mounts).length === 0) {
    throw new Error(
      'SQLite kv extension requires at least one mount in configuration'
    );
  }

  // Track database instances per mount
  const databases = new Map<string, MountDatabase>();

  // Initialize databases for all mounts
  for (const [mountName, mountConfig] of Object.entries(config.mounts)) {
    try {
      // Validate database path - ensure directory exists or can be created (AC-10)
      const dbPath = mountConfig.database;
      const dbDir = dirname(dbPath);

      if (!existsSync(dbDir)) {
        try {
          mkdirSync(dbDir, { recursive: true });
        } catch (error: unknown) {
          throw new Error(
            `Failed to create directory for database path "${dbPath}": ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // Create/open database
      const db = new Database(dbPath);

      // Enable WAL mode for concurrent reader safety
      db.pragma('journal_mode = WAL');

      // Create table if not exists
      const tableName = mountConfig.table;

      // Validate table name contains only alphanumeric and underscore
      const TABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
      if (!TABLE_NAME_PATTERN.test(tableName)) {
        throw new Error(
          `Invalid table name "${tableName}": must match pattern ${TABLE_NAME_PATTERN}`
        );
      }

      db.exec(`
        CREATE TABLE IF NOT EXISTS ${tableName} (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);

      // Store database instance
      databases.set(mountName, { db, table: tableName });
    } catch (error: unknown) {
      // Clean up any opened databases on error
      for (const { db } of databases.values()) {
        db.close();
      }

      // Re-throw with context
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(
        `Failed to initialize SQLite database for mount "${mountName}": ${String(error)}`
      );
    }
  }

  // ============================================================
  // HELPERS
  // ============================================================

  /**
   * Get mount database and configuration.
   * EC-7: Throws if mount unknown.
   */
  function getMountDb(mountName: string): {
    mountDb: MountDatabase;
    mountConfig: SqliteKvMountConfig;
  } {
    const mountDb = databases.get(mountName);
    const mountConfig = config.mounts[mountName];

    if (!mountDb || !mountConfig) {
      throw new Error(
        `Mount '${mountName}' not found. Available mounts: ${Object.keys(config.mounts).join(', ')}`
      );
    }

    return { mountDb, mountConfig };
  }

  /**
   * Check write permission for a mount.
   * EC-3, EC-6: Throws if mode is read-only.
   */
  function checkWritePermission(mountName: string, mode: string): void {
    if (mode === 'read') {
      throw new Error(`Mount '${mountName}' is read-only (mode: ${mode})`);
    }
  }

  /**
   * Calculate value size in bytes (JSON-encoded).
   */
  function calculateValueSize(value: RillValue): number {
    return Buffer.byteLength(JSON.stringify(value), 'utf-8');
  }

  /**
   * Validate type against schema entry.
   */
  function validateType(
    key: string,
    value: RillValue,
    expectedType: 'string' | 'number' | 'bool' | 'list' | 'dict'
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

    if (actualType !== expectedType) {
      throw new Error(
        `key "${key}" expects ${expectedType}, got ${actualType}`
      );
    }
  }

  /**
   * Check if value is a dict.
   */
  function isDict(value: RillValue): value is Record<string, RillValue> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  // ============================================================
  // KV FUNCTIONS
  // ============================================================

  /**
   * IR-1: Get value or schema default.
   * EC-1: Returns schema default if key missing.
   * EC-2: Throws if mount unknown (handled by getMountDb).
   */
  const get = (args: RillValue[]): RillValue => {
    const mountName = args[0] as string;
    const key = args[1] as string;

    const { mountDb, mountConfig } = getMountDb(mountName);

    // Check if schema is defined (declared mode)
    if (mountConfig.schema && !(key in mountConfig.schema)) {
      throw new Error(`key "${key}" not declared in schema`);
    }

    // Query database
    const stmt = mountDb.db.prepare(
      `SELECT value FROM ${mountDb.table} WHERE key = ?`
    );
    const row = stmt.get(key) as { value: string } | undefined;

    if (row) {
      return JSON.parse(row.value) as RillValue;
    }

    // EC-1: Return schema default if key missing
    if (mountConfig.schema && key in mountConfig.schema) {
      return mountConfig.schema[key]!.default;
    }

    // Open mode - return empty string
    return '';
  };

  /**
   * IR-2: Get value or fallback.
   */
  const get_or = (args: RillValue[]): RillValue => {
    const mountName = args[0] as string;
    const key = args[1] as string;
    const fallback = args[2] as RillValue;

    const { mountDb } = getMountDb(mountName);

    // Query database
    const stmt = mountDb.db.prepare(
      `SELECT value FROM ${mountDb.table} WHERE key = ?`
    );
    const row = stmt.get(key) as { value: string } | undefined;

    if (row) {
      return JSON.parse(row.value) as RillValue;
    }

    return fallback;
  };

  /**
   * IR-3: Set value with validation.
   * EC-3: Throws if mode is read-only.
   * EC-4: Throws if value exceeds maxValueSize.
   */
  const set = (args: RillValue[]): boolean => {
    const mountName = args[0] as string;
    const key = args[1] as string;
    const value = args[2] as RillValue;

    const { mountDb, mountConfig } = getMountDb(mountName);

    // EC-3: Check write permission
    checkWritePermission(mountName, mountConfig.mode);

    // Check schema constraints
    if (mountConfig.schema && !(key in mountConfig.schema)) {
      throw new Error(`key "${key}" not declared in schema`);
    }

    // Validate type if in declared mode
    if (mountConfig.schema && key in mountConfig.schema) {
      validateType(key, value, mountConfig.schema[key]!.type);
    }

    // EC-4: Check value size
    const maxValueSize = mountConfig.maxValueSize ?? 102400;
    const valueSize = calculateValueSize(value);
    if (valueSize > maxValueSize) {
      throw new Error(
        `value for "${key}" exceeds size limit (${valueSize} > ${maxValueSize})`
      );
    }

    // Check max entries (only for new keys)
    const maxEntries = mountConfig.maxEntries ?? 10000;
    const hasStmt = mountDb.db.prepare(
      `SELECT 1 FROM ${mountDb.table} WHERE key = ?`
    );
    const exists = hasStmt.get(key) !== undefined;

    if (!exists) {
      const countStmt = mountDb.db.prepare(
        `SELECT COUNT(*) as count FROM ${mountDb.table}`
      );
      const countRow = countStmt.get() as { count: number };

      if (countRow.count >= maxEntries) {
        throw new Error(
          `store exceeds entry limit (${countRow.count + 1} > ${maxEntries})`
        );
      }
    }

    // Insert or replace value
    const stmt = mountDb.db.prepare(
      `INSERT OR REPLACE INTO ${mountDb.table} (key, value) VALUES (?, ?)`
    );
    stmt.run(key, JSON.stringify(value));

    return true;
  };

  /**
   * IR-4: Merge partial dict into existing dict value.
   * EC-5: Throws if existing value is not a dict.
   * EC-6: Throws if mode is read-only.
   */
  const merge = (args: RillValue[]): boolean => {
    const mountName = args[0] as string;
    const key = args[1] as string;
    const partial = args[2] as Record<string, RillValue>;

    const { mountDb, mountConfig } = getMountDb(mountName);

    // EC-6: Check write permission
    checkWritePermission(mountName, mountConfig.mode);

    // Atomic merge using transaction
    const mergeTransaction = mountDb.db.transaction(() => {
      // Get current value
      const selectStmt = mountDb.db.prepare(
        `SELECT value FROM ${mountDb.table} WHERE key = ?`
      );
      const row = selectStmt.get(key) as { value: string } | undefined;

      let currentValue: RillValue | undefined;
      if (row) {
        currentValue = JSON.parse(row.value) as RillValue;

        // EC-5: Existing value must be a dict
        if (!isDict(currentValue)) {
          throw new Error(`Cannot merge into non-dict value at key "${key}"`);
        }
      }

      // Merge partial into current dict (shallow merge)
      const mergedValue = {
        ...(currentValue as Record<string, RillValue> | undefined),
        ...partial,
      };

      // Validate merged value
      if (mountConfig.schema && key in mountConfig.schema) {
        validateType(key, mergedValue, mountConfig.schema[key]!.type);
      }

      // Check value size
      const maxValueSize = mountConfig.maxValueSize ?? 102400;
      const valueSize = calculateValueSize(mergedValue);
      if (valueSize > maxValueSize) {
        throw new Error(
          `merged value for "${key}" exceeds size limit (${valueSize} > ${maxValueSize})`
        );
      }

      // Update value
      const updateStmt = mountDb.db.prepare(
        `INSERT OR REPLACE INTO ${mountDb.table} (key, value) VALUES (?, ?)`
      );
      updateStmt.run(key, JSON.stringify(mergedValue));
    });

    mergeTransaction();
    return true;
  };

  /**
   * IR-5: Delete key.
   */
  const deleteKey = (args: RillValue[]): boolean => {
    const mountName = args[0] as string;
    const key = args[1] as string;

    const { mountDb, mountConfig } = getMountDb(mountName);

    // Check write permission
    checkWritePermission(mountName, mountConfig.mode);

    const stmt = mountDb.db.prepare(
      `DELETE FROM ${mountDb.table} WHERE key = ?`
    );
    const result = stmt.run(key);

    return result.changes > 0;
  };

  /**
   * IR-6: Get all keys.
   */
  const keys = (args: RillValue[]): string[] => {
    const mountName = args[0] as string;
    const { mountDb } = getMountDb(mountName);

    const stmt = mountDb.db.prepare(`SELECT key FROM ${mountDb.table}`);
    const rows = stmt.all() as { key: string }[];

    return rows.map((row) => row.key);
  };

  /**
   * IR-7: Check key existence.
   */
  const has = (args: RillValue[]): boolean => {
    const mountName = args[0] as string;
    const key = args[1] as string;

    const { mountDb } = getMountDb(mountName);

    const stmt = mountDb.db.prepare(
      `SELECT 1 FROM ${mountDb.table} WHERE key = ?`
    );
    const row = stmt.get(key);

    return row !== undefined;
  };

  /**
   * IR-8: Clear all keys (restores schema defaults if declared mode).
   */
  const clear = (args: RillValue[]): boolean => {
    const mountName = args[0] as string;
    const { mountDb, mountConfig } = getMountDb(mountName);

    // Check write permission
    checkWritePermission(mountName, mountConfig.mode);

    // Delete all entries
    const deleteStmt = mountDb.db.prepare(`DELETE FROM ${mountDb.table}`);
    deleteStmt.run();

    // Restore schema defaults if declared mode
    if (mountConfig.schema) {
      const insertStmt = mountDb.db.prepare(
        `INSERT INTO ${mountDb.table} (key, value) VALUES (?, ?)`
      );

      for (const [key, entry] of Object.entries(mountConfig.schema)) {
        insertStmt.run(key, JSON.stringify(entry.default));
      }
    }

    return true;
  };

  /**
   * IR-9: Get all entries as dict.
   */
  const getAll = (args: RillValue[]): Record<string, RillValue> => {
    const mountName = args[0] as string;
    const { mountDb } = getMountDb(mountName);

    const stmt = mountDb.db.prepare(`SELECT key, value FROM ${mountDb.table}`);
    const rows = stmt.all() as { key: string; value: string }[];

    const result: Record<string, RillValue> = {};
    for (const row of rows) {
      result[row.key] = JSON.parse(row.value) as RillValue;
    }

    return result;
  };

  /**
   * IR-10: Get schema information (empty list in open mode).
   */
  const schema = (args: RillValue[]): RillValue[] => {
    const mountName = args[0] as string;
    const { mountConfig } = getMountDb(mountName);

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
   * IR-11: Get list of mount metadata.
   */
  const mountsList = (): RillValue[] => {
    const result: RillValue[] = [];

    for (const [name, mountConfig] of Object.entries(config.mounts)) {
      result.push({
        name,
        mode: mountConfig.mode,
        schema: mountConfig.schema ? 'declared' : 'open',
        maxEntries: mountConfig.maxEntries ?? 10000,
        maxValueSize: mountConfig.maxValueSize ?? 102400,
        database: mountConfig.database,
        table: mountConfig.table,
      });
    }

    return result;
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

  // Attach dispose lifecycle method
  result.dispose = (): void => {
    // Close all database connections
    for (const { db } of databases.values()) {
      db.close();
    }
    databases.clear();
  };

  return result;
}
