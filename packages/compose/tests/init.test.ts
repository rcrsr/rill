/**
 * Tests for initProject() — all file generation and error conditions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  statSync,
  chmodSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initProject } from '../src/init.js';
import { ComposeError } from '../src/errors.js';
import { validateManifest } from '../src/schema.js';

// ============================================================
// TEST SETUP
// ============================================================

let originalCwd: string;
let testDir: string;

beforeEach(() => {
  originalCwd = process.cwd();
  testDir = mkdtempSync(join(tmpdir(), 'init-test-'));
  process.chdir(testDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(testDir, { recursive: true, force: true });
});

// ============================================================
// HELPERS
// ============================================================

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

// ============================================================
// VALID PROJECT CREATION
// ============================================================

describe('initProject', () => {
  describe('creates project directory [AC]', () => {
    it('creates directory for simple project name', async () => {
      await initProject('my-agent');
      expect(existsSync(join(testDir, 'my-agent'))).toBe(true);
      expect(statSync(join(testDir, 'my-agent')).isDirectory()).toBe(true);
    });

    it('creates directory with scoped name using only the local part', async () => {
      await initProject('@scope/my-agent');
      expect(existsSync(join(testDir, 'my-agent'))).toBe(true);
      expect(existsSync(join(testDir, '@scope'))).toBe(false);
    });
  });

  describe('generates agent.json [AC]', () => {
    it('creates agent.json with required fields', async () => {
      await initProject('test-project');
      const agentJson = readJson(join(testDir, 'test-project', 'agent.json'));
      expect(agentJson).toMatchObject({
        name: 'test-project',
        version: '0.1.0',
        runtime: '@rcrsr/rill@^0.8.0',
        entry: 'main.rill',
      });
    });

    it('preserves scoped name in agent.json name field', async () => {
      await initProject('@myorg/my-agent');
      const agentJson = readJson(join(testDir, 'my-agent', 'agent.json'));
      expect((agentJson as Record<string, unknown>)['name']).toBe(
        '@myorg/my-agent'
      );
    });

    it('includes host.timeout of 30000', async () => {
      await initProject('test-project');
      const agentJson = readJson(
        join(testDir, 'test-project', 'agent.json')
      ) as Record<string, unknown>;
      expect((agentJson['host'] as Record<string, unknown>)['timeout']).toBe(
        30000
      );
    });

    it('generates empty extensions when none specified', async () => {
      await initProject('test-project');
      const agentJson = readJson(
        join(testDir, 'test-project', 'agent.json')
      ) as Record<string, unknown>;
      expect(agentJson['extensions']).toEqual({});
    });

    it('passes validateManifest() without modification for no extensions', async () => {
      await initProject('test-project');
      const raw = readJson(join(testDir, 'test-project', 'agent.json'));
      expect(() => validateManifest(raw)).not.toThrow();
    });

    it('passes validateManifest() for anthropic extension', async () => {
      await initProject('test-project', { extensions: ['anthropic'] });
      const raw = readJson(join(testDir, 'test-project', 'agent.json'));
      expect(() => validateManifest(raw)).not.toThrow();
    });
  });

  describe('extension config generation [AC]', () => {
    it('adds anthropic extension with correct package and config', async () => {
      await initProject('test-project', { extensions: ['anthropic'] });
      const agentJson = readJson(
        join(testDir, 'test-project', 'agent.json')
      ) as Record<string, unknown>;
      const extensions = agentJson['extensions'] as Record<string, unknown>;
      expect(extensions['llm']).toMatchObject({
        package: '@rcrsr/rill-ext-llm-anthropic',
        config: { api_key: '${ANTHROPIC_API_KEY}' },
      });
    });

    it('adds openai extension with correct package and config', async () => {
      await initProject('test-project', { extensions: ['openai'] });
      const agentJson = readJson(
        join(testDir, 'test-project', 'agent.json')
      ) as Record<string, unknown>;
      const extensions = agentJson['extensions'] as Record<string, unknown>;
      expect(extensions['llm']).toMatchObject({
        package: '@rcrsr/rill-ext-llm-openai',
        config: { api_key: '${OPENAI_API_KEY}' },
      });
    });

    it('adds qdrant extension with url and api_key config', async () => {
      await initProject('test-project', { extensions: ['qdrant'] });
      const agentJson = readJson(
        join(testDir, 'test-project', 'agent.json')
      ) as Record<string, unknown>;
      const extensions = agentJson['extensions'] as Record<string, unknown>;
      expect(extensions['db']).toMatchObject({
        package: '@rcrsr/rill-ext-qdrant',
        config: { url: '${QDRANT_URL}', api_key: '${QDRANT_API_KEY}' },
      });
    });

    it('adds fetch built-in extension with no config', async () => {
      await initProject('test-project', { extensions: ['fetch'] });
      const agentJson = readJson(
        join(testDir, 'test-project', 'agent.json')
      ) as Record<string, unknown>;
      const extensions = agentJson['extensions'] as Record<string, unknown>;
      expect(extensions['net']).toMatchObject({
        package: '@rcrsr/rill/ext/fetch',
        config: {},
      });
    });

    it('adds kv built-in extension with no config', async () => {
      await initProject('test-project', { extensions: ['kv'] });
      const agentJson = readJson(
        join(testDir, 'test-project', 'agent.json')
      ) as Record<string, unknown>;
      const extensions = agentJson['extensions'] as Record<string, unknown>;
      expect(extensions['kv']).toMatchObject({
        package: '@rcrsr/rill/ext/kv',
        config: {},
      });
    });

    it('adds fs built-in extension with no config', async () => {
      await initProject('test-project', { extensions: ['fs'] });
      const agentJson = readJson(
        join(testDir, 'test-project', 'agent.json')
      ) as Record<string, unknown>;
      const extensions = agentJson['extensions'] as Record<string, unknown>;
      expect(extensions['fs']).toMatchObject({
        package: '@rcrsr/rill/ext/fs',
        config: {},
      });
    });

    it('supports multiple extensions simultaneously', async () => {
      await initProject('test-project', {
        extensions: ['anthropic', 'qdrant', 'fetch'],
      });
      const agentJson = readJson(
        join(testDir, 'test-project', 'agent.json')
      ) as Record<string, unknown>;
      const extensions = agentJson['extensions'] as Record<string, unknown>;
      expect(Object.keys(extensions)).toHaveLength(3);
      expect(extensions['llm']).toBeDefined();
      expect(extensions['db']).toBeDefined();
      expect(extensions['net']).toBeDefined();
    });
  });

  describe('generates main.rill [AC]', () => {
    it('creates main.rill with Hello World starter', async () => {
      await initProject('test-project');
      const content = readFileSync(
        join(testDir, 'test-project', 'main.rill'),
        'utf-8'
      );
      expect(content).toBe('"Hello, World!" -> log\n');
    });
  });

  describe('generates .env.example [AC]', () => {
    it('skips .env.example when no extensions need env vars', async () => {
      await initProject('test-project');
      expect(existsSync(join(testDir, 'test-project', '.env.example'))).toBe(
        false
      );
    });

    it('skips .env.example when only built-in extensions requested', async () => {
      await initProject('test-project', { extensions: ['fetch', 'kv', 'fs'] });
      expect(existsSync(join(testDir, 'test-project', '.env.example'))).toBe(
        false
      );
    });

    it('creates .env.example for anthropic extension', async () => {
      await initProject('test-project', { extensions: ['anthropic'] });
      const content = readFileSync(
        join(testDir, 'test-project', '.env.example'),
        'utf-8'
      );
      expect(content).toContain('ANTHROPIC_API_KEY=');
    });

    it('creates .env.example for qdrant extension with both vars', async () => {
      await initProject('test-project', { extensions: ['qdrant'] });
      const content = readFileSync(
        join(testDir, 'test-project', '.env.example'),
        'utf-8'
      );
      expect(content).toContain('QDRANT_URL=');
      expect(content).toContain('QDRANT_API_KEY=');
    });

    it('deduplicates env vars across multiple extensions', async () => {
      await initProject('test-project', {
        extensions: ['anthropic', 'openai'],
      });
      const content = readFileSync(
        join(testDir, 'test-project', '.env.example'),
        'utf-8'
      );
      // Both keys present
      expect(content).toContain('ANTHROPIC_API_KEY=');
      expect(content).toContain('OPENAI_API_KEY=');
      // Each var appears exactly once
      expect(content.split('ANTHROPIC_API_KEY=').length - 1).toBe(1);
    });
  });

  describe('generates package.json [AC]', () => {
    it('creates package.json with name field', async () => {
      await initProject('test-project');
      const pkg = readJson(
        join(testDir, 'test-project', 'package.json')
      ) as Record<string, unknown>;
      expect(pkg['name']).toBe('test-project');
    });

    it('uses full scoped name in package.json', async () => {
      await initProject('@org/my-agent');
      const pkg = readJson(join(testDir, 'my-agent', 'package.json')) as Record<
        string,
        unknown
      >;
      expect(pkg['name']).toBe('@org/my-agent');
    });
  });

  // ============================================================
  // ERROR CONDITIONS
  // ============================================================

  describe('EC-25: directory already exists', () => {
    it('throws ComposeError when directory exists', async () => {
      await initProject('test-project');
      await expect(initProject('test-project')).rejects.toThrow(ComposeError);
    });

    it('throws with message "Directory already exists: {dirName}"', async () => {
      await initProject('test-project');
      await expect(initProject('test-project')).rejects.toThrow(
        'Directory already exists: test-project'
      );
    });

    it('uses stripped dir name (not scoped) in error message', async () => {
      await initProject('@org/my-agent');
      await expect(initProject('@org/my-agent')).rejects.toThrow(
        'Directory already exists: my-agent'
      );
    });

    it('sets phase to "init"', async () => {
      await initProject('test-project');
      let caught: ComposeError | undefined;
      try {
        await initProject('test-project');
      } catch (e) {
        caught = e as ComposeError;
      }
      expect(caught?.phase).toBe('init');
    });
  });

  describe('EC-26: invalid project name', () => {
    it('throws ComposeError for empty name', async () => {
      await expect(initProject('')).rejects.toThrow(ComposeError);
    });

    it('throws with message "Invalid project name: {name}"', async () => {
      await expect(initProject('Invalid Name!')).rejects.toThrow(
        'Invalid project name: Invalid Name!'
      );
    });

    it('throws for uppercase letters in name', async () => {
      await expect(initProject('MyAgent')).rejects.toThrow(
        'Invalid project name: MyAgent'
      );
    });

    it('throws for name containing spaces', async () => {
      await expect(initProject('my agent')).rejects.toThrow(
        'Invalid project name: my agent'
      );
    });

    it('throws for dot name', async () => {
      await expect(initProject('.')).rejects.toThrow('Invalid project name: .');
    });

    it('throws for path traversal in name', async () => {
      await expect(initProject('../etc')).rejects.toThrow(ComposeError);
    });

    it('sets phase to "init"', async () => {
      let caught: ComposeError | undefined;
      try {
        await initProject('Invalid!');
      } catch (e) {
        caught = e as ComposeError;
      }
      expect(caught?.phase).toBe('init');
    });
  });

  describe('EC-27: unknown extension', () => {
    it('throws ComposeError for unknown extension name', async () => {
      await expect(
        initProject('test-project', { extensions: ['unknown-ext'] })
      ).rejects.toThrow(ComposeError);
    });

    it('throws with message "Unknown extension: {name}"', async () => {
      await expect(
        initProject('test-project', { extensions: ['gemini'] })
      ).rejects.toThrow('Unknown extension: gemini');
    });

    it('sets phase to "init"', async () => {
      let caught: ComposeError | undefined;
      try {
        await initProject('test-project', { extensions: ['unknown'] });
      } catch (e) {
        caught = e as ComposeError;
      }
      expect(caught?.phase).toBe('init');
    });

    it('does not create directory before extension validation', async () => {
      try {
        await initProject('test-project', { extensions: ['unknown'] });
      } catch {
        // expected
      }
      expect(existsSync(join(testDir, 'test-project'))).toBe(false);
    });
  });

  // ============================================================
  // EC-28: filesystem write failure
  // ============================================================

  describe('EC-28: filesystem write failure', () => {
    it('throws ComposeError when directory cannot be created', async () => {
      // Make testDir read-only so mkdirSync fails with EACCES
      chmodSync(testDir, 0o444);
      try {
        await expect(initProject('new-project')).rejects.toThrow(ComposeError);
      } finally {
        chmodSync(testDir, 0o755);
      }
    });

    it('throws with message starting "Failed to create project:"', async () => {
      chmodSync(testDir, 0o444);
      try {
        await expect(initProject('new-project')).rejects.toThrow(
          'Failed to create project:'
        );
      } finally {
        chmodSync(testDir, 0o755);
      }
    });

    it('sets phase to "init"', async () => {
      chmodSync(testDir, 0o444);
      let caught: ComposeError | undefined;
      try {
        await initProject('new-project');
      } catch (e) {
        caught = e as ComposeError;
      } finally {
        chmodSync(testDir, 0o755);
      }
      expect(caught?.phase).toBe('init');
    });
  });
});
