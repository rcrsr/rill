/**
 * Rill Runtime Tests: ResolverContext facade
 *
 * Specification Mapping:
 * - Facade Membership: resolvers, resolverConfigs, resolvingSchemes, parseSource.
 * - resolvers Map: populated from RuntimeOptions.resolvers.
 * - resolverConfigs Map: populated from RuntimeOptions.configurations.resolvers.
 * - resolvingSchemes: fresh empty Set on root context (BC-7).
 * - parseSource: undefined when omitted, function reference when provided (BC-4).
 * - Shared-by-reference: child shares resolvers, resolverConfigs, resolvingSchemes,
 *   and parseSource with parent (createChildContext line 677-680).
 *
 * Construction strategy:
 * - Uses createRuntimeContext for root scope.
 * - Uses createChildContext (internal export) for child scopes.
 * - No standalone facade constructors (TD-3).
 */

import { describe, expect, it } from 'vitest';
import {
  createRuntimeContext,
  createChildContext,
  type SchemeResolver,
} from '@rcrsr/rill';

describe('ResolverContext', () => {
  describe('resolvers Map', () => {
    it('is an empty Map when resolvers option is omitted', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.resolvers).toBeInstanceOf(Map);
      expect(ctx.resolvers.size).toBe(0);
    });

    it('is an empty Map when resolvers option is an empty object', () => {
      const ctx = createRuntimeContext({ resolvers: {} });
      expect(ctx.resolvers.size).toBe(0);
    });

    it('size equals the number of resolver entries passed', () => {
      const resolver: SchemeResolver = async () => ({
        kind: 'value',
        value: 42,
      });
      const ctx = createRuntimeContext({
        resolvers: { data: resolver, blob: resolver },
      });
      expect(ctx.resolvers.size).toBe(2);
    });

    it('registered resolver is retrievable by scheme name', () => {
      const resolver: SchemeResolver = async () => ({
        kind: 'value',
        value: 'hello',
      });
      const ctx = createRuntimeContext({ resolvers: { myscheme: resolver } });
      expect(ctx.resolvers.get('myscheme')).toBe(resolver);
    });

    it('unregistered scheme returns undefined', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.resolvers.get('__no_such_scheme__')).toBeUndefined();
    });
  });

  describe('resolverConfigs Map', () => {
    it('is an empty Map when configurations option is omitted', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.resolverConfigs).toBeInstanceOf(Map);
      expect(ctx.resolverConfigs.size).toBe(0);
    });

    it('config value is retrievable by scheme name', () => {
      const ctx = createRuntimeContext({
        configurations: {
          resolvers: { myscheme: { baseUrl: 'https://example.com' } },
        },
      });
      expect(ctx.resolverConfigs.get('myscheme')).toEqual({
        baseUrl: 'https://example.com',
      });
    });

    it('returns undefined for a scheme key not in configurations.resolvers', () => {
      const ctx = createRuntimeContext({
        configurations: { resolvers: { myscheme: { key: 'value' } } },
      });
      expect(ctx.resolverConfigs.get('otherscheme')).toBeUndefined();
    });
  });

  describe('resolvingSchemes Set [BC-7]', () => {
    it('starts as an empty Set on a fresh context', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.resolvingSchemes).toBeInstanceOf(Set);
      expect(ctx.resolvingSchemes.size).toBe(0);
    });

    it('is a Set instance', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.resolvingSchemes instanceof Set).toBe(true);
    });

    it('has size 0 on construction', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.resolvingSchemes.size).toBe(0);
    });

    it('child context shares the same resolvingSchemes reference as parent', () => {
      const ctx = createRuntimeContext({});
      const child = createChildContext(ctx);
      expect(child.resolvingSchemes).toBe(ctx.resolvingSchemes);
    });
  });

  describe('parseSource [BC-4]', () => {
    it('is undefined when parseSource option is omitted', () => {
      const ctx = createRuntimeContext({});
      expect(ctx.parseSource).toBeUndefined();
    });

    it('is the supplied function reference when provided', () => {
      const parser = (text: string) => {
        void text;
        return {
          type: 'Script' as const,
          body: [],
          span: { start: 0, end: 0 },
        };
      };
      const ctx = createRuntimeContext({ parseSource: parser });
      expect(ctx.parseSource).toBe(parser);
    });

    it('child context inherits parseSource from parent by reference', () => {
      const parser = (text: string) => {
        void text;
        return {
          type: 'Script' as const,
          body: [],
          span: { start: 0, end: 0 },
        };
      };
      const ctx = createRuntimeContext({ parseSource: parser });
      const child = createChildContext(ctx);
      expect(child.parseSource).toBe(ctx.parseSource);
    });

    it('child context inherits undefined parseSource when parent has none', () => {
      const ctx = createRuntimeContext({});
      const child = createChildContext(ctx);
      expect(child.parseSource).toBeUndefined();
    });
  });

  describe('shared-by-reference: child inherits resolver surface', () => {
    it('child.resolvers is the same reference as parent.resolvers', () => {
      const ctx = createRuntimeContext({});
      const child = createChildContext(ctx);
      expect(child.resolvers).toBe(ctx.resolvers);
    });

    it('child.resolverConfigs is the same reference as parent.resolverConfigs', () => {
      const ctx = createRuntimeContext({});
      const child = createChildContext(ctx);
      expect(child.resolverConfigs).toBe(ctx.resolverConfigs);
    });
  });
});
