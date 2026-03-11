/**
 * Extension loader tests
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadExtensions } from '../../src/run/loader.js';
import type { ConfigFile } from '../../src/run/types.js';

function makeConfig(overrides: Partial<ConfigFile> = {}): ConfigFile {
  return { extensions: {}, modules: {}, ...overrides };
}

describe('loadExtensions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  describe('factory discovery', () => {
    it('finds create*Extension export and returns a nested tree', async () => {
      vi.mock(
        '/fake/pkg/factory-discovery',
        () => ({
          createFooExtension: (_config: Record<string, unknown>) => ({
            myFunc: { fn: async () => 'result', params: [] },
            dispose: async () => undefined,
          }),
        }),
        { virtual: true }
      );

      const config = makeConfig({
        extensions: {
          foo: { package: '/fake/pkg/factory-discovery', config: {} },
        },
      });

      const tree = await loadExtensions(config);
      expect(tree).toBeDefined();
      expect(tree['foo']).toBeDefined();
    });
  });

  describe('EC-5: missing package', () => {
    it('exits 1 with "Cannot find package: <package>" for a missing package', async () => {
      vi.spyOn(process, 'exit').mockImplementation((_code) => {
        throw new Error('process.exit called');
      });

      let stderr = '';
      const origStderr = process.stderr.write.bind(process.stderr);
      (process.stderr.write as unknown) = (chunk: string) => {
        stderr += chunk;
        return true;
      };

      const config = makeConfig({
        extensions: {
          foo: {
            package: '@nonexistent/rill-ext-package-xyz-12345',
            config: {},
          },
        },
      });

      try {
        await expect(loadExtensions(config)).rejects.toThrow(
          'process.exit called'
        );
        expect(stderr).toContain(
          'Cannot find package: @nonexistent/rill-ext-package-xyz-12345'
        );
      } finally {
        (process.stderr.write as unknown) = origStderr;
      }
    });

    it('reports all missing packages before exiting', async () => {
      vi.spyOn(process, 'exit').mockImplementation((_code) => {
        throw new Error('process.exit called');
      });

      let stderr = '';
      const origStderr = process.stderr.write.bind(process.stderr);
      (process.stderr.write as unknown) = (chunk: string) => {
        stderr += chunk;
        return true;
      };

      const config = makeConfig({
        extensions: {
          foo: { package: '@nonexistent/pkg-aaa-99999', config: {} },
          bar: { package: '@nonexistent/pkg-bbb-99999', config: {} },
        },
      });

      try {
        await expect(loadExtensions(config)).rejects.toThrow(
          'process.exit called'
        );
        expect(stderr).toContain('@nonexistent/pkg-aaa-99999');
        expect(stderr).toContain('@nonexistent/pkg-bbb-99999');
      } finally {
        (process.stderr.write as unknown) = origStderr;
      }
    });
  });

  describe('EC-6: no create*Extension export', () => {
    it('exits 1 with "No create*Extension export in <package>" message', async () => {
      vi.mock('/fake/pkg/no-factory', () => ({ someOtherExport: 42 }), {
        virtual: true,
      });

      vi.spyOn(process, 'exit').mockImplementation((_code) => {
        throw new Error('process.exit called');
      });

      let stderr = '';
      const origStderr = process.stderr.write.bind(process.stderr);
      (process.stderr.write as unknown) = (chunk: string) => {
        stderr += chunk;
        return true;
      };

      const config = makeConfig({
        extensions: {
          foo: { package: '/fake/pkg/no-factory', config: {} },
        },
      });

      try {
        await expect(loadExtensions(config)).rejects.toThrow(
          'process.exit called'
        );
        expect(stderr).toContain(
          'No create*Extension export in /fake/pkg/no-factory'
        );
      } finally {
        (process.stderr.write as unknown) = origStderr;
      }
    });
  });

  describe('EC-7: factory throws', () => {
    it('exits 1 with the factory error message when factory throws', async () => {
      vi.mock(
        '/fake/pkg/throws-factory',
        () => ({
          createThrowingExtension: (_config: Record<string, unknown>) => {
            throw new Error('api_key is required and was not provided');
          },
        }),
        { virtual: true }
      );

      vi.spyOn(process, 'exit').mockImplementation((_code) => {
        throw new Error('process.exit called');
      });

      let stderr = '';
      const origStderr = process.stderr.write.bind(process.stderr);
      (process.stderr.write as unknown) = (chunk: string) => {
        stderr += chunk;
        return true;
      };

      const config = makeConfig({
        extensions: {
          foo: { package: '/fake/pkg/throws-factory', config: {} },
        },
      });

      try {
        await expect(loadExtensions(config)).rejects.toThrow(
          'process.exit called'
        );
        expect(stderr).toContain('api_key is required and was not provided');
      } finally {
        (process.stderr.write as unknown) = origStderr;
      }
    });
  });

  describe('empty extensions config', () => {
    it('returns empty tree when no extensions are configured', async () => {
      const config = makeConfig({ extensions: {} });
      const tree = await loadExtensions(config);
      expect(tree).toEqual({});
    });
  });
});
