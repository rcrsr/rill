/**
 * Module Loader Tests
 *
 * Tests for cli-module-loader.ts module loading functionality.
 *
 * Note: These tests verify the module loader logic (caching, circular detection, path resolution).
 * Integration tests with actual module dependencies are limited due to frontmatter parser bug
 * (content.trim() strips YAML indentation - see parser-script.ts:143).
 */

import { describe, it, expect } from 'vitest';
import { loadModule } from '../../src/cli-module-loader.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('loadModule', () => {
  describe('error handling', () => {
    it('throws error for non-existent module', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rill-test-'));

      try {
        const cache = new Map();
        await expect(
          loadModule('./nonexistent.rill', tmpDir, cache)
        ).rejects.toThrow('Module not found');
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('provides correct error message with specifier', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rill-test-'));

      try {
        const cache = new Map();
        await expect(
          loadModule('./missing.rill', tmpDir, cache)
        ).rejects.toThrow('./missing.rill');
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('path resolution', () => {
    it('resolves absolute paths correctly', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rill-test-'));

      try {
        const modulePath = path.join(tmpDir, 'simple.rill');
        const content = ['---', '---', '', '42'].join('\n');
        await fs.writeFile(modulePath, content);

        const cache = new Map();
        const result = await loadModule(modulePath, tmpDir, cache);

        expect(result).toBeDefined();
        expect(typeof result).toBe('object');
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('resolves relative paths correctly', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rill-test-'));

      try {
        const subDir = path.join(tmpDir, 'utils');
        await fs.mkdir(subDir);

        const modulePath = path.join(subDir, 'simple.rill');
        const content = ['---', '---', '', '42'].join('\n');
        await fs.writeFile(modulePath, content);

        const scriptPath = path.join(tmpDir, 'script.rill');
        await fs.writeFile(scriptPath, '');

        const cache = new Map();
        const result = await loadModule(
          './utils/simple.rill',
          scriptPath,
          cache
        );

        expect(result).toBeDefined();
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('caching', () => {
    it('caches loaded modules by canonical path', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rill-test-'));

      try {
        const modulePath = path.join(tmpDir, 'cached.rill');
        const content = ['---', '---', '', '42'].join('\n');
        await fs.writeFile(modulePath, content);

        const cache = new Map();
        const result1 = await loadModule(modulePath, tmpDir, cache);
        const result2 = await loadModule(modulePath, tmpDir, cache);

        expect(result1).toBe(result2);
        expect(cache.size).toBe(1);
        expect(cache.has(modulePath)).toBe(true);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('uses same cache entry for equivalent paths', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rill-test-'));

      try {
        const modulePath = path.join(tmpDir, 'module.rill');
        const content = ['---', '---', '', '42'].join('\n');
        await fs.writeFile(modulePath, content);

        const cache = new Map();

        // Load with absolute path
        await loadModule(modulePath, tmpDir, cache);
        expect(cache.size).toBe(1);

        // Load again with same absolute path
        await loadModule(modulePath, tmpDir, cache);
        expect(cache.size).toBe(1);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('export extraction', () => {
    it('returns empty object when no exports declared', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rill-test-'));

      try {
        const modulePath = path.join(tmpDir, 'no-exports.rill');
        const content = ['---', '---', '', '42 :> $value'].join('\n');
        await fs.writeFile(modulePath, content);

        const cache = new Map();
        const result = await loadModule(modulePath, tmpDir, cache);

        expect(result).toEqual({});
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('chain tracking', () => {
    it('cleans up chain after successful load', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rill-test-'));

      try {
        const modulePath = path.join(tmpDir, 'simple.rill');
        const content = ['---', '---', '', '42'].join('\n');
        await fs.writeFile(modulePath, content);

        const cache = new Map();
        const chain = new Set<string>();

        await loadModule(modulePath, tmpDir, cache, chain);

        // Chain should be empty after successful load
        expect(chain.size).toBe(0);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('cleans up chain after error', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rill-test-'));

      try {
        const cache = new Map();
        const chain = new Set<string>();

        try {
          await loadModule('./nonexistent.rill', tmpDir, cache, chain);
        } catch {
          // Expected error
        }

        // Chain should be empty after error
        expect(chain.size).toBe(0);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('circular dependency detection', () => {
    it('detects direct circular dependency (A -> B -> A)', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rill-test-'));

      try {
        // Create module A that imports B
        const moduleA = path.join(tmpDir, 'a.rill');
        const contentA = [
          '---',
          'use:',
          '  - b: ./b.rill',
          '---',
          '',
          '42',
        ].join('\n');
        await fs.writeFile(moduleA, contentA);

        // Create module B that imports A (circular)
        const moduleB = path.join(tmpDir, 'b.rill');
        const contentB = [
          '---',
          'use:',
          '  - a: ./a.rill',
          '---',
          '',
          '100',
        ].join('\n');
        await fs.writeFile(moduleB, contentB);

        const cache = new Map();
        await expect(loadModule(moduleA, tmpDir, cache)).rejects.toThrow(
          /Circular dependency detected: .*a\.rill -> .*b\.rill -> .*a\.rill/
        );
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('detects indirect circular dependency (A -> B -> C -> A)', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rill-test-'));

      try {
        // Create module A that imports B
        const moduleA = path.join(tmpDir, 'a.rill');
        const contentA = [
          '---',
          'use:',
          '  - b: ./b.rill',
          '---',
          '',
          '42',
        ].join('\n');
        await fs.writeFile(moduleA, contentA);

        // Create module B that imports C
        const moduleB = path.join(tmpDir, 'b.rill');
        const contentB = [
          '---',
          'use:',
          '  - c: ./c.rill',
          '---',
          '',
          '100',
        ].join('\n');
        await fs.writeFile(moduleB, contentB);

        // Create module C that imports A (indirect circular)
        const moduleC = path.join(tmpDir, 'c.rill');
        const contentC = [
          '---',
          'use:',
          '  - a: ./a.rill',
          '---',
          '',
          '200',
        ].join('\n');
        await fs.writeFile(moduleC, contentC);

        const cache = new Map();
        await expect(loadModule(moduleA, tmpDir, cache)).rejects.toThrow(
          /Circular dependency detected: .*a\.rill -> .*b\.rill -> .*c\.rill -> .*a\.rill/
        );
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('error message includes complete dependency chain', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rill-test-'));

      try {
        // Create module A that imports B
        const moduleA = path.join(tmpDir, 'module-a.rill');
        const contentA = [
          '---',
          'use:',
          '  - b: ./module-b.rill',
          '---',
          '',
          '42',
        ].join('\n');
        await fs.writeFile(moduleA, contentA);

        // Create module B that imports A (circular)
        const moduleB = path.join(tmpDir, 'module-b.rill');
        const contentB = [
          '---',
          'use:',
          '  - a: ./module-a.rill',
          '---',
          '',
          '100',
        ].join('\n');
        await fs.writeFile(moduleB, contentB);

        const cache = new Map();

        try {
          await loadModule(moduleA, tmpDir, cache);
          expect.fail('Should have thrown circular dependency error');
        } catch (error) {
          const message = (error as Error).message;
          expect(message).toContain('Circular dependency detected:');
          expect(message).toContain('module-a.rill');
          expect(message).toContain('module-b.rill');
          expect(message.match(/module-a\.rill/g)).toHaveLength(2);
        }
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('module execution', () => {
    it('executes module script and captures variables', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rill-test-'));

      try {
        const modulePath = path.join(tmpDir, 'vars.rill');
        const content = ['---', '---', '', '42 :> $x', '100 :> $y'].join('\n');
        await fs.writeFile(modulePath, content);

        const cache = new Map();
        const result = await loadModule(modulePath, tmpDir, cache);

        // No exports, so result should be empty object
        expect(result).toEqual({});
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
