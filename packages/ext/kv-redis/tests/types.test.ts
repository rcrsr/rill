/**
 * Type definition tests for Redis kv extension.
 *
 * Tests type structure and compilation for RedisKvMountConfig and RedisKvConfig.
 */

import { describe, it, expect } from 'vitest';
import type {
  RedisKvMountConfig,
  RedisKvConfig,
  SchemaEntry,
} from '../src/index.js';

// ============================================================
// TYPE STRUCTURE TESTS
// ============================================================

describe('RedisKvMountConfig', () => {
  it('accepts minimal configuration with required fields', () => {
    const config: RedisKvMountConfig = {
      mode: 'read-write',
      prefix: 'app:user:',
    };

    expect(config.mode).toBe('read-write');
    expect(config.prefix).toBe('app:user:');
  });

  it('accepts all optional fields', () => {
    const schema: Record<string, SchemaEntry> = {
      name: { type: 'string', default: '' },
      count: { type: 'number', default: 0 },
      active: { type: 'bool', default: false },
      tags: { type: 'list', default: [] },
      meta: { type: 'dict', default: {} },
    };

    const config: RedisKvMountConfig = {
      mode: 'read',
      prefix: 'test:',
      schema,
      maxEntries: 5000,
      maxValueSize: 50000,
      ttl: 3600,
    };

    expect(config.mode).toBe('read');
    expect(config.prefix).toBe('test:');
    expect(config.schema).toBe(schema);
    expect(config.maxEntries).toBe(5000);
    expect(config.maxValueSize).toBe(50000);
    expect(config.ttl).toBe(3600);
  });

  it('accepts all mode values', () => {
    const readOnly: RedisKvMountConfig = {
      mode: 'read',
      prefix: 'read:',
    };
    const writeOnly: RedisKvMountConfig = {
      mode: 'write',
      prefix: 'write:',
    };
    const readWrite: RedisKvMountConfig = {
      mode: 'read-write',
      prefix: 'rw:',
    };

    expect(readOnly.mode).toBe('read');
    expect(writeOnly.mode).toBe('write');
    expect(readWrite.mode).toBe('read-write');
  });

  it('accepts undefined optional fields', () => {
    const config: RedisKvMountConfig = {
      mode: 'read-write',
      prefix: 'app:',
      schema: undefined,
      maxEntries: undefined,
      maxValueSize: undefined,
      ttl: undefined,
    };

    expect(config.schema).toBeUndefined();
    expect(config.maxEntries).toBeUndefined();
    expect(config.maxValueSize).toBeUndefined();
    expect(config.ttl).toBeUndefined();
  });
});

describe('RedisKvConfig', () => {
  it('accepts minimal configuration with required fields', () => {
    const config: RedisKvConfig = {
      url: 'redis://localhost:6379',
      mounts: {
        user: {
          mode: 'read-write',
          prefix: 'app:user:',
        },
      },
    };

    expect(config.url).toBe('redis://localhost:6379');
    expect(config.mounts).toHaveProperty('user');
  });

  it('accepts multiple mounts', () => {
    const config: RedisKvConfig = {
      url: 'redis://localhost:6379',
      mounts: {
        user: {
          mode: 'read-write',
          prefix: 'app:user:',
        },
        cache: {
          mode: 'read-write',
          prefix: 'app:cache:',
          ttl: 300,
        },
        readonly: {
          mode: 'read',
          prefix: 'app:readonly:',
        },
      },
    };

    expect(Object.keys(config.mounts)).toHaveLength(3);
    expect(config.mounts.user.prefix).toBe('app:user:');
    expect(config.mounts.cache.ttl).toBe(300);
    expect(config.mounts.readonly.mode).toBe('read');
  });

  it('accepts all optional fields', () => {
    const config: RedisKvConfig = {
      url: 'redis://user:pass@host:6379/0',
      mounts: {
        test: {
          mode: 'read-write',
          prefix: 'test:',
        },
      },
      maxStoreSize: 5242880,
      writePolicy: 'immediate',
    };

    expect(config.url).toBe('redis://user:pass@host:6379/0');
    expect(config.maxStoreSize).toBe(5242880);
    expect(config.writePolicy).toBe('immediate');
  });

  it('accepts both write policy values', () => {
    const immediate: RedisKvConfig = {
      url: 'redis://localhost:6379',
      mounts: { test: { mode: 'read-write', prefix: 'test:' } },
      writePolicy: 'immediate',
    };
    const dispose: RedisKvConfig = {
      url: 'redis://localhost:6379',
      mounts: { test: { mode: 'read-write', prefix: 'test:' } },
      writePolicy: 'dispose',
    };

    expect(immediate.writePolicy).toBe('immediate');
    expect(dispose.writePolicy).toBe('dispose');
  });

  it('accepts undefined optional fields', () => {
    const config: RedisKvConfig = {
      url: 'redis://localhost:6379',
      mounts: {
        test: {
          mode: 'read-write',
          prefix: 'test:',
        },
      },
      maxStoreSize: undefined,
      writePolicy: undefined,
    };

    expect(config.maxStoreSize).toBeUndefined();
    expect(config.writePolicy).toBeUndefined();
  });
});

describe('SchemaEntry', () => {
  it('accepts all type values', () => {
    const stringEntry: SchemaEntry = {
      type: 'string',
      default: '',
    };
    const numberEntry: SchemaEntry = {
      type: 'number',
      default: 0,
    };
    const boolEntry: SchemaEntry = {
      type: 'bool',
      default: false,
    };
    const listEntry: SchemaEntry = {
      type: 'list',
      default: [],
    };
    const dictEntry: SchemaEntry = {
      type: 'dict',
      default: {},
    };

    expect(stringEntry.type).toBe('string');
    expect(numberEntry.type).toBe('number');
    expect(boolEntry.type).toBe('bool');
    expect(listEntry.type).toBe('list');
    expect(dictEntry.type).toBe('dict');
  });

  it('accepts optional description field', () => {
    const withDescription: SchemaEntry = {
      type: 'string',
      default: '',
      description: 'User name',
    };
    const withoutDescription: SchemaEntry = {
      type: 'string',
      default: '',
    };

    expect(withDescription.description).toBe('User name');
    expect(withoutDescription.description).toBeUndefined();
  });

  it('accepts undefined description', () => {
    const entry: SchemaEntry = {
      type: 'string',
      default: '',
      description: undefined,
    };

    expect(entry.description).toBeUndefined();
  });
});

// ============================================================
// INTEGRATION EXAMPLES
// ============================================================

describe('Integration examples', () => {
  it('supports multi-mount configuration with schema', () => {
    const config: RedisKvConfig = {
      url: 'redis://localhost:6379',
      mounts: {
        user: {
          mode: 'read-write',
          prefix: 'app:user:',
          schema: {
            name: { type: 'string', default: '', description: 'User name' },
            age: { type: 'number', default: 0, description: 'User age' },
            active: { type: 'bool', default: true },
          },
          maxEntries: 10000,
          maxValueSize: 102400,
        },
        cache: {
          mode: 'read-write',
          prefix: 'app:cache:',
          ttl: 300,
          maxEntries: 1000,
        },
        logs: {
          mode: 'write',
          prefix: 'app:logs:',
          ttl: 86400,
        },
      },
      maxStoreSize: 10485760,
      writePolicy: 'dispose',
    };

    expect(config.mounts.user.schema).toHaveProperty('name');
    expect(config.mounts.cache.ttl).toBe(300);
    expect(config.mounts.logs.mode).toBe('write');
  });

  it('supports open mode without schema', () => {
    const config: RedisKvConfig = {
      url: 'redis://localhost:6379',
      mounts: {
        dynamic: {
          mode: 'read-write',
          prefix: 'app:dynamic:',
          schema: undefined,
        },
      },
    };

    expect(config.mounts.dynamic.schema).toBeUndefined();
  });
});
