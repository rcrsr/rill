/**
 * Type definition tests for SQLite kv extension.
 * Tests type exports and configuration structure.
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  SqliteKvConfig,
  SqliteKvMountConfig,
  SchemaEntry,
} from '../src/index.js';

describe('SqliteKvMountConfig', () => {
  describe('type structure', () => {
    it('accepts valid mount configuration', () => {
      const config: SqliteKvMountConfig = {
        mode: 'read-write',
        database: './data/app.db',
        table: 'user_state',
      };

      expect(config.mode).toBe('read-write');
      expect(config.database).toBe('./data/app.db');
      expect(config.table).toBe('user_state');
    });

    it('accepts all access modes', () => {
      const readConfig: SqliteKvMountConfig = {
        mode: 'read',
        database: './data.db',
        table: 'data',
      };
      const writeConfig: SqliteKvMountConfig = {
        mode: 'write',
        database: './data.db',
        table: 'data',
      };
      const readWriteConfig: SqliteKvMountConfig = {
        mode: 'read-write',
        database: './data.db',
        table: 'data',
      };

      expect(readConfig.mode).toBe('read');
      expect(writeConfig.mode).toBe('write');
      expect(readWriteConfig.mode).toBe('read-write');
    });

    it('accepts optional schema', () => {
      const schema: Record<string, SchemaEntry> = {
        name: { type: 'string', default: '' },
        count: { type: 'number', default: 0 },
      };

      const config: SqliteKvMountConfig = {
        mode: 'read-write',
        database: './data.db',
        table: 'state',
        schema,
      };

      expect(config.schema).toBe(schema);
    });

    it('accepts optional maxEntries', () => {
      const config: SqliteKvMountConfig = {
        mode: 'read-write',
        database: './data.db',
        table: 'state',
        maxEntries: 5000,
      };

      expect(config.maxEntries).toBe(5000);
    });

    it('accepts optional maxValueSize', () => {
      const config: SqliteKvMountConfig = {
        mode: 'read-write',
        database: './data.db',
        table: 'state',
        maxValueSize: 50000,
      };

      expect(config.maxValueSize).toBe(50000);
    });

    it('accepts all optional fields together', () => {
      const config: SqliteKvMountConfig = {
        mode: 'read-write',
        database: './data.db',
        table: 'state',
        schema: {
          name: { type: 'string', default: '' },
        },
        maxEntries: 5000,
        maxValueSize: 50000,
      };

      expect(config.schema).toBeDefined();
      expect(config.maxEntries).toBe(5000);
      expect(config.maxValueSize).toBe(50000);
    });
  });

  describe('type enforcement', () => {
    it('enforces mode union type', () => {
      expectTypeOf<SqliteKvMountConfig['mode']>().toEqualTypeOf<
        'read' | 'write' | 'read-write'
      >();
    });

    it('enforces required database field', () => {
      expectTypeOf<SqliteKvMountConfig>().toHaveProperty('database');
    });

    it('enforces required table field', () => {
      expectTypeOf<SqliteKvMountConfig>().toHaveProperty('table');
    });

    it('allows undefined schema', () => {
      expectTypeOf<SqliteKvMountConfig['schema']>().toEqualTypeOf<
        Record<string, SchemaEntry> | undefined
      >();
    });

    it('allows undefined maxEntries', () => {
      expectTypeOf<SqliteKvMountConfig['maxEntries']>().toEqualTypeOf<
        number | undefined
      >();
    });

    it('allows undefined maxValueSize', () => {
      expectTypeOf<SqliteKvMountConfig['maxValueSize']>().toEqualTypeOf<
        number | undefined
      >();
    });
  });
});

describe('SqliteKvConfig', () => {
  describe('type structure', () => {
    it('accepts valid factory configuration', () => {
      const config: SqliteKvConfig = {
        mounts: {
          user: {
            mode: 'read-write',
            database: './data/app.db',
            table: 'user_state',
          },
        },
      };

      expect(config.mounts).toBeDefined();
      expect(config.mounts.user).toBeDefined();
    });

    it('accepts multiple mounts', () => {
      const config: SqliteKvConfig = {
        mounts: {
          user: {
            mode: 'read-write',
            database: './data/app.db',
            table: 'user_state',
          },
          cache: {
            mode: 'read-write',
            database: './data/cache.db',
            table: 'cache_entries',
          },
        },
      };

      expect(Object.keys(config.mounts)).toHaveLength(2);
      expect(config.mounts.user).toBeDefined();
      expect(config.mounts.cache).toBeDefined();
    });

    it('accepts optional maxStoreSize', () => {
      const config: SqliteKvConfig = {
        mounts: {
          user: {
            mode: 'read-write',
            database: './data.db',
            table: 'state',
          },
        },
        maxStoreSize: 5242880,
      };

      expect(config.maxStoreSize).toBe(5242880);
    });

    it('accepts optional writePolicy', () => {
      const disposeConfig: SqliteKvConfig = {
        mounts: {
          user: {
            mode: 'read-write',
            database: './data.db',
            table: 'state',
          },
        },
        writePolicy: 'dispose',
      };

      const immediateConfig: SqliteKvConfig = {
        mounts: {
          user: {
            mode: 'read-write',
            database: './data.db',
            table: 'state',
          },
        },
        writePolicy: 'immediate',
      };

      expect(disposeConfig.writePolicy).toBe('dispose');
      expect(immediateConfig.writePolicy).toBe('immediate');
    });

    it('accepts all optional fields together', () => {
      const config: SqliteKvConfig = {
        mounts: {
          user: {
            mode: 'read-write',
            database: './data.db',
            table: 'state',
          },
        },
        maxStoreSize: 5242880,
        writePolicy: 'immediate',
      };

      expect(config.maxStoreSize).toBe(5242880);
      expect(config.writePolicy).toBe('immediate');
    });
  });

  describe('type enforcement', () => {
    it('enforces required mounts field', () => {
      expectTypeOf<SqliteKvConfig>().toHaveProperty('mounts');
    });

    it('enforces mounts as Record', () => {
      expectTypeOf<SqliteKvConfig['mounts']>().toEqualTypeOf<
        Record<string, SqliteKvMountConfig>
      >();
    });

    it('allows undefined maxStoreSize', () => {
      expectTypeOf<SqliteKvConfig['maxStoreSize']>().toEqualTypeOf<
        number | undefined
      >();
    });

    it('allows undefined writePolicy', () => {
      expectTypeOf<SqliteKvConfig['writePolicy']>().toEqualTypeOf<
        'dispose' | 'immediate' | undefined
      >();
    });

    it('enforces writePolicy union type', () => {
      expectTypeOf<NonNullable<SqliteKvConfig['writePolicy']>>().toEqualTypeOf<
        'dispose' | 'immediate'
      >();
    });
  });
});

describe('type exports', () => {
  it('exports SqliteKvMountConfig', () => {
    expectTypeOf<SqliteKvMountConfig>().not.toBeNever();
  });

  it('exports SqliteKvConfig', () => {
    expectTypeOf<SqliteKvConfig>().not.toBeNever();
  });
});
