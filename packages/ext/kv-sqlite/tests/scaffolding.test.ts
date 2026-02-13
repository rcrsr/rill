/**
 * Basic scaffolding tests for kv-sqlite package.
 * Verifies package structure and exports.
 */

import { describe, it, expect } from 'vitest';
import {
  createSqliteKvExtension,
  SQLITE_KV_EXTENSION_VERSION,
  type SqliteKvConfig,
} from '../src/index.js';

describe('Package scaffolding', () => {
  describe('exports', () => {
    it('exports createSqliteKvExtension factory function', () => {
      expect(createSqliteKvExtension).toBeDefined();
      expect(typeof createSqliteKvExtension).toBe('function');
    });

    it('exports SQLITE_KV_EXTENSION_VERSION constant', () => {
      expect(SQLITE_KV_EXTENSION_VERSION).toBeDefined();
      expect(typeof SQLITE_KV_EXTENSION_VERSION).toBe('string');
      expect(SQLITE_KV_EXTENSION_VERSION).toBe('0.0.1');
    });

    it('exports SqliteKvConfig type', () => {
      // Type-only export test - compilation validates this
      const config: SqliteKvConfig = {};
      expect(config).toBeDefined();
    });
  });

  describe('createSqliteKvExtension', () => {
    it('returns ExtensionResult with dispose method', () => {
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: ':memory:',
            table: 'kv_test',
          },
        },
      };
      const result = createSqliteKvExtension(config);

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
      expect(typeof result.dispose).toBe('function');

      result.dispose?.();
    });

    it('dispose method can be called without errors', () => {
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: ':memory:',
            table: 'kv_test',
          },
        },
      };
      const result = createSqliteKvExtension(config);

      expect(() => result.dispose?.()).not.toThrow();
    });
  });
});
