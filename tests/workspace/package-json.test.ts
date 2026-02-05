/**
 * Workspace Configuration: Root package.json validation
 *
 * Ensures root package.json conforms to monorepo workspace requirements:
 * - IR-6: Workspace configuration structure
 * - IC-2: Root package.json modifications
 * - EC-4: Accidental publish prevention
 * - EC-5: Valid workspace protocol
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Root package.json', () => {
  const packageJsonPath = join(process.cwd(), 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

  describe('IR-6: Workspace Configuration', () => {
    it('has "private": true to prevent accidental publish', () => {
      expect(packageJson.private).toBe(true);
    });

    it('specifies packageManager as pnpm@10.x.x', () => {
      expect(packageJson.packageManager).toBeDefined();
      expect(packageJson.packageManager).toMatch(/^pnpm@10\.\d+\.\d+$/);
    });

    it('has executable build script (no -r recursion)', () => {
      expect(packageJson.scripts.build).toBeDefined();
      expect(packageJson.scripts.build).not.toContain('-r');
    });

    it('has executable test script (no -r recursion)', () => {
      expect(packageJson.scripts.test).toBeDefined();
      expect(packageJson.scripts.test).not.toContain('-r');
    });

    it('has executable typecheck script (no -r recursion)', () => {
      expect(packageJson.scripts.typecheck).toBeDefined();
      expect(packageJson.scripts.typecheck).not.toContain('-r');
    });

    it('has executable lint script (no -r recursion)', () => {
      expect(packageJson.scripts.lint).toBeDefined();
      expect(packageJson.scripts.lint).not.toContain('-r');
    });

    it('has composite check script that runs all checks', () => {
      expect(packageJson.scripts.check).toBeDefined();
      expect(packageJson.scripts.check).toContain('build');
      expect(packageJson.scripts.check).toContain('test');
      expect(packageJson.scripts.check).toContain('typecheck');
      expect(packageJson.scripts.check).toContain('lint');
    });

    it('has test:examples script', () => {
      expect(packageJson.scripts['test:examples']).toBeDefined();
    });
  });

  describe('IC-2: Root package.json modifications', () => {
    it('removes bin field (moved to core package)', () => {
      expect(packageJson.bin).toBeUndefined();
    });

    it('removes main field (moved to core package)', () => {
      expect(packageJson.main).toBeUndefined();
    });

    it('removes types field (moved to core package)', () => {
      expect(packageJson.types).toBeUndefined();
    });

    it('removes exports field (moved to core package)', () => {
      expect(packageJson.exports).toBeUndefined();
    });

    it('preserves devDependencies at root for shared tooling', () => {
      expect(packageJson.devDependencies).toBeDefined();
      expect(Object.keys(packageJson.devDependencies).length).toBeGreaterThan(
        0
      );
    });
  });

  describe('EC-4: Accidental publish prevention', () => {
    it('blocks npm publish with private flag', () => {
      // npm will refuse to publish if private is true
      expect(packageJson.private).toBe(true);
    });
  });

  describe('EC-5: Valid workspace protocol', () => {
    it('has valid package manager specification', () => {
      expect(packageJson.packageManager).toBeTruthy();
      // pnpm install will validate the packageManager field
      // This test ensures the field exists and has the correct format
      expect(packageJson.packageManager).toMatch(/^pnpm@/);
    });

    it('maintains type: module for ESM compatibility', () => {
      expect(packageJson.type).toBe('module');
    });
  });

  describe('Metadata preservation', () => {
    it('preserves repository information', () => {
      expect(packageJson.repository).toBeDefined();
      expect(packageJson.repository.type).toBe('git');
    });

    it('preserves package name', () => {
      expect(packageJson.name).toBe('@rcrsr/rill');
    });

    it('preserves version', () => {
      expect(packageJson.version).toBeDefined();
    });

    it('preserves author', () => {
      expect(packageJson.author).toBeDefined();
    });

    it('preserves license', () => {
      expect(packageJson.license).toBe('MIT');
    });

    it('preserves engine requirements', () => {
      expect(packageJson.engines).toBeDefined();
      expect(packageJson.engines.node).toBeDefined();
    });
  });
});
