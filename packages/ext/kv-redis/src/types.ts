/**
 * Type definitions for Redis kv extension.
 * Defines configuration for Redis key-value storage backend.
 */

import type { SchemaEntry } from '@rcrsr/rill';

export type { SchemaEntry };

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Configuration for a single Redis kv mount.
 *
 * Extends common kv mount configuration with Redis-specific fields.
 * Each mount represents a key prefix in Redis.
 *
 * @example
 * ```typescript
 * const mountConfig: RedisKvMountConfig = {
 *   mode: 'read-write',
 *   prefix: 'app:user:',
 *   schema: {
 *     name: { type: 'string', default: '' },
 *     count: { type: 'number', default: 0 }
 *   },
 *   maxEntries: 5000,
 *   maxValueSize: 50000,
 *   ttl: 3600
 * };
 * ```
 */
export interface RedisKvMountConfig {
  /**
   * Access mode for this mount.
   *
   * - 'read': Read-only access (set/delete/clear operations throw errors)
   * - 'write': Write-only access (get operations throw errors)
   * - 'read-write': Full access to all operations
   */
  readonly mode: 'read' | 'write' | 'read-write';

  /**
   * Key prefix for this mount.
   *
   * All keys in this mount are prefixed with this string to namespace them.
   * Different mounts can use different prefixes to organize keys.
   *
   * @example 'app:user:'
   */
  readonly prefix: string;

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

  /**
   * Time-to-live in seconds for keys in this mount.
   *
   * Optional - when undefined, keys do not expire.
   * When set, keys are automatically deleted after TTL expires.
   *
   * @example 3600 // 1 hour
   */
  readonly ttl?: number | undefined;
}

/**
 * Configuration options for Redis kv extension.
 *
 * Defines Redis connection URL, mount configurations, size limits,
 * and write policies for Redis-backed key-value storage.
 *
 * @example
 * ```typescript
 * // Multi-mount configuration
 * const config: RedisKvConfig = {
 *   url: 'redis://localhost:6379',
 *   mounts: {
 *     user: {
 *       mode: 'read-write',
 *       prefix: 'app:user:',
 *       schema: { name: { type: 'string', default: '' } },
 *       ttl: 3600
 *     },
 *     cache: {
 *       mode: 'read-write',
 *       prefix: 'app:cache:',
 *       ttl: 300
 *     }
 *   },
 *   maxStoreSize: 5242880,
 *   writePolicy: 'immediate'
 * };
 * ```
 */
export interface RedisKvConfig {
  /**
   * Redis connection URL.
   *
   * Required - specifies the Redis server connection string.
   * Supports standard Redis URL format.
   *
   * @example 'redis://localhost:6379'
   * @example 'redis://user:pass@host:port/db'
   */
  readonly url: string;

  /**
   * Mount definitions keyed by mount name.
   *
   * Each mount corresponds to a key prefix in Redis.
   * Mount names are used in kv function calls (e.g., `kv::get('user', 'name')`).
   *
   * Required field - at least one mount must be defined.
   */
  readonly mounts: Record<string, RedisKvMountConfig>;

  /**
   * Maximum total store size in bytes across all mounts.
   *
   * Defaults to 10485760 bytes (10 MB).
   * This limit applies to the sum of all values in all mounts.
   * Set operations throw when total size exceeds limit.
   */
  readonly maxStoreSize?: number | undefined;

  /**
   * Write policy for Redis operations.
   *
   * - 'dispose': Changes buffered in memory, flushed on extension dispose (default)
   * - 'immediate': Each set operation writes to Redis immediately
   *
   * Immediate mode trades performance for durability.
   * Dispose mode is faster but risks data loss if process crashes.
   */
  readonly writePolicy?: 'dispose' | 'immediate' | undefined;
}
