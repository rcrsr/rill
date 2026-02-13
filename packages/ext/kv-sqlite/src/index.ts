/**
 * SQLite kv extension for rill.
 * Provides key-value storage operations using SQLite backend.
 */

// ============================================================
// PUBLIC TYPES
// ============================================================
export type {
  SqliteKvConfig,
  SqliteKvMountConfig,
  SchemaEntry,
} from './types.js';

// ============================================================
// FACTORY
// ============================================================
export { createSqliteKvExtension } from './factory.js';

// ============================================================
// VERSION
// ============================================================
export const SQLITE_KV_EXTENSION_VERSION = '0.0.1';
