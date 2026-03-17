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
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

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

  describe('module folder aliasing', () => {
    it('resolves dot-path to file within aliased directory', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rill-resolvers-'));
      fs.writeFileSync(path.join(dir, 'ext.rill'), '"extension bindings"');
      try {
        const result = buildResolvers(
          makeOptions({ modulesConfig: { bindings: dir }, configDir: '/tmp' })
        );
        const moduleResolver = result.resolvers['module'];
        const resolution = await moduleResolver!('bindings.ext');
        expect(resolution).toEqual(
          expect.objectContaining({
            kind: 'source',
            text: '"extension bindings"',
          })
        );
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it('resolves nested dot-path to nested file path', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rill-resolvers-'));
      fs.mkdirSync(path.join(dir, 'sub'));
      fs.writeFileSync(path.join(dir, 'sub', 'deep.rill'), '"deep value"');
      try {
        const result = buildResolvers(
          makeOptions({ modulesConfig: { lib: dir }, configDir: '/tmp' })
        );
        const moduleResolver = result.resolvers['module'];
        const resolution = await moduleResolver!('lib.sub.deep');
        expect(resolution).toEqual(
          expect.objectContaining({ kind: 'source', text: '"deep value"' })
        );
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it('resolves bare alias to index.rill', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rill-resolvers-'));
      fs.writeFileSync(path.join(dir, 'index.rill'), '"index content"');
      try {
        const result = buildResolvers(
          makeOptions({ modulesConfig: { utils: dir }, configDir: '/tmp' })
        );
        const moduleResolver = result.resolvers['module'];
        const resolution = await moduleResolver!('utils');
        expect(resolution).toEqual(
          expect.objectContaining({ kind: 'source', text: '"index content"' })
        );
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it('throws RILL-R050 for unknown module alias', async () => {
      const result = buildResolvers(makeOptions());
      const moduleResolver = result.resolvers['module'];
      await expect(moduleResolver!('unknown')).rejects.toThrow(
        /not found in resolver config/
      );
    });

    it('resolves module paths relative to configDir', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rill-resolvers-'));
      const subDir = path.join(dir, 'modules');
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(subDir, 'index.rill'), '"from modules"');
      try {
        const result = buildResolvers(
          makeOptions({ modulesConfig: { lib: './modules' }, configDir: dir })
        );
        const moduleResolver = result.resolvers['module'];
        const resolution = await moduleResolver!('lib');
        expect(resolution).toEqual(
          expect.objectContaining({ kind: 'source', text: '"from modules"' })
        );
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it('does not reserve ext or context as module names', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rill-resolvers-'));
      fs.writeFileSync(path.join(dir, 'index.rill'), '"ext folder"');
      try {
        const result = buildResolvers(
          makeOptions({ modulesConfig: { ext: dir }, configDir: '/tmp' })
        );
        const moduleResolver = result.resolvers['module'];
        const resolution = await moduleResolver!('ext');
        expect(resolution).toEqual(
          expect.objectContaining({ kind: 'source', text: '"ext folder"' })
        );
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
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
