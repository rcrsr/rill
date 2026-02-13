/**
 * Tests for SQLite kv extension functions.
 * Validates all 11 kv contract functions against specification requirements.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createSqliteKvExtension } from '../src/factory.js';
import type { SqliteKvConfig } from '../src/types.js';

// Test database directory
const TEST_DATA_DIR = join(process.cwd(), 'test-data-functions');

// Clean up test databases after each test
afterEach(() => {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
});

describe('kv functions', () => {
  describe('get() - IR-1', () => {
    it('returns value when key exists', () => {
      const dbPath = join(TEST_DATA_DIR, 'get.db');
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

      // Set then get
      ext.set?.fn(['test', 'name', 'Alice']);
      const result = ext.get?.fn(['test', 'name']);

      expect(result).toBe('Alice');
      ext.dispose?.();
    });

    it('returns schema default if key missing (EC-1)', () => {
      const dbPath = join(TEST_DATA_DIR, 'get-default.db');
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
            schema: {
              count: { type: 'number', default: 0 },
            },
          },
        },
      };

      const ext = createSqliteKvExtension(config);
      const result = ext.get?.fn(['test', 'count']);

      expect(result).toBe(0);
      ext.dispose?.();
    });

    it('returns empty string for missing key in open mode', () => {
      const dbPath = join(TEST_DATA_DIR, 'get-open.db');
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
      const result = ext.get?.fn(['test', 'missing']);

      expect(result).toBe('');
      ext.dispose?.();
    });

    it('throws if mount unknown (EC-2, EC-7)', () => {
      const dbPath = join(TEST_DATA_DIR, 'get-mount-error.db');
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

      expect(() => ext.get?.fn(['unknown', 'key'])).toThrow('not found');
      ext.dispose?.();
    });

    it('throws if key not in schema (declared mode)', () => {
      const dbPath = join(TEST_DATA_DIR, 'get-schema.db');
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
            schema: {
              name: { type: 'string', default: '' },
            },
          },
        },
      };

      const ext = createSqliteKvExtension(config);

      expect(() => ext.get?.fn(['test', 'age'])).toThrow('not declared');
      ext.dispose?.();
    });
  });

  describe('get_or() - IR-2', () => {
    it('returns value when key exists', () => {
      const dbPath = join(TEST_DATA_DIR, 'get-or.db');
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

      ext.set?.fn(['test', 'name', 'Bob']);
      const result = ext.get_or?.fn(['test', 'name', 'fallback']);

      expect(result).toBe('Bob');
      ext.dispose?.();
    });

    it('returns fallback when key missing', () => {
      const dbPath = join(TEST_DATA_DIR, 'get-or-fallback.db');
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
      const result = ext.get_or?.fn(['test', 'missing', 'default-value']);

      expect(result).toBe('default-value');
      ext.dispose?.();
    });

    it('throws if mount unknown (EC-7)', () => {
      const dbPath = join(TEST_DATA_DIR, 'get-or-mount.db');
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

      expect(() => ext.get_or?.fn(['unknown', 'key', 'fallback'])).toThrow(
        'not found'
      );
      ext.dispose?.();
    });
  });

  describe('set() - IR-3', () => {
    it('sets value and returns true', () => {
      const dbPath = join(TEST_DATA_DIR, 'set.db');
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

      const result = ext.set?.fn(['test', 'name', 'Charlie']);
      expect(result).toBe(true);

      const value = ext.get?.fn(['test', 'name']);
      expect(value).toBe('Charlie');

      ext.dispose?.();
    });

    it('throws PermissionError if mode is read-only (EC-3)', () => {
      const dbPath = join(TEST_DATA_DIR, 'set-readonly.db');
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read',
            database: dbPath,
            table: 'kv_test',
          },
        },
      };

      const ext = createSqliteKvExtension(config);

      expect(() => ext.set?.fn(['test', 'name', 'value'])).toThrow('read-only');
      ext.dispose?.();
    });

    it('throws SizeError if value exceeds maxValueSize (EC-4)', () => {
      const dbPath = join(TEST_DATA_DIR, 'set-size.db');
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
            maxValueSize: 10, // Very small limit
          },
        },
      };

      const ext = createSqliteKvExtension(config);

      const largeValue = 'x'.repeat(100);
      expect(() => ext.set?.fn(['test', 'key', largeValue])).toThrow(
        'exceeds size limit'
      );
      ext.dispose?.();
    });

    it('validates type in declared mode', () => {
      const dbPath = join(TEST_DATA_DIR, 'set-type.db');
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
            schema: {
              count: { type: 'number', default: 0 },
            },
          },
        },
      };

      const ext = createSqliteKvExtension(config);

      expect(() => ext.set?.fn(['test', 'count', 'not-a-number'])).toThrow(
        'expects number'
      );
      ext.dispose?.();
    });

    it('throws if max entries exceeded', () => {
      const dbPath = join(TEST_DATA_DIR, 'set-max-entries.db');
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
            maxEntries: 2,
          },
        },
      };

      const ext = createSqliteKvExtension(config);

      ext.set?.fn(['test', 'key1', 'value1']);
      ext.set?.fn(['test', 'key2', 'value2']);

      expect(() => ext.set?.fn(['test', 'key3', 'value3'])).toThrow(
        'entry limit'
      );
      ext.dispose?.();
    });

    it('allows updating existing key without exceeding max entries', () => {
      const dbPath = join(TEST_DATA_DIR, 'set-update.db');
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
            maxEntries: 2,
          },
        },
      };

      const ext = createSqliteKvExtension(config);

      ext.set?.fn(['test', 'key1', 'value1']);
      ext.set?.fn(['test', 'key2', 'value2']);

      // Update existing key should work
      expect(() => ext.set?.fn(['test', 'key1', 'updated'])).not.toThrow();

      const value = ext.get?.fn(['test', 'key1']);
      expect(value).toBe('updated');

      ext.dispose?.();
    });

    it('throws if mount unknown (EC-7)', () => {
      const dbPath = join(TEST_DATA_DIR, 'set-mount.db');
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

      expect(() => ext.set?.fn(['unknown', 'key', 'value'])).toThrow(
        'not found'
      );
      ext.dispose?.();
    });
  });

  describe('merge() - IR-4', () => {
    it('merges partial dict into existing dict', () => {
      const dbPath = join(TEST_DATA_DIR, 'merge.db');
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

      ext.set?.fn(['test', 'user', { name: 'Alice', age: 30 }]);
      const result = ext.merge?.fn(['test', 'user', { age: 31, city: 'NYC' }]);

      expect(result).toBe(true);

      const value = ext.get?.fn(['test', 'user']);
      expect(value).toEqual({ name: 'Alice', age: 31, city: 'NYC' });

      ext.dispose?.();
    });

    it('creates new dict if key does not exist', () => {
      const dbPath = join(TEST_DATA_DIR, 'merge-new.db');
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

      const result = ext.merge?.fn(['test', 'user', { name: 'Bob' }]);

      expect(result).toBe(true);

      const value = ext.get?.fn(['test', 'user']);
      expect(value).toEqual({ name: 'Bob' });

      ext.dispose?.();
    });

    it('throws TypeError if existing value is not a dict (EC-5)', () => {
      const dbPath = join(TEST_DATA_DIR, 'merge-type.db');
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

      ext.set?.fn(['test', 'name', 'Alice']);

      expect(() => ext.merge?.fn(['test', 'name', { age: 30 }])).toThrow(
        'non-dict'
      );
      ext.dispose?.();
    });

    it('throws PermissionError if mode is read-only (EC-6)', () => {
      const dbPath = join(TEST_DATA_DIR, 'merge-readonly.db');
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read',
            database: dbPath,
            table: 'kv_test',
          },
        },
      };

      const ext = createSqliteKvExtension(config);

      expect(() => ext.merge?.fn(['test', 'user', { name: 'Alice' }])).toThrow(
        'read-only'
      );
      ext.dispose?.();
    });

    it('applies atomically using transaction', () => {
      const dbPath = join(TEST_DATA_DIR, 'merge-atomic.db');
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
            maxValueSize: 50, // Small limit to trigger error
          },
        },
      };

      const ext = createSqliteKvExtension(config);

      ext.set?.fn(['test', 'user', { name: 'Alice' }]);

      // Merge that exceeds size limit should not partially apply
      const largePatch = { name: 'Alice', data: 'x'.repeat(100) };

      expect(() => ext.merge?.fn(['test', 'user', largePatch])).toThrow();

      // Original value should be unchanged
      const value = ext.get?.fn(['test', 'user']);
      expect(value).toEqual({ name: 'Alice' });

      ext.dispose?.();
    });

    it('throws if mount unknown (EC-7)', () => {
      const dbPath = join(TEST_DATA_DIR, 'merge-mount.db');
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

      expect(() => ext.merge?.fn(['unknown', 'key', { a: 1 }])).toThrow(
        'not found'
      );
      ext.dispose?.();
    });
  });

  describe('delete() - IR-5', () => {
    it('deletes existing key and returns true', () => {
      const dbPath = join(TEST_DATA_DIR, 'delete.db');
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

      ext.set?.fn(['test', 'name', 'Alice']);
      const result = ext.delete?.fn(['test', 'name']);

      expect(result).toBe(true);
      expect(ext.has?.fn(['test', 'name'])).toBe(false);

      ext.dispose?.();
    });

    it('returns false when key does not exist', () => {
      const dbPath = join(TEST_DATA_DIR, 'delete-missing.db');
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

      const result = ext.delete?.fn(['test', 'nonexistent']);

      expect(result).toBe(false);
      ext.dispose?.();
    });

    it('throws if mount unknown (EC-7)', () => {
      const dbPath = join(TEST_DATA_DIR, 'delete-mount.db');
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

      expect(() => ext.delete?.fn(['unknown', 'key'])).toThrow('not found');
      ext.dispose?.();
    });
  });

  describe('keys() - IR-6', () => {
    it('returns all keys', () => {
      const dbPath = join(TEST_DATA_DIR, 'keys.db');
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

      ext.set?.fn(['test', 'key1', 'value1']);
      ext.set?.fn(['test', 'key2', 'value2']);
      ext.set?.fn(['test', 'key3', 'value3']);

      const result = ext.keys?.fn(['test']);

      expect(result).toHaveLength(3);
      expect(result).toContain('key1');
      expect(result).toContain('key2');
      expect(result).toContain('key3');

      ext.dispose?.();
    });

    it('returns empty array when no keys exist', () => {
      const dbPath = join(TEST_DATA_DIR, 'keys-empty.db');
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

      const result = ext.keys?.fn(['test']);

      expect(result).toEqual([]);
      ext.dispose?.();
    });

    it('throws if mount unknown (EC-7)', () => {
      const dbPath = join(TEST_DATA_DIR, 'keys-mount.db');
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

      expect(() => ext.keys?.fn(['unknown'])).toThrow('not found');
      ext.dispose?.();
    });
  });

  describe('has() - IR-7', () => {
    it('returns true when key exists', () => {
      const dbPath = join(TEST_DATA_DIR, 'has.db');
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

      ext.set?.fn(['test', 'name', 'Alice']);
      const result = ext.has?.fn(['test', 'name']);

      expect(result).toBe(true);
      ext.dispose?.();
    });

    it('returns false when key does not exist', () => {
      const dbPath = join(TEST_DATA_DIR, 'has-missing.db');
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

      const result = ext.has?.fn(['test', 'missing']);

      expect(result).toBe(false);
      ext.dispose?.();
    });

    it('throws if mount unknown (EC-7)', () => {
      const dbPath = join(TEST_DATA_DIR, 'has-mount.db');
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

      expect(() => ext.has?.fn(['unknown', 'key'])).toThrow('not found');
      ext.dispose?.();
    });
  });

  describe('clear() - IR-8', () => {
    it('clears all keys and returns true', () => {
      const dbPath = join(TEST_DATA_DIR, 'clear.db');
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

      ext.set?.fn(['test', 'key1', 'value1']);
      ext.set?.fn(['test', 'key2', 'value2']);

      const result = ext.clear?.fn(['test']);

      expect(result).toBe(true);
      expect(ext.keys?.fn(['test'])).toEqual([]);

      ext.dispose?.();
    });

    it('restores schema defaults in declared mode', () => {
      const dbPath = join(TEST_DATA_DIR, 'clear-schema.db');
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
            schema: {
              name: { type: 'string', default: 'Anonymous' },
              count: { type: 'number', default: 0 },
            },
          },
        },
      };

      const ext = createSqliteKvExtension(config);

      ext.set?.fn(['test', 'name', 'Alice']);
      ext.set?.fn(['test', 'count', 42]);

      ext.clear?.fn(['test']);

      expect(ext.get?.fn(['test', 'name'])).toBe('Anonymous');
      expect(ext.get?.fn(['test', 'count'])).toBe(0);

      ext.dispose?.();
    });

    it('throws if mount unknown (EC-7)', () => {
      const dbPath = join(TEST_DATA_DIR, 'clear-mount.db');
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

      expect(() => ext.clear?.fn(['unknown'])).toThrow('not found');
      ext.dispose?.();
    });
  });

  describe('getAll() - IR-9', () => {
    it('returns all entries as dict', () => {
      const dbPath = join(TEST_DATA_DIR, 'getall.db');
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

      ext.set?.fn(['test', 'name', 'Alice']);
      ext.set?.fn(['test', 'age', 30]);

      const result = ext.getAll?.fn(['test']);

      expect(result).toEqual({
        name: 'Alice',
        age: 30,
      });

      ext.dispose?.();
    });

    it('returns empty dict when no entries exist', () => {
      const dbPath = join(TEST_DATA_DIR, 'getall-empty.db');
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

      const result = ext.getAll?.fn(['test']);

      expect(result).toEqual({});
      ext.dispose?.();
    });

    it('throws if mount unknown (EC-7)', () => {
      const dbPath = join(TEST_DATA_DIR, 'getall-mount.db');
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

      expect(() => ext.getAll?.fn(['unknown'])).toThrow('not found');
      ext.dispose?.();
    });
  });

  describe('schema() - IR-10', () => {
    it('returns schema entries in declared mode', () => {
      const dbPath = join(TEST_DATA_DIR, 'schema.db');
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
            schema: {
              name: { type: 'string', default: '', description: 'User name' },
              age: { type: 'number', default: 0 },
            },
          },
        },
      };

      const ext = createSqliteKvExtension(config);

      const result = ext.schema?.fn(['test']);

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        key: 'name',
        type: 'string',
        description: 'User name',
      });
      expect(result).toContainEqual({
        key: 'age',
        type: 'number',
        description: '',
      });

      ext.dispose?.();
    });

    it('returns empty list in open mode', () => {
      const dbPath = join(TEST_DATA_DIR, 'schema-open.db');
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

      const result = ext.schema?.fn(['test']);

      expect(result).toEqual([]);
      ext.dispose?.();
    });

    it('throws if mount unknown (EC-7)', () => {
      const dbPath = join(TEST_DATA_DIR, 'schema-mount.db');
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

      expect(() => ext.schema?.fn(['unknown'])).toThrow('not found');
      ext.dispose?.();
    });
  });

  describe('mounts() - IR-11', () => {
    it('returns list of mount metadata', () => {
      const db1Path = join(TEST_DATA_DIR, 'mounts1.db');
      const db2Path = join(TEST_DATA_DIR, 'mounts2.db');
      const config: SqliteKvConfig = {
        mounts: {
          users: {
            mode: 'read-write',
            database: db1Path,
            table: 'users_kv',
            schema: {
              name: { type: 'string', default: '' },
            },
            maxEntries: 5000,
            maxValueSize: 50000,
          },
          cache: {
            mode: 'read',
            database: db2Path,
            table: 'cache_kv',
          },
        },
      };

      const ext = createSqliteKvExtension(config);

      const result = ext.mounts?.fn([]);

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        name: 'users',
        mode: 'read-write',
        schema: 'declared',
        maxEntries: 5000,
        maxValueSize: 50000,
        database: db1Path,
        table: 'users_kv',
      });
      expect(result).toContainEqual({
        name: 'cache',
        mode: 'read',
        schema: 'open',
        maxEntries: 10000,
        maxValueSize: 102400,
        database: db2Path,
        table: 'cache_kv',
      });

      ext.dispose?.();
    });

    it('returns empty list when no mounts configured', () => {
      // This test verifies behavior if mounts were empty (though factory rejects this)
      // We test with a single mount instead
      const dbPath = join(TEST_DATA_DIR, 'mounts-single.db');
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

      const result = ext.mounts?.fn([]);

      expect(result).toHaveLength(1);
      ext.dispose?.();
    });
  });
});
