/**
 * Type definitions for SQLite kv extension.
 * Defines configuration for SQLite key-value storage backend.
 */

import type { RillValue } from '@rcrsr/rill';

// ============================================================
// KV SCHEMA TYPES
// ============================================================

/**
 * Schema entry defining type and default for a key.
 *
 * Re-defined from @rcrsr/rill/ext/kv to avoid dependency on internal paths.
 * This interface must match the core SchemaEntry definition.
 */
export interface SchemaEntry {
  /** Type constraint for the value */
  type: 'string' | 'number' | 'bool' | 'list' | 'dict';
  /** Default value when key is missing */
  default: RillValue;
  /** Optional description for documentation */
  description?: string | undefined;
}

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Configuration for a single SQLite kv mount.
 *
 * Extends common kv mount configuration with SQLite-specific fields.
 * Each mount represents a table in a SQLite database file.
 *
 * @example
 * ```typescript
 * const mountConfig: SqliteKvMountConfig = {
 *   mode: 'read-write',
 *   database: './data/app.db',
 *   table: 'user_state',
 *   schema: {
 *     name: { type: 'string', default: '' },
 *     count: { type: 'number', default: 0 }
 *   },
 *   maxEntries: 5000,
 *   maxValueSize: 50000
 * };
 * ```
 */
export interface SqliteKvMountConfig {
  /**
   * Access mode for this mount.
   *
   * - 'read': Read-only access (set/delete/clear operations throw errors)
   * - 'write': Write-only access (get operations throw errors)
   * - 'read-write': Full access to all operations
   */
  readonly mode: 'read' | 'write' | 'read-write';

  /**
   * Path to SQLite database file.
   *
   * File is created if it does not exist.
   * Multiple mounts can share the same database file with different tables.
   *
   * @example './data/app.db'
   */
  readonly database: string;

  /**
   * Table name for this mount.
   *
   * Table is created if it does not exist with schema:
   * - key TEXT PRIMARY KEY
   * - value TEXT (JSON-encoded RillValue)
   *
   * @example 'user_state'
   */
  readonly table: string;

  /**
   * Schema definitions (optional).
   *
   * When provided, enables declared mode:
   * - Only declared keys can be accessed
   * - Type validation enforced on set operations
   * - Missing keys return schema defaults
   *
   * When undefined, enables open mode:
   * - Any key can be accessed
   * - No type validation
   * - Missing keys return empty string
   */
  readonly schema?: Record<string, SchemaEntry> | undefined;

  /**
   * Maximum number of entries allowed in this mount.
   *
   * Defaults to 10000.
   * Set operations throw when limit exceeded.
   */
  readonly maxEntries?: number | undefined;

  /**
   * Maximum value size in bytes (JSON-encoded).
   *
   * Defaults to 102400 bytes (100 KB).
   * Set operations throw when value exceeds limit.
   */
  readonly maxValueSize?: number | undefined;
}

/**
 * Configuration options for SQLite kv extension.
 *
 * Defines mount configurations, size limits, and write policies for
 * SQLite-backed key-value storage.
 *
 * @example
 * ```typescript
 * // Multi-mount configuration
 * const config: SqliteKvConfig = {
 *   mounts: {
 *     user: {
 *       mode: 'read-write',
 *       database: './data/app.db',
 *       table: 'user_state',
 *       schema: { name: { type: 'string', default: '' } }
 *     },
 *     cache: {
 *       mode: 'read-write',
 *       database: './data/cache.db',
 *       table: 'cache_entries'
 *     }
 *   },
 *   maxStoreSize: 5242880,
 *   writePolicy: 'immediate'
 * };
 * ```
 */
export interface SqliteKvConfig {
  /**
   * Mount definitions keyed by mount name.
   *
   * Each mount corresponds to a table in a SQLite database.
   * Mount names are used in kv function calls (e.g., `kv::get('user', 'name')`).
   *
   * Required field - at least one mount must be defined.
   */
  readonly mounts: Record<string, SqliteKvMountConfig>;

  /**
   * Maximum total store size in bytes across all mounts.
   *
   * Defaults to 10485760 bytes (10 MB).
   * This limit applies to the sum of all database files.
   * Set operations throw when total size exceeds limit.
   */
  readonly maxStoreSize?: number | undefined;

  /**
   * Write policy for database operations.
   *
   * - 'dispose': Changes buffered in memory, flushed on extension dispose (default)
   * - 'immediate': Each set operation writes to database immediately
   *
   * Immediate mode trades performance for durability.
   * Dispose mode is faster but risks data loss if process crashes.
   */
  readonly writePolicy?: 'dispose' | 'immediate' | undefined;
}
