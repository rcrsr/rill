/**
 * Tests for kv extension factory
 *
 * Verifies key-value store operations, schema validation, persistence, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  createKvExtension,
  type KvConfig,
  type SchemaEntry,
} from '../../src/ext/kv/index.js';
import { RuntimeError } from '../../src/error-classes.js';

describe('kv extension factory', () => {
  let tempDir: string;
  let storePath: string;

  beforeEach(async () => {
    // Create temporary directory for test store files
    tempDir = path.join(os.tmpdir(), `rill-kv-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    storePath = path.join(tempDir, 'test-store.json');
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('factory creation', () => {
    it('creates ExtensionResult with 11 functions and dispose (IC-7)', () => {
      const config: KvConfig = {
        store: storePath,
      };

      const ext = createKvExtension(config);

      // Verify all 11 functions exist
      expect(ext).toHaveProperty('get');
      expect(ext).toHaveProperty('get_or');
      expect(ext).toHaveProperty('set');
      expect(ext).toHaveProperty('merge');
      expect(ext).toHaveProperty('delete');
      expect(ext).toHaveProperty('keys');
      expect(ext).toHaveProperty('has');
      expect(ext).toHaveProperty('clear');
      expect(ext).toHaveProperty('getAll');
      expect(ext).toHaveProperty('schema');
      expect(ext).toHaveProperty('mounts');
      expect(ext).toHaveProperty('dispose');

      // Verify function structure
      expect(ext.get).toMatchObject({
        params: expect.any(Array),
        fn: expect.any(Function),
        description: expect.any(String),
        returnType: 'any',
      });
    });

    it('applies config defaults', () => {
      const config: KvConfig = {
        store: storePath,
      };

      const ext = createKvExtension(config);

      // Should not throw - defaults applied (maxEntries=10000, maxValueSize=102400, maxStoreSize=10485760, writePolicy='dispose')
      expect(ext).toBeDefined();
    });

    it('accepts custom limits', () => {
      const config: KvConfig = {
        store: storePath,
        maxEntries: 100,
        maxValueSize: 1024,
        maxStoreSize: 10240,
        writePolicy: 'immediate',
      };

      const ext = createKvExtension(config);
      expect(ext).toBeDefined();
    });
  });

  describe('backward compatibility (single-store config)', () => {
    it('get() returns empty string for missing key in open mode (IR-15)', async () => {
      const ext = createKvExtension({ store: storePath });
      const result = await ext.get.fn(['default', 'missing']);
      expect(result).toBe('');
    });

    it('set() stores value and returns true (IR-16)', async () => {
      const ext = createKvExtension({ store: storePath });
      const result = await ext.set.fn(['default', 'key1', 'value1']);
      expect(result).toBe(true);

      const value = await ext.get.fn(['default', 'key1']);
      expect(value).toBe('value1');
    });

    it('delete() removes key and returns true (IR-17)', async () => {
      const ext = createKvExtension({ store: storePath });
      await ext.set.fn(['default', 'key1', 'value1']);

      const result = await ext.delete.fn(['default', 'key1']);
      expect(result).toBe(true);

      const value = await ext.get.fn(['default', 'key1']);
      expect(value).toBe(''); // Missing key returns empty string
    });

    it('delete() returns false for missing key', async () => {
      const ext = createKvExtension({ store: storePath });
      const result = await ext.delete.fn(['default', 'missing']);
      expect(result).toBe(false);
    });

    it('keys() returns list of all keys (IR-6)', async () => {
      const ext = createKvExtension({ store: storePath });
      await ext.set.fn(['default', 'a', 1]);
      await ext.set.fn(['default', 'b', 2]);
      await ext.set.fn(['default', 'c', 3]);

      const result = await ext.keys.fn(['default']);
      expect(result).toEqual(expect.arrayContaining(['a', 'b', 'c']));
      expect(result).toHaveLength(3);
    });

    it('has() checks key existence (IR-7)', async () => {
      const ext = createKvExtension({ store: storePath });
      await ext.set.fn(['default', 'key1', 'value1']);

      const exists = await ext.has.fn(['default', 'key1']);
      expect(exists).toBe(true);

      const missing = await ext.has.fn(['default', 'missing']);
      expect(missing).toBe(false);
    });

    it('clear() removes all keys (IR-8)', async () => {
      const ext = createKvExtension({ store: storePath });
      await ext.set.fn(['default', 'a', 1]);
      await ext.set.fn(['default', 'b', 2]);

      const result = await ext.clear.fn(['default']);
      expect(result).toBe(true);

      const keys = await ext.keys.fn(['default']);
      expect(keys).toHaveLength(0);
    });

    it('getAll() returns dict of all entries (IR-9)', async () => {
      const ext = createKvExtension({ store: storePath });
      await ext.set.fn(['default', 'a', 1]);
      await ext.set.fn(['default', 'b', 'text']);
      await ext.set.fn(['default', 'c', true]);

      const result = await ext.getAll.fn(['default']);
      expect(result).toEqual({
        a: 1,
        b: 'text',
        c: true,
      });
    });

    it('schema() returns empty list in open mode (IR-10)', async () => {
      const ext = createKvExtension({ store: storePath });
      const result = await ext.schema.fn(['default']);
      expect(result).toEqual([]);
    });
  });

  describe('get_or operation', () => {
    it('returns stored value when key exists (IR-2)', async () => {
      const ext = createKvExtension({ store: storePath });
      await ext.set.fn(['default', 'key1', 'stored_value']);

      const result = await ext.get_or.fn(['default', 'key1', 'fallback']);
      expect(result).toBe('stored_value');
    });

    it('returns fallback when key missing (IR-2)', async () => {
      const ext = createKvExtension({ store: storePath });

      const result = await ext.get_or.fn(['default', 'missing', 'fallback']);
      expect(result).toBe('fallback');
    });

    it('never throws for missing key (IR-2)', async () => {
      const ext = createKvExtension({ store: storePath });

      // Should not throw even though key is missing
      const result = await ext.get_or.fn([
        'default',
        'missing',
        'default_value',
      ]);
      expect(result).toBe('default_value');
    });

    it('works with different value types (IR-2)', async () => {
      const ext = createKvExtension({ store: storePath });

      // String value
      await ext.set.fn(['default', 'str', 'hello']);
      const str = await ext.get_or.fn(['default', 'str', 'fallback']);
      expect(str).toBe('hello');

      // Number value
      await ext.set.fn(['default', 'num', 42]);
      const num = await ext.get_or.fn(['default', 'num', 0]);
      expect(num).toBe(42);

      // Boolean value
      await ext.set.fn(['default', 'bool', true]);
      const bool = await ext.get_or.fn(['default', 'bool', false]);
      expect(bool).toBe(true);

      // Dict value
      await ext.set.fn(['default', 'dict', { a: 1 }]);
      const dict = await ext.get_or.fn(['default', 'dict', {}]);
      expect(dict).toEqual({ a: 1 });

      // List value
      await ext.set.fn(['default', 'list', [1, 2, 3]]);
      const list = await ext.get_or.fn(['default', 'list', []]);
      expect(list).toEqual([1, 2, 3]);
    });

    it('returns fallback for missing key in declared mode without throwing (IR-2)', async () => {
      const schema = {
        count: { type: 'number', default: 0 },
      };
      const ext = createKvExtension({ store: storePath, schema });

      // Unlike get() which would throw in declared mode for unknown keys,
      // get_or() returns the fallback
      const result = await ext.get_or.fn([
        'default',
        'unknown',
        'safe_fallback',
      ]);
      expect(result).toBe('safe_fallback');
    });

    it('works across different mounts', async () => {
      const storePath1 = path.join(tempDir, 'mount1.json');
      const storePath2 = path.join(tempDir, 'mount2.json');

      const ext = createKvExtension({
        mounts: {
          m1: { mode: 'read-write', store: storePath1 },
          m2: { mode: 'read-write', store: storePath2 },
        },
      });

      await ext.set.fn(['m1', 'key', 'value1']);

      // Existing key in m1
      const result1 = await ext.get_or.fn(['m1', 'key', 'fallback']);
      expect(result1).toBe('value1');

      // Missing key in m2
      const result2 = await ext.get_or.fn(['m2', 'key', 'fallback']);
      expect(result2).toBe('fallback');
    });
  });

  describe('merge operation', () => {
    it('merges partial dict into existing dict value (IR-4)', async () => {
      const ext = createKvExtension({ store: storePath });

      // Set initial dict value
      await ext.set.fn(['default', 'config', { a: 1, b: 2, c: 3 }]);

      // Merge partial update
      const result = await ext.merge.fn(['default', 'config', { b: 20, d: 4 }]);
      expect(result).toBe(true);

      // Verify merged result
      const merged = await ext.get.fn(['default', 'config']);
      expect(merged).toEqual({ a: 1, b: 20, c: 3, d: 4 });
    });

    it('returns true on success (IR-4)', async () => {
      const ext = createKvExtension({ store: storePath });
      await ext.set.fn(['default', 'data', { x: 1 }]);

      const result = await ext.merge.fn(['default', 'data', { y: 2 }]);
      expect(result).toBe(true);
    });

    it('is idempotent - repeated calls produce same result (IR-4)', async () => {
      const ext = createKvExtension({ store: storePath });
      await ext.set.fn(['default', 'settings', { theme: 'light', lang: 'en' }]);

      // First merge
      await ext.merge.fn(['default', 'settings', { theme: 'dark' }]);
      const result1 = await ext.get.fn(['default', 'settings']);

      // Second merge with same partial
      await ext.merge.fn(['default', 'settings', { theme: 'dark' }]);
      const result2 = await ext.get.fn(['default', 'settings']);

      // Results should be identical
      expect(result1).toEqual(result2);
      expect(result1).toEqual({ theme: 'dark', lang: 'en' });
    });

    it('throws TypeError when existing value is not a dict (EC-5)', async () => {
      const ext = createKvExtension({ store: storePath });

      // Set non-dict value
      await ext.set.fn(['default', 'count', 42]);

      // Attempt to merge into non-dict
      await expect(
        ext.merge.fn(['default', 'count', { x: 1 }])
      ).rejects.toThrow(RuntimeError);
      await expect(
        ext.merge.fn(['default', 'count', { x: 1 }])
      ).rejects.toThrow('Cannot merge into non-dict value at key "count"');
    });

    it('throws PermissionError on read-only mount (EC-6)', async () => {
      // Create store with initial data
      const ext1 = createKvExtension({
        store: storePath,
        mode: 'read-write',
      });
      await ext1.set.fn(['default', 'data', { a: 1 }]);
      await ext1.dispose!();

      // Open in read-only mode
      const ext2 = createKvExtension({
        store: storePath,
        mode: 'read',
      });

      // Attempt merge in read-only mode
      await expect(
        ext2.merge.fn(['default', 'data', { b: 2 }])
      ).rejects.toThrow(RuntimeError);
      await expect(
        ext2.merge.fn(['default', 'data', { b: 2 }])
      ).rejects.toThrow("Mount 'default' is read-only");
    });

    it('merges into undefined key (creates new dict)', async () => {
      const ext = createKvExtension({ store: storePath });

      // Merge into non-existent key
      await ext.merge.fn(['default', 'new', { x: 10, y: 20 }]);

      const value = await ext.get.fn(['default', 'new']);
      expect(value).toEqual({ x: 10, y: 20 });
    });

    it('handles empty partial dict', async () => {
      const ext = createKvExtension({ store: storePath });
      await ext.set.fn(['default', 'data', { a: 1, b: 2 }]);

      // Merge empty partial (no-op)
      await ext.merge.fn(['default', 'data', {}]);

      const value = await ext.get.fn(['default', 'data']);
      expect(value).toEqual({ a: 1, b: 2 });
    });

    it('overwrites existing fields with partial values', async () => {
      const ext = createKvExtension({ store: storePath });
      await ext.set.fn([
        'default',
        'user',
        { name: 'Alice', age: 30, city: 'NYC' },
      ]);

      // Overwrite multiple fields
      await ext.merge.fn(['default', 'user', { age: 31, city: 'LA' }]);

      const value = await ext.get.fn(['default', 'user']);
      expect(value).toEqual({ name: 'Alice', age: 31, city: 'LA' });
    });
  });

  describe('declared mode (with schema)', () => {
    const testSchema: Record<string, SchemaEntry> = {
      count: { type: 'number', default: 0, description: 'Counter value' },
      name: { type: 'string', default: '', description: 'User name' },
      enabled: { type: 'bool', default: false },
    };

    it('get() returns schema default for missing key (IR-15)', async () => {
      const ext = createKvExtension({ store: storePath, schema: testSchema });
      const result = await ext.get.fn(['default', 'count']);
      expect(result).toBe(0);
    });

    it('set() validates type against schema (EC-21)', async () => {
      const ext = createKvExtension({ store: storePath, schema: testSchema });

      // Valid set
      await ext.set.fn(['default', 'count', 42]);
      const value = await ext.get.fn(['default', 'count']);
      expect(value).toBe(42);

      // Invalid type - should throw
      await expect(
        ext.set.fn(['default', 'count', 'not-a-number'])
      ).rejects.toThrow(RuntimeError);
      await expect(
        ext.set.fn(['default', 'count', 'not-a-number'])
      ).rejects.toThrow('expects number, got string');
    });

    it('get() throws for key not in schema (EC-20)', async () => {
      const ext = createKvExtension({ store: storePath, schema: testSchema });

      await expect(ext.get.fn(['default', 'unknown'])).rejects.toThrow(
        RuntimeError
      );
      await expect(ext.get.fn(['default', 'unknown'])).rejects.toThrow(
        'not declared in schema'
      );
    });

    it('set() throws for key not in schema (EC-20)', async () => {
      const ext = createKvExtension({ store: storePath, schema: testSchema });

      await expect(ext.set.fn(['default', 'unknown', 'value'])).rejects.toThrow(
        RuntimeError
      );
      await expect(ext.set.fn(['default', 'unknown', 'value'])).rejects.toThrow(
        'not declared in schema'
      );
    });

    it('clear() restores schema defaults (IR-8)', async () => {
      const ext = createKvExtension({ store: storePath, schema: testSchema });

      await ext.set.fn(['default', 'count', 100]);
      await ext.set.fn(['default', 'name', 'Alice']);

      await ext.clear.fn(['default']);

      const count = await ext.get.fn(['default', 'count']);
      const name = await ext.get.fn(['default', 'name']);
      expect(count).toBe(0);
      expect(name).toBe('');
    });

    it('schema() returns list of schema entries (IR-10)', async () => {
      const ext = createKvExtension({ store: storePath, schema: testSchema });
      const result = await ext.schema.fn(['default']);

      expect(result).toEqual(
        expect.arrayContaining([
          { key: 'count', type: 'number', description: 'Counter value' },
          { key: 'name', type: 'string', description: 'User name' },
          { key: 'enabled', type: 'bool', description: '' },
        ])
      );
      expect(result).toHaveLength(3);
    });
  });

  describe('size limits', () => {
    it('value size boundary: exact limit succeeds, limit+1 fails (AC-12)', async () => {
      const ext = createKvExtension({
        store: storePath,
        maxValueSize: 100, // 100 bytes
      });

      // Value at exact size limit should succeed
      // JSON.stringify adds 2 bytes for quotes, so 98 chars = 100 bytes
      const atLimit = 'x'.repeat(98);
      await ext.set.fn(['default', 'key', atLimit]);
      const stored = await ext.get.fn(['default', 'key']);
      expect(stored).toBe(atLimit);

      // Value exceeding limit by 1 byte should fail (99 chars = 101 bytes)
      const overLimit = 'y'.repeat(99);
      await expect(ext.set.fn(['default', 'key2', overLimit])).rejects.toThrow(
        RuntimeError
      );
      await expect(ext.set.fn(['default', 'key2', overLimit])).rejects.toThrow(
        'exceeds size limit'
      );
    });

    it('throws when value exceeds maxValueSize (EC-22)', async () => {
      const ext = createKvExtension({
        store: storePath,
        maxValueSize: 100, // 100 bytes
      });

      const largeValue = 'x'.repeat(200);

      await expect(ext.set.fn(['default', 'key', largeValue])).rejects.toThrow(
        RuntimeError
      );
      await expect(ext.set.fn(['default', 'key', largeValue])).rejects.toThrow(
        'exceeds size limit'
      );
    });

    it('throws when store exceeds maxStoreSize (EC-23)', async () => {
      const ext = createKvExtension({
        store: storePath,
        maxStoreSize: 30, // 30 bytes (very small)
      });

      // Add entries until store size is exceeded
      await ext.set.fn(['default', 'a', 'x'.repeat(5)]);

      // This should exceed the limit (would be ~40 bytes total)
      await expect(
        ext.set.fn(['default', 'b', 'y'.repeat(20)])
      ).rejects.toThrow(RuntimeError);
      await expect(
        ext.set.fn(['default', 'b', 'y'.repeat(20)])
      ).rejects.toThrow('store exceeds size limit');
    });

    it('throws when max entries exceeded (EC-24)', async () => {
      const ext = createKvExtension({
        store: storePath,
        maxEntries: 3,
      });

      await ext.set.fn(['default', 'a', 1]);
      await ext.set.fn(['default', 'b', 2]);
      await ext.set.fn(['default', 'c', 3]);

      // Fourth entry should fail
      await expect(ext.set.fn(['default', 'd', 4])).rejects.toThrow(
        RuntimeError
      );
      await expect(ext.set.fn(['default', 'd', 4])).rejects.toThrow(
        'exceeds entry limit'
      );
    });

    it('allows updating existing key without exceeding entry limit', async () => {
      const ext = createKvExtension({
        store: storePath,
        maxEntries: 2,
      });

      await ext.set.fn(['default', 'a', 1]);
      await ext.set.fn(['default', 'b', 2]);

      // Update existing key should succeed
      await ext.set.fn(['default', 'a', 10]);
      const value = await ext.get.fn(['default', 'a']);
      expect(value).toBe(10);
    });
  });

  describe('persistence (AC-6)', () => {
    it('persists state across invocations with dispose policy', async () => {
      // First instance
      const ext1 = createKvExtension({ store: storePath });
      await ext1.set.fn(['default', 'key1', 'value1']);
      await ext1.set.fn(['default', 'key2', 42]);
      await ext1.dispose!();

      // Second instance should load persisted data
      const ext2 = createKvExtension({ store: storePath });
      const value1 = await ext2.get.fn(['default', 'key1']);
      const value2 = await ext2.get.fn(['default', 'key2']);

      expect(value1).toBe('value1');
      expect(value2).toBe(42);
    });

    it('initializes with schema defaults on first run', async () => {
      const schema: Record<string, SchemaEntry> = {
        count: { type: 'number', default: 100 },
        flag: { type: 'bool', default: true },
      };

      const ext = createKvExtension({ store: storePath, schema });
      const count = await ext.get.fn(['default', 'count']);
      const flag = await ext.get.fn(['default', 'flag']);

      expect(count).toBe(100);
      expect(flag).toBe(true);
    });

    it('validates existing store file against schema on load', async () => {
      const schema: Record<string, SchemaEntry> = {
        count: { type: 'number', default: 0 },
      };

      // Create store with valid data
      await fs.writeFile(
        storePath,
        JSON.stringify({ count: 42, extra: 'ignored' }),
        'utf-8'
      );

      const ext = createKvExtension({ store: storePath, schema });
      const count = await ext.get.fn(['default', 'count']);

      // Should load valid value
      expect(count).toBe(42);

      // Extra keys should be dropped
      const keys = await ext.keys.fn(['default']);
      expect(keys).toEqual(['count']);
    });

    it('throws on corrupt store file (EC-25)', async () => {
      // Write invalid JSON
      await fs.writeFile(storePath, 'not valid json{', 'utf-8');

      expect(() => createKvExtension({ store: storePath })).not.toThrow();

      // Error should occur when first operation is attempted
      const ext = createKvExtension({ store: storePath });
      await expect(ext.get.fn(['default', 'key'])).rejects.toThrow(
        RuntimeError
      );
      await expect(ext.get.fn(['default', 'key'])).rejects.toThrow(
        'state file corrupt'
      );
    });

    it('throws when store file has wrong type (EC-25)', async () => {
      // Write array instead of object
      await fs.writeFile(storePath, JSON.stringify([1, 2, 3]), 'utf-8');

      const ext = createKvExtension({ store: storePath });
      await expect(ext.get.fn(['default', 'key'])).rejects.toThrow(
        RuntimeError
      );
      await expect(ext.get.fn(['default', 'key'])).rejects.toThrow(
        'state file corrupt'
      );
    });
  });

  describe('write policies', () => {
    it('batches writes with dispose policy (default)', async () => {
      const ext = createKvExtension({ store: storePath });

      await ext.set.fn(['default', 'key1', 'value1']);
      await ext.set.fn(['default', 'key2', 'value2']);

      // File should not exist yet (no immediate write)
      const exists = await fs
        .access(storePath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);

      // After dispose, file should exist
      await ext.dispose!();
      const content = await fs.readFile(storePath, 'utf-8');
      const data = JSON.parse(content);
      expect(data).toEqual({ key1: 'value1', key2: 'value2' });
    });

    it('writes immediately with immediate policy', async () => {
      const ext = createKvExtension({
        store: storePath,
        writePolicy: 'immediate',
      });

      await ext.set.fn(['default', 'key1', 'value1']);

      // File should exist immediately
      const content = await fs.readFile(storePath, 'utf-8');
      const data = JSON.parse(content);
      expect(data).toEqual({ key1: 'value1' });
    });

    it('performs atomic writes (write .tmp, then rename)', async () => {
      const ext = createKvExtension({ store: storePath });

      await ext.set.fn(['default', 'key1', 'value1']);
      await ext.dispose!();

      // .tmp file should not exist after successful write
      const tmpPath = `${storePath}.tmp`;
      const tmpExists = await fs
        .access(tmpPath)
        .then(() => true)
        .catch(() => false);
      expect(tmpExists).toBe(false);

      // Store file should exist
      const exists = await fs
        .access(storePath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });
  });

  describe('type validation', () => {
    const schema: Record<string, SchemaEntry> = {
      str: { type: 'string', default: '' },
      num: { type: 'number', default: 0 },
      bool: { type: 'bool', default: false },
      list: { type: 'list', default: [] },
      dict: { type: 'dict', default: {} },
    };

    it('validates string type', async () => {
      const ext = createKvExtension({ store: storePath, schema });

      await ext.set.fn(['default', 'str', 'hello']);
      expect(await ext.get.fn(['default', 'str'])).toBe('hello');

      await expect(ext.set.fn(['default', 'str', 123])).rejects.toThrow(
        'got number'
      );
    });

    it('validates number type', async () => {
      const ext = createKvExtension({ store: storePath, schema });

      await ext.set.fn(['default', 'num', 42]);
      expect(await ext.get.fn(['default', 'num'])).toBe(42);

      await expect(ext.set.fn(['default', 'num', 'text'])).rejects.toThrow(
        'got string'
      );
    });

    it('validates bool type', async () => {
      const ext = createKvExtension({ store: storePath, schema });

      await ext.set.fn(['default', 'bool', true]);
      expect(await ext.get.fn(['default', 'bool'])).toBe(true);

      await expect(ext.set.fn(['default', 'bool', 1])).rejects.toThrow(
        'got number'
      );
    });

    it('validates list type', async () => {
      const ext = createKvExtension({ store: storePath, schema });

      await ext.set.fn(['default', 'list', [1, 2, 3]]);
      expect(await ext.get.fn(['default', 'list'])).toEqual([1, 2, 3]);

      await expect(ext.set.fn(['default', 'list', { a: 1 }])).rejects.toThrow(
        'got dict'
      );
    });

    it('validates dict type', async () => {
      const ext = createKvExtension({ store: storePath, schema });

      await ext.set.fn(['default', 'dict', { a: 1, b: 2 }]);
      expect(await ext.get.fn(['default', 'dict'])).toEqual({ a: 1, b: 2 });

      await expect(ext.set.fn(['default', 'dict', [1, 2]])).rejects.toThrow(
        'got list'
      );
    });
  });

  describe('access mode enforcement', () => {
    it('read-only mode rejects set operation (IC-2, EC-3)', async () => {
      const ext = createKvExtension({
        store: storePath,
        mode: 'read',
      });

      await expect(ext.set.fn(['default', 'key', 'value'])).rejects.toThrow(
        RuntimeError
      );
      await expect(ext.set.fn(['default', 'key', 'value'])).rejects.toThrow(
        "Mount 'default' is read-only"
      );
    });

    it('read-only mode rejects delete operation (IC-2)', async () => {
      const ext = createKvExtension({
        store: storePath,
        mode: 'read',
      });

      await expect(ext.delete.fn(['default', 'key'])).rejects.toThrow(
        RuntimeError
      );
      await expect(ext.delete.fn(['default', 'key'])).rejects.toThrow(
        "Mount 'default' is read-only"
      );
    });

    it('read-only mode rejects clear operation (IC-2)', async () => {
      const ext = createKvExtension({
        store: storePath,
        mode: 'read',
      });

      await expect(ext.clear.fn(['default'])).rejects.toThrow(RuntimeError);
      await expect(ext.clear.fn(['default'])).rejects.toThrow(
        "Mount 'default' is read-only"
      );
    });

    it('read-only mode allows read operations', async () => {
      // First create a store with some data
      const ext1 = createKvExtension({
        store: storePath,
        mode: 'read-write',
      });
      await ext1.set.fn(['default', 'key1', 'value1']);
      await ext1.dispose!();

      // Now open in read-only mode
      const ext2 = createKvExtension({
        store: storePath,
        mode: 'read',
      });

      // All read operations should work
      const value = await ext2.get.fn(['default', 'key1']);
      expect(value).toBe('value1');

      const exists = await ext2.has.fn(['default', 'key1']);
      expect(exists).toBe(true);

      const keys = await ext2.keys.fn(['default']);
      expect(keys).toContain('key1');

      const all = await ext2.getAll.fn(['default']);
      expect(all).toEqual({ key1: 'value1' });
    });

    it('read-write mode allows all operations (default)', async () => {
      const ext = createKvExtension({
        store: storePath,
        mode: 'read-write',
      });

      // Write operations should work
      await ext.set.fn(['default', 'key', 'value']);
      expect(await ext.get.fn(['default', 'key'])).toBe('value');

      await ext.delete.fn(['default', 'key']);
      expect(await ext.has.fn(['default', 'key'])).toBe(false);

      await ext.set.fn(['default', 'a', 1]);
      await ext.clear.fn(['default']);
      expect(await ext.keys.fn(['default'])).toHaveLength(0);
    });

    it('mode defaults to read-write when not specified', async () => {
      const ext = createKvExtension({
        store: storePath,
      });

      // Should allow write operations
      await ext.set.fn(['default', 'key', 'value']);
      expect(await ext.get.fn(['default', 'key'])).toBe('value');
    });

    it('write mode allows write operations', async () => {
      const ext = createKvExtension({
        store: storePath,
        mode: 'write',
      });

      // Should allow write operations
      await ext.set.fn(['default', 'key', 'value']);
      await ext.delete.fn(['default', 'key']);
      await ext.clear.fn(['default']);
    });
  });

  describe('boundary cases', () => {
    it('empty schema object returns empty schema list (AC-31 partial)', async () => {
      const ext = createKvExtension({ store: storePath, schema: {} });

      // schema() should return empty list for empty schema
      const schemaResult = await ext.schema.fn(['default']);
      expect(schemaResult).toEqual([]);

      // NOTE: AC-31 specifies empty schema should behave as open mode,
      // but current implementation treats {} as declared mode (rejects unknown keys).
      // This is a known limitation - see [DEVIATION] in Implementation Notes.
      await expect(ext.set.fn(['default', 'any_key', 'value'])).rejects.toThrow(
        'not declared in schema'
      );
    });

    it('max entries boundary: accept at limit, reject after (AC-28)', async () => {
      const ext = createKvExtension({
        store: storePath,
        maxEntries: 2,
      });

      // Should accept entries up to the limit
      await ext.set.fn(['default', 'a', 1]);
      await ext.set.fn(['default', 'b', 2]);

      // Verify both entries exist
      expect(await ext.has.fn(['default', 'a'])).toBe(true);
      expect(await ext.has.fn(['default', 'b'])).toBe(true);

      // Next set should throw
      await expect(ext.set.fn(['default', 'c', 3])).rejects.toThrow(
        RuntimeError
      );
      await expect(ext.set.fn(['default', 'c', 3])).rejects.toThrow(
        'exceeds entry limit'
      );
    });

    it('empty store returns schema defaults on first run (AC-24)', async () => {
      const schema: Record<string, SchemaEntry> = {
        run_count: { type: 'number', default: 0 },
        last_user: { type: 'string', default: 'anonymous' },
        active: { type: 'bool', default: true },
      };

      // First run with no existing store file
      const ext = createKvExtension({ store: storePath, schema });

      // Should return schema defaults
      expect(await ext.get.fn(['default', 'run_count'])).toBe(0);
      expect(await ext.get.fn(['default', 'last_user'])).toBe('anonymous');
      expect(await ext.get.fn(['default', 'active'])).toBe(true);
    });
  });

  describe('mounts() introspection (IR-11)', () => {
    it('returns list of mount metadata', async () => {
      const storePath1 = path.join(tempDir, 'store1.json');
      const storePath2 = path.join(tempDir, 'store2.json');

      const ext = createKvExtension({
        mounts: {
          user: {
            mode: 'read-write',
            store: storePath1,
            schema: {
              name: { type: 'string', default: '' },
            },
            maxEntries: 500,
            maxValueSize: 50000,
          },
          cache: {
            mode: 'read',
            store: storePath2,
          },
        },
      });

      const result = await ext.mounts.fn([]);

      expect(result).toEqual(
        expect.arrayContaining([
          {
            name: 'user',
            mode: 'read-write',
            schema: 'declared',
            maxEntries: 500,
            maxValueSize: 50000,
          },
          {
            name: 'cache',
            mode: 'read',
            schema: 'open',
            maxEntries: 10000,
            maxValueSize: 102400,
          },
        ])
      );
      expect(result).toHaveLength(2);
    });

    it('includes all mount metadata fields (name, mode, schema, maxEntries, maxValueSize)', async () => {
      const ext = createKvExtension({
        store: storePath,
        mode: 'write',
        maxEntries: 200,
        maxValueSize: 2048,
      });

      const result = await ext.mounts.fn([]);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: 'default',
        mode: 'write',
        schema: 'open',
        maxEntries: 200,
        maxValueSize: 2048,
      });
    });

    it('distinguishes declared vs open schema mode', async () => {
      const storePath1 = path.join(tempDir, 'declared.json');
      const storePath2 = path.join(tempDir, 'open.json');

      const ext = createKvExtension({
        mounts: {
          declared: {
            mode: 'read-write',
            store: storePath1,
            schema: { key: { type: 'string', default: '' } },
          },
          open: {
            mode: 'read-write',
            store: storePath2,
          },
        },
      });

      const result = await ext.mounts.fn([]);

      const declaredMount = result.find(
        (m: Record<string, unknown>) => m.name === 'declared'
      );
      const openMount = result.find(
        (m: Record<string, unknown>) => m.name === 'open'
      );

      expect(declaredMount?.schema).toBe('declared');
      expect(openMount?.schema).toBe('open');
    });

    it('applies default values for maxEntries and maxValueSize', async () => {
      const ext = createKvExtension({
        store: storePath,
      });

      const result = await ext.mounts.fn([]);

      expect(result[0]).toMatchObject({
        maxEntries: 10000,
        maxValueSize: 102400,
      });
    });
  });

  describe('mount validation (EC-2, EC-7)', () => {
    it('get() throws MountError for unknown mount', async () => {
      const ext = createKvExtension({
        mounts: {
          valid: {
            mode: 'read-write',
            store: path.join(tempDir, 'valid.json'),
          },
        },
      });

      await expect(ext.get.fn(['unknown', 'key'])).rejects.toThrow(
        RuntimeError
      );
      await expect(ext.get.fn(['unknown', 'key'])).rejects.toThrow(
        "Mount 'unknown' not found"
      );
    });

    it('set() throws MountError for unknown mount', async () => {
      const ext = createKvExtension({
        mounts: {
          valid: {
            mode: 'read-write',
            store: path.join(tempDir, 'valid.json'),
          },
        },
      });

      await expect(ext.set.fn(['unknown', 'key', 'value'])).rejects.toThrow(
        RuntimeError
      );
      await expect(ext.set.fn(['unknown', 'key', 'value'])).rejects.toThrow(
        "Mount 'unknown' not found"
      );
    });

    it('delete() throws MountError for unknown mount', async () => {
      const ext = createKvExtension({
        mounts: {
          valid: {
            mode: 'read-write',
            store: path.join(tempDir, 'valid.json'),
          },
        },
      });

      await expect(ext.delete.fn(['unknown', 'key'])).rejects.toThrow(
        RuntimeError
      );
      await expect(ext.delete.fn(['unknown', 'key'])).rejects.toThrow(
        "Mount 'unknown' not found"
      );
    });

    it('merge() throws MountError for unknown mount', async () => {
      const ext = createKvExtension({
        mounts: {
          valid: {
            mode: 'read-write',
            store: path.join(tempDir, 'valid.json'),
          },
        },
      });

      await expect(ext.merge.fn(['unknown', 'key', {}])).rejects.toThrow(
        RuntimeError
      );
      await expect(ext.merge.fn(['unknown', 'key', {}])).rejects.toThrow(
        "Mount 'unknown' not found"
      );
    });

    it('get_or() throws MountError for unknown mount', async () => {
      const ext = createKvExtension({
        mounts: {
          valid: {
            mode: 'read-write',
            store: path.join(tempDir, 'valid.json'),
          },
        },
      });

      await expect(
        ext.get_or.fn(['unknown', 'key', 'fallback'])
      ).rejects.toThrow(RuntimeError);
      await expect(
        ext.get_or.fn(['unknown', 'key', 'fallback'])
      ).rejects.toThrow("Mount 'unknown' not found");
    });

    it('keys() throws MountError for unknown mount', async () => {
      const ext = createKvExtension({
        mounts: {
          valid: {
            mode: 'read-write',
            store: path.join(tempDir, 'valid.json'),
          },
        },
      });

      await expect(ext.keys.fn(['unknown'])).rejects.toThrow(RuntimeError);
      await expect(ext.keys.fn(['unknown'])).rejects.toThrow(
        "Mount 'unknown' not found"
      );
    });

    it('has() throws MountError for unknown mount', async () => {
      const ext = createKvExtension({
        mounts: {
          valid: {
            mode: 'read-write',
            store: path.join(tempDir, 'valid.json'),
          },
        },
      });

      await expect(ext.has.fn(['unknown', 'key'])).rejects.toThrow(
        RuntimeError
      );
      await expect(ext.has.fn(['unknown', 'key'])).rejects.toThrow(
        "Mount 'unknown' not found"
      );
    });

    it('clear() throws MountError for unknown mount', async () => {
      const ext = createKvExtension({
        mounts: {
          valid: {
            mode: 'read-write',
            store: path.join(tempDir, 'valid.json'),
          },
        },
      });

      await expect(ext.clear.fn(['unknown'])).rejects.toThrow(RuntimeError);
      await expect(ext.clear.fn(['unknown'])).rejects.toThrow(
        "Mount 'unknown' not found"
      );
    });

    it('getAll() throws MountError for unknown mount', async () => {
      const ext = createKvExtension({
        mounts: {
          valid: {
            mode: 'read-write',
            store: path.join(tempDir, 'valid.json'),
          },
        },
      });

      await expect(ext.getAll.fn(['unknown'])).rejects.toThrow(RuntimeError);
      await expect(ext.getAll.fn(['unknown'])).rejects.toThrow(
        "Mount 'unknown' not found"
      );
    });

    it('schema() throws MountError for unknown mount', async () => {
      const ext = createKvExtension({
        mounts: {
          valid: {
            mode: 'read-write',
            store: path.join(tempDir, 'valid.json'),
          },
        },
      });

      await expect(ext.schema.fn(['unknown'])).rejects.toThrow(RuntimeError);
      await expect(ext.schema.fn(['unknown'])).rejects.toThrow(
        "Mount 'unknown' not found"
      );
    });

    it('all functions validate mount name (EC-7)', async () => {
      const ext = createKvExtension({
        mounts: {
          valid: {
            mode: 'read-write',
            store: path.join(tempDir, 'valid.json'),
          },
        },
      });

      // All functions should throw for unknown mount
      const functionsToTest = [
        () => ext.get.fn(['unknown', 'key']),
        () => ext.set.fn(['unknown', 'key', 'value']),
        () => ext.delete.fn(['unknown', 'key']),
        () => ext.merge.fn(['unknown', 'key', {}]),
        () => ext.get_or.fn(['unknown', 'key', 'fallback']),
        () => ext.keys.fn(['unknown']),
        () => ext.has.fn(['unknown', 'key']),
        () => ext.clear.fn(['unknown']),
        () => ext.getAll.fn(['unknown']),
        () => ext.schema.fn(['unknown']),
      ];

      for (const fn of functionsToTest) {
        await expect(fn()).rejects.toThrow("Mount 'unknown' not found");
      }
    });
  });

  describe('multi-mount support (IC-1)', () => {
    it('creates separate stores for each mount', async () => {
      const storePath1 = path.join(tempDir, 'store1.json');
      const storePath2 = path.join(tempDir, 'store2.json');

      const ext = createKvExtension({
        mounts: {
          user: {
            mode: 'read-write',
            store: storePath1,
          },
          cache: {
            mode: 'read-write',
            store: storePath2,
          },
        },
      });

      // Set values in different mounts
      await ext.set.fn(['user', 'name', 'Alice']);
      await ext.set.fn(['cache', 'token', 'abc123']);

      // Verify mount isolation
      const userName = await ext.get.fn(['user', 'name']);
      const cacheToken = await ext.get.fn(['cache', 'token']);

      expect(userName).toBe('Alice');
      expect(cacheToken).toBe('abc123');

      // Verify missing keys in other mounts
      const userToken = await ext.get.fn(['user', 'token']);
      const cacheName = await ext.get.fn(['cache', 'name']);

      expect(userToken).toBe(''); // Missing key returns empty string
      expect(cacheName).toBe('');
    });

    it('functions access correct mount store (IR-6, IR-7, IR-8, IR-9, IR-10)', async () => {
      const storePath1 = path.join(tempDir, 'store1.json');
      const storePath2 = path.join(tempDir, 'store2.json');

      const ext = createKvExtension({
        mounts: {
          m1: {
            mode: 'read-write',
            store: storePath1,
          },
          m2: {
            mode: 'read-write',
            store: storePath2,
          },
        },
      });

      // Set values in both mounts
      await ext.set.fn(['m1', 'a', 1]);
      await ext.set.fn(['m1', 'b', 2]);
      await ext.set.fn(['m2', 'c', 3]);

      // IR-6: keys() returns keys from specified mount only
      const m1Keys = await ext.keys.fn(['m1']);
      const m2Keys = await ext.keys.fn(['m2']);

      expect(m1Keys).toEqual(expect.arrayContaining(['a', 'b']));
      expect(m1Keys).toHaveLength(2);
      expect(m2Keys).toEqual(['c']);

      // IR-7: has() checks specified mount only
      expect(await ext.has.fn(['m1', 'a'])).toBe(true);
      expect(await ext.has.fn(['m2', 'a'])).toBe(false);

      // IR-9: getAll() returns entries from specified mount only
      const m1All = await ext.getAll.fn(['m1']);
      const m2All = await ext.getAll.fn(['m2']);

      expect(m1All).toEqual({ a: 1, b: 2 });
      expect(m2All).toEqual({ c: 3 });

      // IR-8: clear() clears specified mount only
      await ext.clear.fn(['m1']);

      expect(await ext.keys.fn(['m1'])).toHaveLength(0);
      expect(await ext.keys.fn(['m2'])).toHaveLength(1); // m2 unaffected
    });

    it('schema() returns schema from specified mount (IR-10)', async () => {
      const storePath1 = path.join(tempDir, 'store1.json');
      const storePath2 = path.join(tempDir, 'store2.json');

      const ext = createKvExtension({
        mounts: {
          user: {
            mode: 'read-write',
            store: storePath1,
            schema: {
              name: { type: 'string', default: '', description: 'User name' },
            },
          },
          cache: {
            mode: 'read-write',
            store: storePath2,
            // No schema (open mode)
          },
        },
      });

      // user mount has schema
      const userSchema = await ext.schema.fn(['user']);
      expect(userSchema).toEqual([
        { key: 'name', type: 'string', description: 'User name' },
      ]);

      // cache mount has no schema
      const cacheSchema = await ext.schema.fn(['cache']);
      expect(cacheSchema).toEqual([]);
    });

    it('dispose flushes all mount stores', async () => {
      const storePath1 = path.join(tempDir, 'store1.json');
      const storePath2 = path.join(tempDir, 'store2.json');

      const ext = createKvExtension({
        mounts: {
          m1: { mode: 'read-write', store: storePath1 },
          m2: { mode: 'read-write', store: storePath2 },
        },
      });

      await ext.set.fn(['m1', 'a', 1]);
      await ext.set.fn(['m2', 'b', 2]);
      await ext.dispose!();

      // Both stores should be flushed
      const content1 = await fs.readFile(storePath1, 'utf-8');
      const content2 = await fs.readFile(storePath2, 'utf-8');

      expect(JSON.parse(content1)).toEqual({ a: 1 });
      expect(JSON.parse(content2)).toEqual({ b: 2 });
    });
  });
});
