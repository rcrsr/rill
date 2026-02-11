/**
 * Release Script Integration Tests
 * Validates scripts/release.sh behavior and configuration
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SCRIPT_PATH = path.join(process.cwd(), 'scripts/release.sh');
const PACKAGES = ['packages/core', 'packages/cli', 'packages/ext/claude-code'];

describe('Release Script', () => {
  describe('IC-14: Script exists and is executable', () => {
    it('exists at scripts/release.sh', () => {
      expect(fs.existsSync(SCRIPT_PATH)).toBe(true);
    });

    it('is executable', () => {
      const stats = fs.statSync(SCRIPT_PATH);
      // Check if executable bit is set (any of user, group, or other)
      const isExecutable = (stats.mode & 0o111) !== 0;
      expect(isExecutable).toBe(true);
    });

    it('has bash shebang', () => {
      const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
      expect(content.startsWith('#!/bin/bash')).toBe(true);
    });

    it('uses set -e for error handling', () => {
      const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
      expect(content).toContain('set -e');
    });
  });

  describe('IC-14: Script builds all packages', () => {
    it('contains pnpm run -r build command', () => {
      const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
      expect(content).toContain('pnpm run -r build');
    });

    it('fails on build errors', () => {
      const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
      expect(content).toMatch(/pnpm run -r build.*\|\|.*error.*Build failed/s);
    });
  });

  describe('IC-14: Script runs tests before publish', () => {
    it('contains pnpm run -r test command', () => {
      const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
      expect(content).toContain('pnpm run -r test');
    });

    it('fails on test errors', () => {
      const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
      expect(content).toMatch(/pnpm run -r test.*\|\|.*error.*Tests failed/s);
    });

    it('runs tests after build', () => {
      const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
      const buildIndex = content.indexOf('pnpm run -r build');
      const testIndex = content.indexOf('pnpm run -r test');
      expect(testIndex).toBeGreaterThan(buildIndex);
    });
  });

  describe('IC-14, EC-7, AC-13: Script publishes with --access public', () => {
    it('contains pnpm publish --access public command', () => {
      const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
      expect(content).toContain('pnpm publish --access public');
    });

    it('verifies publishConfig.access exists before publishing', () => {
      const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
      expect(content).toContain('"access": "public"');
      expect(content).toMatch(/publishConfig\.access.*public/);
    });

    it('fails if package missing publishConfig.access', () => {
      const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
      expect(content).toMatch(
        /publishConfig\.access.*public.*error.*missing/is
      );
    });

    it('publishes after tests pass', () => {
      const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
      const testIndex = content.indexOf('pnpm run -r test');
      const publishIndex = content.indexOf('pnpm publish --access public');
      expect(publishIndex).toBeGreaterThan(testIndex);
    });
  });

  describe('IC-14, AC-9: Script creates git tags with rill@X.Y.Z convention', () => {
    it('creates tags for each package', () => {
      const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
      expect(content).toContain('git tag');
    });

    it('uses package_name@version format', () => {
      const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
      // TAG should be in format: PKG_NAME@VERSION
      expect(content).toMatch(/TAG=["']?\$\{PKG_NAME\}@\$\{VERSION\}/);
    });

    it('creates annotated tags with message', () => {
      const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
      expect(content).toMatch(/git tag -a.*-m/);
    });

    it('handles existing tags gracefully', () => {
      const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
      expect(content).toMatch(/tag.*already exists.*skipping/is);
    });

    it('creates tags after successful publish', () => {
      const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
      const publishIndex = content.indexOf('pnpm publish --access public');
      // Look for the actual tag creation command with -a flag
      const tagIndex = content.indexOf('git tag -a');
      expect(tagIndex).toBeGreaterThan(publishIndex);
    });
  });

  describe('EC-7: Publish validation', () => {
    it('validates publishConfig before attempting publish', () => {
      const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
      const validateIndex = content.indexOf('publishConfig.access');
      const publishIndex = content.indexOf('pnpm publish');
      expect(validateIndex).toBeGreaterThan(0);
      expect(publishIndex).toBeGreaterThan(validateIndex);
    });
  });

  describe('Package configuration', () => {
    it('all packages have publishConfig.access: "public"', () => {
      for (const pkgDir of PACKAGES) {
        const pkgJsonPath = path.join(process.cwd(), pkgDir, 'package.json');
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));

        expect(pkgJson.publishConfig).toBeDefined();
        expect(pkgJson.publishConfig.access).toBe('public');
      }
    });

    it('script includes all workspace packages', () => {
      const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');

      // Package directories in discovery loop (names resolved dynamically)
      expect(content).toContain('packages/core');
      expect(content).toContain('packages/cli');
      expect(content).toContain('packages/create-agent');
      expect(content).toContain('packages/ext/');
    });
  });

  describe('Version consistency', () => {
    it('lockstep packages share the same version', () => {
      const readVersion = (dir: string) =>
        JSON.parse(
          fs.readFileSync(
            path.join(process.cwd(), dir, 'package.json'),
            'utf-8'
          )
        ).version;

      const coreVersion = readVersion('packages/core');
      expect(readVersion('packages/cli')).toBe(coreVersion);
      expect(readVersion('packages/fiddle')).toBe(coreVersion);
    });
  });

  describe('Safety checks', () => {
    it('verifies clean working directory', () => {
      const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
      expect(content).toContain('git status --porcelain');
      expect(content).toMatch(/Working directory not clean/);
    });

    it('verifies project root', () => {
      const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
      expect(content).toContain('pnpm-workspace.yaml');
    });

    it('requires confirmation before publishing', () => {
      const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
      expect(content).toMatch(/read -p.*Proceed with publish/);
    });

    it('allows cancelling release', () => {
      const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');
      expect(content).toMatch(/Release cancelled/);
    });
  });
});
