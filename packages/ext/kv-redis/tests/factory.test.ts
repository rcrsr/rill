/**
 * Tests for Redis kv extension factory.
 *
 * Coverage:
 * - IC-7: Factory creates extension with valid config
 * - AC-10: Configuration validation failure
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createRedisKvExtension } from '../src/factory.js';
import type { RedisKvExtensionConfig } from '../src/factory.js';

describe('createRedisKvExtension', () => {
  // Track created extensions for cleanup
  const extensions: Array<{ dispose?: () => void | Promise<void> }> = [];

  afterEach(async () => {
    // Clean up all created extensions
    for (const ext of extensions) {
      if (ext.dispose) {
        await ext.dispose();
      }
    }
    extensions.length = 0;
  });

  describe('IC-7: Factory creates extension with valid config', () => {
    it('exports factory function', () => {
      expect(typeof createRedisKvExtension).toBe('function');
    });

    it('returns ExtensionResult structure with valid config', () => {
      const config: RedisKvExtensionConfig = {
        url: 'redis://localhost:6379',
        mounts: {
          test: {
            mode: 'read-write',
            prefix: 'test:',
          },
        },
      };

      const result = createRedisKvExtension(config);
      extensions.push(result);

      expect(typeof result).toBe('object');
      expect(result).not.toBeNull();
      expect(Array.isArray(result)).toBe(false);
    });

    it('exports all 11 kv functions with correct structure', () => {
      const config: RedisKvExtensionConfig = {
        url: 'redis://localhost:6379',
        mounts: {
          test: {
            mode: 'read-write',
            prefix: 'test:',
          },
        },
      };

      const result = createRedisKvExtension(config);
      extensions.push(result);

      // Check all 11 functions are present (IR-1 through IR-11)
      const expectedFunctions = [
        'get', // IR-1
        'get_or', // IR-2
        'set', // IR-3
        'merge', // IR-4
        'delete', // IR-5
        'keys', // IR-6
        'has', // IR-7
        'clear', // IR-8
        'getAll', // IR-9
        'schema', // IR-10
        'mounts', // IR-11
      ];

      for (const fnName of expectedFunctions) {
        expect(result[fnName]).toBeDefined();
        expect(typeof result[fnName]?.fn).toBe('function');
        expect(Array.isArray(result[fnName]?.params)).toBe(true);
        expect(typeof result[fnName]?.description).toBe('string');
        expect(typeof result[fnName]?.returnType).toBe('string');
      }
    });

    it('returns ExtensionResult with dispose method', () => {
      const config: RedisKvExtensionConfig = {
        url: 'redis://localhost:6379',
        mounts: {
          test: {
            mode: 'read-write',
            prefix: 'test:',
          },
        },
      };

      const result = createRedisKvExtension(config);
      extensions.push(result);

      expect(typeof result.dispose).toBe('function');
    });

    it('accepts TLS connection URL with rediss://', () => {
      const config: RedisKvExtensionConfig = {
        url: 'rediss://localhost:6380',
        mounts: {
          test: {
            mode: 'read-write',
            prefix: 'test:',
          },
        },
      };

      expect(() => {
        const result = createRedisKvExtension(config);
        extensions.push(result);
      }).not.toThrow();
    });

    it('accepts connection URL with authentication', () => {
      const config: RedisKvExtensionConfig = {
        url: 'redis://:password@localhost:6379',
        mounts: {
          test: {
            mode: 'read-write',
            prefix: 'test:',
          },
        },
      };

      expect(() => {
        const result = createRedisKvExtension(config);
        extensions.push(result);
      }).not.toThrow();
    });

    it('accepts multiple mounts with non-overlapping prefixes', () => {
      const config: RedisKvExtensionConfig = {
        url: 'redis://localhost:6379',
        mounts: {
          user: {
            mode: 'read-write',
            prefix: 'app:user:',
          },
          cache: {
            mode: 'read-write',
            prefix: 'app:cache:',
          },
          session: {
            mode: 'read-write',
            prefix: 'session:',
          },
        },
      };

      expect(() => {
        const result = createRedisKvExtension(config);
        extensions.push(result);
      }).not.toThrow();
    });
  });

  describe('AC-10: Configuration validation failure', () => {
    it('throws for missing mounts configuration', () => {
      const config = {
        url: 'redis://localhost:6379',
        mounts: {},
      } as RedisKvExtensionConfig;

      expect(() => createRedisKvExtension(config)).toThrow(
        'Redis kv extension requires at least one mount in configuration'
      );
    });

    it('throws for undefined mounts', () => {
      const config = {
        url: 'redis://localhost:6379',
      } as unknown as RedisKvExtensionConfig;

      expect(() => createRedisKvExtension(config)).toThrow(
        'Redis kv extension requires at least one mount in configuration'
      );
    });

    it('throws for missing connection URL', () => {
      const config = {
        url: '',
        mounts: {
          test: { mode: 'read-write', prefix: 'test:' },
        },
      } as RedisKvExtensionConfig;

      expect(() => createRedisKvExtension(config)).toThrow(
        'Redis kv extension requires a valid connection URL'
      );
    });

    it('throws for invalid URL type', () => {
      const config = {
        url: null,
        mounts: {
          test: { mode: 'read-write', prefix: 'test:' },
        },
      } as unknown as RedisKvExtensionConfig;

      expect(() => createRedisKvExtension(config)).toThrow(
        'Redis kv extension requires a valid connection URL'
      );
    });

    it('throws for invalid URL scheme (http)', () => {
      const config: RedisKvExtensionConfig = {
        url: 'http://localhost:6379',
        mounts: {
          test: { mode: 'read-write', prefix: 'test:' },
        },
      };

      expect(() => createRedisKvExtension(config)).toThrow(
        'Invalid Redis connection URL: must start with redis:// or rediss://'
      );
    });

    it('throws for invalid URL scheme (localhost without protocol)', () => {
      const config: RedisKvExtensionConfig = {
        url: 'localhost:6379',
        mounts: {
          test: { mode: 'read-write', prefix: 'test:' },
        },
      };

      expect(() => createRedisKvExtension(config)).toThrow(
        'Invalid Redis connection URL: must start with redis:// or rediss://'
      );
    });

    it('throws for overlapping mount prefixes (exact match)', () => {
      const config: RedisKvExtensionConfig = {
        url: 'redis://localhost:6379',
        mounts: {
          user1: {
            mode: 'read-write',
            prefix: 'app:user:',
          },
          user2: {
            mode: 'read-write',
            prefix: 'app:user:',
          },
        },
      };

      expect(() => createRedisKvExtension(config)).toThrow(
        'Mount prefix overlap detected'
      );
    });

    it('throws for overlapping mount prefixes (one prefix starts with another)', () => {
      const config: RedisKvExtensionConfig = {
        url: 'redis://localhost:6379',
        mounts: {
          app: {
            mode: 'read-write',
            prefix: 'app:',
          },
          user: {
            mode: 'read-write',
            prefix: 'app:user:',
          },
        },
      };

      expect(() => createRedisKvExtension(config)).toThrow(
        'Mount prefix overlap detected'
      );
    });
  });

  describe('IC-7: Dispose disconnects Redis client', () => {
    it('dispose method returns without error', async () => {
      const config: RedisKvExtensionConfig = {
        url: 'redis://localhost:6379',
        mounts: {
          test: {
            mode: 'read-write',
            prefix: 'test:',
          },
        },
      };

      const result = createRedisKvExtension(config);

      // Should not throw
      await expect(result.dispose?.()).resolves.toBeUndefined();
    });

    it('dispose can be called multiple times', async () => {
      const config: RedisKvExtensionConfig = {
        url: 'redis://localhost:6379',
        mounts: {
          test: {
            mode: 'read-write',
            prefix: 'test:',
          },
        },
      };

      const result = createRedisKvExtension(config);

      // First dispose
      await result.dispose?.();

      // Second dispose should not throw
      await expect(result.dispose?.()).resolves.toBeUndefined();
    });
  });
});
