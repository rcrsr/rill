/**
 * Tests for buildResolvers
 */

import { buildResolvers } from '@rcrsr/rill-config';
import {
  isApplicationCallable,
  structureToTypeValue,
  toCallable,
} from '@rcrsr/rill';
import type { ApplicationCallable, RillValue } from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

// ============================================================
// buildResolvers
// ============================================================

describe('buildResolvers', () => {
  const emptyTree: Record<string, RillValue> = {};

  function makeOptions(
    overrides: Partial<Parameters<typeof buildResolvers>[0]> = {}
  ): Parameters<typeof buildResolvers>[0] {
    return {
      extTree: emptyTree,
      contextValues: {},
      extensionBindings: '[:]',
      contextBindings: '[:]',
      modulesConfig: {},
      configDir: '/tmp',
      ...overrides,
    };
  }

  describe('resolver keys', () => {
    it('returns resolvers with ext, context, and module keys', () => {
      const result = buildResolvers(makeOptions());
      expect(result.resolvers).toHaveProperty('ext');
      expect(result.resolvers).toHaveProperty('context');
      expect(result.resolvers).toHaveProperty('module');
    });

    it('returns configurations with resolvers key', () => {
      const result = buildResolvers(makeOptions());
      expect(result.configurations).toHaveProperty('resolvers');
    });
  });

  describe('module:ext returns extension bindings source', () => {
    it('returns source text for module:ext', () => {
      const extensionBindings = '[\n  run: use<ext:tools.run>:||\n]';
      const result = buildResolvers(makeOptions({ extensionBindings }));
      const moduleResolver = result.resolvers['module'];
      expect(moduleResolver).toBeDefined();
      const resolution = moduleResolver!('ext');
      expect(resolution).toEqual({ kind: 'source', text: extensionBindings });
    });
  });

  describe('module:context returns context bindings source', () => {
    it('returns source text for module:context', () => {
      const contextBindings = '[\n  apiUrl: "https://example.com"\n]';
      const result = buildResolvers(makeOptions({ contextBindings }));
      const moduleResolver = result.resolvers['module'];
      expect(moduleResolver).toBeDefined();
      const resolution = moduleResolver!('context');
      expect(resolution).toEqual({ kind: 'source', text: contextBindings });
    });
  });

  describe('user module config', () => {
    it('does not include ext or context keys from modulesConfig in user routes', () => {
      // Reserved keys 'ext' and 'context' must not be forwarded to moduleResolver
      const result = buildResolvers(
        makeOptions({
          modulesConfig: {
            ext: './should-be-ignored.rill',
            context: './also-ignored.rill',
          },
        })
      );
      // Module resolver should still return bindings for 'ext' and 'context'
      const moduleResolver = result.resolvers['module'];
      expect(moduleResolver).toBeDefined();
      const extRes = moduleResolver!('ext');
      expect(extRes).toHaveProperty('kind', 'source');
    });
  });

  describe('configurations.resolvers content', () => {
    it('configurations.resolvers.ext reflects the ext tree as rillvalues', () => {
      const result = buildResolvers(makeOptions());
      const resolverConfigs = result.configurations.resolvers;
      expect(resolverConfigs).toHaveProperty('ext');
      expect(resolverConfigs).toHaveProperty('context');
    });

    it('passes contextValues into configurations.resolvers.context', () => {
      const contextValues = { userId: 'abc123', count: 42 };
      const result = buildResolvers(makeOptions({ contextValues }));
      expect(result.configurations.resolvers['context']).toEqual(contextValues);
    });
  });

  describe('extTree passthrough preserves returnType and description', () => {
    it('ApplicationCallable in extTree carries returnType through to configurations', () => {
      const tree: Record<string, RillValue> = {
        tools: {
          greet: toCallable({
            fn: async () => 'hello',
            params: [
              {
                name: 'name',
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            returnType: structureToTypeValue({ kind: 'string' }),
            annotations: { description: 'Greets by name' },
          }),
        },
      };
      const result = buildResolvers(makeOptions({ extTree: tree }));
      const extConfig = result.configurations.resolvers['ext'] as Record<
        string,
        RillValue
      >;
      const toolsDict = extConfig['tools'] as Record<string, RillValue>;
      const greetCallable = toolsDict['greet'];

      expect(isApplicationCallable(greetCallable)).toBe(true);
      const ac = greetCallable as unknown as ApplicationCallable;
      expect(ac.returnType).toBeDefined();
      expect(ac.annotations['description']).toBe('Greets by name');
    });
  });
});
