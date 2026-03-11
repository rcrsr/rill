/**
 * Tests for resolveMounts and detectNamespaceCollisions
 * Covers: BC-4, BC-5, EC-6, EC-13, BC-2 (AC-26, AC-27, AC-19, AC-11, AC-24)
 */

import type { ExtensionManifest, ResolvedMount } from '@rcrsr/rill-config';
import {
  detectNamespaceCollisions,
  MountValidationError,
  NamespaceCollisionError,
  resolveMounts,
} from '@rcrsr/rill-config';
import { describe, expect, it } from 'vitest';

// ============================================================
// TEST HELPERS
// ============================================================

function makeManifest(namespace: string): ExtensionManifest {
  return {
    namespace,
    factory: () => ({}),
  };
}

function makeManifestMap(
  entries: Array<[mountPath: string, namespace: string]>
): ReadonlyMap<string, ExtensionManifest> {
  return new Map(
    entries.map(([mountPath, ns]) => [mountPath, makeManifest(ns)])
  );
}

// ============================================================
// resolveMounts
// ============================================================

describe('resolveMounts', () => {
  describe('valid mount paths', () => {
    it('accepts a single-segment mount path', () => {
      // AC-26: single segment is valid
      const result = resolveMounts({ fs: '@scope/pkg' });
      expect(result).toHaveLength(1);
      expect(result[0]?.mountPath).toBe('fs');
      expect(result[0]?.packageSpecifier).toBe('@scope/pkg');
    });

    it('accepts a five-segment mount path', () => {
      // AC-27: five segments separated by dots are valid
      const result = resolveMounts({ 'a.b.c.d.e': '@scope/pkg' });
      expect(result).toHaveLength(1);
      expect(result[0]?.mountPath).toBe('a.b.c.d.e');
    });

    it('accepts alphanumeric segments with underscores and hyphens', () => {
      const result = resolveMounts({ 'my_ext-v2.sub_ns': '@scope/pkg' });
      expect(result).toHaveLength(1);
      expect(result[0]?.mountPath).toBe('my_ext-v2.sub_ns');
    });
  });

  describe('specifier parsing', () => {
    it('extracts version constraint from scoped package with version', () => {
      const result = resolveMounts({ fs: '@scope/pkg@^1.0.0' });
      expect(result[0]?.packageSpecifier).toBe('@scope/pkg');
      expect(result[0]?.versionConstraint).toBe('^1.0.0');
    });

    it('returns no versionConstraint for scoped package without version', () => {
      const result = resolveMounts({ fs: '@scope/pkg' });
      expect(result[0]?.packageSpecifier).toBe('@scope/pkg');
      expect(result[0]).not.toHaveProperty('versionConstraint');
    });

    it('returns no versionConstraint for local path specifier', () => {
      const result = resolveMounts({ fs: './local/path' });
      expect(result[0]?.packageSpecifier).toBe('./local/path');
      expect(result[0]).not.toHaveProperty('versionConstraint');
    });

    it('resolves multiple mounts to correct order', () => {
      const result = resolveMounts({
        'storage.kv': '@scope/kv@1.0.0',
        'storage.cache': '@scope/cache',
      });
      expect(result).toHaveLength(2);
      expect(result[0]?.mountPath).toBe('storage.kv');
      expect(result[1]?.mountPath).toBe('storage.cache');
    });
  });

  describe('same package at multiple mounts', () => {
    it('allows same package at two mount paths when version is consistent', () => {
      const result = resolveMounts({
        'ns.a': '@scope/pkg@^1.0.0',
        'ns.b': '@scope/pkg@^1.0.0',
      });
      expect(result).toHaveLength(2);
    });

    it('allows same package at two mount paths with no version on either', () => {
      const result = resolveMounts({
        'ns.a': '@scope/pkg',
        'ns.b': '@scope/pkg',
      });
      expect(result).toHaveLength(2);
    });
  });

  describe('error cases', () => {
    it('throws MountValidationError for a segment with an invalid character', () => {
      // AC-19: segment containing '!' is invalid
      expect(() => resolveMounts({ 'bad!segment': '@scope/pkg' })).toThrowError(
        MountValidationError
      );
      expect(() => resolveMounts({ 'bad!segment': '@scope/pkg' })).toThrowError(
        'Invalid segment: bad!segment in bad!segment'
      );
    });

    it('throws MountValidationError for a segment with a dot replaced by invalid char', () => {
      // AC-19: segment 'a b' contains a space which is invalid
      expect(() => resolveMounts({ 'a b.c': '@scope/pkg' })).toThrowError(
        MountValidationError
      );
    });

    it('throws MountValidationError when same package has conflicting versions', () => {
      // AC-19: same package at two mounts with different versions
      expect(() =>
        resolveMounts({
          'ns.a': '@scope/pkg@^1.0.0',
          'ns.b': '@scope/pkg@^2.0.0',
        })
      ).toThrowError(MountValidationError);
      expect(() =>
        resolveMounts({
          'ns.a': '@scope/pkg@^1.0.0',
          'ns.b': '@scope/pkg@^2.0.0',
        })
      ).toThrowError(
        'Package @scope/pkg has conflicting versions: ^1.0.0 vs ^2.0.0'
      );
    });

    it('throws MountValidationError when version conflicts with no-version mount', () => {
      expect(() =>
        resolveMounts({
          'ns.a': '@scope/pkg',
          'ns.b': '@scope/pkg@^1.0.0',
        })
      ).toThrowError(MountValidationError);
    });
  });
});

// ============================================================
// detectNamespaceCollisions
// ============================================================

describe('detectNamespaceCollisions', () => {
  describe('no collision cases', () => {
    it('does not throw when all manifests use unique namespaces from different packages', () => {
      const mounts = resolveMounts({
        'ns.storage': '@scope/storage',
        'ns.logging': '@scope/logging',
      });
      const manifests = makeManifestMap([
        ['ns.storage', 'ns.storage'],
        ['ns.logging', 'ns.logging'],
      ]);
      expect(() => detectNamespaceCollisions(manifests, mounts)).not.toThrow();
    });

    it('allows same package to have prefix overlap across its own mount paths', () => {
      // Same-package prefix overlap is allowed per spec
      const mounts = resolveMounts({
        'ns.storage': '@scope/pkg@^1.0.0',
        'ns.storage.cache': '@scope/pkg@^1.0.0',
      });
      const manifests = makeManifestMap([
        ['ns.storage', 'ns.storage'],
        ['ns.storage.cache', 'ns.storage.cache'],
      ]);
      expect(() => detectNamespaceCollisions(manifests, mounts)).not.toThrow();
    });

    it('does not throw for a single manifest', () => {
      const mounts = resolveMounts({ storage: '@scope/pkg' });
      const manifests = makeManifestMap([['storage', 'storage']]);
      expect(() => detectNamespaceCollisions(manifests, mounts)).not.toThrow();
    });

    it('does not throw for an empty manifest map', () => {
      const mounts: ResolvedMount[] = [];
      const manifests: ReadonlyMap<string, ExtensionManifest> = new Map();
      expect(() => detectNamespaceCollisions(manifests, mounts)).not.toThrow();
    });
  });

  describe('collision cases', () => {
    it('throws NamespaceCollisionError when two different packages declare the same namespace', () => {
      // AC-11: cross-package same-namespace collision
      const mounts = resolveMounts({
        'storage.a': '@scope/pkg-a',
        'storage.b': '@scope/pkg-b',
      });
      const manifests = makeManifestMap([
        ['storage.a', 'shared.namespace'],
        ['storage.b', 'shared.namespace'],
      ]);
      expect(() => detectNamespaceCollisions(manifests, mounts)).toThrowError(
        NamespaceCollisionError
      );
      expect(() => detectNamespaceCollisions(manifests, mounts)).toThrowError(
        'Namespace shared.namespace declared by @scope/pkg-a and @scope/pkg-b'
      );
    });

    it('throws NamespaceCollisionError when mount paths from different packages have prefix overlap', () => {
      // AC-11: cross-package prefix overlap
      const mounts = resolveMounts({
        ns: '@scope/pkg-a',
        'ns.sub': '@scope/pkg-b',
      });
      const manifests = makeManifestMap([
        ['ns', 'ns'],
        ['ns.sub', 'ns.sub'],
      ]);
      expect(() => detectNamespaceCollisions(manifests, mounts)).toThrowError(
        NamespaceCollisionError
      );
      expect(() => detectNamespaceCollisions(manifests, mounts)).toThrowError(
        'ns (@scope/pkg-a) is prefix of ns.sub (@scope/pkg-b)'
      );
    });
  });

  describe('performance', () => {
    it('completes for 100 extensions in under 50ms', () => {
      // AC-24: performance threshold for 100 extensions
      const mountsRecord: Record<string, string> = {};
      for (let i = 0; i < 100; i++) {
        mountsRecord[`ext${i}`] = `@scope/pkg-${i}`;
      }
      const mounts = resolveMounts(mountsRecord);
      const entries: Array<[string, string]> = mounts.map((m) => [
        m.mountPath,
        m.mountPath,
      ]);
      const manifests = makeManifestMap(entries);

      const start = performance.now();
      detectNamespaceCollisions(manifests, mounts);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(50);
    });
  });
});
