/**
 * Rill Runtime Tests: Version API
 * Tests for runtime version constants VERSION and VERSION_INFO
 *
 * Specification Mapping (conduct/specifications/runtime-version.md):
 *
 * Acceptance Criteria:
 * - AC-1: VERSION equals package.json version
 * - AC-2: VERSION_INFO components match semver parse
 * - AC-4: VERSION_INFO.prerelease undefined for stable versions
 *
 * Implementation Coverage:
 * - IC-8: Test file creation
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { VERSION, VERSION_INFO, type VersionInfo } from '@rcrsr/rill';

// Get package.json path relative to this test file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '../../package.json');

describe('Rill Runtime: Version API', () => {
  describe('AC-1: VERSION equals package.json version', () => {
    it('returns version string matching package.json', () => {
      // Read package.json version
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      const expectedVersion = packageJson.version as string;

      // AC-1: VERSION should equal package.json version
      expect(VERSION).toBe(expectedVersion);
    });

    it('returns version in semver format', () => {
      // VERSION should follow semver pattern: major.minor.patch or major.minor.patch-prerelease
      const semverPattern = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/;
      expect(VERSION).toMatch(semverPattern);
    });
  });

  describe('AC-2: VERSION_INFO components match semver parse', () => {
    it('returns VersionInfo object with major, minor, patch fields', () => {
      // AC-2: VERSION_INFO should have major, minor, patch components
      expect(VERSION_INFO).toHaveProperty('major');
      expect(VERSION_INFO).toHaveProperty('minor');
      expect(VERSION_INFO).toHaveProperty('patch');
      expect(VERSION_INFO).toHaveProperty('prerelease');
    });

    it('returns numeric values for major, minor, patch', () => {
      expect(typeof VERSION_INFO.major).toBe('number');
      expect(typeof VERSION_INFO.minor).toBe('number');
      expect(typeof VERSION_INFO.patch).toBe('number');
    });

    it('matches parsed components from VERSION string', () => {
      // Parse VERSION string manually
      const versionParts = VERSION.split('-')[0]!.split('.');
      const expectedMajor = parseInt(versionParts[0]!, 10);
      const expectedMinor = parseInt(versionParts[1]!, 10);
      const expectedPatch = parseInt(versionParts[2]!, 10);

      // AC-2: Components should match semver parse
      expect(VERSION_INFO.major).toBe(expectedMajor);
      expect(VERSION_INFO.minor).toBe(expectedMinor);
      expect(VERSION_INFO.patch).toBe(expectedPatch);
    });
  });

  describe('AC-4: VERSION_INFO.prerelease undefined for stable versions', () => {
    it('returns undefined for prerelease when version is stable', () => {
      // Check if VERSION contains prerelease (hyphen separator)
      const hasPrerelease = VERSION.includes('-');

      if (!hasPrerelease) {
        // AC-4: Stable versions have undefined prerelease
        expect(VERSION_INFO.prerelease).toBeUndefined();
      } else {
        // Prerelease versions should have string value
        expect(typeof VERSION_INFO.prerelease).toBe('string');
      }
    });
  });

  describe('Type Safety', () => {
    it('VERSION_INFO matches VersionInfo interface', () => {
      // Type guard: ensure VERSION_INFO conforms to VersionInfo
      const info: VersionInfo = VERSION_INFO;

      expect(info.major).toBeDefined();
      expect(info.minor).toBeDefined();
      expect(info.patch).toBeDefined();
      // prerelease can be string | undefined
      expect(
        typeof info.prerelease === 'string' ||
          typeof info.prerelease === 'undefined'
      ).toBe(true);
    });

    it('VERSION_INFO properties are readonly', () => {
      // VersionInfo interface defines readonly properties
      // TypeScript enforces this at compile time
      // Runtime verification: properties exist and are accessible
      expect(() => VERSION_INFO.major).not.toThrow();
      expect(() => VERSION_INFO.minor).not.toThrow();
      expect(() => VERSION_INFO.patch).not.toThrow();
      expect(() => VERSION_INFO.prerelease).not.toThrow();
    });
  });

  describe('Consistency', () => {
    it('VERSION and VERSION_INFO represent same version', () => {
      // Reconstruct version string from VERSION_INFO
      let reconstructed = `${VERSION_INFO.major}.${VERSION_INFO.minor}.${VERSION_INFO.patch}`;
      if (VERSION_INFO.prerelease) {
        reconstructed += `-${VERSION_INFO.prerelease}`;
      }

      // Should match VERSION constant
      expect(reconstructed).toBe(VERSION);
    });

    it('returns consistent values across multiple accesses', () => {
      // VERSION should be stable across calls
      const version1 = VERSION;
      const version2 = VERSION;
      expect(version1).toBe(version2);

      // VERSION_INFO should be stable across calls
      const info1 = VERSION_INFO;
      const info2 = VERSION_INFO;
      expect(info1).toBe(info2);
      expect(info1.major).toBe(info2.major);
      expect(info1.minor).toBe(info2.minor);
      expect(info1.patch).toBe(info2.patch);
      expect(info1.prerelease).toBe(info2.prerelease);
    });
  });
});
