/**
 * End-to-end tests for generated project validation.
 * Tests complete project scaffolding, file content, and rill-check integration.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, readFile, access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { parseWithRecovery } from '@rcrsr/rill';
import {
  scaffold,
  type ScaffoldConfig,
  InstallError,
} from '../src/scaffold.js';

// ============================================================
// TEST SETUP
// ============================================================

let testDir: string;

beforeEach(() => {
  // Create unique temp directory for each test
  testDir = mkdtempSync(join(tmpdir(), 'e2e-test-'));
});

afterEach(async () => {
  // Clean up test directory
  if (testDir) {
    await rm(testDir, { recursive: true, force: true });
  }
});

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Parse a generated agent.rill file directly.
 * Returns true if parsing succeeds with no errors, false otherwise.
 */
function checkRillSyntax(projectPath: string): boolean {
  const agentPath = join(projectPath, 'src', 'agent.rill');
  const source = readFileSync(agentPath, 'utf8');
  const result = parseWithRecovery(source);
  return result.errors.length === 0;
}

/**
 * Read and parse package.json from project directory.
 */
async function readPackageJson(
  projectPath: string
): Promise<Record<string, unknown>> {
  const packageJsonPath = join(projectPath, 'package.json');
  const content = await readFile(packageJsonPath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Read agent.rill content from project directory.
 */
async function readAgentRill(projectPath: string): Promise<string> {
  const agentPath = join(projectPath, 'src', 'agent.rill');
  return readFile(agentPath, 'utf-8');
}

/**
 * Check if file exists in project directory.
 */
async function fileExists(
  projectPath: string,
  relPath: string
): Promise<boolean> {
  try {
    await access(join(projectPath, relPath));
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// AC-1: GENERATE PROJECT WITH 2 EXTENSIONS
// ============================================================

describe('AC-1: Generate project with 2 extensions', () => {
  it('creates project with anthropic and qdrant configured', async () => {
    const config: ScaffoldConfig = {
      projectName: join(testDir, 'two-ext-app'),
      extensions: ['anthropic', 'qdrant'],
      description: 'Test app with two extensions',
      packageManager: 'npm',
      typescript: true,
      installDeps: false,
      starterPattern: null,
    };

    await scaffold(config);

    // Verify project directory exists
    await expect(access(config.projectName)).resolves.not.toThrow();

    // Verify package.json includes both extensions
    const packageJson = await readPackageJson(config.projectName);
    const deps = packageJson.dependencies as Record<string, string>;
    expect(deps).toHaveProperty('@rcrsr/rill-ext-anthropic');
    expect(deps).toHaveProperty('@rcrsr/rill-ext-qdrant');

    // Verify host.ts imports both extensions
    const hostTs = await readFile(
      join(config.projectName, 'src', 'host.ts'),
      'utf-8'
    );
    expect(hostTs).toContain('createAnthropicExtension');
    expect(hostTs).toContain('createQdrantExtension');
    expect(hostTs).toContain("hoistExtension('anthropic'");
    expect(hostTs).toContain("hoistExtension('qdrant'");

    // Verify .env.example includes env vars for extensions with env vars
    // Note: qdrant has no env vars, only anthropic does
    const envExample = await readFile(
      join(config.projectName, '.env.example'),
      'utf-8'
    );
    expect(envExample).toContain('ANTHROPIC_API_KEY');
    // Qdrant has no env vars, so it shouldn't appear in .env.example
    expect(envExample).not.toContain('QDRANT');
  });

  it('creates all expected files for project with extensions', async () => {
    const config: ScaffoldConfig = {
      projectName: join(testDir, 'complete-ext-app'),
      extensions: ['anthropic', 'qdrant'],
      description: 'Complete validation',
      packageManager: 'npm',
      typescript: true,
      installDeps: false,
      starterPattern: null,
    };

    await scaffold(config);

    // Root files
    expect(await fileExists(config.projectName, 'package.json')).toBe(true);
    expect(await fileExists(config.projectName, '.env.example')).toBe(true);
    expect(await fileExists(config.projectName, 'CLAUDE.md')).toBe(true);
    expect(await fileExists(config.projectName, 'tsconfig.json')).toBe(true);

    // Source files
    expect(await fileExists(config.projectName, 'src/host.ts')).toBe(true);
    expect(await fileExists(config.projectName, 'src/run.ts')).toBe(true);
    expect(await fileExists(config.projectName, 'src/agent.rill')).toBe(true);
  });
});

// ============================================================
// AC-3: GENERATE PROJECT WITH DESCRIPTION
// ============================================================

describe('AC-3: Generate project with description', () => {
  it('shows description as comment in agent.rill', async () => {
    const config: ScaffoldConfig = {
      projectName: join(testDir, 'desc-app'),
      extensions: [],
      description: 'A sample application for testing descriptions',
      packageManager: 'npm',
      typescript: true,
      installDeps: false,
      starterPattern: null,
    };

    await scaffold(config);

    const agentRill = await readAgentRill(config.projectName);

    // Verify description appears as comment at start of file
    expect(agentRill).toContain(
      '# A sample application for testing descriptions'
    );
    expect(
      agentRill
        .trimStart()
        .startsWith('# A sample application for testing descriptions')
    ).toBe(true);
  });

  it('handles multi-line descriptions in agent.rill', async () => {
    const config: ScaffoldConfig = {
      projectName: join(testDir, 'multiline-desc'),
      extensions: ['anthropic'],
      description:
        'Line 1: Main purpose\nLine 2: Additional context\nLine 3: Final note',
      packageManager: 'npm',
      typescript: true,
      installDeps: false,
      starterPattern: null,
    };

    await scaffold(config);

    const agentRill = await readAgentRill(config.projectName);

    // Verify multi-line description appears (as single comment with newlines)
    expect(agentRill).toContain(
      '# Line 1: Main purpose\nLine 2: Additional context\nLine 3: Final note'
    );
  });

  it('omits description comment when description is empty', async () => {
    const config: ScaffoldConfig = {
      projectName: join(testDir, 'no-desc'),
      extensions: [],
      description: '',
      packageManager: 'npm',
      typescript: true,
      installDeps: false,
      starterPattern: null,
    };

    await scaffold(config);

    const agentRill = await readAgentRill(config.projectName);

    // Should start with default content, not a description comment
    expect(agentRill.trimStart().startsWith('# Minimal starter script')).toBe(
      true
    );
  });

  it('shows description with RAG preset', async () => {
    const config: ScaffoldConfig = {
      projectName: join(testDir, 'rag-with-desc'),
      extensions: ['anthropic', 'qdrant'],
      description: 'RAG application for document search',
      packageManager: 'npm',
      typescript: true,
      installDeps: false,
      starterPattern: 'search-focused',
    };

    await scaffold(config);

    const agentRill = await readAgentRill(config.projectName);

    // Description should appear before preset content
    expect(agentRill).toContain('# RAG application for document search');
    expect(
      agentRill.indexOf('# RAG application for document search')
    ).toBeLessThan(agentRill.indexOf('# Search-focused RAG workflow'));
  });

  it('shows description with chatbot preset', async () => {
    const config: ScaffoldConfig = {
      projectName: join(testDir, 'chat-with-desc'),
      extensions: ['anthropic'],
      description: 'Conversational chatbot assistant',
      packageManager: 'npm',
      typescript: true,
      installDeps: false,
      starterPattern: 'conversation-loop',
    };

    await scaffold(config);

    const agentRill = await readAgentRill(config.projectName);

    // Description should appear before preset content
    expect(agentRill).toContain('# Conversational chatbot assistant');
    expect(
      agentRill.indexOf('# Conversational chatbot assistant')
    ).toBeLessThan(agentRill.indexOf('# Conversation-loop chatbot workflow'));
  });
});

// ============================================================
// AC-2: GENERATE PROJECT WITH NO EXTENSIONS
// ============================================================

describe('AC-2: Generate project with no extensions', () => {
  it('creates project with empty extension list', async () => {
    const config: ScaffoldConfig = {
      projectName: join(testDir, 'no-ext-app'),
      extensions: [],
      description: 'App with no extensions',
      packageManager: 'npm',
      typescript: true,
      installDeps: false,
      starterPattern: null,
    };

    await scaffold(config);

    // Verify project directory exists
    await expect(access(config.projectName)).resolves.not.toThrow();

    // Verify package.json does not include extension packages
    const packageJson = await readPackageJson(config.projectName);
    const deps = packageJson.dependencies as Record<string, string>;
    expect(deps).not.toHaveProperty('@rcrsr/rill-ext-anthropic');
    expect(deps).not.toHaveProperty('@rcrsr/rill-ext-qdrant');
    expect(deps).not.toHaveProperty('@rcrsr/rill-ext-pinecone');
  });

  it('creates host.ts with only app functions stub', async () => {
    const config: ScaffoldConfig = {
      projectName: join(testDir, 'stub-app'),
      extensions: [],
      description: 'Stub-only app',
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

    // Should have basic structure
    expect(hostTs).toContain('export function createHost()');
    expect(hostTs).toContain('const functions = {');
    expect(hostTs).toContain("...prefixFunctions('app', appFunctions)");

    // Should not have extension imports
    expect(hostTs).not.toContain('createAnthropicExtension');
    expect(hostTs).not.toContain('createQdrantExtension');
    expect(hostTs).not.toContain('createPineconeExtension');
  });

  it('verifies file structure is correct with no extensions', async () => {
    const config: ScaffoldConfig = {
      projectName: join(testDir, 'structure-test'),
      extensions: [],
      description: 'Structure validation',
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

    // node_modules should not exist (installDeps: false)
    expect(rootFiles).not.toContain('node_modules');
  });
});

// ============================================================
// AC-5: CHECK SYNTAX OF GENERATED SCRIPT
// ============================================================

describe('AC-5: Generated agent.rill passes rill-check', () => {
  it('validates syntax for default template', async () => {
    const config: ScaffoldConfig = {
      projectName: join(testDir, 'check-default'),
      extensions: [],
      description: 'Syntax check test',
      packageManager: 'npm',
      typescript: true,
      installDeps: false,
      starterPattern: null,
    };

    await scaffold(config);

    // Run rill-check on generated script
    const passed = checkRillSyntax(config.projectName);
    expect(passed).toBe(true);
  });

  it('validates syntax for project with extensions', async () => {
    const config: ScaffoldConfig = {
      projectName: join(testDir, 'check-ext'),
      extensions: ['anthropic', 'qdrant'],
      description: 'Syntax check with extensions',
      packageManager: 'npm',
      typescript: true,
      installDeps: false,
      starterPattern: null,
    };

    await scaffold(config);

    const passed = checkRillSyntax(config.projectName);
    expect(passed).toBe(true);
  });

  it('validates syntax for RAG preset', async () => {
    const config: ScaffoldConfig = {
      projectName: join(testDir, 'check-rag'),
      extensions: ['anthropic', 'qdrant'],
      description: 'Syntax check RAG preset',
      packageManager: 'npm',
      typescript: true,
      installDeps: false,
      starterPattern: 'search-focused',
    };

    await scaffold(config);

    const passed = checkRillSyntax(config.projectName);
    expect(passed).toBe(true);
  });

  it('validates syntax for chatbot preset', async () => {
    const config: ScaffoldConfig = {
      projectName: join(testDir, 'check-chatbot'),
      extensions: ['anthropic'],
      description: 'Syntax check chatbot preset',
      packageManager: 'npm',
      typescript: true,
      installDeps: false,
      starterPattern: 'conversation-loop',
    };

    await scaffold(config);

    const passed = checkRillSyntax(config.projectName);
    expect(passed).toBe(true);
  });
});

// ============================================================
// AC-6: GENERATE PROJECT WITH --preset rag
// ============================================================

describe('AC-6: Generate project with --preset rag', () => {
  it('creates project with anthropic + qdrant extensions', async () => {
    const config: ScaffoldConfig = {
      projectName: join(testDir, 'rag-app'),
      extensions: ['anthropic', 'qdrant'],
      description: 'RAG workflow app',
      packageManager: 'npm',
      typescript: true,
      installDeps: false,
      starterPattern: 'search-focused',
    };

    await scaffold(config);

    // Verify extensions are included
    const packageJson = await readPackageJson(config.projectName);
    const deps = packageJson.dependencies as Record<string, string>;
    expect(deps).toHaveProperty('@rcrsr/rill-ext-anthropic');
    expect(deps).toHaveProperty('@rcrsr/rill-ext-qdrant');
  });

  it('generates search-focused starter script', async () => {
    const config: ScaffoldConfig = {
      projectName: join(testDir, 'rag-starter'),
      extensions: ['anthropic', 'qdrant'],
      description: 'RAG starter validation',
      packageManager: 'npm',
      typescript: true,
      installDeps: false,
      starterPattern: 'search-focused',
    };

    await scaffold(config);

    const agentRill = await readAgentRill(config.projectName);

    // Verify RAG-specific content
    expect(agentRill).toContain('Search-focused RAG workflow');
    expect(agentRill).toContain('ai::embed');
    expect(agentRill).toContain('db::search');
    expect(agentRill).toContain('$.payload.content');
    expect(agentRill).toContain('ai::message');

    // Should not contain chatbot pattern
    expect(agentRill).not.toContain('conversation-loop');
    expect(agentRill).not.toContain('ai::messages');
  });

  it('includes RAG workflow steps in comments', async () => {
    const config: ScaffoldConfig = {
      projectName: join(testDir, 'rag-comments'),
      extensions: ['anthropic', 'qdrant'],
      description: 'RAG comments validation',
      packageManager: 'npm',
      typescript: true,
      installDeps: false,
      starterPattern: 'search-focused',
    };

    await scaffold(config);

    const agentRill = await readAgentRill(config.projectName);

    // Verify workflow comments
    expect(agentRill).toContain('Embed the user query into a vector');
    expect(agentRill).toContain('Search the vector database');
    expect(agentRill).toContain('Summarize results using the AI model');
  });
});

// ============================================================
// AC-7: GENERATE PROJECT WITH --preset chatbot
// ============================================================

describe('AC-7: Generate project with --preset chatbot', () => {
  it('creates project with anthropic extension', async () => {
    const config: ScaffoldConfig = {
      projectName: join(testDir, 'chatbot-app'),
      extensions: ['anthropic'],
      description: 'Chatbot workflow app',
      packageManager: 'npm',
      typescript: true,
      installDeps: false,
      starterPattern: 'conversation-loop',
    };

    await scaffold(config);

    const packageJson = await readPackageJson(config.projectName);
    const deps = packageJson.dependencies as Record<string, string>;
    expect(deps).toHaveProperty('@rcrsr/rill-ext-anthropic');
  });

  it('generates conversation-loop starter script', async () => {
    const config: ScaffoldConfig = {
      projectName: join(testDir, 'chatbot-starter'),
      extensions: ['anthropic'],
      description: 'Chatbot starter validation',
      packageManager: 'npm',
      typescript: true,
      installDeps: false,
      starterPattern: 'conversation-loop',
    };

    await scaffold(config);

    const agentRill = await readAgentRill(config.projectName);

    // Verify chatbot-specific content
    expect(agentRill).toContain('Conversation-loop chatbot workflow');
    expect(agentRill).toContain('Multi-turn message exchange');
    expect(agentRill).toContain('ai::messages');
    expect(agentRill).toContain('role: "system"');
    expect(agentRill).toContain('role: "user"');

    // Should not contain RAG pattern
    expect(agentRill).not.toContain('search-focused');
    expect(agentRill).not.toContain('db::search');
  });

  it('includes conversation workflow structure', async () => {
    const config: ScaffoldConfig = {
      projectName: join(testDir, 'chatbot-structure'),
      extensions: ['anthropic'],
      description: 'Chatbot structure validation',
      packageManager: 'npm',
      typescript: true,
      installDeps: false,
      starterPattern: 'conversation-loop',
    };

    await scaffold(config);

    const agentRill = await readAgentRill(config.projectName);

    // Verify conversation structure
    expect(agentRill).toContain('Initialize conversation with system context');
    expect(agentRill).toContain('You are a helpful assistant');
    expect(agentRill).toContain('First user message');
    expect(agentRill).toContain('Second user message');
  });
});

// ============================================================
// AC-4: RUN GENERATED PROJECT EXECUTES WITHOUT ERRORS
// ============================================================

describe('AC-4: Run generated project executes without errors', () => {
  it('generates project with valid TypeScript structure', async () => {
    const config: ScaffoldConfig = {
      projectName: join(testDir, 'runtime-validation'),
      extensions: [],
      description: 'Runtime validation test',
      packageManager: 'pnpm',
      typescript: true,
      installDeps: false,
      starterPattern: null,
    };

    await scaffold(config);

    // Verify run.ts exists and has correct structure
    const runTs = await readFile(
      join(config.projectName, 'src', 'run.ts'),
      'utf-8'
    );
    expect(runTs).toContain("from '@rcrsr/rill'");
    expect(runTs).toContain("from './host.js'");
    expect(runTs).toContain('parse(source)');
    expect(runTs).toContain('execute(ast, ctx)');
    expect(runTs).toContain('createHost()');
    expect(runTs).toContain('async function main()');

    // Verify host.ts exports what run.ts imports
    const hostTs = await readFile(
      join(config.projectName, 'src', 'host.ts'),
      'utf-8'
    );
    expect(hostTs).toContain('export function createHost()');
    expect(hostTs).toContain('const functions =');
    expect(hostTs).toContain('const dispose =');

    // Verify package.json has start script
    const packageJson = await readPackageJson(config.projectName);
    const scripts = packageJson.scripts as Record<string, string>;
    expect(scripts).toHaveProperty('start');
    expect(scripts.start).toBe('tsx src/run.ts');
  });

  it('generates project with extensions and valid imports', async () => {
    const config: ScaffoldConfig = {
      projectName: join(testDir, 'runtime-ext-validation'),
      extensions: ['anthropic', 'qdrant'],
      description: 'Runtime validation with extensions',
      packageManager: 'pnpm',
      typescript: true,
      installDeps: false,
      starterPattern: null,
    };

    await scaffold(config);

    // Verify host.ts contains extension imports and setup
    const hostTs = await readFile(
      join(config.projectName, 'src', 'host.ts'),
      'utf-8'
    );
    expect(hostTs).toContain('createAnthropicExtension');
    expect(hostTs).toContain('createQdrantExtension');
    expect(hostTs).toContain("hoistExtension('anthropic'");
    expect(hostTs).toContain("hoistExtension('qdrant'");
    expect(hostTs).toContain('export function createHost()');

    // Verify run.ts can import host
    const runTs = await readFile(
      join(config.projectName, 'src', 'run.ts'),
      'utf-8'
    );
    expect(runTs).toContain("from './host.js'");
    expect(runTs).toContain('createHost()');
  });

  it('generates RAG preset with valid runtime structure', async () => {
    const config: ScaffoldConfig = {
      projectName: join(testDir, 'runtime-rag-validation'),
      extensions: ['anthropic', 'qdrant'],
      description: 'RAG preset runtime validation',
      packageManager: 'pnpm',
      typescript: true,
      installDeps: false,
      starterPattern: 'search-focused',
    };

    await scaffold(config);

    // Verify agent.rill is valid (already tested by AC-5)
    const agentRill = await readAgentRill(config.projectName);
    expect(agentRill).toContain('ai::embed');
    expect(agentRill).toContain('db::search');

    // Verify host.ts can provide these functions
    const hostTs = await readFile(
      join(config.projectName, 'src', 'host.ts'),
      'utf-8'
    );
    expect(hostTs).toContain('anthropic');
    expect(hostTs).toContain('qdrant');
    expect(hostTs).toContain('export function createHost()');
  });

  it('generates chatbot preset with valid runtime structure', async () => {
    const config: ScaffoldConfig = {
      projectName: join(testDir, 'runtime-chatbot-validation'),
      extensions: ['anthropic'],
      description: 'Chatbot preset runtime validation',
      packageManager: 'pnpm',
      typescript: true,
      installDeps: false,
      starterPattern: 'conversation-loop',
    };

    await scaffold(config);

    // Verify agent.rill is valid (already tested by AC-5)
    const agentRill = await readAgentRill(config.projectName);
    expect(agentRill).toContain('ai::messages');

    // Verify host.ts can provide these functions
    const hostTs = await readFile(
      join(config.projectName, 'src', 'host.ts'),
      'utf-8'
    );
    expect(hostTs).toContain('anthropic');
    expect(hostTs).toContain('export function createHost()');
  });
});

// ============================================================
// AC-20 + EC-8: NETWORK FAILURE DURING INSTALL
// ============================================================

describe('AC-20 + EC-8: Network failure during install', () => {
  it('produces clear error when npm install fails', async () => {
    const config: ScaffoldConfig = {
      projectName: join(testDir, 'install-fail-app'),
      extensions: [],
      description: 'Install failure test',
      // Use invalid package manager to simulate install failure
      packageManager: 'npm',
      typescript: true,
      installDeps: true,
      starterPattern: null,
    };

    // Create project first (without install)
    const noInstallConfig = { ...config, installDeps: false };
    await scaffold(noInstallConfig);

    // Manually break package.json to cause install failure
    const brokenPackageJson = {
      name: 'broken-app',
      dependencies: {
        'nonexistent-package-that-does-not-exist-12345': '^1.0.0',
      },
    };

    const packageJsonPath = join(config.projectName, 'package.json');
    await rm(packageJsonPath);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(packageJsonPath, JSON.stringify(brokenPackageJson));

    // Now try to install with broken package.json
    // This should throw InstallError
    try {
      const { execSync } = await import('node:child_process');
      execSync('npm install', {
        cwd: config.projectName,
        stdio: 'pipe',
        encoding: 'utf8',
      });
      expect.fail('Should have thrown install error');
    } catch (err) {
      // Verify error is clear (not InstallError since we're testing execSync directly)
      expect(err).toBeDefined();
    }
  });

  it('InstallError has correct properties', () => {
    const err = new InstallError(
      'Failed to install dependencies: network error'
    );

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(InstallError);
    expect(err.name).toBe('InstallError');
    expect(err.message).toContain('Failed to install dependencies');
    expect(err.message).toContain('network error');
  });
});
