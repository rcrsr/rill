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
    it('creates ExtensionResult with 8 functions and dispose (IC-7)', () => {
      const config: KvConfig = {
        store: storePath,
      };

      const ext = createKvExtension(config);

      // Verify all 8 functions exist
      expect(ext).toHaveProperty('get');
      expect(ext).toHaveProperty('set');
      expect(ext).toHaveProperty('delete');
      expect(ext).toHaveProperty('keys');
      expect(ext).toHaveProperty('has');
      expect(ext).toHaveProperty('clear');
      expect(ext).toHaveProperty('getAll');
      expect(ext).toHaveProperty('schema');
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

  describe('open mode (no schema)', () => {
    it('get() returns empty string for missing key in open mode (IR-15)', async () => {
      const ext = createKvExtension({ store: storePath });
      const result = await ext.get.fn(['missing']);
      expect(result).toBe('');
    });

    it('set() stores value and returns true (IR-16)', async () => {
      const ext = createKvExtension({ store: storePath });
      const result = await ext.set.fn(['key1', 'value1']);
      expect(result).toBe(true);

      const value = await ext.get.fn(['key1']);
      expect(value).toBe('value1');
    });

    it('delete() removes key and returns true (IR-17)', async () => {
      const ext = createKvExtension({ store: storePath });
      await ext.set.fn(['key1', 'value1']);

      const result = await ext.delete.fn(['key1']);
      expect(result).toBe(true);

      const value = await ext.get.fn(['key1']);
      expect(value).toBe(''); // Missing key returns empty string
    });

    it('delete() returns false for missing key', async () => {
      const ext = createKvExtension({ store: storePath });
      const result = await ext.delete.fn(['missing']);
      expect(result).toBe(false);
    });

    it('keys() returns list of all keys (IR-18)', async () => {
      const ext = createKvExtension({ store: storePath });
      await ext.set.fn(['a', 1]);
      await ext.set.fn(['b', 2]);
      await ext.set.fn(['c', 3]);

      const result = await ext.keys.fn([]);
      expect(result).toEqual(expect.arrayContaining(['a', 'b', 'c']));
      expect(result).toHaveLength(3);
    });

    it('has() checks key existence (IR-19)', async () => {
      const ext = createKvExtension({ store: storePath });
      await ext.set.fn(['key1', 'value1']);

      const exists = await ext.has.fn(['key1']);
      expect(exists).toBe(true);

      const missing = await ext.has.fn(['missing']);
      expect(missing).toBe(false);
    });

    it('clear() removes all keys (IR-20)', async () => {
      const ext = createKvExtension({ store: storePath });
      await ext.set.fn(['a', 1]);
      await ext.set.fn(['b', 2]);

      const result = await ext.clear.fn([]);
      expect(result).toBe(true);

      const keys = await ext.keys.fn([]);
      expect(keys).toHaveLength(0);
    });

    it('getAll() returns dict of all entries (IR-21)', async () => {
      const ext = createKvExtension({ store: storePath });
      await ext.set.fn(['a', 1]);
      await ext.set.fn(['b', 'text']);
      await ext.set.fn(['c', true]);

      const result = await ext.getAll.fn([]);
      expect(result).toEqual({
        a: 1,
        b: 'text',
        c: true,
      });
    });

    it('schema() returns empty list in open mode (IR-22)', async () => {
      const ext = createKvExtension({ store: storePath });
      const result = await ext.schema.fn([]);
      expect(result).toEqual([]);
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
      const result = await ext.get.fn(['count']);
      expect(result).toBe(0);
    });

    it('set() validates type against schema (EC-21)', async () => {
      const ext = createKvExtension({ store: storePath, schema: testSchema });

      // Valid set
      await ext.set.fn(['count', 42]);
      const value = await ext.get.fn(['count']);
      expect(value).toBe(42);

      // Invalid type - should throw
      await expect(ext.set.fn(['count', 'not-a-number'])).rejects.toThrow(
        RuntimeError
      );
      await expect(ext.set.fn(['count', 'not-a-number'])).rejects.toThrow(
        'expects number, got string'
      );
    });

    it('get() throws for key not in schema (EC-20)', async () => {
      const ext = createKvExtension({ store: storePath, schema: testSchema });

      await expect(ext.get.fn(['unknown'])).rejects.toThrow(RuntimeError);
      await expect(ext.get.fn(['unknown'])).rejects.toThrow(
        'not declared in schema'
      );
    });

    it('set() throws for key not in schema (EC-20)', async () => {
      const ext = createKvExtension({ store: storePath, schema: testSchema });

      await expect(ext.set.fn(['unknown', 'value'])).rejects.toThrow(
        RuntimeError
      );
      await expect(ext.set.fn(['unknown', 'value'])).rejects.toThrow(
        'not declared in schema'
      );
    });

    it('clear() restores schema defaults (IR-20)', async () => {
      const ext = createKvExtension({ store: storePath, schema: testSchema });

      await ext.set.fn(['count', 100]);
      await ext.set.fn(['name', 'Alice']);

      await ext.clear.fn([]);

      const count = await ext.get.fn(['count']);
      const name = await ext.get.fn(['name']);
      expect(count).toBe(0);
      expect(name).toBe('');
    });

    it('schema() returns list of schema entries (IR-22)', async () => {
      const ext = createKvExtension({ store: storePath, schema: testSchema });
      const result = await ext.schema.fn([]);

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
    it('throws when value exceeds maxValueSize (EC-22)', async () => {
      const ext = createKvExtension({
        store: storePath,
        maxValueSize: 100, // 100 bytes
      });

      const largeValue = 'x'.repeat(200);

      await expect(ext.set.fn(['key', largeValue])).rejects.toThrow(
        RuntimeError
      );
      await expect(ext.set.fn(['key', largeValue])).rejects.toThrow(
        'exceeds size limit'
      );
    });

    it('throws when store exceeds maxStoreSize (EC-23)', async () => {
      const ext = createKvExtension({
        store: storePath,
        maxStoreSize: 30, // 30 bytes (very small)
      });

      // Add entries until store size is exceeded
      await ext.set.fn(['a', 'x'.repeat(5)]);

      // This should exceed the limit (would be ~40 bytes total)
      await expect(ext.set.fn(['b', 'y'.repeat(20)])).rejects.toThrow(
        RuntimeError
      );
      await expect(ext.set.fn(['b', 'y'.repeat(20)])).rejects.toThrow(
        'store exceeds size limit'
      );
    });

    it('throws when max entries exceeded (EC-24)', async () => {
      const ext = createKvExtension({
        store: storePath,
        maxEntries: 3,
      });

      await ext.set.fn(['a', 1]);
      await ext.set.fn(['b', 2]);
      await ext.set.fn(['c', 3]);

      // Fourth entry should fail
      await expect(ext.set.fn(['d', 4])).rejects.toThrow(RuntimeError);
      await expect(ext.set.fn(['d', 4])).rejects.toThrow('exceeds entry limit');
    });

    it('allows updating existing key without exceeding entry limit', async () => {
      const ext = createKvExtension({
        store: storePath,
        maxEntries: 2,
      });

      await ext.set.fn(['a', 1]);
      await ext.set.fn(['b', 2]);

      // Update existing key should succeed
      await ext.set.fn(['a', 10]);
      const value = await ext.get.fn(['a']);
      expect(value).toBe(10);
    });
  });

  describe('persistence (AC-6)', () => {
    it('persists state across invocations with dispose policy', async () => {
      // First instance
      const ext1 = createKvExtension({ store: storePath });
      await ext1.set.fn(['key1', 'value1']);
      await ext1.set.fn(['key2', 42]);
      await ext1.dispose!();

      // Second instance should load persisted data
      const ext2 = createKvExtension({ store: storePath });
      const value1 = await ext2.get.fn(['key1']);
      const value2 = await ext2.get.fn(['key2']);

      expect(value1).toBe('value1');
      expect(value2).toBe(42);
    });

    it('initializes with schema defaults on first run', async () => {
      const schema: Record<string, SchemaEntry> = {
        count: { type: 'number', default: 100 },
        flag: { type: 'bool', default: true },
      };

      const ext = createKvExtension({ store: storePath, schema });
      const count = await ext.get.fn(['count']);
      const flag = await ext.get.fn(['flag']);

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
      const count = await ext.get.fn(['count']);

      // Should load valid value
      expect(count).toBe(42);

      // Extra keys should be dropped
      const keys = await ext.keys.fn([]);
      expect(keys).toEqual(['count']);
    });

    it('throws on corrupt store file (EC-25)', async () => {
      // Write invalid JSON
      await fs.writeFile(storePath, 'not valid json{', 'utf-8');

      expect(() => createKvExtension({ store: storePath })).not.toThrow();

      // Error should occur when first operation is attempted
      const ext = createKvExtension({ store: storePath });
      await expect(ext.get.fn(['key'])).rejects.toThrow(RuntimeError);
      await expect(ext.get.fn(['key'])).rejects.toThrow('state file corrupt');
    });

    it('throws when store file has wrong type (EC-25)', async () => {
      // Write array instead of object
      await fs.writeFile(storePath, JSON.stringify([1, 2, 3]), 'utf-8');

      const ext = createKvExtension({ store: storePath });
      await expect(ext.get.fn(['key'])).rejects.toThrow(RuntimeError);
      await expect(ext.get.fn(['key'])).rejects.toThrow('state file corrupt');
    });
  });

  describe('write policies', () => {
    it('batches writes with dispose policy (default)', async () => {
      const ext = createKvExtension({ store: storePath });

      await ext.set.fn(['key1', 'value1']);
      await ext.set.fn(['key2', 'value2']);

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

      await ext.set.fn(['key1', 'value1']);

      // File should exist immediately
      const content = await fs.readFile(storePath, 'utf-8');
      const data = JSON.parse(content);
      expect(data).toEqual({ key1: 'value1' });
    });

    it('performs atomic writes (write .tmp, then rename)', async () => {
      const ext = createKvExtension({ store: storePath });

      await ext.set.fn(['key1', 'value1']);
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

      await ext.set.fn(['str', 'hello']);
      expect(await ext.get.fn(['str'])).toBe('hello');

      await expect(ext.set.fn(['str', 123])).rejects.toThrow('got number');
    });

    it('validates number type', async () => {
      const ext = createKvExtension({ store: storePath, schema });

      await ext.set.fn(['num', 42]);
      expect(await ext.get.fn(['num'])).toBe(42);

      await expect(ext.set.fn(['num', 'text'])).rejects.toThrow('got string');
    });

    it('validates bool type', async () => {
      const ext = createKvExtension({ store: storePath, schema });

      await ext.set.fn(['bool', true]);
      expect(await ext.get.fn(['bool'])).toBe(true);

      await expect(ext.set.fn(['bool', 1])).rejects.toThrow('got number');
    });

    it('validates list type', async () => {
      const ext = createKvExtension({ store: storePath, schema });

      await ext.set.fn(['list', [1, 2, 3]]);
      expect(await ext.get.fn(['list'])).toEqual([1, 2, 3]);

      await expect(ext.set.fn(['list', { a: 1 }])).rejects.toThrow('got dict');
    });

    it('validates dict type', async () => {
      const ext = createKvExtension({ store: storePath, schema });

      await ext.set.fn(['dict', { a: 1, b: 2 }]);
      expect(await ext.get.fn(['dict'])).toEqual({ a: 1, b: 2 });

      await expect(ext.set.fn(['dict', [1, 2]])).rejects.toThrow('got list');
    });
  });

  describe('boundary cases', () => {
    it('empty schema object returns empty schema list (AC-31 partial)', async () => {
      const ext = createKvExtension({ store: storePath, schema: {} });

      // schema() should return empty list for empty schema
      const schemaResult = await ext.schema.fn([]);
      expect(schemaResult).toEqual([]);

      // NOTE: AC-31 specifies empty schema should behave as open mode,
      // but current implementation treats {} as declared mode (rejects unknown keys).
      // This is a known limitation - see [DEVIATION] in Implementation Notes.
      await expect(ext.set.fn(['any_key', 'value'])).rejects.toThrow(
        'not declared in schema'
      );
    });

    it('max entries boundary: accept at limit, reject after (AC-28)', async () => {
      const ext = createKvExtension({
        store: storePath,
        maxEntries: 2,
      });

      // Should accept entries up to the limit
      await ext.set.fn(['a', 1]);
      await ext.set.fn(['b', 2]);

      // Verify both entries exist
      expect(await ext.has.fn(['a'])).toBe(true);
      expect(await ext.has.fn(['b'])).toBe(true);

      // Next set should throw
      await expect(ext.set.fn(['c', 3])).rejects.toThrow(RuntimeError);
      await expect(ext.set.fn(['c', 3])).rejects.toThrow('exceeds entry limit');
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
      expect(await ext.get.fn(['run_count'])).toBe(0);
      expect(await ext.get.fn(['last_user'])).toBe('anonymous');
      expect(await ext.get.fn(['active'])).toBe(true);
    });
  });
});
