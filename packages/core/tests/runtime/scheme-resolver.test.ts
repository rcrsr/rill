/**
 * Rill Runtime Tests: Scheme Resolvers
 * Tests for moduleResolver, extResolver, and createRuntimeContext resolver config.
 */

import {
  createRuntimeContext,
  extResolver,
  moduleResolver,
  parse,
  RuntimeError,
  type RillValue,
  type ResolverResult,
  type SchemeResolver,
} from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

// ============================================================
// moduleResolver tests (covers IR-4, EC-1, EC-2, EC-3)
// ============================================================

describe('Rill Runtime: moduleResolver', () => {
  describe('IR-4: Config lookup', () => {
    it('EC-3: throws RILL-R059 when config is not a plain object (undefined)', async () => {
      await expect(
        moduleResolver('greetings', undefined)
      ).rejects.toHaveProperty('errorId', 'RILL-R059');
    });

    it('EC-3: throws RILL-R059 when config is an array', async () => {
      await expect(moduleResolver('greetings', [])).rejects.toHaveProperty(
        'errorId',
        'RILL-R059'
      );
    });

    it('EC-3: throws RILL-R059 when config is a string', async () => {
      await expect(
        moduleResolver('greetings', 'not-an-object')
      ).rejects.toHaveProperty('errorId', 'RILL-R059');
    });

    it('EC-3: RILL-R059 message is descriptive', async () => {
      await expect(moduleResolver('greetings', null)).rejects.toThrow(
        'moduleResolver config must be a plain object'
      );
    });

    it('EC-1: throws RILL-R050 when module ID absent from config', async () => {
      await expect(
        moduleResolver('missing', { other: './other.rill' })
      ).rejects.toHaveProperty('errorId', 'RILL-R050');
    });

    it('EC-1: RILL-R050 message includes the module name', async () => {
      await expect(
        moduleResolver('missing', { other: './other.rill' })
      ).rejects.toThrow("Module 'missing' not found in resolver config");
    });

    it('EC-2: throws RILL-R051 when file path exists in config but file not readable', async () => {
      await expect(
        moduleResolver('greetings', { greetings: './nonexistent-file.rill' })
      ).rejects.toHaveProperty('errorId', 'RILL-R051');
    });

    it('EC-2: RILL-R051 message includes the module name', async () => {
      await expect(
        moduleResolver('greetings', { greetings: './nonexistent-file.rill' })
      ).rejects.toThrow("Failed to read module 'greetings'");
    });
  });

  describe('Source evaluation via createRuntimeContext', () => {
    it('AC-2+AC-22: module source last expression is returned', async () => {
      const result = await run('use<module:greetings>', {
        resolvers: {
          module: (_resource: string): ResolverResult => ({
            kind: 'source',
            text: '"hello world"',
          }),
        },
        parseSource: (text: string) => parse(text),
      });
      expect(result).toBe('hello world');
    });

    it('multi-statement module source: last expression is returned', async () => {
      const result = await run('use<module:calc>', {
        resolvers: {
          module: (_resource: string): ResolverResult => ({
            kind: 'source',
            text: '"ignored" => $x\n"final"',
          }),
        },
        parseSource: (text: string) => parse(text),
      });
      expect(result).toBe('final');
    });
  });

  describe('Parse error wrapping', () => {
    it('wraps parseSource errors with sourceId', async () => {
      try {
        await run('use<module:bad>', {
          resolvers: {
            module: (_resource: string): ResolverResult => ({
              kind: 'source',
              text: '??? invalid syntax',
            }),
          },
          parseSource: (text: string) => parse(text),
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const rErr = err as RuntimeError;
        expect(rErr.errorId).toBe('RILL-R056');
        expect(rErr.sourceId).toBe('module:bad');
        expect(rErr.context?.sourceId).toBe('module:bad');
        expect(rErr.cause).toBeInstanceOf(Error);
      }
    });
  });
});

// ============================================================
// extResolver tests (covers IR-5, EC-4, EC-5)
// ============================================================

describe('Rill Runtime: extResolver', () => {
  describe('IR-5: Full dict return and member access', () => {
    it('returns full extension value when no dot path in resource', () => {
      const dictValue = { search: 'searchFn', upsert: 'upsertFn' };
      const result = extResolver('qdrant', { qdrant: dictValue as RillValue });
      expect(result).toEqual({ kind: 'value', value: dictValue });
    });

    it('returns member value for single dot-path segment', () => {
      const dictValue = { search: 'searchFn', upsert: 'upsertFn' };
      const result = extResolver('qdrant.search', {
        qdrant: dictValue as RillValue,
      });
      expect(result).toEqual({ kind: 'value', value: 'searchFn' });
    });

    it('returns deeply nested member for multi-segment dot path', () => {
      const nested = { filters: { range: 'rangeFn' } };
      const result = extResolver('qdrant.filters.range', {
        qdrant: nested as unknown as RillValue,
      });
      expect(result).toEqual({ kind: 'value', value: 'rangeFn' });
    });
  });

  describe('EC-4: Missing extension name', () => {
    it('throws RILL-R052 when extension name not in config', () => {
      expect(() => extResolver('qdrant', {})).toThrow(RuntimeError);
      try {
        extResolver('qdrant', {});
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as RuntimeError).errorId).toBe('RILL-R052');
      }
    });

    it('EC-4: RILL-R052 message includes extension name', () => {
      try {
        extResolver('qdrant', {});
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as Error).message).toContain(
          "Extension 'qdrant' not found in resolver config"
        );
      }
    });

    it('EC-4: throws RILL-R052 when config is omitted (empty config)', () => {
      try {
        extResolver('missing');
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as RuntimeError).errorId).toBe('RILL-R052');
      }
    });
  });

  describe('EC-5: Missing member path', () => {
    it('throws RILL-R053 when first dot-path member not found', () => {
      const cfg = { qdrant: { search: 'ok' } };
      try {
        extResolver(
          'qdrant.nonexistent',
          cfg as unknown as Record<string, RillValue>
        );
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as RuntimeError).errorId).toBe('RILL-R053');
      }
    });

    it('EC-5: RILL-R053 message includes member path and extension name', () => {
      const cfg = { qdrant: { search: 'ok' } };
      try {
        extResolver(
          'qdrant.nonexistent',
          cfg as unknown as Record<string, RillValue>
        );
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as Error).message).toContain(
          "Member 'nonexistent' not found in extension 'qdrant'"
        );
      }
    });

    it('throws RILL-R053 when nested path member not found', () => {
      const cfg = { qdrant: { filters: { range: 'ok' } } };
      try {
        extResolver(
          'qdrant.filters.missing',
          cfg as unknown as Record<string, RillValue>
        );
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as RuntimeError).errorId).toBe('RILL-R053');
      }
    });
  });
});

// ============================================================
// createRuntimeContext resolver config tests (covers IR-9, AC-7)
// ============================================================

describe('Rill Runtime: createRuntimeContext resolver config', () => {
  describe('IR-9: Resolver map population', () => {
    it('AC-7: 3-scheme config produces ctx.resolvers.size === 3', () => {
      const resolver: SchemeResolver = () => ({ kind: 'value', value: null });
      const ctx = createRuntimeContext({
        resolvers: { a: resolver, b: resolver, c: resolver },
      });
      expect(ctx.resolvers.size).toBe(3);
    });

    it('empty resolvers object produces empty Map', () => {
      const ctx = createRuntimeContext({ resolvers: {} });
      expect(ctx.resolvers.size).toBe(0);
    });

    it('omitted resolvers option produces empty Map', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.resolvers).toBeInstanceOf(Map);
      expect(ctx.resolvers.size).toBe(0);
    });

    it('registered resolver is retrievable by scheme name', () => {
      const resolver: SchemeResolver = () => ({ kind: 'value', value: 'x' });
      const ctx = createRuntimeContext({ resolvers: { myscheme: resolver } });
      expect(ctx.resolvers.get('myscheme')).toBe(resolver);
    });
  });

  describe('configurations.resolvers → ctx.resolverConfigs', () => {
    it('populates resolverConfigs from configurations.resolvers', () => {
      const ctx = createRuntimeContext({
        configurations: { resolvers: { myscheme: { basePath: '/tmp' } } },
      });
      expect(ctx.resolverConfigs.get('myscheme')).toEqual({ basePath: '/tmp' });
    });

    it('omitted configurations produces empty resolverConfigs Map', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.resolverConfigs).toBeInstanceOf(Map);
      expect(ctx.resolverConfigs.size).toBe(0);
    });
  });

  describe('ctx.resolvingSchemes starts empty', () => {
    it('resolvingSchemes is an empty Set on fresh context', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.resolvingSchemes).toBeInstanceOf(Set);
      expect(ctx.resolvingSchemes.size).toBe(0);
    });
  });
});
