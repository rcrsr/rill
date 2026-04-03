/**
 * Tests for resolveSpecifier (internal helper in loader.ts)
 * Covers: relative paths, absolute paths, file URLs, bare specifier resolution
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveSpecifier } from '../src/loader.js';
import { describe, expect, it } from 'vitest';

// ============================================================
// TESTS
// ============================================================

describe('resolveSpecifier', () => {
  describe('relative paths resolve to file URLs', () => {
    it('resolves ./ paths against cwd', () => {
      const result = resolveSpecifier('./foo.js');
      const expected = pathToFileURL(resolve(process.cwd(), './foo.js')).href;
      expect(result).toBe(expected);
      expect(result.startsWith('file:///')).toBe(true);
    });

    it('resolves ../ paths against cwd', () => {
      const result = resolveSpecifier('../bar.js');
      const expected = pathToFileURL(resolve(process.cwd(), '../bar.js')).href;
      expect(result).toBe(expected);
      expect(result.startsWith('file:///')).toBe(true);
    });
  });

  describe('absolute paths and file URLs pass through unchanged', () => {
    it('returns absolute paths as-is', () => {
      expect(resolveSpecifier('/some/absolute/path.js')).toBe(
        '/some/absolute/path.js'
      );
    });

    it('returns file:// URLs as-is', () => {
      expect(resolveSpecifier('file:///some/path.js')).toBe(
        'file:///some/path.js'
      );
    });
  });

  describe('bare specifiers resolve from project directory', () => {
    it('resolves an installed package to a file URL', () => {
      // semver is a dependency of rill-config
      const result = resolveSpecifier('semver');
      expect(result.startsWith('file:///')).toBe(true);
      expect(result).toContain('semver');
    });

    it('throws for a non-existent package', () => {
      expect(() => resolveSpecifier('@nonexistent/pkg-xyz')).toThrow();
    });
  });
});
