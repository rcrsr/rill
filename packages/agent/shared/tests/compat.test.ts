/**
 * Tests for checkTargetCompatibility() — worker target native deps and built-in detection.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { checkTargetCompatibility } from '../src/compat.js';
import { ComposeError } from '../src/errors.js';
import type { ResolvedExtension } from '../src/resolve.js';
import type { BuildTarget } from '../src/schema.js';

// ============================================================
// TEST SETUP
// ============================================================

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const SHARED_DIR = join(THIS_DIR, '..');

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'compat-test-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ============================================================
// HELPERS
// ============================================================

/**
 * Creates a minimal ResolvedExtension with local strategy.
 * Sets factory.__source so resolvePackageDir() can derive the package dir.
 */
function makeLocalExtension(
  namespace: string,
  entryFilePath: string
): ResolvedExtension {
  const factory = function factory() {
    return {};
  } as unknown as ResolvedExtension['factory'];
  (factory as unknown as Record<string, unknown>)['__source'] = entryFilePath;

  return {
    alias: namespace,
    namespace,
    strategy: 'local',
    factory,
    config: {},
  };
}

/**
 * Creates a minimal ResolvedExtension with npm strategy.
 */
function makeNpmExtension(namespace: string): ResolvedExtension {
  const factory = function factory() {
    return {};
  } as unknown as ResolvedExtension['factory'];

  return {
    alias: namespace,
    namespace,
    strategy: 'npm',
    factory,
    config: {},
  };
}

/**
 * Creates a minimal ResolvedExtension with builtin strategy.
 */
function makeBuiltinExtension(namespace: string): ResolvedExtension {
  const factory = function factory() {
    return {};
  } as unknown as ResolvedExtension['factory'];

  return {
    alias: namespace,
    namespace,
    strategy: 'builtin',
    factory,
    config: {},
  };
}

/**
 * Writes a JS entry file that imports a Node.js built-in module.
 * Returns the absolute file path.
 */
function writeBuiltinImportFile(
  dir: string,
  filename: string,
  builtinModule: string
): string {
  const filePath = join(dir, filename);
  writeFileSync(
    filePath,
    `import mod from '${builtinModule}';\nexport default mod;\n`
  );
  return filePath;
}

/**
 * Creates a fake npm package in packages/agent/shared/node_modules/<name>/.
 * Returns the package directory path and a cleanup function.
 */
function createFakeNpmPackage(
  name: string,
  options: {
    entryContent?: string;
    hasBindingGyp?: boolean;
    gypfile?: boolean;
    nodeGypRebuild?: boolean;
  } = {}
): { packageDir: string; cleanup: () => void } {
  const packageDir = join(SHARED_DIR, 'node_modules', name);
  mkdirSync(packageDir, { recursive: true });

  const pkgJson: Record<string, unknown> = {
    name,
    version: '1.0.0',
    type: 'module',
    main: 'index.js',
  };

  if (options.gypfile) {
    pkgJson['gypfile'] = true;
  }
  if (options.nodeGypRebuild) {
    pkgJson['scripts'] = { install: 'node-gyp rebuild' };
  }

  writeFileSync(join(packageDir, 'package.json'), JSON.stringify(pkgJson));

  if (options.hasBindingGyp) {
    writeFileSync(join(packageDir, 'binding.gyp'), '{}');
  }

  const entryContent =
    options.entryContent ??
    'export default function factory() { return {}; }\n';
  writeFileSync(join(packageDir, 'index.js'), entryContent);

  return {
    packageDir,
    cleanup: () => rmSync(packageDir, { recursive: true, force: true }),
  };
}

// ============================================================
// EMPTY EXTENSIONS
// ============================================================

describe('checkTargetCompatibility', () => {
  describe('empty extensions array', () => {
    it('passes without error for empty array on worker target', async () => {
      await expect(
        checkTargetCompatibility([], 'worker')
      ).resolves.toBeUndefined();
    });

    it('passes without error for empty array on non-worker target', async () => {
      await expect(
        checkTargetCompatibility([], 'container')
      ).resolves.toBeUndefined();
    });
  });

  // ============================================================
  // NON-WORKER TARGETS SKIP ALL CHECKS
  // ============================================================

  describe('non-worker targets skip all checks', () => {
    const nonWorkerTargets: BuildTarget[] = ['container', 'lambda', 'local'];

    for (const target of nonWorkerTargets) {
      it(`skips compatibility checks for target: ${target}`, async () => {
        // Create a local extension pointing to a file that imports node:fs.
        // On worker target this would throw EC-21, but non-worker skips.
        const entryFile = writeBuiltinImportFile(testDir, 'ext.js', 'node:fs');
        const ext = makeLocalExtension('testExt', entryFile);

        await expect(
          checkTargetCompatibility([ext], target)
        ).resolves.toBeUndefined();
      });
    }
  });

  // ============================================================
  // EC-20: NATIVE ADDON DETECTION [AC-16]
  // ============================================================

  describe('EC-20: native deps incompatible with worker target [AC-16]', () => {
    it('throws ComposeError for npm extension with binding.gyp', async () => {
      const { cleanup } = createFakeNpmPackage('rill-test-native-binding', {
        hasBindingGyp: true,
      });

      try {
        const ext = makeNpmExtension('rill-test-native-binding');

        await expect(checkTargetCompatibility([ext], 'worker')).rejects.toThrow(
          'Extension rill-test-native-binding has native deps; incompatible with worker target'
        );
      } finally {
        cleanup();
      }
    });

    it('throws ComposeError instance for native addon', async () => {
      const { cleanup } = createFakeNpmPackage('rill-test-native-gypfile', {
        gypfile: true,
      });

      try {
        const ext = makeNpmExtension('rill-test-native-gypfile');

        await expect(
          checkTargetCompatibility([ext], 'worker')
        ).rejects.toBeInstanceOf(ComposeError);
      } finally {
        cleanup();
      }
    });

    it('throws ComposeError with phase compatibility for native addon', async () => {
      const { cleanup } = createFakeNpmPackage('rill-test-native-gyp-phase', {
        hasBindingGyp: true,
      });

      try {
        const ext = makeNpmExtension('rill-test-native-gyp-phase');

        const error = await checkTargetCompatibility([ext], 'worker').catch(
          (e: unknown) => e
        );

        expect(error).toBeInstanceOf(ComposeError);
        expect((error as ComposeError).phase).toBe('compatibility');
      } finally {
        cleanup();
      }
    });

    it('throws ComposeError for npm extension with node-gyp rebuild in scripts', async () => {
      const { cleanup } = createFakeNpmPackage('rill-test-native-scripts', {
        nodeGypRebuild: true,
      });

      try {
        const ext = makeNpmExtension('rill-test-native-scripts');

        await expect(
          checkTargetCompatibility([ext], 'worker')
        ).rejects.toMatchObject({
          message:
            'Extension rill-test-native-scripts has native deps; incompatible with worker target',
          phase: 'compatibility',
        });
      } finally {
        cleanup();
      }
    });
  });

  // ============================================================
  // EC-21: RESTRICTED BUILT-IN DETECTION [AC-17]
  // ============================================================

  describe('EC-21: restricted Node.js built-in incompatible with worker target [AC-17]', () => {
    it('throws ComposeError for local extension importing node:fs', async () => {
      const entryFile = writeBuiltinImportFile(testDir, 'ext-fs.js', 'node:fs');
      const ext = makeLocalExtension('fsExt', entryFile);

      await expect(checkTargetCompatibility([ext], 'worker')).rejects.toThrow(
        'Extension fsExt uses Node.js API fs; incompatible with worker target'
      );
    });

    it('throws ComposeError instance for restricted built-in', async () => {
      const entryFile = writeBuiltinImportFile(
        testDir,
        'ext-path.js',
        'node:path'
      );
      const ext = makeLocalExtension('pathExt', entryFile);

      await expect(
        checkTargetCompatibility([ext], 'worker')
      ).rejects.toBeInstanceOf(ComposeError);
    });

    it('throws ComposeError with phase compatibility for restricted built-in', async () => {
      const entryFile = writeBuiltinImportFile(
        testDir,
        'ext-net.js',
        'node:net'
      );
      const ext = makeLocalExtension('netExt', entryFile);

      const error = await checkTargetCompatibility([ext], 'worker').catch(
        (e: unknown) => e
      );

      expect(error).toBeInstanceOf(ComposeError);
      expect((error as ComposeError).phase).toBe('compatibility');
    });

    it('throws exact EC-21 message for node:path import', async () => {
      const entryFile = writeBuiltinImportFile(
        testDir,
        'ext-path2.js',
        'node:path'
      );
      const ext = makeLocalExtension('myPathExt', entryFile);

      await expect(
        checkTargetCompatibility([ext], 'worker')
      ).rejects.toMatchObject({
        message:
          'Extension myPathExt uses Node.js API path; incompatible with worker target',
        phase: 'compatibility',
      });
    });

    it('throws for bare fs import (no node: prefix, external)', async () => {
      // esbuild marks bare built-in imports as external with no node: prefix.
      // The isNodeBuiltin check handles this case via external === true.
      const entryFile = join(testDir, 'ext-bare-fs.js');
      writeFileSync(entryFile, `import fs from 'fs';\nexport default fs;\n`);
      const ext = makeLocalExtension('bareFsExt', entryFile);

      await expect(
        checkTargetCompatibility([ext], 'worker')
      ).rejects.toMatchObject({
        message: expect.stringContaining('uses Node.js API fs'),
        phase: 'compatibility',
      });
    });
  });

  // ============================================================
  // node:crypto WARNING (partial support)
  // ============================================================

  describe('node:crypto — warning only, no error', () => {
    it('does not throw for local extension importing node:crypto', async () => {
      const entryFile = writeBuiltinImportFile(
        testDir,
        'ext-crypto.js',
        'node:crypto'
      );
      const ext = makeLocalExtension('cryptoExt', entryFile);

      await expect(
        checkTargetCompatibility([ext], 'worker')
      ).resolves.toBeUndefined();
    });

    it('writes partial-support warning to stderr for node:crypto', async () => {
      const stderrSpy = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      try {
        const entryFile = writeBuiltinImportFile(
          testDir,
          'ext-crypto-warn.js',
          'node:crypto'
        );
        const ext = makeLocalExtension('cryptoWarnExt', entryFile);

        await checkTargetCompatibility([ext], 'worker');

        expect(stderrSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            'Warning: cryptoWarnExt uses node:crypto; only partial support on Cloudflare Workers'
          )
        );
      } finally {
        stderrSpy.mockRestore();
      }
    });
  });

  // ============================================================
  // WARNING-ONLY BUILT-INS (os, child_process, etc.)
  // ============================================================

  describe('warning-only built-ins — no error, warning printed', () => {
    it('does not throw for local extension importing node:os', async () => {
      const entryFile = writeBuiltinImportFile(testDir, 'ext-os.js', 'node:os');
      const ext = makeLocalExtension('osExt', entryFile);

      await expect(
        checkTargetCompatibility([ext], 'worker')
      ).resolves.toBeUndefined();
    });

    it('writes non-functional stub warning to stderr for node:os', async () => {
      const stderrSpy = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      try {
        const entryFile = writeBuiltinImportFile(
          testDir,
          'ext-os-warn.js',
          'node:os'
        );
        const ext = makeLocalExtension('osWarnExt', entryFile);

        await checkTargetCompatibility([ext], 'worker');

        expect(stderrSpy).toHaveBeenCalledWith(
          'Warning: osWarnExt uses os; Cloudflare Workers provides non-functional stub\n'
        );
      } finally {
        stderrSpy.mockRestore();
      }
    });

    it('does not throw for local extension importing node:vm', async () => {
      const entryFile = writeBuiltinImportFile(testDir, 'ext-vm.js', 'node:vm');
      const ext = makeLocalExtension('vmExt', entryFile);

      await expect(
        checkTargetCompatibility([ext], 'worker')
      ).resolves.toBeUndefined();
    });

    it('writes non-functional stub warning to stderr for node:vm', async () => {
      const stderrSpy = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      try {
        const entryFile = writeBuiltinImportFile(
          testDir,
          'ext-vm-warn.js',
          'node:vm'
        );
        const ext = makeLocalExtension('vmWarnExt', entryFile);

        await checkTargetCompatibility([ext], 'worker');

        expect(stderrSpy).toHaveBeenCalledWith(
          'Warning: vmWarnExt uses vm; Cloudflare Workers provides non-functional stub\n'
        );
      } finally {
        stderrSpy.mockRestore();
      }
    });
  });

  // ============================================================
  // findNpmPackageDir: NESTED WORKSPACE WALK
  // ============================================================

  describe('findNpmPackageDir walks up directory tree for nested workspaces', () => {
    it('resolves npm package installed 2 levels above cwd', async () => {
      // Simulate a cwd that is 2 levels deep inside a temp directory, with
      // node_modules at the top level. The upward walk finds it at cwd/../..
      const pkgName = 'rill-test-nested-pkg';
      const rootDir = mkdtempSync(join(tmpdir(), 'nested-walk-'));

      try {
        // Create nested cwd: rootDir/workspace/project/
        const nestedCwd = join(rootDir, 'workspace', 'project');
        mkdirSync(nestedCwd, { recursive: true });

        // Install fake package at rootDir/node_modules/<pkgName>/
        const pkgDir = join(rootDir, 'node_modules', pkgName);
        mkdirSync(pkgDir, { recursive: true });
        writeFileSync(
          join(pkgDir, 'package.json'),
          JSON.stringify({ name: pkgName, version: '1.0.0', main: 'index.js' })
        );
        writeFileSync(
          join(pkgDir, 'index.js'),
          'export default function factory() { return {}; }\n'
        );

        // Point process.cwd() at the deeply-nested directory
        const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(nestedCwd);

        try {
          const ext = makeNpmExtension(pkgName);
          // Should resolve without error — upward walk reaches rootDir/node_modules
          await expect(
            checkTargetCompatibility([ext], 'worker')
          ).resolves.toBeUndefined();
        } finally {
          cwdSpy.mockRestore();
        }
      } finally {
        rmSync(rootDir, { recursive: true, force: true });
      }
    });
  });

  // ============================================================
  // BUILTIN STRATEGY SKIPPED
  // ============================================================

  describe('builtin strategy extensions skipped', () => {
    it('does not check built-in strategy extensions on worker target', async () => {
      const ext = makeBuiltinExtension('rill-builtin-ext');

      await expect(
        checkTargetCompatibility([ext], 'worker')
      ).resolves.toBeUndefined();
    });
  });
});
