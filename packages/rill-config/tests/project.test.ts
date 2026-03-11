/**
 * Tests for loadProject facade
 * Covers: HP-1, AC-1, AC-23
 */

import { loadProject, ConfigNotFoundError } from '@rcrsr/rill-config';
import { describe, expect, it, vi } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ============================================================
// HELPERS
// ============================================================

function writeTempConfig(content: string): {
  configPath: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'rill-config-test-'));
  const configPath = join(dir, 'rill-config.json');
  writeFileSync(configPath, content, 'utf8');
  return {
    configPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const MINIMAL_CONFIG = JSON.stringify({
  name: 'test-project',
  version: '1.0.0',
});

const CONFIG_WITH_CONTEXT = JSON.stringify({
  name: 'ctx-project',
  context: {
    schema: {
      apiUrl: { type: 'string' },
      debug: { type: 'bool' },
    },
    values: {
      apiUrl: 'https://example.com',
      debug: false,
    },
  },
});

// ============================================================
// HP-1 / AC-1: loadProject with valid config returns ProjectResult
// ============================================================

describe('loadProject', () => {
  describe('HP-1: valid config with no extensions', () => {
    it('returns a ProjectResult with empty extTree and disposes', async () => {
      // AC-1, AC-23: no extensions block -> empty extTree and disposes
      const { configPath, cleanup } = writeTempConfig(MINIMAL_CONFIG);
      try {
        const result = await loadProject({
          configPath,
          env: {},
          rillVersion: '1.0.0',
        });
        expect(result.extTree).toEqual({});
        expect(result.disposes).toHaveLength(0);
      } finally {
        cleanup();
      }
    });

    it('returns the parsed config in result.config', async () => {
      const { configPath, cleanup } = writeTempConfig(MINIMAL_CONFIG);
      try {
        const result = await loadProject({
          configPath,
          env: {},
          rillVersion: '1.0.0',
        });
        expect(result.config.name).toBe('test-project');
        expect(result.config.version).toBe('1.0.0');
      } finally {
        cleanup();
      }
    });

    it('returns a resolverConfig with ext, context, and module resolvers', async () => {
      const { configPath, cleanup } = writeTempConfig(MINIMAL_CONFIG);
      try {
        const result = await loadProject({
          configPath,
          env: {},
          rillVersion: '1.0.0',
        });
        expect(result.resolverConfig.resolvers).toHaveProperty('ext');
        expect(result.resolverConfig.resolvers).toHaveProperty('context');
        expect(result.resolverConfig.resolvers).toHaveProperty('module');
      } finally {
        cleanup();
      }
    });

    it('returns extensionBindings as rill source string', async () => {
      const { configPath, cleanup } = writeTempConfig(MINIMAL_CONFIG);
      try {
        const result = await loadProject({
          configPath,
          env: {},
          rillVersion: '1.0.0',
        });
        expect(typeof result.extensionBindings).toBe('string');
        expect(result.extensionBindings.length).toBeGreaterThan(0);
      } finally {
        cleanup();
      }
    });

    it('returns hostOptions as empty object when host block absent', async () => {
      const { configPath, cleanup } = writeTempConfig(MINIMAL_CONFIG);
      try {
        const result = await loadProject({
          configPath,
          env: {},
          rillVersion: '1.0.0',
        });
        expect(result.hostOptions).toEqual({});
      } finally {
        cleanup();
      }
    });
  });

  describe('HP-1: valid config with context block', () => {
    it('builds context bindings from schema and values', async () => {
      const { configPath, cleanup } = writeTempConfig(CONFIG_WITH_CONTEXT);
      try {
        const result = await loadProject({
          configPath,
          env: {},
          rillVersion: '1.0.0',
        });
        expect(result.contextBindings).toContain('apiUrl');
        expect(result.contextBindings).toContain('debug');
      } finally {
        cleanup();
      }
    });
  });

  describe('error: config file not found', () => {
    it('throws ConfigNotFoundError when config path does not exist', async () => {
      await expect(
        loadProject({
          configPath: '/nonexistent/path/rill-config.json',
          env: {},
          rillVersion: '1.0.0',
        })
      ).rejects.toThrow(ConfigNotFoundError);
    });

    it('never calls process.exit', async () => {
      const exitSpy = vi.spyOn(process, 'exit');
      await loadProject({
        configPath: '/nonexistent/path/rill-config.json',
        env: {},
        rillVersion: '1.0.0',
      }).catch(() => undefined);
      expect(exitSpy).not.toHaveBeenCalled();
      exitSpy.mockRestore();
    });
  });
});
