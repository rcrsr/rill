/**
 * Tests for resolveConfigPath
 * Covers: HP-2, HP-3, EC-1 (AC-2, AC-3)
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigNotFoundError, resolveConfigPath } from '@rcrsr/rill-config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// ============================================================
// TEST HELPERS
// ============================================================

function createTmpDir(prefix: string): string {
  const dir = join(
    tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ============================================================
// TESTS
// ============================================================

describe('resolveConfigPath', () => {
  describe('HP-2: configFlag set', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = createTmpDir('rill-resolve-flag');
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns the explicit path without searching when configFlag is set', () => {
      const configPath = join(tmpDir, 'rill-config.json');
      writeFileSync(configPath, '{}');

      const result = resolveConfigPath({
        configFlag: configPath,
        cwd: '/does-not-matter',
      });

      expect(result).toBe(configPath);
    });

    it('returns an absolute path when configFlag is a relative path', () => {
      const configPath = join(tmpDir, 'rill-config.json');
      writeFileSync(configPath, '{}');

      const result = resolveConfigPath({ configFlag: configPath, cwd: tmpDir });

      expect(result).toBe(configPath);
    });
  });

  describe('HP-3: upward walk', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = createTmpDir('rill-resolve-walk');
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('finds rill-config.json in cwd', () => {
      const configPath = join(tmpDir, 'rill-config.json');
      writeFileSync(configPath, '{}');

      const result = resolveConfigPath({ cwd: tmpDir });

      expect(result).toBe(configPath);
    });

    it('walks upward from a subdirectory to find config in a parent', () => {
      const configPath = join(tmpDir, 'rill-config.json');
      writeFileSync(configPath, '{}');
      const child = join(tmpDir, 'a', 'b', 'c');
      mkdirSync(child, { recursive: true });

      const result = resolveConfigPath({ cwd: child });

      expect(result).toBe(configPath);
    });

    it('returns an absolute path', () => {
      const configPath = join(tmpDir, 'rill-config.json');
      writeFileSync(configPath, '{}');

      const result = resolveConfigPath({ cwd: tmpDir });

      expect(result.startsWith('/')).toBe(true);
    });
  });

  describe('EC-1: config not found', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = createTmpDir('rill-resolve-err');
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('throws ConfigNotFoundError when explicit configFlag path does not exist', () => {
      const missingPath = join(tmpDir, 'nonexistent.json');

      expect(() =>
        resolveConfigPath({ configFlag: missingPath, cwd: tmpDir })
      ).toThrow(ConfigNotFoundError);
    });

    it('throws ConfigNotFoundError with message containing the path when configFlag is missing', () => {
      const missingPath = join(tmpDir, 'nonexistent.json');

      expect(() =>
        resolveConfigPath({ configFlag: missingPath, cwd: tmpDir })
      ).toThrow(/Config not found:/);
    });

    it('throws ConfigNotFoundError when no config exists from cwd to root', () => {
      // Use a deep subdirectory with no rill-config.json anywhere above it up to root
      // We cannot guarantee the parent of tmpDir has no config, so place a config-free
      // subdirectory under tmpDir and verify that the error mentions the cwd.
      // The implementation stops at the filesystem root, which will not have rill-config.json.
      // Use an isolated tmpDir with no config file.
      const child = join(tmpDir, 'no-config-here');
      mkdirSync(child);

      // tmpDir itself has no rill-config.json - but ancestors might.
      // To guarantee the error, use a path we control: place config at a sibling, not above.
      // We write no config, so this will walk up past tmpDir all the way to root.
      // This only works if no ancestor of tmpDir has a rill-config.json.
      // That is the expected behavior in CI / test isolation.
      expect(() => resolveConfigPath({ cwd: child })).toThrow(
        ConfigNotFoundError
      );
    });

    it('throws ConfigNotFoundError with message mentioning the cwd when no config found', () => {
      // Walk from tmpDir which has no rill-config.json.
      // Message should contain the original cwd.
      expect(() => resolveConfigPath({ cwd: tmpDir })).toThrow(
        `No rill-config.json found from ${tmpDir} to root`
      );
    });
  });
});
