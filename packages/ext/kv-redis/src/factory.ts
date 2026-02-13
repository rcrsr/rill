/**
 * Factory function for creating Redis kv extension.
 *
 * @module
 */

import { Redis } from 'ioredis';
import type { ExtensionResult, RillValue } from '@rcrsr/rill';
import type { RedisKvMountConfig } from './types.js';

/**
 * Configuration for Redis kv extension factory.
 */
export interface RedisKvExtensionConfig {
  /** Redis connection URL (e.g., "redis://localhost:6379") */
  readonly url: string;

  /** Mount point configurations */
  readonly mounts: Record<string, RedisKvMountConfig>;

  /** Maximum store size in bytes (optional) */
  readonly maxStoreSize?: number | undefined;

  /** Write policy: 'dispose' (write on dispose) or 'immediate' (write immediately) */
  readonly writePolicy?: 'dispose' | 'immediate' | undefined;
}

/**
 * Creates a Redis kv backend extension for rill.
 *
 * Connects to Redis server and validates configuration.
 * Throws error for invalid connection string or unreachable server.
 *
 * @param config - Extension configuration
 * @returns Extension result with kv functions and dispose
 * @throws Error for invalid configuration (AC-10)
 *
 * @example
 * ```typescript
 * const ext = createRedisKvExtension({
 *   url: 'redis://localhost:6379',
 *   mounts: {
 *     user: {
 *       mode: 'read-write',
 *       prefix: 'app:user:',
 *       schema: { name: { type: 'string', default: '' } }
 *     }
 *   }
 * });
 * // Use with rill runtime...
 * await ext.dispose();
 * ```
 */
export function createRedisKvExtension(
  config: RedisKvExtensionConfig
): ExtensionResult {
  // Validate required configuration (AC-10)
  if (!config.mounts || Object.keys(config.mounts).length === 0) {
    throw new Error(
      'Redis kv extension requires at least one mount in configuration'
    );
  }

  // Validate connection URL format (AC-10)
  if (!config.url || typeof config.url !== 'string') {
    throw new Error('Redis kv extension requires a valid connection URL');
  }

  // Check URL scheme is redis:// or rediss://
  if (
    !config.url.startsWith('redis://') &&
    !config.url.startsWith('rediss://')
  ) {
    throw new Error(
      `Invalid Redis connection URL: must start with redis:// or rediss:// (got: ${config.url})`
    );
  }

  // Validate mount prefixes don't overlap
  const prefixes = Object.entries(config.mounts).map(([name, cfg]) => ({
    name,
    prefix: cfg.prefix,
  }));

  for (let i = 0; i < prefixes.length; i++) {
    for (let j = i + 1; j < prefixes.length; j++) {
      const a = prefixes[i]!;
      const b = prefixes[j]!;

      if (a.prefix.startsWith(b.prefix) || b.prefix.startsWith(a.prefix)) {
        throw new Error(
          `Mount prefix overlap detected: "${a.name}" (${a.prefix}) and "${b.name}" (${b.prefix})`
        );
      }
    }
  }

  // Create Redis client (AC-10: throws for invalid connection)
  let client: Redis;
  try {
    client = new Redis(config.url);
  } catch (error: unknown) {
    throw new Error(
      `Failed to create Redis client: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Set up error handler to prevent unhandled errors
  client.on('error', (err: Error) => {
    // Error is logged but won't crash process
    // Actual connection failures will be caught during operations
    console.error('Redis connection error:', err);
  });

  // ============================================================
  // HELPERS
  // ============================================================

  /**
   * Get mount configuration.
   * EC-7: Throws if mount unknown.
   */
  function getMountConfig(mountName: string): RedisKvMountConfig {
    const mountConfig = config.mounts[mountName];

    if (!mountConfig) {
      throw new Error(
        `Mount '${mountName}' not found. Available mounts: ${Object.keys(config.mounts).join(', ')}`
      );
    }

    return mountConfig;
  }

  /**
   * Build Redis key with mount prefix.
   */
  function buildKey(prefix: string, key: string): string {
    return `${prefix}${key}`;
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
   * EC-2: Throws if mount unknown (handled by getMountConfig).
   */
  const get = async (args: RillValue[]): Promise<RillValue> => {
    const mountName = args[0] as string;
    const key = args[1] as string;

    const mountConfig = getMountConfig(mountName);

    // Check if schema is defined (declared mode)
    if (mountConfig.schema && !(key in mountConfig.schema)) {
      throw new Error(`key "${key}" not declared in schema`);
    }

    // Query Redis
    const redisKey = buildKey(mountConfig.prefix, key);
    const value = await client.get(redisKey);

    if (value !== null) {
      return JSON.parse(value) as RillValue;
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
  const get_or = async (args: RillValue[]): Promise<RillValue> => {
    const mountName = args[0] as string;
    const key = args[1] as string;
    const fallback = args[2] as RillValue;

    const mountConfig = getMountConfig(mountName);

    // Query Redis
    const redisKey = buildKey(mountConfig.prefix, key);
    const value = await client.get(redisKey);

    if (value !== null) {
      return JSON.parse(value) as RillValue;
    }

    return fallback;
  };

  /**
   * IR-3: Set value with validation.
   * EC-3: Throws if mode is read-only.
   * EC-4: Throws if value exceeds maxValueSize.
   */
  const set = async (args: RillValue[]): Promise<boolean> => {
    const mountName = args[0] as string;
    const key = args[1] as string;
    const value = args[2] as RillValue;

    const mountConfig = getMountConfig(mountName);

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
    const redisKey = buildKey(mountConfig.prefix, key);
    const exists = (await client.exists(redisKey)) === 1;

    if (!exists) {
      // Count existing keys with this prefix
      const pattern = `${mountConfig.prefix}*`;
      const keys = await scanKeys(pattern);

      if (keys.length >= maxEntries) {
        throw new Error(
          `store exceeds entry limit (${keys.length + 1} > ${maxEntries})`
        );
      }
    }

    // Set value with optional TTL
    const serialized = JSON.stringify(value);
    if (mountConfig.ttl) {
      await client.setex(redisKey, mountConfig.ttl, serialized);
    } else {
      await client.set(redisKey, serialized);
    }

    return true;
  };

  /**
   * IR-4: Merge partial dict into existing dict value.
   * EC-5: Throws if existing value is not a dict.
   * EC-6: Throws if mode is read-only.
   */
  const merge = async (args: RillValue[]): Promise<boolean> => {
    const mountName = args[0] as string;
    const key = args[1] as string;
    const partial = args[2] as Record<string, RillValue>;

    const mountConfig = getMountConfig(mountName);

    // EC-6: Check write permission
    checkWritePermission(mountName, mountConfig.mode);

    // Use Redis WATCH for optimistic locking (atomic merge)
    const redisKey = buildKey(mountConfig.prefix, key);

    // Retry loop for optimistic locking
    let retries = 0;
    const MAX_RETRIES = 10;

    while (retries < MAX_RETRIES) {
      await client.watch(redisKey);

      try {
        // Get current value
        const currentValueStr = await client.get(redisKey);
        let currentValue: RillValue | undefined;

        if (currentValueStr !== null) {
          currentValue = JSON.parse(currentValueStr) as RillValue;

          // EC-5: Existing value must be a dict
          if (!isDict(currentValue)) {
            await client.unwatch();
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
          await client.unwatch();
          throw new Error(
            `merged value for "${key}" exceeds size limit (${valueSize} > ${maxValueSize})`
          );
        }

        // Execute transaction
        const serialized = JSON.stringify(mergedValue);
        const result = await client.multi().set(redisKey, serialized).exec();

        // If transaction succeeded, result is non-null
        if (result !== null) {
          // Apply TTL if configured
          if (mountConfig.ttl) {
            await client.expire(redisKey, mountConfig.ttl);
          }
          return true;
        }

        // Transaction failed (key was modified), retry
        retries++;
      } catch (error: unknown) {
        await client.unwatch();
        throw error;
      }
    }

    throw new Error(
      `Failed to merge after ${MAX_RETRIES} retries due to concurrent modifications`
    );
  };

  /**
   * IR-5: Delete key.
   */
  const deleteKey = async (args: RillValue[]): Promise<boolean> => {
    const mountName = args[0] as string;
    const key = args[1] as string;

    const mountConfig = getMountConfig(mountName);

    // Check write permission
    checkWritePermission(mountName, mountConfig.mode);

    const redisKey = buildKey(mountConfig.prefix, key);
    const result = await client.del(redisKey);

    return result > 0;
  };

  /**
   * Scan keys matching pattern using SCAN (non-blocking).
   * IR-6: Uses SCAN not KEYS for production safety.
   */
  async function scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, foundKeys] = await client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100
      );
      cursor = nextCursor;
      keys.push(...foundKeys);
    } while (cursor !== '0');

    return keys;
  }

  /**
   * IR-6: Get all keys.
   */
  const keys = async (args: RillValue[]): Promise<string[]> => {
    const mountName = args[0] as string;
    const mountConfig = getMountConfig(mountName);

    const pattern = `${mountConfig.prefix}*`;
    const redisKeys = await scanKeys(pattern);

    // Strip prefix from keys
    const prefixLen = mountConfig.prefix.length;
    return redisKeys.map((k) => k.substring(prefixLen));
  };

  /**
   * IR-7: Check key existence.
   */
  const has = async (args: RillValue[]): Promise<boolean> => {
    const mountName = args[0] as string;
    const key = args[1] as string;

    const mountConfig = getMountConfig(mountName);

    const redisKey = buildKey(mountConfig.prefix, key);
    const exists = await client.exists(redisKey);

    return exists === 1;
  };

  /**
   * IR-8: Clear all keys (restores schema defaults if declared mode).
   */
  const clear = async (args: RillValue[]): Promise<boolean> => {
    const mountName = args[0] as string;
    const mountConfig = getMountConfig(mountName);

    // Check write permission
    checkWritePermission(mountName, mountConfig.mode);

    // Get all keys for this mount
    const pattern = `${mountConfig.prefix}*`;
    const redisKeys = await scanKeys(pattern);

    // Delete all keys
    if (redisKeys.length > 0) {
      await client.del(...redisKeys);
    }

    // Restore schema defaults if declared mode
    if (mountConfig.schema) {
      const pipeline = client.pipeline();

      for (const [key, entry] of Object.entries(mountConfig.schema)) {
        const redisKey = buildKey(mountConfig.prefix, key);
        const serialized = JSON.stringify(entry.default);

        if (mountConfig.ttl) {
          pipeline.setex(redisKey, mountConfig.ttl, serialized);
        } else {
          pipeline.set(redisKey, serialized);
        }
      }

      await pipeline.exec();
    }

    return true;
  };

  /**
   * IR-9: Get all entries as dict.
   */
  const getAll = async (
    args: RillValue[]
  ): Promise<Record<string, RillValue>> => {
    const mountName = args[0] as string;
    const mountConfig = getMountConfig(mountName);

    const pattern = `${mountConfig.prefix}*`;
    const redisKeys = await scanKeys(pattern);

    if (redisKeys.length === 0) {
      return {};
    }

    // Fetch all values with MGET
    const values = await client.mget(...redisKeys);

    // Build result dict
    const result: Record<string, RillValue> = {};
    const prefixLen = mountConfig.prefix.length;

    for (let i = 0; i < redisKeys.length; i++) {
      const key = redisKeys[i]!.substring(prefixLen);
      const value = values[i];

      if (value !== null && value !== undefined) {
        result[key] = JSON.parse(value) as RillValue;
      }
    }

    return result;
  };

  /**
   * IR-10: Get schema information (empty list in open mode).
   */
  const schema = (args: RillValue[]): RillValue[] => {
    const mountName = args[0] as string;
    const mountConfig = getMountConfig(mountName);

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
        prefix: mountConfig.prefix,
        ttl: mountConfig.ttl ?? 0,
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
  result.dispose = async (): Promise<void> => {
    // Disconnect Redis client
    await client.quit();
  };

  return result;
}
