/**
 * Rill Generation Script Tests: Error Cases
 * Tests error handling in scripts/generate-version.ts
 *
 * Specification Mapping (conduct/specifications/runtime-version.md):
 *
 * Error Contracts:
 * - EC-1: package.json not found -> exit 1 with "package.json not found"
 * - EC-2: package.json missing version field -> exit 1 with "missing version field"
 * - EC-3: Invalid semver format -> exit 1 with "Invalid semver format"
 *
 * Acceptance Criteria:
 * - AC-6: Error case - package.json missing
 * - AC-7: Error case - version field missing
 * - AC-8: Error case - invalid semver
 *
 * Implementation Coverage:
 * - IC-9: Script error handling
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('Generation Script: Error Cases', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'rill-generate-version-test-')
    );
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Execute generate-version.ts script in an isolated test environment.
   * Creates a copy of the script in testDir to run it in isolation.
   * Returns exit code, stdout, and stderr.
   */
  async function execGenerateVersion(
    testDir: string
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise(async (resolve) => {
      // Copy the script to test directory so it resolves paths relative to testDir
      const originalScriptPath = path.join(
        process.cwd(),
        'scripts',
        'generate-version.ts'
      );
      const originalScriptContent = await fs.readFile(
        originalScriptPath,
        'utf-8'
      );

      // Create scripts directory in testDir
      const scriptsDir = path.join(testDir, 'scripts');
      await fs.mkdir(scriptsDir, { recursive: true });

      // Write the script to test directory
      const testScriptPath = path.join(scriptsDir, 'generate-version.ts');
      await fs.writeFile(testScriptPath, originalScriptContent, 'utf-8');

      // Create src/runtime/core directory for output
      const outputDir = path.join(testDir, 'src', 'runtime', 'core');
      await fs.mkdir(outputDir, { recursive: true });

      const proc = spawn('npx', ['tsx', testScriptPath], {
        cwd: testDir,
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        resolve({
          exitCode: code ?? 0,
          stdout,
          stderr,
        });
      });
    });
  }

  /**
   * Write a file to a specific directory and return its path.
   */
  async function writeFile(
    dir: string,
    name: string,
    content: string
  ): Promise<string> {
    const filePath = path.join(dir, name);
    await fs.writeFile(filePath, content, 'utf-8');
    return filePath;
  }

  describe('EC-1: package.json not found [AC-6]', () => {
    it('exits with code 1 when package.json missing', async () => {
      // Create empty directory (no package.json)
      const testDir = path.join(tempDir, 'no-package-json');
      await fs.mkdir(testDir, { recursive: true });

      const result = await execGenerateVersion(testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('ERROR: package.json not found');
      expect(result.stderr).toContain(path.join(testDir, 'package.json'));
    });

    it('error message includes full path to missing file', async () => {
      const testDir = path.join(tempDir, 'no-package-json-path');
      await fs.mkdir(testDir, { recursive: true });

      const result = await execGenerateVersion(testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/ERROR: package\.json not found: .+/);
      // Should include absolute path
      expect(result.stderr).toContain(testDir);
    });
  });

  describe('EC-2: package.json missing version field [AC-7]', () => {
    it('exits with code 1 when version field missing', async () => {
      const testDir = path.join(tempDir, 'missing-version');
      await fs.mkdir(testDir, { recursive: true });

      // Create package.json without version field
      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package' })
      );

      const result = await execGenerateVersion(testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        'ERROR: package.json missing version field'
      );
    });

    it('exits with code 1 when version field is empty string', async () => {
      const testDir = path.join(tempDir, 'empty-version');
      await fs.mkdir(testDir, { recursive: true });

      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '' })
      );

      const result = await execGenerateVersion(testDir);

      // Empty string version is treated as missing (falsy check)
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        'ERROR: package.json missing version field'
      );
    });

    it('exits with code 1 when version field is null', async () => {
      const testDir = path.join(tempDir, 'null-version');
      await fs.mkdir(testDir, { recursive: true });

      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: null })
      );

      const result = await execGenerateVersion(testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        'ERROR: package.json missing version field'
      );
    });
  });

  describe('EC-3: Invalid semver format [AC-8]', () => {
    it('exits with code 1 for invalid semver "not-a-version"', async () => {
      const testDir = path.join(tempDir, 'invalid-semver-1');
      await fs.mkdir(testDir, { recursive: true });

      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: 'not-a-version' })
      );

      const result = await execGenerateVersion(testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        'ERROR: Invalid semver format: not-a-version'
      );
    });

    it('exits with code 1 for invalid semver "1.2"', async () => {
      const testDir = path.join(tempDir, 'invalid-semver-2');
      await fs.mkdir(testDir, { recursive: true });

      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '1.2' })
      );

      const result = await execGenerateVersion(testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('ERROR: Invalid semver format: 1.2');
    });

    it('exits with code 1 for invalid semver "v1.2.3"', async () => {
      const testDir = path.join(tempDir, 'invalid-semver-3');
      await fs.mkdir(testDir, { recursive: true });

      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: 'v1.2.3' })
      );

      const result = await execGenerateVersion(testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('ERROR: Invalid semver format: v1.2.3');
    });

    it('exits with code 1 for invalid semver "1.2.3.4"', async () => {
      const testDir = path.join(tempDir, 'invalid-semver-4');
      await fs.mkdir(testDir, { recursive: true });

      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '1.2.3.4' })
      );

      const result = await execGenerateVersion(testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('ERROR: Invalid semver format: 1.2.3.4');
    });

    it('error message includes invalid version string', async () => {
      const testDir = path.join(tempDir, 'invalid-semver-message');
      await fs.mkdir(testDir, { recursive: true });

      const invalidVersion = 'totally-wrong';
      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: invalidVersion })
      );

      const result = await execGenerateVersion(testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/ERROR: Invalid semver format: .+/);
      expect(result.stderr).toContain(invalidVersion);
    });
  });

  describe('Valid Semver Formats (negative tests)', () => {
    it('succeeds for valid semver "1.2.3"', async () => {
      const testDir = path.join(tempDir, 'valid-semver-1');
      await fs.mkdir(testDir, { recursive: true });

      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '1.2.3' })
      );

      const result = await execGenerateVersion(testDir);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain('ERROR');
    });

    it('succeeds for valid semver "0.4.5"', async () => {
      const testDir = path.join(tempDir, 'valid-semver-2');
      await fs.mkdir(testDir, { recursive: true });

      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '0.4.5' })
      );

      const result = await execGenerateVersion(testDir);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain('ERROR');
    });

    it('succeeds for valid semver with prerelease "1.2.3-alpha.1"', async () => {
      const testDir = path.join(tempDir, 'valid-semver-prerelease');
      await fs.mkdir(testDir, { recursive: true });

      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '1.2.3-alpha.1' })
      );

      const result = await execGenerateVersion(testDir);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain('ERROR');
    });
  });

  describe('Error Message Format', () => {
    it('writes error messages to stderr, not stdout', async () => {
      const testDir = path.join(tempDir, 'stderr-check');
      await fs.mkdir(testDir, { recursive: true });

      const result = await execGenerateVersion(testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('ERROR');
      expect(result.stdout).not.toContain('ERROR');
    });

    it('error message starts with ERROR: prefix', async () => {
      const testDir = path.join(tempDir, 'error-prefix');
      await fs.mkdir(testDir, { recursive: true });

      const result = await execGenerateVersion(testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/^ERROR: /);
    });
  });
});
