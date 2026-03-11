/**
 * Tests for loadExtensions
 * Covers: HP-7, HP-8, EC-7, EC-8, EC-9, EC-10, EC-11, BC-1
 * (AC-7, AC-8, AC-16, AC-18, AC-20, AC-21, AC-23)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  loadExtensions,
  ExtensionLoadError,
  ExtensionVersionError,
  NamespaceMismatchError,
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
  });

  describe('EC-7: no ExtensionManifest export throws ExtensionLoadError', () => {
    it('throws ExtensionLoadError when module exports no ExtensionManifest', async () => {
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
          ExtensionManifest: {
            namespace: 'pkg',
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
  });

  // ============================================================
  // EC-8: Mount/namespace mismatch
  // ============================================================

  describe('EC-8: mount/namespace mismatch throws NamespaceMismatchError', () => {
    it('throws NamespaceMismatchError when mount path does not start with namespace', async () => {
      // AC-18: mount path 'other.path' does not start with namespace 'pkg'
      vi.mock(
        '/fake/ext/ns-mismatch',
        () => ({
          ExtensionManifest: {
            namespace: 'pkg',
            factory: () => ({}),
          },
        }),
        { virtual: true }
      );
      const mounts = [makeMount('other.path', '/fake/ext/ns-mismatch')];
      await expect(loadExtensions(mounts, {})).rejects.toThrow(
        NamespaceMismatchError
      );
    });

    it('includes mount path and namespace in the error message', async () => {
      vi.mock(
        '/fake/ext/ns-mismatch-msg',
        () => ({
          ExtensionManifest: {
            namespace: 'pkg',
            factory: () => ({}),
          },
        }),
        { virtual: true }
      );
      const mounts = [makeMount('wrong', '/fake/ext/ns-mismatch-msg')];
      const err = await loadExtensions(mounts, {}).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NamespaceMismatchError);
      const msg = (err as NamespaceMismatchError).message;
      expect(msg).toContain('wrong');
      expect(msg).toContain('pkg');
    });
  });

  // ============================================================
  // EC-9: Cross-package collision
  // ============================================================

  describe('EC-9: cross-package namespace collision throws NamespaceCollisionError', () => {
    it('throws NamespaceCollisionError when two different packages claim the same namespace', async () => {
      // AC-11: pkg-a and pkg-b both declare namespace 'shared'
      vi.mock(
        '/fake/ext/coll-pkg-a',
        () => ({
          ExtensionManifest: {
            namespace: 'shared',
            factory: () => ({}),
          },
        }),
        { virtual: true }
      );
      vi.mock(
        '/fake/ext/coll-pkg-b',
        () => ({
          ExtensionManifest: {
            namespace: 'shared',
            factory: () => ({}),
          },
        }),
        { virtual: true }
      );
      const mounts = [
        makeMount('shared.a', '/fake/ext/coll-pkg-a'),
        makeMount('shared.b', '/fake/ext/coll-pkg-b'),
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
          ExtensionManifest: {
            namespace: 'vext',
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
          ExtensionManifest: {
            namespace: 'vok',
            version: '1.5.0',
            factory: () => ({}),
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
          ExtensionManifest: {
            namespace: 'real',
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
          ExtensionManifest: {
            namespace: 'base',
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
  // HP-8: Manifest validation and factory invocation
  // ============================================================

  describe('HP-8: validates manifest and invokes factory', () => {
    it('calls factory with the matching config block and populates extTree', async () => {
      vi.mock(
        '/fake/ext/valid-factory',
        () => ({
          ExtensionManifest: {
            namespace: 'tools',
            factory: (_cfg: Record<string, unknown>) => ({
              run: { fn: async () => 'ok', params: [] },
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
      // vi.mock is hoisted — cannot close over local variables.
      // Assert the dispose array has the collected function.
      vi.mock(
        '/fake/ext/with-dispose',
        () => ({
          ExtensionManifest: {
            namespace: 'disp',
            factory: () => ({
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
          ExtensionManifest: {
            namespace: 'dual',
            factory: (_cfg: Record<string, unknown>) => ({
              fn1: { fn: async () => 'v', params: [] },
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
