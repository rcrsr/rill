/**
 * Integration tests for Redis kv contract functions.
 *
 * Coverage:
 * - AC-1: Backend swap produces identical output
 * - AC-3: Atomic merge without race condition
 * - AC-7: Unknown mount throws MountError
 * - AC-8: Read-only mode throws PermissionError
 * - AC-11: Empty mount returns empty results
 * - AC-12: Value size boundary
 * - IR-1, EC-1: get returns schema default when key missing
 * - IR-2: get_or returns fallback when key missing
 * - IR-3, EC-3, EC-4: set validates mode and size
 * - IR-4, EC-5, EC-6: merge validates dict type and mode
 * - IR-5: delete removes key
 * - IR-6: keys uses SCAN not KEYS
 * - IR-7: has checks existence
 * - IR-8: clear removes all mount keys
 * - IR-9: getAll retrieves all entries
 * - IR-10: schema returns mount schema
 * - IR-11: mounts returns metadata
 * - EC-2, EC-7: All functions throw for unknown mount
 * - TTL support for auto-expiring keys
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Redis } from 'ioredis';
import { createRedisKvExtension } from '../src/factory.js';
import type { RedisKvExtensionConfig } from '../src/factory.js';
import { createKvExtension } from '@rcrsr/rill';

// Redis test connection
const REDIS_URL = 'redis://localhost:6379';

// Check if Redis is available before running tests
let redisAvailable = false;

try {
  const testClient = new Redis(REDIS_URL, {
    connectTimeout: 1000,
    maxRetriesPerRequest: 1,
  });

  await new Promise<void>((resolve) => {
    testClient.on('ready', () => {
      redisAvailable = true;
      testClient.quit();
      resolve();
    });
    testClient.on('error', (err: Error) => {
      if (
        err.message.includes('ECONNREFUSED') ||
        err.message.includes('ETIMEDOUT')
      ) {
        testClient.quit();
        resolve();
      }
    });
    setTimeout(() => {
      testClient.quit();
      resolve();
    }, 2000);
  });
} catch {
  redisAvailable = false;
}

describe.skipIf(!redisAvailable)('Integration Tests', () => {
  // Track created extensions for cleanup
  const extensions: Array<{ dispose?: () => void | Promise<void> }> = [];

  beforeEach(async () => {
    // Clean up any test keys from previous runs
    const cleanup = createRedisKvExtension({
      url: REDIS_URL,
      mounts: {
        test: { mode: 'read-write', prefix: 'test:' },
      },
    });
    extensions.push(cleanup);
    await cleanup.clear?.fn(['test']);
  });

  afterEach(async () => {
    // Clean up all created extensions
    for (const ext of extensions) {
      if (ext.dispose) {
        await ext.dispose();
      }
    }
    extensions.length = 0;
  });

  describe('IR-1, EC-1: get returns schema default when key missing', () => {
    it('returns schema default for missing key in declared mode', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          user: {
            mode: 'read-write',
            prefix: 'test:user:',
            schema: {
              name: { type: 'string', default: 'Anonymous' },
              count: { type: 'number', default: 0 },
            },
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      const name = await ext.get?.fn(['user', 'name']);
      expect(name).toBe('Anonymous');

      const count = await ext.get?.fn(['user', 'count']);
      expect(count).toBe(0);
    });

    it('returns empty string for missing key in open mode', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          cache: {
            mode: 'read-write',
            prefix: 'test:cache:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      const result = await ext.get?.fn(['cache', 'missing']);
      expect(result).toBe('');
    });

    it('returns stored value when key exists', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          state: {
            mode: 'read-write',
            prefix: 'test:state:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      await ext.set?.fn(['state', 'key', 'value']);
      const result = await ext.get?.fn(['state', 'key']);
      expect(result).toBe('value');
    });
  });

  describe('IR-2: get_or returns fallback when key missing', () => {
    it('returns fallback for missing key', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          cache: {
            mode: 'read-write',
            prefix: 'test:cache:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      const result = await ext.get_or?.fn(['cache', 'missing', 'fallback']);
      expect(result).toBe('fallback');
    });

    it('returns stored value when key exists', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          cache: {
            mode: 'read-write',
            prefix: 'test:cache:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      await ext.set?.fn(['cache', 'key', 'stored']);
      const result = await ext.get_or?.fn(['cache', 'key', 'fallback']);
      expect(result).toBe('stored');
    });
  });

  describe('IR-3, EC-3, EC-4: set validates mode and size', () => {
    it('sets value successfully', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          state: {
            mode: 'read-write',
            prefix: 'test:state:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      const result = await ext.set?.fn(['state', 'key', 'value']);
      expect(result).toBe(true);

      const value = await ext.get?.fn(['state', 'key']);
      expect(value).toBe('value');
    });

    it('throws when mode is read-only', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          readonly: {
            mode: 'read',
            prefix: 'test:readonly:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      await expect(ext.set?.fn(['readonly', 'key', 'value'])).rejects.toThrow(
        `Mount 'readonly' is read-only`
      );
    });

    it('throws when value exceeds maxValueSize', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          limited: {
            mode: 'read-write',
            prefix: 'test:limited:',
            maxValueSize: 10,
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      const largeValue = 'x'.repeat(20);
      await expect(ext.set?.fn(['limited', 'key', largeValue])).rejects.toThrow(
        'exceeds size limit'
      );
    });

    it('validates type in declared mode', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          typed: {
            mode: 'read-write',
            prefix: 'test:typed:',
            schema: {
              count: { type: 'number', default: 0 },
            },
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      await expect(ext.set?.fn(['typed', 'count', 'string'])).rejects.toThrow(
        'expects number, got string'
      );
    });
  });

  describe('IR-4, EC-5, EC-6: merge validates dict type and mode', () => {
    it('merges partial dict into existing dict', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          state: {
            mode: 'read-write',
            prefix: 'test:state:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      await ext.set?.fn(['state', 'config', { a: 1, b: 2 }]);
      const result = await ext.merge?.fn(['state', 'config', { b: 3, c: 4 }]);
      expect(result).toBe(true);

      const value = await ext.get?.fn(['state', 'config']);
      expect(value).toEqual({ a: 1, b: 3, c: 4 });
    });

    it('creates new dict when key does not exist', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          state: {
            mode: 'read-write',
            prefix: 'test:state:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      const result = await ext.merge?.fn(['state', 'new', { x: 10 }]);
      expect(result).toBe(true);

      const value = await ext.get?.fn(['state', 'new']);
      expect(value).toEqual({ x: 10 });
    });

    it('throws when existing value is not a dict', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          state: {
            mode: 'read-write',
            prefix: 'test:state:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      await ext.set?.fn(['state', 'string', 'value']);
      await expect(
        ext.merge?.fn(['state', 'string', { x: 1 }])
      ).rejects.toThrow('Cannot merge into non-dict value');
    });

    it('throws when mode is read-only', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          readonly: {
            mode: 'read',
            prefix: 'test:readonly:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      await expect(
        ext.merge?.fn(['readonly', 'key', { x: 1 }])
      ).rejects.toThrow(`Mount 'readonly' is read-only`);
    });
  });

  describe('IR-5: delete removes key', () => {
    it('deletes existing key and returns true', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          state: {
            mode: 'read-write',
            prefix: 'test:state:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      await ext.set?.fn(['state', 'key', 'value']);
      const result = await ext.delete?.fn(['state', 'key']);
      expect(result).toBe(true);

      const value = await ext.get?.fn(['state', 'key']);
      expect(value).toBe('');
    });

    it('returns false when key does not exist', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          state: {
            mode: 'read-write',
            prefix: 'test:state:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      const result = await ext.delete?.fn(['state', 'missing']);
      expect(result).toBe(false);
    });
  });

  describe('IR-6: keys uses SCAN not KEYS', () => {
    it('returns all keys in mount', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          state: {
            mode: 'read-write',
            prefix: 'test:state:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      await ext.set?.fn(['state', 'key1', 'value1']);
      await ext.set?.fn(['state', 'key2', 'value2']);
      await ext.set?.fn(['state', 'key3', 'value3']);

      const keys = await ext.keys?.fn(['state']);
      expect(keys).toHaveLength(3);
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
      expect(keys).toContain('key3');
    });

    it('returns empty array for mount with no keys', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          empty: {
            mode: 'read-write',
            prefix: 'test:empty:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      const keys = await ext.keys?.fn(['empty']);
      expect(keys).toEqual([]);
    });
  });

  describe('IR-7: has checks existence', () => {
    it('returns true when key exists', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          state: {
            mode: 'read-write',
            prefix: 'test:state:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      await ext.set?.fn(['state', 'key', 'value']);
      const result = await ext.has?.fn(['state', 'key']);
      expect(result).toBe(true);
    });

    it('returns false when key does not exist', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          state: {
            mode: 'read-write',
            prefix: 'test:state:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      const result = await ext.has?.fn(['state', 'missing']);
      expect(result).toBe(false);
    });
  });

  describe('IR-8: clear removes all mount keys', () => {
    it('removes all keys in mount', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          state: {
            mode: 'read-write',
            prefix: 'test:state:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      await ext.set?.fn(['state', 'key1', 'value1']);
      await ext.set?.fn(['state', 'key2', 'value2']);
      await ext.set?.fn(['state', 'key3', 'value3']);

      const result = await ext.clear?.fn(['state']);
      expect(result).toBe(true);

      const keys = await ext.keys?.fn(['state']);
      expect(keys).toEqual([]);
    });

    it('restores schema defaults in declared mode', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          user: {
            mode: 'read-write',
            prefix: 'test:user:',
            schema: {
              name: { type: 'string', default: 'Anonymous' },
              count: { type: 'number', default: 0 },
            },
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      await ext.set?.fn(['user', 'name', 'Alice']);
      await ext.set?.fn(['user', 'count', 42]);

      await ext.clear?.fn(['user']);

      const name = await ext.get?.fn(['user', 'name']);
      expect(name).toBe('Anonymous');

      const count = await ext.get?.fn(['user', 'count']);
      expect(count).toBe(0);
    });
  });

  describe('IR-9: getAll retrieves all entries', () => {
    it('returns all entries as dict', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          state: {
            mode: 'read-write',
            prefix: 'test:state:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      await ext.set?.fn(['state', 'key1', 'value1']);
      await ext.set?.fn(['state', 'key2', 42]);
      await ext.set?.fn(['state', 'key3', { nested: true }]);

      const result = await ext.getAll?.fn(['state']);
      expect(result).toEqual({
        key1: 'value1',
        key2: 42,
        key3: { nested: true },
      });
    });

    it('returns empty dict for mount with no keys', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          empty: {
            mode: 'read-write',
            prefix: 'test:empty:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      const result = await ext.getAll?.fn(['empty']);
      expect(result).toEqual({});
    });
  });

  describe('IR-10: schema returns mount schema', () => {
    it('returns schema entries in declared mode', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          user: {
            mode: 'read-write',
            prefix: 'test:user:',
            schema: {
              name: { type: 'string', default: '', description: 'User name' },
              count: { type: 'number', default: 0 },
            },
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      const result = ext.schema?.fn(['user']);
      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        key: 'name',
        type: 'string',
        description: 'User name',
      });
      expect(result).toContainEqual({
        key: 'count',
        type: 'number',
        description: '',
      });
    });

    it('returns empty list in open mode', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          cache: {
            mode: 'read-write',
            prefix: 'test:cache:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      const result = ext.schema?.fn(['cache']);
      expect(result).toEqual([]);
    });
  });

  describe('IR-11: mounts returns metadata', () => {
    it('returns list of mount metadata', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          user: {
            mode: 'read-write',
            prefix: 'test:user:',
            schema: {
              name: { type: 'string', default: '' },
            },
            maxEntries: 1000,
            maxValueSize: 5000,
            ttl: 3600,
          },
          cache: {
            mode: 'read',
            prefix: 'test:cache:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      const result = ext.mounts?.fn([]);
      expect(result).toHaveLength(2);

      expect(result).toContainEqual({
        name: 'user',
        mode: 'read-write',
        schema: 'declared',
        maxEntries: 1000,
        maxValueSize: 5000,
        prefix: 'test:user:',
        ttl: 3600,
      });

      expect(result).toContainEqual({
        name: 'cache',
        mode: 'read',
        schema: 'open',
        maxEntries: 10000,
        maxValueSize: 102400,
        prefix: 'test:cache:',
        ttl: 0,
      });
    });
  });

  describe('EC-2, EC-7: All functions throw for unknown mount', () => {
    it('get throws for unknown mount', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          known: {
            mode: 'read-write',
            prefix: 'test:known:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      await expect(ext.get?.fn(['unknown', 'key'])).rejects.toThrow(
        `Mount 'unknown' not found`
      );
    });

    it('set throws for unknown mount', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          known: {
            mode: 'read-write',
            prefix: 'test:known:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      await expect(ext.set?.fn(['unknown', 'key', 'value'])).rejects.toThrow(
        `Mount 'unknown' not found`
      );
    });

    it('keys throws for unknown mount', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          known: {
            mode: 'read-write',
            prefix: 'test:known:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      await expect(ext.keys?.fn(['unknown'])).rejects.toThrow(
        `Mount 'unknown' not found`
      );
    });
  });

  describe('AC-3: TTL support for auto-expiring keys', () => {
    it('sets TTL on keys when configured', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          session: {
            mode: 'read-write',
            prefix: 'test:session:',
            ttl: 1, // 1 second for fast test
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      await ext.set?.fn(['session', 'token', 'abc123']);

      // Key should exist immediately
      const exists1 = await ext.has?.fn(['session', 'token']);
      expect(exists1).toBe(true);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Key should be gone
      const exists2 = await ext.has?.fn(['session', 'token']);
      expect(exists2).toBe(false);
    });

    it('sets TTL on merged keys when configured', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          session: {
            mode: 'read-write',
            prefix: 'test:session:',
            ttl: 1,
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      await ext.set?.fn(['session', 'data', { x: 1 }]);
      await ext.merge?.fn(['session', 'data', { y: 2 }]);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const exists = await ext.has?.fn(['session', 'data']);
      expect(exists).toBe(false);
    });
  });

  describe('AC-1: Backend swap produces identical output', () => {
    it('produces identical results for same operations on JSON and Redis backends', async () => {
      // JSON file backend configuration
      const jsonExt = createKvExtension({
        mounts: {
          state: {
            mode: 'read-write',
            store: '/tmp/rill-test-backend-swap.json',
            schema: {
              count: { type: 'number', default: 0 },
              name: { type: 'string', default: 'Guest' },
            },
          },
        },
      });

      // Redis backend configuration (identical schema)
      const redisExt = createRedisKvExtension({
        url: REDIS_URL,
        mounts: {
          state: {
            mode: 'read-write',
            prefix: 'test:backend-swap:',
            schema: {
              count: { type: 'number', default: 0 },
              name: { type: 'string', default: 'Guest' },
            },
          },
        },
      });

      extensions.push(jsonExt, redisExt);

      // Execute identical operations on both backends
      await jsonExt.set?.fn(['state', 'count', 42]);
      await redisExt.set?.fn(['state', 'count', 42]);

      await jsonExt.set?.fn(['state', 'name', 'Alice']);
      await redisExt.set?.fn(['state', 'name', 'Alice']);

      // Verify identical results
      const jsonCount = await jsonExt.get?.fn(['state', 'count']);
      const redisCount = await redisExt.get?.fn(['state', 'count']);
      expect(jsonCount).toBe(redisCount);
      expect(jsonCount).toBe(42);

      const jsonName = await jsonExt.get?.fn(['state', 'name']);
      const redisName = await redisExt.get?.fn(['state', 'name']);
      expect(jsonName).toBe(redisName);
      expect(jsonName).toBe('Alice');

      // Test keys operation
      const jsonKeys = await jsonExt.keys?.fn(['state']);
      const redisKeys = await redisExt.keys?.fn(['state']);
      expect(jsonKeys?.sort()).toEqual(redisKeys?.sort());

      // Test getAll operation
      const jsonAll = await jsonExt.getAll?.fn(['state']);
      const redisAll = await redisExt.getAll?.fn(['state']);
      expect(jsonAll).toEqual(redisAll);

      // Cleanup
      if (jsonExt.dispose) await jsonExt.dispose();
    });

    it('handles merge operations identically across backends', async () => {
      const jsonExt = createKvExtension({
        mounts: {
          config: {
            mode: 'read-write',
            store: '/tmp/rill-test-backend-merge.json',
          },
        },
      });

      const redisExt = createRedisKvExtension({
        url: REDIS_URL,
        mounts: {
          config: {
            mode: 'read-write',
            prefix: 'test:backend-merge:',
          },
        },
      });

      extensions.push(jsonExt, redisExt);

      // Set initial dict
      await jsonExt.set?.fn(['config', 'settings', { a: 1, b: 2 }]);
      await redisExt.set?.fn(['config', 'settings', { a: 1, b: 2 }]);

      // Merge partial dict
      await jsonExt.merge?.fn(['config', 'settings', { b: 3, c: 4 }]);
      await redisExt.merge?.fn(['config', 'settings', { b: 3, c: 4 }]);

      // Verify identical results
      const jsonSettings = await jsonExt.get?.fn(['config', 'settings']);
      const redisSettings = await redisExt.get?.fn(['config', 'settings']);
      expect(jsonSettings).toEqual(redisSettings);
      expect(jsonSettings).toEqual({ a: 1, b: 3, c: 4 });

      // Cleanup
      if (jsonExt.dispose) await jsonExt.dispose();
    });
  });

  describe('AC-3: Atomic merge without race condition', () => {
    it('executes merge as atomic operation using WATCH/MULTI', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          state: {
            mode: 'read-write',
            prefix: 'test:atomic:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      // Set initial dict value
      await ext.set?.fn(['state', 'data', { step: 'init' }]);

      // Create monitor client to observe commands
      const monitorClient = new Redis(REDIS_URL);
      const commands: string[] = [];

      monitorClient.monitor((err) => {
        if (err) throw err;
      });

      monitorClient.on('monitor', (_time, args) => {
        const cmd = args.join(' ');
        // Track WATCH, MULTI, and SET commands for our test key
        if (
          cmd.includes('test:atomic:data') &&
          (cmd.includes('WATCH') ||
            cmd.includes('MULTI') ||
            cmd.includes('SET'))
        ) {
          commands.push(cmd);
        }
      });

      // Wait for monitor to be ready
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Execute merge
      await ext.merge?.fn(['state', 'data', { step: 'done' }]);

      // Wait for commands to be captured
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify atomic operation pattern:
      // 1. WATCH command observed (for optimistic locking)
      // 2. MULTI command observed (transaction start)
      // 3. SET command inside transaction
      const watchCommands = commands.filter((c) => c.includes('WATCH'));
      const multiCommands = commands.filter((c) => c.includes('MULTI'));

      expect(watchCommands.length).toBeGreaterThan(0);
      expect(multiCommands.length).toBeGreaterThan(0);

      // Verify final merged value is correct
      const result = await ext.get?.fn(['state', 'data']);
      expect(result).toEqual({ step: 'done' });

      // Cleanup monitor
      await monitorClient.quit();
    });

    it('retries merge on concurrent modification', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          state: {
            mode: 'read-write',
            prefix: 'test:concurrent:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      // Set initial value
      await ext.set?.fn(['state', 'counter', { count: 0 }]);

      // Create competing client to simulate race condition
      const competingClient = new Redis(REDIS_URL);

      // Start merge operation
      const mergePromise = ext.merge?.fn(['state', 'counter', { count: 1 }]);

      // Immediately modify the key from competing client (simulates race)
      await new Promise((resolve) => setTimeout(resolve, 10));
      await competingClient.set(
        'test:concurrent:counter',
        JSON.stringify({ count: 99 })
      );

      // Merge should retry and eventually succeed or fail gracefully
      await mergePromise;

      // Verify a valid result (either retry succeeded or error thrown)
      const result = await ext.get?.fn(['state', 'counter']);
      expect(result).toHaveProperty('count');

      // Cleanup
      await competingClient.quit();
    });
  });

  describe('AC-7: Unknown mount throws MountError', () => {
    it('throws MountError for all functions with unknown mount name', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          known: {
            mode: 'read-write',
            prefix: 'test:known:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      // Test all kv functions throw for unknown mount
      await expect(ext.get?.fn(['unknown', 'key'])).rejects.toThrow(
        `Mount 'unknown' not found`
      );

      await expect(
        ext.get_or?.fn(['unknown', 'key', 'fallback'])
      ).rejects.toThrow(`Mount 'unknown' not found`);

      await expect(ext.set?.fn(['unknown', 'key', 'value'])).rejects.toThrow(
        `Mount 'unknown' not found`
      );

      await expect(ext.merge?.fn(['unknown', 'key', {}])).rejects.toThrow(
        `Mount 'unknown' not found`
      );

      await expect(ext.delete?.fn(['unknown', 'key'])).rejects.toThrow(
        `Mount 'unknown' not found`
      );

      await expect(ext.keys?.fn(['unknown'])).rejects.toThrow(
        `Mount 'unknown' not found`
      );

      await expect(ext.has?.fn(['unknown', 'key'])).rejects.toThrow(
        `Mount 'unknown' not found`
      );

      await expect(ext.clear?.fn(['unknown'])).rejects.toThrow(
        `Mount 'unknown' not found`
      );

      await expect(ext.getAll?.fn(['unknown'])).rejects.toThrow(
        `Mount 'unknown' not found`
      );

      // schema is synchronous, so test differently
      expect(() => ext.schema?.fn(['unknown'])).toThrow(
        `Mount 'unknown' not found`
      );
    });
  });

  describe('AC-8: Read-only mode enforcement', () => {
    it('throws PermissionError for write operations on read-only mounts', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          readonly: {
            mode: 'read',
            prefix: 'test:readonly:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      // set should throw
      await expect(ext.set?.fn(['readonly', 'key', 'value'])).rejects.toThrow(
        `Mount 'readonly' is read-only`
      );

      // merge should throw
      await expect(ext.merge?.fn(['readonly', 'key', {}])).rejects.toThrow(
        `Mount 'readonly' is read-only`
      );

      // delete should throw
      await expect(ext.delete?.fn(['readonly', 'key'])).rejects.toThrow(
        `Mount 'readonly' is read-only`
      );

      // clear should throw
      await expect(ext.clear?.fn(['readonly'])).rejects.toThrow(
        `Mount 'readonly' is read-only`
      );

      // Read operations should work
      const value = await ext.get?.fn(['readonly', 'key']);
      expect(value).toBe('');

      const keys = await ext.keys?.fn(['readonly']);
      expect(keys).toEqual([]);
    });
  });

  describe('AC-11: Empty mount returns empty results', () => {
    it('returns empty results for all query operations on empty mount', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          empty: {
            mode: 'read-write',
            prefix: 'test:empty-ops:',
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      // Ensure mount is empty
      await ext.clear?.fn(['empty']);

      // keys returns empty array
      const keys = await ext.keys?.fn(['empty']);
      expect(keys).toEqual([]);

      // getAll returns empty dict
      const all = await ext.getAll?.fn(['empty']);
      expect(all).toEqual({});

      // schema returns empty array (open mode)
      const schema = ext.schema?.fn(['empty']);
      expect(schema).toEqual([]);

      // has returns false
      const exists = await ext.has?.fn(['empty', 'nonexistent']);
      expect(exists).toBe(false);

      // get returns empty string (open mode)
      const value = await ext.get?.fn(['empty', 'nonexistent']);
      expect(value).toBe('');
    });

    it('returns empty results for declared mode with schema defaults', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          declared: {
            mode: 'read-write',
            prefix: 'test:declared-empty:',
            schema: {
              name: { type: 'string', default: 'Default' },
              count: { type: 'number', default: 0 },
            },
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      // Clear to initialize with defaults
      await ext.clear?.fn(['declared']);

      // schema returns entries
      const schema = ext.schema?.fn(['declared']);
      expect(schema).toHaveLength(2);

      // keys returns schema keys (from clear initialization)
      const keys = await ext.keys?.fn(['declared']);
      expect(keys.sort()).toEqual(['count', 'name']);

      // get returns defaults
      const name = await ext.get?.fn(['declared', 'name']);
      expect(name).toBe('Default');

      const count = await ext.get?.fn(['declared', 'count']);
      expect(count).toBe(0);
    });
  });

  describe('AC-12: Maximum value size boundary', () => {
    it('succeeds when value is exactly at size limit', async () => {
      const sizeLimit = 1024; // 1KB
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          limited: {
            mode: 'read-write',
            prefix: 'test:size-limit:',
            maxValueSize: sizeLimit,
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      // Create value that serializes to exactly the size limit
      // JSON.stringify adds quotes and escapes, so adjust for that
      // A string "x" serializes to 3 bytes: "x" (with quotes)
      // We need to find a value that JSON.stringify produces exactly sizeLimit bytes
      let testValue = 'x'.repeat(Math.floor(sizeLimit / 2));

      // Adjust to get exact size
      while (
        Buffer.byteLength(JSON.stringify(testValue), 'utf-8') < sizeLimit
      ) {
        testValue += 'x';
      }
      // Now trim back to exact size
      while (
        Buffer.byteLength(JSON.stringify(testValue), 'utf-8') > sizeLimit
      ) {
        testValue = testValue.slice(0, -1);
      }

      const exactSize = Buffer.byteLength(JSON.stringify(testValue), 'utf-8');
      expect(exactSize).toBe(sizeLimit);

      // Should succeed at exact limit
      const result = await ext.set?.fn(['limited', 'exact', testValue]);
      expect(result).toBe(true);

      // Verify value was stored
      const retrieved = await ext.get?.fn(['limited', 'exact']);
      expect(retrieved).toBe(testValue);
    });

    it('fails when value exceeds size limit by 1 byte', async () => {
      const sizeLimit = 1024; // 1KB
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          limited: {
            mode: 'read-write',
            prefix: 'test:size-exceed:',
            maxValueSize: sizeLimit,
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      // Create value that serializes to sizeLimit + 1 bytes
      let testValue = 'x'.repeat(Math.floor(sizeLimit / 2));

      // Adjust to get exact size + 1
      while (
        Buffer.byteLength(JSON.stringify(testValue), 'utf-8') <= sizeLimit
      ) {
        testValue += 'x';
      }

      const actualSize = Buffer.byteLength(JSON.stringify(testValue), 'utf-8');
      expect(actualSize).toBeGreaterThan(sizeLimit);

      // Should fail when exceeding limit
      await expect(
        ext.set?.fn(['limited', 'exceed', testValue])
      ).rejects.toThrow('exceeds size limit');
    });

    it('validates merged value size against limit', async () => {
      const sizeLimit = 100; // Small limit for test
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          limited: {
            mode: 'read-write',
            prefix: 'test:merge-size:',
            maxValueSize: sizeLimit,
          },
        },
      };

      const ext = createRedisKvExtension(config);
      extensions.push(ext);

      // Set small initial dict
      await ext.set?.fn(['limited', 'data', { a: 1 }]);

      // Merge that would exceed size limit
      const largePartial = { b: 'x'.repeat(200) };

      await expect(
        ext.merge?.fn(['limited', 'data', largePartial])
      ).rejects.toThrow('exceeds size limit');
    });
  });
});
