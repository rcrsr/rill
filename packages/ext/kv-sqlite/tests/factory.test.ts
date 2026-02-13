/**
 * Tests for SQLite kv extension factory.
 * Validates configuration, database initialization, WAL mode, and table creation.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createSqliteKvExtension } from '../src/factory.js';
import type { SqliteKvConfig } from '../src/types.js';

// Test database directory
const TEST_DATA_DIR = join(process.cwd(), 'test-data');

// Clean up test databases after each test
afterEach(() => {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
});

describe('createSqliteKvExtension', () => {
  describe('configuration validation', () => {
    it('throws for missing mounts', () => {
      const config = {} as SqliteKvConfig;

      expect(() => createSqliteKvExtension(config)).toThrow(
        'at least one mount'
      );
    });

    it('throws for empty mounts object', () => {
      const config: SqliteKvConfig = {
        mounts: {},
      };

      expect(() => createSqliteKvExtension(config)).toThrow(
        'at least one mount'
      );
    });

    it('creates directory if database path parent does not exist', () => {
      const dbPath = join(TEST_DATA_DIR, 'nested', 'dir', 'test.db');
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
          },
        },
      };

      const ext = createSqliteKvExtension(config);
      expect(existsSync(join(TEST_DATA_DIR, 'nested', 'dir'))).toBe(true);
      ext.dispose?.();
    });

    it('throws for invalid database path permissions', () => {
      // Create a read-only directory
      const readonlyDir = join(TEST_DATA_DIR, 'readonly');
      mkdirSync(readonlyDir, { recursive: true });

      // Create a file to block directory creation
      const blockedPath = join(readonlyDir, 'blocked');
      writeFileSync(blockedPath, '');

      const dbPath = join(blockedPath, 'test.db');
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
          },
        },
      };

      // SQLite will throw 'unable to open database file' when directory can't be created
      expect(() => createSqliteKvExtension(config)).toThrow();
    });
  });

  describe('database initialization', () => {
    it('creates database file if not exists', () => {
      const dbPath = join(TEST_DATA_DIR, 'new.db');
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
          },
        },
      };

      const ext = createSqliteKvExtension(config);
      expect(existsSync(dbPath)).toBe(true);
      ext.dispose?.();
    });

    it('opens existing database file', () => {
      const dbPath = join(TEST_DATA_DIR, 'existing.db');
      mkdirSync(TEST_DATA_DIR, { recursive: true });

      // Create database with existing data
      const db = new Database(dbPath);
      db.exec('CREATE TABLE existing (id INTEGER PRIMARY KEY)');
      db.close();

      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
          },
        },
      };

      const ext = createSqliteKvExtension(config);

      // Verify existing table still exists
      const verifyDb = new Database(dbPath, { readonly: true });
      const tables = verifyDb
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        .all() as Array<{ name: string }>;
      const tableNames = tables.map((t) => t.name);
      verifyDb.close();

      expect(tableNames).toContain('existing');
      expect(tableNames).toContain('kv_test');

      ext.dispose?.();
    });

    it('supports multiple mounts sharing same database', () => {
      const dbPath = join(TEST_DATA_DIR, 'shared.db');
      const config: SqliteKvConfig = {
        mounts: {
          users: {
            mode: 'read-write',
            database: dbPath,
            table: 'users_kv',
          },
          settings: {
            mode: 'read-write',
            database: dbPath,
            table: 'settings_kv',
          },
        },
      };

      const ext = createSqliteKvExtension(config);

      // Verify both tables exist
      const db = new Database(dbPath, { readonly: true });
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        .all() as Array<{ name: string }>;
      const tableNames = tables.map((t) => t.name);
      db.close();

      expect(tableNames).toContain('users_kv');
      expect(tableNames).toContain('settings_kv');

      ext.dispose?.();
    });

    it('supports multiple mounts with different databases', () => {
      const db1Path = join(TEST_DATA_DIR, 'db1.db');
      const db2Path = join(TEST_DATA_DIR, 'db2.db');
      const config: SqliteKvConfig = {
        mounts: {
          mount1: {
            mode: 'read-write',
            database: db1Path,
            table: 'kv_data',
          },
          mount2: {
            mode: 'read-write',
            database: db2Path,
            table: 'kv_data',
          },
        },
      };

      const ext = createSqliteKvExtension(config);

      expect(existsSync(db1Path)).toBe(true);
      expect(existsSync(db2Path)).toBe(true);

      ext.dispose?.();
    });
  });

  describe('WAL mode', () => {
    it('enables WAL mode on database initialization', () => {
      const dbPath = join(TEST_DATA_DIR, 'wal.db');
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
          },
        },
      };

      const ext = createSqliteKvExtension(config);
      ext.dispose?.();

      // Verify WAL mode persists
      const db = new Database(dbPath, { readonly: true });
      const journalMode = db.pragma('journal_mode', { simple: true });
      db.close();

      expect(journalMode).toBe('wal');
    });

    it('preserves WAL mode on existing database', () => {
      const dbPath = join(TEST_DATA_DIR, 'existing-wal.db');
      mkdirSync(TEST_DATA_DIR, { recursive: true });

      // Create database with WAL already enabled
      const db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
      db.close();

      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
          },
        },
      };

      const ext = createSqliteKvExtension(config);
      ext.dispose?.();

      // Verify WAL mode still enabled
      const verifyDb = new Database(dbPath, { readonly: true });
      const journalMode = verifyDb.pragma('journal_mode', { simple: true });
      verifyDb.close();

      expect(journalMode).toBe('wal');
    });
  });

  describe('table creation', () => {
    it('creates table with correct schema', () => {
      const dbPath = join(TEST_DATA_DIR, 'schema.db');
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
          },
        },
      };

      const ext = createSqliteKvExtension(config);
      ext.dispose?.();

      // Verify table schema
      const db = new Database(dbPath, { readonly: true });
      const columns = db.pragma('table_info(kv_test)') as Array<{
        cid: number;
        name: string;
        type: string;
        notnull: number;
        pk: number;
      }>;
      db.close();

      expect(columns).toHaveLength(2);
      expect(columns[0]).toMatchObject({
        name: 'key',
        type: 'TEXT',
        pk: 1,
      });
      expect(columns[1]).toMatchObject({
        name: 'value',
        type: 'TEXT',
        notnull: 1,
      });
    });

    it('does not recreate existing table', () => {
      const dbPath = join(TEST_DATA_DIR, 'existing-table.db');
      mkdirSync(TEST_DATA_DIR, { recursive: true });

      // Create database with existing table and data
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE kv_test (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
      db.prepare('INSERT INTO kv_test (key, value) VALUES (?, ?)').run(
        'existing_key',
        '"existing_value"'
      );
      db.close();

      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
          },
        },
      };

      const ext = createSqliteKvExtension(config);
      ext.dispose?.();

      // Verify existing data preserved
      const verifyDb = new Database(dbPath, { readonly: true });
      const row = verifyDb
        .prepare('SELECT * FROM kv_test WHERE key = ?')
        .get('existing_key') as { key: string; value: string } | undefined;
      verifyDb.close();

      expect(row).toBeDefined();
      expect(row?.value).toBe('"existing_value"');
    });
  });

  describe('function exports', () => {
    it('exports all 11 kv storage functions', () => {
      const dbPath = join(TEST_DATA_DIR, 'exports.db');
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
          },
        },
      };

      const ext = createSqliteKvExtension(config);

      // Verify all 11 functions exist
      expect(ext.get).toBeDefined();
      expect(ext.get_or).toBeDefined();
      expect(ext.set).toBeDefined();
      expect(ext.merge).toBeDefined();
      expect(ext.delete).toBeDefined();
      expect(ext.keys).toBeDefined();
      expect(ext.has).toBeDefined();
      expect(ext.clear).toBeDefined();
      expect(ext.getAll).toBeDefined();
      expect(ext.schema).toBeDefined();
      expect(ext.mounts).toBeDefined();

      ext.dispose?.();
    });

    it('all functions have correct HostFunctionDefinition structure', () => {
      const dbPath = join(TEST_DATA_DIR, 'structure.db');
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
          },
        },
      };

      const ext = createSqliteKvExtension(config);

      // Verify structure for one function (all follow same pattern)
      expect(ext.get.params).toBeDefined();
      expect(ext.get.fn).toBeTypeOf('function');
      expect(ext.get.description).toBeTypeOf('string');
      expect(ext.get.returnType).toBe('any');

      ext.dispose?.();
    });
  });

  describe('dispose lifecycle', () => {
    it('closes database connections', () => {
      const dbPath = join(TEST_DATA_DIR, 'dispose.db');
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
          },
        },
      };

      const ext = createSqliteKvExtension(config);

      // Dispose should close database
      ext.dispose?.();

      // Should be able to open database again (not locked)
      const db = new Database(dbPath);
      db.close();
    });

    it('cleans up all mounts on dispose', () => {
      const db1Path = join(TEST_DATA_DIR, 'dispose1.db');
      const db2Path = join(TEST_DATA_DIR, 'dispose2.db');
      const config: SqliteKvConfig = {
        mounts: {
          mount1: {
            mode: 'read-write',
            database: db1Path,
            table: 'kv_data',
          },
          mount2: {
            mode: 'read-write',
            database: db2Path,
            table: 'kv_data',
          },
        },
      };

      const ext = createSqliteKvExtension(config);
      ext.dispose?.();

      // Both databases should be closable (not locked)
      const db1 = new Database(db1Path);
      const db2 = new Database(db2Path);
      db1.close();
      db2.close();
    });

    it('handles dispose without error if already disposed', () => {
      const dbPath = join(TEST_DATA_DIR, 'double-dispose.db');
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
          },
        },
      };

      const ext = createSqliteKvExtension(config);

      expect(() => {
        ext.dispose?.();
        ext.dispose?.();
      }).not.toThrow();
    });
  });

  describe('error handling', () => {
    it('cleans up databases on initialization error', () => {
      const db1Path = join(TEST_DATA_DIR, 'cleanup1.db');
      const db2Path = join(TEST_DATA_DIR, 'cleanup2.db');

      // Create a file to block second database creation
      mkdirSync(TEST_DATA_DIR, { recursive: true });
      mkdirSync(db2Path); // Make db2Path a directory instead of file

      const config: SqliteKvConfig = {
        mounts: {
          mount1: {
            mode: 'read-write',
            database: db1Path,
            table: 'kv_data',
          },
          mount2: {
            mode: 'read-write',
            database: db2Path,
            table: 'kv_data',
          },
        },
      };

      expect(() => createSqliteKvExtension(config)).toThrow();

      // First database should be closed and accessible
      if (existsSync(db1Path)) {
        const db = new Database(db1Path);
        db.close();
      }
    });
  });
});
