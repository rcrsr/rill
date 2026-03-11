/**
 * Rill Runtime Tests: contextResolver
 * Tests for dot-path traversal, value resolution, and error codes.
 */

import { contextResolver, RuntimeError } from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

// ============================================================
// contextResolver tests (covers IC-2, EC-17, EC-18)
// ============================================================

describe('Rill Runtime: contextResolver', () => {
  describe('IC-2: Flat key resolution', () => {
    it('returns {kind: "value", value} for a flat key', () => {
      const result = contextResolver('timeout', { timeout: 30 });
      expect(result).toEqual({ kind: 'value', value: 30 });
    });

    it('returns string value for a flat string key', () => {
      const result = contextResolver('model', { model: 'gpt-4' });
      expect(result).toEqual({ kind: 'value', value: 'gpt-4' });
    });

    it('returns boolean value for a flat boolean key', () => {
      const result = contextResolver('debug', { debug: true });
      expect(result).toEqual({ kind: 'value', value: true });
    });
  });

  describe('IC-2: Nested dot-path traversal', () => {
    it('resolves a single-level nested key via dot-path', () => {
      const result = contextResolver('limits.max_tokens', {
        limits: { max_tokens: 4096 },
      });
      expect(result).toEqual({ kind: 'value', value: 4096 });
    });

    it('resolves a two-level nested key via dot-path', () => {
      const result = contextResolver('app.db.host', {
        app: { db: { host: 'localhost' } },
      });
      expect(result).toEqual({ kind: 'value', value: 'localhost' });
    });
  });

  describe('IC-2: Empty config fallback', () => {
    it('throws RILL-R062 for any key when config is omitted', () => {
      try {
        contextResolver('anykey');
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as RuntimeError).errorId).toBe('RILL-R062');
      }
    });

    it('throws RILL-R062 for any key when config is empty object', () => {
      try {
        contextResolver('anykey', {});
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as RuntimeError).errorId).toBe('RILL-R062');
      }
    });
  });

  describe('EC-17: Missing key -> RILL-R062', () => {
    it('throws RILL-R062 when flat key is absent from config', () => {
      try {
        contextResolver('missing', { other: 'value' });
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as RuntimeError).errorId).toBe('RILL-R062');
      }
    });

    it('throws RuntimeError instance on missing flat key', () => {
      expect(() => contextResolver('missing', { other: 'value' })).toThrow(
        RuntimeError
      );
    });

    it('RILL-R062 message includes the key name', () => {
      try {
        contextResolver('timeout', {});
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as Error).message).toContain(
          "Context key 'timeout' not found"
        );
      }
    });

    it('throws RILL-R062 when nested path leaf is absent', () => {
      try {
        contextResolver('limits.missing', { limits: { max_tokens: 4096 } });
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as RuntimeError).errorId).toBe('RILL-R062');
      }
    });

    it('RILL-R062 message includes the full dot-path key', () => {
      try {
        contextResolver('limits.missing', { limits: { max_tokens: 4096 } });
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as Error).message).toContain(
          "Context key 'limits.missing' not found"
        );
      }
    });
  });

  describe('EC-18: Segment not a dict -> RILL-R063', () => {
    it('throws RILL-R063 when intermediate segment is a string, not a dict', () => {
      try {
        contextResolver('timeout.sub', { timeout: 'not-a-dict' });
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as RuntimeError).errorId).toBe('RILL-R063');
      }
    });

    it('throws RILL-R063 when intermediate segment is a number, not a dict', () => {
      try {
        contextResolver('limits.max_tokens.sub', {
          limits: { max_tokens: 4096 },
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as RuntimeError).errorId).toBe('RILL-R063');
      }
    });

    it('throws RILL-R063 when intermediate segment is an array, not a dict', () => {
      try {
        contextResolver('items.first', { items: [1, 2, 3] });
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as RuntimeError).errorId).toBe('RILL-R063');
      }
    });

    it('throws RuntimeError instance when segment is not a dict', () => {
      expect(() => contextResolver('timeout.sub', { timeout: 42 })).toThrow(
        RuntimeError
      );
    });

    it('RILL-R063 message includes the resource path and offending segment', () => {
      try {
        contextResolver('timeout.sub', { timeout: 'flat' });
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as Error).message).toContain("Context path 'timeout.sub'");
        expect((err as Error).message).toContain('is not a dict');
      }
    });
  });
});
