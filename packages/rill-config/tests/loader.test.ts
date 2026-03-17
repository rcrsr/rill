/**
 * Tests for loadExtensions
 * Covers: HP-7, HP-8, EC-5, EC-6, EC-7, EC-10, EC-11, BC-1
 * (AC-7, AC-8, AC-13, AC-14, AC-16, AC-20, AC-21, AC-23)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  loadExtensions,
  ExtensionLoadError,
  ExtensionVersionError,
  NamespaceCollisionError,
  ConfigValidationError,
} from '@rcrsr/rill-config';
import type { ResolvedMount } from '@rcrsr/rill-config';

// ============================================================
// TEST HELPERS
// ============================================================

function makeMount(
  mountPath: string,
  packageSpecifier: string,
  versionConstraint?: string
): ResolvedMount {
  return versionConstraint !== undefined
    ? { mountPath, packageSpecifier, versionConstraint }
    : { mountPath, packageSpecifier };
}

// ============================================================
// BC-1: Empty extensions
// ============================================================

describe('loadExtensions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  describe('BC-1: empty mounts', () => {
    it('returns empty extTree when no mounts are provided', async () => {
      // AC-23: empty mounts succeeds and returns empty extTree
      const result = await loadExtensions([], {});
      expect(result.extTree).toEqual({});
      expect(result.disposes).toHaveLength(0);
      expect(result.manifests.size).toBe(0);
    });
  });

  // ============================================================
  // EC-7: Package not found / no manifest / factory failure
  // ============================================================

  describe('EC-7: missing package throws ExtensionLoadError', () => {
    it('throws ExtensionLoadError for a non-existent package specifier', async () => {
      // AC-21: import() of unknown package triggers ExtensionLoadError
      const mounts = [
        makeMount('pkg', '@nonexistent/rill-ext-loader-test-99999'),
      ];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        ExtensionLoadError
      );
    });

    it('collects all missing packages before throwing', async () => {
      // AC-21: errors are collected into a single throw
      const mounts = [
        makeMount('a', '@nonexistent/rill-ext-aaa-loader-99999'),
        makeMount('b', '@nonexistent/rill-ext-bbb-loader-99999'),
      ];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        ExtensionLoadError
      );
    });

    it('includes the missing package name in the error message', async () => {
      const mounts = [
        makeMount('pkg', '@nonexistent/rill-ext-named-loader-99999'),
      ];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        '@nonexistent/rill-ext-named-loader-99999'
      );
    });

    it('EC-8: error message uses "Cannot find packages: {list}" format', async () => {
      const mounts = [makeMount('a', '@nonexistent/rill-ext-ec8-format-99999')];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        'Cannot find packages: @nonexistent/rill-ext-ec8-format-99999'
      );
    });

    it('EC-8: lists all missing packages in a single message', async () => {
      const mounts = [
        makeMount('a', '@nonexistent/rill-ext-ec8-a-99999'),
        makeMount('b', '@nonexistent/rill-ext-ec8-b-99999'),
      ];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        'Cannot find packages: @nonexistent/rill-ext-ec8-a-99999, @nonexistent/rill-ext-ec8-b-99999'
      );
    });
  });

  describe('EC-7: no extensionManifest export throws ExtensionLoadError', () => {
    it('throws ExtensionLoadError when module exports no extensionManifest', async () => {
      // AC-21: package found but no manifest export
      vi.mock('/fake/ext/no-manifest', () => ({ someOtherExport: 42 }), {
        virtual: true,
      });
      const mounts = [makeMount('pkg', '/fake/ext/no-manifest')];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        ExtensionLoadError
      );
    });

    it('includes the package name in the "no manifest" error message', async () => {
      vi.mock('/fake/ext/no-manifest-msg', () => ({ irrelevant: true }), {
        virtual: true,
      });
      const mounts = [makeMount('pkg', '/fake/ext/no-manifest-msg')];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        '/fake/ext/no-manifest-msg'
      );
    });
  });

  describe('EC-7: factory throws ExtensionLoadError', () => {
    it('throws ExtensionLoadError when factory function throws', async () => {
      // AC-21: factory invocation failure
      vi.mock(
        '/fake/ext/factory-throws',
        () => ({
          extensionManifest: {
            factory: () => {
              throw new Error('api_key is required');
            },
          },
        }),
        { virtual: true }
      );
      const mounts = [makeMount('pkg', '/fake/ext/factory-throws')];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        ExtensionLoadError
      );
    });

    it('EC-7: error message uses "Factory for {pkg} threw: {reason}" format', async () => {
      vi.mock(
        '/fake/ext/factory-throws-msg',
        () => ({
          extensionManifest: {
            factory: () => {
              throw new Error('connection refused');
            },
          },
        }),
        { virtual: true }
      );
      const mounts = [makeMount('pkg', '/fake/ext/factory-throws-msg')];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        'Factory for /fake/ext/factory-throws-msg threw: connection refused'
      );
    });
  });

  // ============================================================
  // EC-9: Cross-package collision
  // ============================================================

  describe('EC-9: cross-package mount collision throws NamespaceCollisionError', () => {
    it('throws NamespaceCollisionError when mount paths from different packages overlap', async () => {
      vi.mock(
        '/fake/ext/coll-pkg-a',
        () => ({
          extensionManifest: {
            factory: () => ({}),
          },
        }),
        { virtual: true }
      );
      vi.mock(
        '/fake/ext/coll-pkg-b',
        () => ({
          extensionManifest: {
            factory: () => ({}),
          },
        }),
        { virtual: true }
      );
      const mounts = [
        makeMount('shared', '/fake/ext/coll-pkg-a'),
        makeMount('shared.sub', '/fake/ext/coll-pkg-b'),
      ];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        NamespaceCollisionError
      );
    });
  });

  // ============================================================
  // EC-10: Version mismatch
  // ============================================================

  describe('EC-10: version mismatch throws ExtensionVersionError', () => {
    it('throws ExtensionVersionError when installed version does not satisfy constraint', async () => {
      // AC-16: package is v1.0.0 but constraint is ^2.0.0
      vi.mock(
        '/fake/ext/version-mismatch',
        () => ({
          extensionManifest: {
            version: '1.0.0',
            factory: () => ({}),
          },
        }),
        { virtual: true }
      );
      const mounts = [
        makeMount('vext', '/fake/ext/version-mismatch', '^2.0.0'),
      ];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        ExtensionVersionError
      );
    });

    it('does not throw when installed version satisfies constraint', async () => {
      vi.mock(
        '/fake/ext/version-ok',
        () => ({
          extensionManifest: {
            version: '1.5.0',
            factory: () => ({ value: 'ok' }),
          },
        }),
        { virtual: true }
      );
      const mounts = [makeMount('vok', '/fake/ext/version-ok', '^1.0.0')];
      await expect(loadExtensions(mounts, {})).resolves.toBeDefined();
    });
  });

  // ============================================================
  // EC-11: Orphaned config key
  // ============================================================

  describe('EC-11: orphaned config key throws ConfigValidationError', () => {
    it('throws ConfigValidationError for a config key that has no matching mount', async () => {
      // AC-20: 'orphan' key in config has no corresponding mount path
      vi.mock(
        '/fake/ext/orphan-base',
        () => ({
          extensionManifest: {
            factory: () => ({}),
          },
        }),
        { virtual: true }
      );
      const mounts = [makeMount('real', '/fake/ext/orphan-base')];
      const config = { orphan: { setting: 'value' } };
      await expect(loadExtensions(mounts, config)).rejects.toThrow(
        ConfigValidationError
      );
    });

    it('includes the orphaned key in the error message', async () => {
      vi.mock(
        '/fake/ext/orphan-msg',
        () => ({
          extensionManifest: {
            factory: () => ({}),
          },
        }),
        { virtual: true }
      );
      const mounts = [makeMount('base', '/fake/ext/orphan-msg')];
      await expect(
        loadExtensions(mounts, { staleKey: { x: 1 } })
      ).rejects.toThrow('staleKey');
    });
  });

  // ============================================================
  // EC-5: Factory returns result without value property
  // ============================================================

  describe('EC-5: factory result missing value property throws ExtensionLoadError', () => {
    it('throws ExtensionLoadError when factory returns object without value property', async () => {
      // AC-13: factory returns {} (no value property)
      vi.mock(
        '/fake/ext/no-value-prop',
        () => ({
          extensionManifest: {
            factory: () => ({}),
          },
        }),
        { virtual: true }
      );
      const mounts = [makeMount('nv', '/fake/ext/no-value-prop')];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        ExtensionLoadError
      );
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        'Factory for /fake/ext/no-value-prop returned result without value property'
      );
    });
  });

  // ============================================================
  // EC-6: Factory returns undefined value
  // ============================================================

  describe('EC-6: factory result with undefined value throws ExtensionLoadError', () => {
    it('throws ExtensionLoadError when factory returns { value: undefined }', async () => {
      // AC-14: factory returns { value: undefined }
      vi.mock(
        '/fake/ext/undef-value',
        () => ({
          extensionManifest: {
            factory: () => ({ value: undefined }),
          },
        }),
        { virtual: true }
      );
      const mounts = [makeMount('uv', '/fake/ext/undef-value')];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        ExtensionLoadError
      );
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        'Factory for /fake/ext/undef-value returned undefined value'
      );
    });
  });

  // ============================================================
  // HP-8: Manifest validation and factory invocation
  // ============================================================

  describe('HP-8: validates manifest and invokes factory', () => {
    it('calls factory with the matching config block and populates extTree', async () => {
      vi.mock(
        '/fake/ext/valid-factory',
        () => ({
          extensionManifest: {
            factory: (_cfg: Record<string, unknown>) => ({
              value: { run: { fn: async () => 'ok', params: [] } },
            }),
          },
        }),
        { virtual: true }
      );
      const mounts = [makeMount('tools', '/fake/ext/valid-factory')];
      const result = await loadExtensions(mounts, {});
      expect(result.extTree).toBeDefined();
      expect(result.manifests.size).toBe(1);
      expect(result.manifests.has('tools')).toBe(true);
    });

    it('collects dispose function from factory result', async () => {
      vi.mock(
        '/fake/ext/with-dispose',
        () => ({
          extensionManifest: {
            factory: () => ({
              value: 'placeholder',
              dispose: () => undefined,
            }),
          },
        }),
        { virtual: true }
      );
      const mounts = [makeMount('disp', '/fake/ext/with-dispose')];
      const result = await loadExtensions(mounts, {});
      expect(result.disposes).toHaveLength(1);
      expect(typeof result.disposes[0]).toBe('function');
    });
  });

  // ============================================================
  // HP-7: Same package at two mount paths
  // ============================================================

  describe('HP-7: same package at two mount paths', () => {
    it('creates independent entries in extTree for each mount', async () => {
      vi.mock(
        '/fake/ext/dual-mount',
        () => ({
          extensionManifest: {
            factory: (_cfg: Record<string, unknown>) => ({
              value: { fn1: { fn: async () => 'v', params: [] } },
            }),
          },
        }),
        { virtual: true }
      );
      const mounts = [
        makeMount('dual.a', '/fake/ext/dual-mount'),
        makeMount('dual.b', '/fake/ext/dual-mount'),
      ];
      const result = await loadExtensions(mounts, {});
      expect(result.manifests.has('dual.a')).toBe(true);
      expect(result.manifests.has('dual.b')).toBe(true);
    });
  });
});
