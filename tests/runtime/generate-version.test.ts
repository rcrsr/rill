/**
 * Rill Generation Script Tests
 *
 * Tests the generate-version.ts script that creates version-data.ts from package.json.
 * Uses direct import for happy path (fast) and process spawn only for error cases.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import { VERSION, VERSION_INFO } from '../../src/generated/version-data.js';

describe('Version Generation', () => {
  describe('Generated output', () => {
    it('exports VERSION string matching package.json', async () => {
      const packageJson = JSON.parse(
        await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf-8')
      );
      expect(VERSION).toBe(packageJson.version);
    });

    it('exports VERSION_INFO with parsed components', () => {
      expect(typeof VERSION_INFO.major).toBe('number');
      expect(typeof VERSION_INFO.minor).toBe('number');
      expect(typeof VERSION_INFO.patch).toBe('number');

      // Reconstruct version string from components
      const reconstructed = VERSION_INFO.prerelease
        ? `${VERSION_INFO.major}.${VERSION_INFO.minor}.${VERSION_INFO.patch}-${VERSION_INFO.prerelease}`
        : `${VERSION_INFO.major}.${VERSION_INFO.minor}.${VERSION_INFO.patch}`;
      expect(reconstructed).toBe(VERSION);
    });
  });

  describe('Script error handling', () => {
    let tempDir: string;

    beforeAll(async () => {
      tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'rill-generate-version-')
      );
    });

    afterAll(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    async function runScript(
      testDir: string
    ): Promise<{ exitCode: number; stderr: string }> {
      const scriptsDir = path.join(testDir, 'scripts');
      await fs.mkdir(scriptsDir, { recursive: true });
      await fs.mkdir(path.join(testDir, 'src', 'generated'), {
        recursive: true,
      });

      const scriptContent = await fs.readFile(
        path.join(process.cwd(), 'scripts', 'generate-version.ts'),
        'utf-8'
      );
      const testScriptPath = path.join(scriptsDir, 'generate-version.ts');
      await fs.writeFile(testScriptPath, scriptContent, 'utf-8');

      return new Promise((resolve) => {
        const proc = spawn('npx', ['tsx', testScriptPath], {
          cwd: testDir,
          env: { ...process.env },
        });

        let stderr = '';
        proc.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        proc.on('close', (code) => {
          resolve({ exitCode: code ?? 0, stderr });
        });
      });
    }

    it('exits 1 when package.json missing', async () => {
      const testDir = path.join(tempDir, 'no-package');
      await fs.mkdir(testDir, { recursive: true });

      const result = await runScript(testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('package.json not found');
    });

    it('exits 1 when version field missing', async () => {
      const testDir = path.join(tempDir, 'no-version');
      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(
        path.join(testDir, 'package.json'),
        JSON.stringify({ name: 'test' }),
        'utf-8'
      );

      const result = await runScript(testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('missing version field');
    });

    it('exits 1 for invalid semver format', async () => {
      const testDir = path.join(tempDir, 'bad-semver');
      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(
        path.join(testDir, 'package.json'),
        JSON.stringify({ name: 'test', version: 'not-valid' }),
        'utf-8'
      );

      const result = await runScript(testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Invalid semver format');
    });
  });
});
