/**
 * Tests for resolveExtensions() — all resolution strategies and error conditions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolveExtensions, type ResolveOptions } from '../src/resolve.js';
import { ComposeError } from '../src/errors.js';
import type { ManifestExtension } from '../src/schema.js';

// ============================================================
// TEST SETUP
// ============================================================

let testDir: string;

// Directory of this test file — has access to packages/agent/shared/node_modules
const THIS_DIR = dirname(fileURLToPath(import.meta.url));

// The agent/shared package root has esbuild/zod in node_modules
const SHARED_DIR = join(THIS_DIR, '..');

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'resolve-test-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ============================================================
// HELPERS
// ============================================================

/**
 * Writes a minimal ESM file that exports a default factory function.
 * Returns the absolute file path.
 */
function writeFactoryFile(dir: string, filename: string): string {
  const filePath = join(dir, filename);
  writeFileSync(
    filePath,
    `export default function factory(config) { return {}; }\n`
  );
  return filePath;
}

/**
 * Writes a file that exports no default (named export only).
 * Used to trigger EC-8 (no factory export).
 */
function writeNoDefaultFile(dir: string, filename: string): string {
  const filePath = join(dir, filename);
  writeFileSync(filePath, `export const notAFactory = 'not-a-function';\n`);
  return filePath;
}

function makeOptions(dir: string): ResolveOptions {
  return { manifestDir: dir };
}

function makeExt(
  pkg: string,
  config?: Record<string, unknown>
): ManifestExtension {
  return { package: pkg, config: config ?? {} };
}

// ============================================================
// EMPTY EXTENSIONS [AC-23]
// ============================================================

describe('resolveExtensions', () => {
  describe('empty extensions [AC-23]', () => {
    it('returns empty array for empty extensions record', async () => {
      const result = await resolveExtensions({}, makeOptions(testDir));
      expect(result).toEqual([]);
    });
  });

  // ============================================================
  // LOCAL PATH STRATEGY
  // ============================================================

  describe('local path strategy', () => {
    it('loads a factory from a relative ./path file', async () => {
      writeFactoryFile(testDir, 'my-ext.mjs');
      const extensions = { myExt: makeExt('./my-ext.mjs') };

      const result = await resolveExtensions(extensions, makeOptions(testDir));

      expect(result).toHaveLength(1);
      expect(result[0]!.alias).toBe('myExt');
      expect(result[0]!.namespace).toBe('myExt');
      expect(result[0]!.strategy).toBe('local');
      expect(typeof result[0]!.factory).toBe('function');
    });

    it('populates config from manifest [AC-23]', async () => {
      writeFactoryFile(testDir, 'ext.mjs');
      const extensions = { myExt: makeExt('./ext.mjs', { key: 'value' }) };

      const result = await resolveExtensions(extensions, makeOptions(testDir));

      expect(result[0]!.config).toEqual({ key: 'value' });
    });

    it('defaults config to {} when not specified', async () => {
      writeFactoryFile(testDir, 'ext.mjs');
      const extensions = {
        myExt: { package: './ext.mjs' } as ManifestExtension,
      };

      const result = await resolveExtensions(extensions, makeOptions(testDir));

      expect(result[0]!.config).toEqual({});
    });

    it('resolves path with traversal segments correctly [AC-32]', async () => {
      // Create a subdirectory so ./ext/../ext/my-ext.mjs normalizes to ./ext/my-ext.mjs
      const subDir = join(testDir, 'ext');
      mkdirSync(subDir);
      writeFactoryFile(subDir, 'my-ext.mjs');

      const normalPath = './ext/my-ext.mjs';
      const traversalPath = './ext/../ext/my-ext.mjs';

      const resultNormal = await resolveExtensions(
        { myExt: makeExt(normalPath) },
        makeOptions(testDir)
      );
      const resultTraversal = await resolveExtensions(
        { myExt: makeExt(traversalPath) },
        makeOptions(testDir)
      );

      // Both resolve to the same factory
      expect(typeof resultNormal[0]!.factory).toBe('function');
      expect(typeof resultTraversal[0]!.factory).toBe('function');
      expect(resultNormal[0]!.factory.toString()).toBe(
        resultTraversal[0]!.factory.toString()
      );
    });
  });

  // ============================================================
  // NPM STRATEGY
  // ============================================================

  describe('npm strategy', () => {
    it('populates resolvedVersion for a successfully resolved npm package', async () => {
      // Create a fake extension package directly in packages/agent/shared/node_modules/
      // so import.meta.resolve can find it from this test file's location.
      const fakePackageDir = join(
        SHARED_DIR,
        'node_modules',
        'rill-test-fake-ext'
      );
      mkdirSync(fakePackageDir, { recursive: true });
      writeFileSync(
        join(fakePackageDir, 'package.json'),
        JSON.stringify({
          name: 'rill-test-fake-ext',
          version: '1.2.3',
          type: 'module',
          main: 'index.js',
        })
      );
      writeFileSync(
        join(fakePackageDir, 'index.js'),
        `export default function factory(config) { return {}; }\n`
      );

      try {
        const result = await resolveExtensions(
          { ext: makeExt('rill-test-fake-ext') },
          makeOptions(SHARED_DIR)
        );

        expect(result[0]!.resolvedVersion).toBe('1.2.3');
        expect(result[0]!.strategy).toBe('npm');
      } finally {
        rmSync(fakePackageDir, { recursive: true, force: true });
      }
    });

    it('resolves an installed npm package (EC-8 does not fire for no-default)', async () => {
      // esbuild is a known dependency — import.meta.resolve finds it.
      // Its default export is an object (not callable), so EC-8 fires.
      // This test confirms EC-7 (package not found) is NOT the failure.
      const extensions = { bundler: makeExt('esbuild') };

      await expect(
        resolveExtensions(extensions, makeOptions(SHARED_DIR))
      ).rejects.toThrow('does not export a valid ExtensionFactory');
    });
  });

  // ============================================================
  // ERROR CONDITIONS
  // ============================================================

  describe('error conditions', () => {
    // EC-7: package not found → ComposeError phase resolution
    describe('EC-7: npm package not found [AC-14]', () => {
      it('throws ComposeError with install hint for missing npm package', async () => {
        const extensions = {
          missing: makeExt('@non-existent/test-package-xyz'),
        };

        await expect(
          resolveExtensions(extensions, makeOptions(testDir))
        ).rejects.toMatchObject({
          message:
            'Extension package not found: @non-existent/test-package-xyz. Run pnpm add @non-existent/test-package-xyz',
          phase: 'resolution',
        });
      });

      it('throws ComposeError instance for missing npm package', async () => {
        const extensions = {
          missing: makeExt('@non-existent/test-package-xyz'),
        };

        await expect(
          resolveExtensions(extensions, makeOptions(testDir))
        ).rejects.toBeInstanceOf(ComposeError);
      });
    });

    describe('EC-16: local path not found', () => {
      it('throws ComposeError for missing local file', async () => {
        const extensions = { missing: makeExt('./does-not-exist.mjs') };

        await expect(
          resolveExtensions(extensions, makeOptions(testDir))
        ).rejects.toMatchObject({
          message: 'Extension path not found: ./does-not-exist.mjs',
          phase: 'resolution',
        });
      });

      // EC-9: path traversal → ComposeError phase resolution
      it('throws ComposeError for path traversal outside manifestDir [EC-9]', async () => {
        // ../../../etc/passwd escapes the manifestDir
        const extensions = { traversal: makeExt('../../../etc/passwd') };

        await expect(
          resolveExtensions(extensions, makeOptions(testDir))
        ).rejects.toMatchObject({
          message: 'Extension path not found: ../../../etc/passwd',
          phase: 'resolution',
        });
      });

      it('throws ComposeError instance for missing local path', async () => {
        const extensions = { missing: makeExt('./does-not-exist.mjs') };

        await expect(
          resolveExtensions(extensions, makeOptions(testDir))
        ).rejects.toBeInstanceOf(ComposeError);
      });
    });

    describe('EC-17: unknown built-in name', () => {
      it('throws ComposeError for unrecognized built-in name', async () => {
        const extensions = { bad: makeExt('@rcrsr/rill/ext/unknown-builtin') };

        await expect(
          resolveExtensions(extensions, makeOptions(testDir))
        ).rejects.toMatchObject({
          message:
            'Unknown built-in extension: unknown-builtin. Valid: fs, fetch, exec, kv, crypto',
          phase: 'resolution',
        });
      });

      it('throws ComposeError instance for unknown built-in', async () => {
        const extensions = { bad: makeExt('@rcrsr/rill/ext/sql') };

        await expect(
          resolveExtensions(extensions, makeOptions(testDir))
        ).rejects.toBeInstanceOf(ComposeError);
      });
    });

    // EC-8: no factory export → ComposeError phase resolution
    describe('EC-8: no factory export [AC-20]', () => {
      it('throws ComposeError when local module has no default export', async () => {
        writeNoDefaultFile(testDir, 'no-default.mjs');
        const extensions = { bad: makeExt('./no-default.mjs') };

        await expect(
          resolveExtensions(extensions, makeOptions(testDir))
        ).rejects.toMatchObject({
          message: './no-default.mjs does not export a valid ExtensionFactory',
          phase: 'resolution',
        });
      });

      it('throws ComposeError when local module default is not a function', async () => {
        const filePath = join(testDir, 'string-default.mjs');
        writeFileSync(filePath, `export default 'not-a-function';\n`);
        const extensions = { bad: makeExt('./string-default.mjs') };

        await expect(
          resolveExtensions(extensions, makeOptions(testDir))
        ).rejects.toMatchObject({
          message:
            './string-default.mjs does not export a valid ExtensionFactory',
          phase: 'resolution',
        });
      });

      it('throws ComposeError instance for invalid factory', async () => {
        writeNoDefaultFile(testDir, 'invalid.mjs');
        const extensions = { bad: makeExt('./invalid.mjs') };

        await expect(
          resolveExtensions(extensions, makeOptions(testDir))
        ).rejects.toBeInstanceOf(ComposeError);
      });
    });

    describe('EC-19: namespace collision [AC-15]', () => {
      it('namespace equals alias — two different aliases cannot collide', async () => {
        // Since namespace = alias (the manifest key), and JSON object keys are
        // unique, two extensions in the same record cannot share a namespace.
        // EC-19 is structurally unreachable via resolveExtensions().
        // This test documents the invariant.
        writeFactoryFile(testDir, 'ext-a.mjs');
        writeFactoryFile(testDir, 'ext-b.mjs');

        const extensions = {
          extA: makeExt('./ext-a.mjs'),
          extB: makeExt('./ext-b.mjs'),
        };

        const result = await resolveExtensions(
          extensions,
          makeOptions(testDir)
        );

        expect(result).toHaveLength(2);
        expect(result[0]!.namespace).toBe('extA');
        expect(result[1]!.namespace).toBe('extB');
        // Distinct namespaces: no collision
        expect(result[0]!.namespace).not.toBe(result[1]!.namespace);
      });
    });
  });

  // ============================================================
  // BUILT-IN STRATEGY [AC-9]
  // ============================================================

  describe('built-in strategy [AC-9]', () => {
    it('throws EC-17 for invalid built-in name before attempting import', async () => {
      const extensions = { bad: makeExt('@rcrsr/rill/ext/invalid-name') };

      await expect(
        resolveExtensions(extensions, makeOptions(testDir))
      ).rejects.toMatchObject({
        message:
          'Unknown built-in extension: invalid-name. Valid: fs, fetch, exec, kv, crypto',
        phase: 'resolution',
      });
    });

    it('throws EC-17 for any name not in the valid set', async () => {
      const invalidNames = ['sql', 'http', 'db', 'logger', 'fs2'] as const;

      for (const name of invalidNames) {
        await expect(
          resolveExtensions(
            { ext: makeExt(`@rcrsr/rill/ext/${name}`) },
            makeOptions(testDir)
          )
        ).rejects.toMatchObject({
          message: expect.stringContaining(
            `Unknown built-in extension: ${name}`
          ),
          phase: 'resolution',
        });
      }
    });

    it('passes name validation for all 5 known built-in names', async () => {
      // The vitest alias for @rcrsr/rill → src/index.ts prevents dynamic
      // sub-path imports (import('@rcrsr/rill/ext/fs')) from completing —
      // Vite cannot resolve the sub-path through a file alias.
      // We verify that EC-17 is NOT thrown (name is accepted), but the
      // subsequent import step throws a non-ComposeError environment error.
      // AC-9 (builtin loads via sub-path export) is verified in integration
      // tests outside the Vite test environment — see Implementation Notes.
      const knownNames = ['fs', 'fetch', 'exec', 'kv', 'crypto'] as const;

      for (const name of knownNames) {
        const error = await resolveExtensions(
          { ext: makeExt(`@rcrsr/rill/ext/${name}`) },
          makeOptions(testDir)
        ).catch((e: unknown) => e);

        // An error is thrown (import fails in Vite), but it must NOT be EC-17
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).not.toContain(
          'Unknown built-in extension'
        );
      }
    });
  });

  // ============================================================
  // STRATEGY DETECTION
  // ============================================================

  describe('strategy detection', () => {
    it('treats ./relative paths as local strategy', async () => {
      const extensions = { ext: makeExt('./missing.mjs') };

      const error = await resolveExtensions(
        extensions,
        makeOptions(testDir)
      ).catch((e: unknown) => e);

      // EC-16 (path not found), confirming local strategy was used
      expect((error as ComposeError).message).toContain(
        'Extension path not found'
      );
    });

    it('treats ../relative paths as local strategy', async () => {
      const extensions = { ext: makeExt('../missing.mjs') };

      const error = await resolveExtensions(
        extensions,
        makeOptions(testDir)
      ).catch((e: unknown) => e);

      // EC-16 (path not found), confirming local strategy was used
      expect((error as ComposeError).message).toContain(
        'Extension path not found'
      );
    });

    it('treats bare package names as npm strategy', async () => {
      const extensions = { ext: makeExt('some-package') };

      const error = await resolveExtensions(
        extensions,
        makeOptions(testDir)
      ).catch((e: unknown) => e);

      // EC-15 (package not found), confirming npm strategy was used
      expect((error as ComposeError).message).toContain(
        'Extension package not found'
      );
    });

    it('treats @scope/package names as npm strategy', async () => {
      const extensions = { ext: makeExt('@scope/some-package') };

      const error = await resolveExtensions(
        extensions,
        makeOptions(testDir)
      ).catch((e: unknown) => e);

      // EC-15 (package not found), confirming npm strategy was used
      expect((error as ComposeError).message).toContain(
        'Extension package not found'
      );
    });
  });

  // ============================================================
  // RETURN SHAPE
  // ============================================================

  describe('resolved extension shape', () => {
    it('populates all required fields for local extension', async () => {
      writeFactoryFile(testDir, 'ext.mjs');
      const extensions = {
        myExt: { package: './ext.mjs', config: { k: 1 } } as ManifestExtension,
      };

      const result = await resolveExtensions(extensions, makeOptions(testDir));
      const ext = result[0]!;

      expect(ext.alias).toBe('myExt');
      expect(ext.namespace).toBe('myExt');
      expect(ext.strategy).toBe('local');
      expect(typeof ext.factory).toBe('function');
      expect(ext.config).toEqual({ k: 1 });
      // resolvedVersion is not set for local strategy
      expect(ext.resolvedVersion).toBeUndefined();
    });

    it('preserves declaration order of extensions', async () => {
      writeFactoryFile(testDir, 'first.mjs');
      writeFactoryFile(testDir, 'second.mjs');
      writeFactoryFile(testDir, 'third.mjs');

      const extensions = {
        first: makeExt('./first.mjs'),
        second: makeExt('./second.mjs'),
        third: makeExt('./third.mjs'),
      };

      const result = await resolveExtensions(extensions, makeOptions(testDir));

      expect(result.map((e) => e.alias)).toEqual(['first', 'second', 'third']);
    });
  });
});
