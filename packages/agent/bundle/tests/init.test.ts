import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, rm, readFile, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initProject } from '../src/init.js';
import { ComposeError } from '@rcrsr/rill-agent-shared';

// ============================================================
// TEMP DIR + CWD HELPERS
// ============================================================

const tmpDirs: string[] = [];
let originalCwd: string;

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rill-init-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  // Restore cwd before cleanup so rm can always succeed
  if (originalCwd) {
    process.chdir(originalCwd);
  }
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

// ============================================================
// AC-27: initProject creates directory with required files
// ============================================================

describe('initProject success cases', () => {
  // ----------------------------------------------------------
  // AC-27: Creates agent.json, main.rill, package.json
  // ----------------------------------------------------------
  it('creates agent.json, main.rill, and package.json in new directory [AC-27]', async () => {
    const tmpDir = await makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    await initProject('test-project');

    const projectDir = path.join(tmpDir, 'test-project');
    expect(existsSync(path.join(projectDir, 'agent.json'))).toBe(true);
    expect(existsSync(path.join(projectDir, 'main.rill'))).toBe(true);
    expect(existsSync(path.join(projectDir, 'package.json'))).toBe(true);
  });

  // ----------------------------------------------------------
  // Additional: agent.json has correct shape
  // ----------------------------------------------------------
  it('agent.json has correct name, version, runtime, and entry fields', async () => {
    const tmpDir = await makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    await initProject('my-agent');

    const raw = await readFile(
      path.join(tmpDir, 'my-agent', 'agent.json'),
      'utf-8'
    );
    const agentJson = JSON.parse(raw) as Record<string, unknown>;

    expect(agentJson['name']).toBe('my-agent');
    expect(agentJson['version']).toBe('0.1.0');
    expect(typeof agentJson['runtime']).toBe('string');
    expect(agentJson['entry']).toBe('main.rill');
    expect(typeof agentJson['extensions']).toBe('object');
    expect(typeof agentJson['modules']).toBe('object');
  });

  // ----------------------------------------------------------
  // Additional: package.json has type: "module" and build/check scripts
  // ----------------------------------------------------------
  it('package.json has type: "module" and build and check scripts', async () => {
    const tmpDir = await makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    await initProject('my-agent');

    const raw = await readFile(
      path.join(tmpDir, 'my-agent', 'package.json'),
      'utf-8'
    );
    const pkgJson = JSON.parse(raw) as Record<string, unknown>;

    expect(pkgJson['type']).toBe('module');
    expect(typeof pkgJson['scripts']).toBe('object');
    const scripts = pkgJson['scripts'] as Record<string, unknown>;
    expect(typeof scripts['build']).toBe('string');
    expect(typeof scripts['check']).toBe('string');
  });

  // ----------------------------------------------------------
  // Additional: extensions option creates entries in agent.json
  // ----------------------------------------------------------
  it('extensions option adds entries to agent.json extensions record', async () => {
    const tmpDir = await makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    await initProject('my-agent', {
      extensions: ['@rcrsr/rill-ext-fetch', '@rcrsr/rill-ext-log'],
    });

    const raw = await readFile(
      path.join(tmpDir, 'my-agent', 'agent.json'),
      'utf-8'
    );
    const agentJson = JSON.parse(raw) as Record<string, unknown>;
    const extensions = agentJson['extensions'] as Record<string, unknown>;

    expect(typeof extensions['rill-ext-fetch']).toBe('object');
    expect(typeof extensions['rill-ext-log']).toBe('object');

    const fetchEntry = extensions['rill-ext-fetch'] as Record<string, unknown>;
    expect(fetchEntry['package']).toBe('@rcrsr/rill-ext-fetch');
  });

  // ----------------------------------------------------------
  // Additional: main.rill is created with non-empty content
  // ----------------------------------------------------------
  it('main.rill is created with non-empty content referencing the project name', async () => {
    const tmpDir = await makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    await initProject('my-agent');

    const content = await readFile(
      path.join(tmpDir, 'my-agent', 'main.rill'),
      'utf-8'
    );
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain('my-agent');
  });
});

// ============================================================
// AC-35 / EC-18: Directory already exists → ComposeError phase 'init'
// ============================================================

describe('initProject error cases', () => {
  // ----------------------------------------------------------
  // AC-35 / EC-18: Directory exists → ComposeError phase 'init'
  // ----------------------------------------------------------
  it('throws ComposeError phase init when directory already exists [AC-35/EC-18]', async () => {
    const tmpDir = await makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    // Create the directory first
    await mkdir(path.join(tmpDir, 'existing-project'));

    await expect(initProject('existing-project')).rejects.toSatisfy(
      (e: unknown) => {
        return e instanceof ComposeError && e.phase === 'init';
      }
    );
  });

  it('error message includes the directory name when directory exists [AC-35/EC-18]', async () => {
    const tmpDir = await makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    await mkdir(path.join(tmpDir, 'existing-project'));

    await expect(initProject('existing-project')).rejects.toSatisfy(
      (e: unknown) => {
        return (
          e instanceof ComposeError &&
          e.phase === 'init' &&
          e.message.includes('existing-project')
        );
      }
    );
  });
});
