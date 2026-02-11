/**
 * Tests for project scaffolding module.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, readFile, access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  scaffold,
  type ScaffoldConfig,
  InstallError,
} from '../src/scaffold.js';
import { FileSystemError } from '../src/templates.js';

// ============================================================
// TEST SETUP
// ============================================================

let testDir: string;

beforeEach(() => {
  // Create unique temp directory for each test
  testDir = mkdtempSync(join(tmpdir(), 'scaffold-test-'));
});

afterEach(async () => {
  // Clean up test directory
  if (testDir) {
    await rm(testDir, { recursive: true, force: true });
  }
});

// ============================================================
// SCAFFOLDING TESTS
// ============================================================

describe('scaffold', () => {
  describe('basic project creation', () => {
    it('creates project directory and files', async () => {
      const config: ScaffoldConfig = {
        projectName: join(testDir, 'test-app'),
        extensions: [],
        description: 'Test application',
        packageManager: 'npm',
        typescript: true,
        installDeps: false,
        starterPattern: null,
      };

      await scaffold(config);

      // Verify project directory exists
      await expect(access(config.projectName)).resolves.not.toThrow();

      // Verify src directory exists
      await expect(
        access(join(config.projectName, 'src'))
      ).resolves.not.toThrow();

      // Verify core files exist
      await expect(
        access(join(config.projectName, 'package.json'))
      ).resolves.not.toThrow();
      await expect(
        access(join(config.projectName, 'src', 'host.ts'))
      ).resolves.not.toThrow();
      await expect(
        access(join(config.projectName, 'src', 'run.ts'))
      ).resolves.not.toThrow();
      await expect(
        access(join(config.projectName, 'src', 'agent.rill'))
      ).resolves.not.toThrow();
      await expect(
        access(join(config.projectName, '.env.example'))
      ).resolves.not.toThrow();
      await expect(
        access(join(config.projectName, 'CLAUDE.md'))
      ).resolves.not.toThrow();
    });

    it('creates tsconfig.json when typescript is true', async () => {
      const config: ScaffoldConfig = {
        projectName: join(testDir, 'ts-app'),
        extensions: [],
        description: 'TypeScript app',
        packageManager: 'npm',
        typescript: true,
        installDeps: false,
        starterPattern: null,
      };

      await scaffold(config);

      await expect(
        access(join(config.projectName, 'tsconfig.json'))
      ).resolves.not.toThrow();
    });

    it('skips tsconfig.json when typescript is false', async () => {
      const config: ScaffoldConfig = {
        projectName: join(testDir, 'js-app'),
        extensions: [],
        description: 'JavaScript app',
        packageManager: 'npm',
        typescript: false,
        installDeps: false,
        starterPattern: null,
      };

      await scaffold(config);

      await expect(
        access(join(config.projectName, 'tsconfig.json'))
      ).rejects.toThrow();
    });
  });

  describe('template rendering', () => {
    it('renders package.json with project name', async () => {
      const config: ScaffoldConfig = {
        projectName: join(testDir, 'named-app'),
        extensions: [],
        description: 'Named application',
        packageManager: 'pnpm',
        typescript: true,
        installDeps: false,
        starterPattern: null,
      };

      await scaffold(config);

      const packageJson = await readFile(
        join(config.projectName, 'package.json'),
        'utf-8'
      );
      const parsed = JSON.parse(packageJson);

      expect(parsed.name).toBe('named-app');
    });

    it('renders agent.rill with description comment', async () => {
      const config: ScaffoldConfig = {
        projectName: join(testDir, 'desc-app'),
        extensions: [],
        description: 'Test application with description',
        packageManager: 'npm',
        typescript: true,
        installDeps: false,
        starterPattern: null,
      };

      await scaffold(config);

      const agentRill = await readFile(
        join(config.projectName, 'src', 'agent.rill'),
        'utf-8'
      );

      expect(agentRill).toContain('# Test application with description');
      // Verify description appears at the start of the file
      expect(
        agentRill.trimStart().startsWith('# Test application with description')
      ).toBe(true);
    });

    it('renders agent.rill with multi-line description comment', async () => {
      const config: ScaffoldConfig = {
        projectName: join(testDir, 'multiline-desc-app'),
        extensions: [],
        description:
          'First line of description\nSecond line of description\nThird line',
        packageManager: 'npm',
        typescript: true,
        installDeps: false,
        starterPattern: null,
      };

      await scaffold(config);

      const agentRill = await readFile(
        join(config.projectName, 'src', 'agent.rill'),
        'utf-8'
      );

      // Multi-line description should appear as a single comment line in the template
      // since the template uses {{description}} without splitting
      expect(agentRill).toContain(
        '# First line of description\nSecond line of description\nThird line'
      );
    });

    it('renders agent.rill without description comment when empty', async () => {
      const config: ScaffoldConfig = {
        projectName: join(testDir, 'no-desc-app'),
        extensions: [],
        description: '',
        packageManager: 'npm',
        typescript: true,
        installDeps: false,
        starterPattern: null,
      };

      await scaffold(config);

      const agentRill = await readFile(
        join(config.projectName, 'src', 'agent.rill'),
        'utf-8'
      );

      // When no description, should start with the default content
      expect(agentRill.trimStart().startsWith('# Minimal starter script')).toBe(
        true
      );
    });

    it('renders agent.rill with long description without truncation', async () => {
      // AC-18: Description > 1000 characters is valid, full description used
      const longDescription = 'a'.repeat(1500);
      const config: ScaffoldConfig = {
        projectName: join(testDir, 'long-desc-app'),
        extensions: [],
        description: longDescription,
        packageManager: 'npm',
        typescript: true,
        installDeps: false,
        starterPattern: null,
      };

      await scaffold(config);

      const agentRill = await readFile(
        join(config.projectName, 'src', 'agent.rill'),
        'utf-8'
      );

      // Verify full description appears without truncation
      expect(agentRill).toContain(`# ${longDescription}`);
      // Verify exact length is preserved (1500 characters plus comment marker and space)
      expect(agentRill.trimStart().split('\n')[0]).toBe(`# ${longDescription}`);
      expect(agentRill.trimStart().split('\n')[0]?.length).toBe(1502); // '# ' + 1500 chars
    });

    it('includes extension packages in package.json', async () => {
      const config: ScaffoldConfig = {
        projectName: join(testDir, 'ext-app'),
        extensions: ['anthropic', 'qdrant'],
        description: 'App with extensions',
        packageManager: 'npm',
        typescript: true,
        installDeps: false,
        starterPattern: null,
      };

      await scaffold(config);

      const packageJson = await readFile(
        join(config.projectName, 'package.json'),
        'utf-8'
      );
      const parsed = JSON.parse(packageJson);

      expect(parsed.dependencies).toHaveProperty('@rcrsr/rill-ext-anthropic');
      expect(parsed.dependencies).toHaveProperty('@rcrsr/rill-ext-qdrant');
    });

    it('renders CLAUDE.md with correct package manager', async () => {
      const config: ScaffoldConfig = {
        projectName: join(testDir, 'pnpm-app'),
        extensions: [],
        description: 'PNPM app',
        packageManager: 'pnpm',
        typescript: true,
        installDeps: false,
        starterPattern: null,
      };

      await scaffold(config);

      const claudeMd = await readFile(
        join(config.projectName, 'CLAUDE.md'),
        'utf-8'
      );

      expect(claudeMd).toContain('pnpm start');
      expect(claudeMd).toContain('pnpm run check');
    });

    it('renders host.ts with extension imports', async () => {
      const config: ScaffoldConfig = {
        projectName: join(testDir, 'host-app'),
        extensions: ['anthropic'],
        description: 'Host integration app',
        packageManager: 'npm',
        typescript: true,
        installDeps: false,
        starterPattern: null,
      };

      await scaffold(config);

      const hostTs = await readFile(
        join(config.projectName, 'src', 'host.ts'),
        'utf-8'
      );

      expect(hostTs).toContain('createAnthropicExtension');
      expect(hostTs).toContain('@rcrsr/rill-ext-anthropic');
      expect(hostTs).toContain("hoistExtension('anthropic'");
    });

    it('renders .env.example with extension env vars', async () => {
      const config: ScaffoldConfig = {
        projectName: join(testDir, 'env-app'),
        extensions: ['anthropic', 'pinecone'],
        description: 'App with env vars',
        packageManager: 'npm',
        typescript: true,
        installDeps: false,
        starterPattern: null,
      };

      await scaffold(config);

      const envExample = await readFile(
        join(config.projectName, '.env.example'),
        'utf-8'
      );

      expect(envExample).toContain('ANTHROPIC_API_KEY');
      expect(envExample).toContain('PINECONE_API_KEY');
    });
  });

  describe('error handling - directory exists', () => {
    it('throws FileSystemError when directory already exists', async () => {
      const config: ScaffoldConfig = {
        projectName: join(testDir, 'existing-app'),
        extensions: [],
        description: 'Duplicate app',
        packageManager: 'npm',
        typescript: true,
        installDeps: false,
        starterPattern: null,
      };

      // Create first project
      await scaffold(config);

      // Try to create again with same name
      await expect(scaffold(config)).rejects.toThrow(FileSystemError);
      await expect(scaffold(config)).rejects.toThrow(
        'Directory existing-app already exists'
      );
    });

    it('throws FileSystemError with correct error type', async () => {
      const config: ScaffoldConfig = {
        projectName: join(testDir, 'duplicate-app'),
        extensions: [],
        description: 'Test',
        packageManager: 'npm',
        typescript: true,
        installDeps: false,
        starterPattern: null,
      };

      await scaffold(config);

      try {
        await scaffold(config);
        expect.fail('Should have thrown FileSystemError');
      } catch (err) {
        expect(err).toBeInstanceOf(FileSystemError);
        expect(err).toHaveProperty('name', 'FileSystemError');
      }
    });
  });

  describe('dependency installation', () => {
    it('skips install when installDeps is false', async () => {
      const config: ScaffoldConfig = {
        projectName: join(testDir, 'no-deps-app'),
        extensions: [],
        description: 'No deps',
        packageManager: 'npm',
        typescript: true,
        installDeps: false,
        starterPattern: null,
      };

      await scaffold(config);

      // Verify node_modules does not exist
      await expect(
        access(join(config.projectName, 'node_modules'))
      ).rejects.toThrow();
    });

    // Note: Actual installation test would be slow and require real package manager
    // Testing install failure requires mocking execSync, which is outside scope
  });

  describe('extension configuration', () => {
    it('handles multiple extensions', async () => {
      const config: ScaffoldConfig = {
        projectName: join(testDir, 'multi-ext-app'),
        extensions: ['anthropic', 'qdrant', 'pinecone'],
        description: 'Multi-extension app',
        packageManager: 'npm',
        typescript: true,
        installDeps: false,
        starterPattern: null,
      };

      await scaffold(config);

      const hostTs = await readFile(
        join(config.projectName, 'src', 'host.ts'),
        'utf-8'
      );

      expect(hostTs).toContain('createAnthropicExtension');
      expect(hostTs).toContain('createQdrantExtension');
      expect(hostTs).toContain('createPineconeExtension');
      expect(hostTs).toContain("hoistExtension('anthropic'");
      expect(hostTs).toContain("hoistExtension('qdrant'");
      expect(hostTs).toContain("hoistExtension('pinecone'");
    });

    it('handles empty extensions array', async () => {
      const config: ScaffoldConfig = {
        projectName: join(testDir, 'no-ext-app'),
        extensions: [],
        description: 'No extensions',
        packageManager: 'npm',
        typescript: true,
        installDeps: false,
        starterPattern: null,
      };

      await scaffold(config);

      const hostTs = await readFile(
        join(config.projectName, 'src', 'host.ts'),
        'utf-8'
      );

      // Should still have basic structure
      expect(hostTs).toContain('export function createHost()');
      expect(hostTs).toContain('const functions = {');
      expect(hostTs).toContain("...prefixFunctions('app', appFunctions)");
    });

    it('handles unknown extension gracefully', async () => {
      const config: ScaffoldConfig = {
        projectName: join(testDir, 'unknown-ext-app'),
        extensions: ['nonexistent-extension'],
        description: 'Unknown extension',
        packageManager: 'npm',
        typescript: true,
        installDeps: false,
        starterPattern: null,
      };

      // Should not throw, but extension won't be included
      await scaffold(config);

      const hostTs = await readFile(
        join(config.projectName, 'src', 'host.ts'),
        'utf-8'
      );

      // Should not contain references to unknown extension
      expect(hostTs).not.toContain('nonexistent-extension');
    });
  });

  describe('package manager variations', () => {
    it('handles npm package manager', async () => {
      const config: ScaffoldConfig = {
        projectName: join(testDir, 'npm-app'),
        extensions: [],
        description: 'NPM app',
        packageManager: 'npm',
        typescript: true,
        installDeps: false,
        starterPattern: null,
      };

      await scaffold(config);

      const claudeMd = await readFile(
        join(config.projectName, 'CLAUDE.md'),
        'utf-8'
      );

      expect(claudeMd).toContain('npm start');
    });

    it('handles pnpm package manager', async () => {
      const config: ScaffoldConfig = {
        projectName: join(testDir, 'pnpm-app2'),
        extensions: [],
        description: 'PNPM app',
        packageManager: 'pnpm',
        typescript: true,
        installDeps: false,
        starterPattern: null,
      };

      await scaffold(config);

      const claudeMd = await readFile(
        join(config.projectName, 'CLAUDE.md'),
        'utf-8'
      );

      expect(claudeMd).toContain('pnpm start');
    });

    it('handles yarn package manager', async () => {
      const config: ScaffoldConfig = {
        projectName: join(testDir, 'yarn-app'),
        extensions: [],
        description: 'Yarn app',
        packageManager: 'yarn',
        typescript: true,
        installDeps: false,
        starterPattern: null,
      };

      await scaffold(config);

      const claudeMd = await readFile(
        join(config.projectName, 'CLAUDE.md'),
        'utf-8'
      );

      expect(claudeMd).toContain('yarn start');
    });
  });

  describe('file content validation', () => {
    it('creates valid package.json', async () => {
      const config: ScaffoldConfig = {
        projectName: join(testDir, 'valid-json-app'),
        extensions: ['anthropic'],
        description: 'Valid JSON',
        packageManager: 'npm',
        typescript: true,
        installDeps: false,
        starterPattern: null,
      };

      await scaffold(config);

      const packageJson = await readFile(
        join(config.projectName, 'package.json'),
        'utf-8'
      );

      // Should parse without error
      const parsed = JSON.parse(packageJson);
      expect(parsed).toHaveProperty('name');
      expect(parsed).toHaveProperty('scripts');
      expect(parsed).toHaveProperty('dependencies');
    });

    it('creates all expected files', async () => {
      const config: ScaffoldConfig = {
        projectName: join(testDir, 'complete-app'),
        extensions: [],
        description: 'Complete app',
        packageManager: 'npm',
        typescript: true,
        installDeps: false,
        starterPattern: null,
      };

      await scaffold(config);

      const rootFiles = await readdir(config.projectName);
      const srcFiles = await readdir(join(config.projectName, 'src'));

      // Root files
      expect(rootFiles).toContain('package.json');
      expect(rootFiles).toContain('.env.example');
      expect(rootFiles).toContain('CLAUDE.md');
      expect(rootFiles).toContain('tsconfig.json');
      expect(rootFiles).toContain('src');

      // Src files
      expect(srcFiles).toContain('host.ts');
      expect(srcFiles).toContain('run.ts');
      expect(srcFiles).toContain('agent.rill');
    });
  });
});

// ============================================================
// ERROR CLASS TESTS
// ============================================================

describe('InstallError', () => {
  it('extends Error', () => {
    const err = new InstallError('test');
    expect(err).toBeInstanceOf(Error);
  });

  it('sets name property', () => {
    const err = new InstallError('test');
    expect(err.name).toBe('InstallError');
  });

  it('preserves message', () => {
    const err = new InstallError('npm install failed');
    expect(err.message).toBe('npm install failed');
  });
});
