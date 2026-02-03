/**
 * Rill Generation Script Tests: Boundary Conditions
 * Tests boundary cases for version generation script
 *
 * Specification Mapping (conduct/specifications/runtime-version.md):
 *
 * Acceptance Criteria (Boundary Conditions):
 * - AC-3: Prerelease version handling
 * - AC-9: Boundary version "0.0.0"
 * - AC-10: Prerelease identifier handling
 *
 * Implementation Coverage:
 * - IC-9: Script boundary case handling
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('Generation Script: Boundary Conditions', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'rill-generate-version-boundary-')
    );
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Execute generate-version.ts script in an isolated test environment.
   * Creates a copy of the script in testDir to run it in isolation.
   * Returns exit code, stdout, stderr, and generated file content.
   */
  async function execGenerateVersion(testDir: string): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    generatedContent: string | null;
  }> {
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

      proc.on('close', async (code) => {
        // Try to read generated file
        let generatedContent: string | null = null;
        const outputPath = path.join(outputDir, 'version-data.ts');
        try {
          generatedContent = await fs.readFile(outputPath, 'utf-8');
        } catch {
          // File not generated (expected for error cases)
        }

        resolve({
          exitCode: code ?? 0,
          stdout,
          stderr,
          generatedContent,
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

  /**
   * Parse generated TypeScript file to extract VERSION_INFO values.
   * Uses regex to avoid needing to compile TypeScript.
   */
  function parseGeneratedVersionInfo(content: string): {
    major: number;
    minor: number;
    patch: number;
    prerelease: string | undefined;
  } {
    const majorMatch = content.match(/major:\s*(\d+)/);
    const minorMatch = content.match(/minor:\s*(\d+)/);
    const patchMatch = content.match(/patch:\s*(\d+)/);
    const prereleaseMatch = content.match(
      /prerelease:\s*('([^']*)'|undefined)/
    );

    if (!majorMatch || !minorMatch || !patchMatch || !prereleaseMatch) {
      throw new Error('Failed to parse generated VERSION_INFO');
    }

    return {
      major: parseInt(majorMatch[1]!, 10),
      minor: parseInt(minorMatch[1]!, 10),
      patch: parseInt(patchMatch[1]!, 10),
      prerelease: prereleaseMatch[2] || undefined,
    };
  }

  describe('AC-3: Prerelease version handling', () => {
    it('parses version "1.0.0-beta.2" with prerelease "beta.2"', async () => {
      // AC-S3: Given package.json version "1.0.0-beta.2"
      // When import VERSION_INFO
      // Then equals {major:1, minor:0, patch:0, prerelease:"beta.2"}
      const testDir = path.join(tempDir, 'prerelease-beta');
      await fs.mkdir(testDir, { recursive: true });

      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '1.0.0-beta.2' })
      );

      const result = await execGenerateVersion(testDir);

      expect(result.exitCode).toBe(0);
      expect(result.generatedContent).not.toBeNull();

      const versionInfo = parseGeneratedVersionInfo(result.generatedContent!);
      expect(versionInfo.major).toBe(1);
      expect(versionInfo.minor).toBe(0);
      expect(versionInfo.patch).toBe(0);
      expect(versionInfo.prerelease).toBe('beta.2');
    });

    it('generated file contains VERSION constant "1.0.0-beta.2"', async () => {
      const testDir = path.join(tempDir, 'prerelease-beta-version');
      await fs.mkdir(testDir, { recursive: true });

      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '1.0.0-beta.2' })
      );

      const result = await execGenerateVersion(testDir);

      expect(result.exitCode).toBe(0);
      expect(result.generatedContent).toContain(
        "export const VERSION = '1.0.0-beta.2';"
      );
    });
  });

  describe('AC-9: Boundary version "0.0.0"', () => {
    it('parses version "0.0.0" with all components zero', async () => {
      // AC-B1: Given version "0.0.0"
      // When import VERSION_INFO
      // Then major=0, minor=0, patch=0
      const testDir = path.join(tempDir, 'boundary-zero');
      await fs.mkdir(testDir, { recursive: true });

      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '0.0.0' })
      );

      const result = await execGenerateVersion(testDir);

      expect(result.exitCode).toBe(0);
      expect(result.generatedContent).not.toBeNull();

      const versionInfo = parseGeneratedVersionInfo(result.generatedContent!);
      expect(versionInfo.major).toBe(0);
      expect(versionInfo.minor).toBe(0);
      expect(versionInfo.patch).toBe(0);
      expect(versionInfo.prerelease).toBeUndefined();
    });

    it('generated file contains VERSION constant "0.0.0"', async () => {
      const testDir = path.join(tempDir, 'boundary-zero-version');
      await fs.mkdir(testDir, { recursive: true });

      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '0.0.0' })
      );

      const result = await execGenerateVersion(testDir);

      expect(result.exitCode).toBe(0);
      expect(result.generatedContent).toContain(
        "export const VERSION = '0.0.0';"
      );
    });

    it('generated VERSION_INFO has prerelease undefined', async () => {
      const testDir = path.join(tempDir, 'boundary-zero-prerelease');
      await fs.mkdir(testDir, { recursive: true });

      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '0.0.0' })
      );

      const result = await execGenerateVersion(testDir);

      expect(result.exitCode).toBe(0);
      expect(result.generatedContent).toContain('prerelease: undefined');
    });
  });

  describe('AC-10: Prerelease identifier handling', () => {
    it('parses complex prerelease "alpha.1.2.3" correctly', async () => {
      // AC-B2: Given prerelease "alpha.1.2.3"
      // When import VERSION_INFO.prerelease
      // Then equals "alpha.1.2.3"
      const testDir = path.join(tempDir, 'prerelease-complex');
      await fs.mkdir(testDir, { recursive: true });

      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '2.5.9-alpha.1.2.3' })
      );

      const result = await execGenerateVersion(testDir);

      expect(result.exitCode).toBe(0);
      expect(result.generatedContent).not.toBeNull();

      const versionInfo = parseGeneratedVersionInfo(result.generatedContent!);
      expect(versionInfo.major).toBe(2);
      expect(versionInfo.minor).toBe(5);
      expect(versionInfo.patch).toBe(9);
      expect(versionInfo.prerelease).toBe('alpha.1.2.3');
    });

    it('preserves exact prerelease string without modification', async () => {
      const testDir = path.join(tempDir, 'prerelease-exact');
      await fs.mkdir(testDir, { recursive: true });

      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '1.0.0-alpha.1.2.3' })
      );

      const result = await execGenerateVersion(testDir);

      expect(result.exitCode).toBe(0);
      // Prerelease should be preserved exactly as "alpha.1.2.3"
      expect(result.generatedContent).toContain("prerelease: 'alpha.1.2.3'");
    });

    it('handles single-segment prerelease identifiers', async () => {
      const testDir = path.join(tempDir, 'prerelease-single');
      await fs.mkdir(testDir, { recursive: true });

      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '3.2.1-rc' })
      );

      const result = await execGenerateVersion(testDir);

      expect(result.exitCode).toBe(0);
      expect(result.generatedContent).not.toBeNull();

      const versionInfo = parseGeneratedVersionInfo(result.generatedContent!);
      expect(versionInfo.prerelease).toBe('rc');
    });

    it('handles hyphen-separated prerelease identifiers', async () => {
      const testDir = path.join(tempDir, 'prerelease-hyphen');
      await fs.mkdir(testDir, { recursive: true });

      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({
          name: 'test-package',
          version: '1.5.2-beta-1-fix',
        })
      );

      const result = await execGenerateVersion(testDir);

      expect(result.exitCode).toBe(0);
      expect(result.generatedContent).not.toBeNull();

      const versionInfo = parseGeneratedVersionInfo(result.generatedContent!);
      expect(versionInfo.prerelease).toBe('beta-1-fix');
    });
  });

  describe('Prerelease Edge Cases', () => {
    it('handles prerelease with numeric-only segments', async () => {
      const testDir = path.join(tempDir, 'prerelease-numeric');
      await fs.mkdir(testDir, { recursive: true });

      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '1.0.0-20250203' })
      );

      const result = await execGenerateVersion(testDir);

      expect(result.exitCode).toBe(0);
      expect(result.generatedContent).not.toBeNull();

      const versionInfo = parseGeneratedVersionInfo(result.generatedContent!);
      expect(versionInfo.prerelease).toBe('20250203');
    });

    it('handles prerelease with mixed alphanumeric', async () => {
      const testDir = path.join(tempDir, 'prerelease-mixed');
      await fs.mkdir(testDir, { recursive: true });

      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '1.0.0-rc.1a2b3c' })
      );

      const result = await execGenerateVersion(testDir);

      expect(result.exitCode).toBe(0);
      expect(result.generatedContent).not.toBeNull();

      const versionInfo = parseGeneratedVersionInfo(result.generatedContent!);
      expect(versionInfo.prerelease).toBe('rc.1a2b3c');
    });
  });

  describe('Generated File Structure', () => {
    it('generates valid TypeScript syntax', async () => {
      const testDir = path.join(tempDir, 'syntax-check');
      await fs.mkdir(testDir, { recursive: true });

      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '1.2.3-beta.4' })
      );

      const result = await execGenerateVersion(testDir);

      expect(result.exitCode).toBe(0);
      expect(result.generatedContent).not.toBeNull();

      // Check required exports exist
      expect(result.generatedContent).toContain('export const VERSION =');
      expect(result.generatedContent).toContain('export const VERSION_INFO:');
      expect(result.generatedContent).toContain('export interface VersionInfo');

      // Check structure
      expect(result.generatedContent).toContain('readonly major: number');
      expect(result.generatedContent).toContain('readonly minor: number');
      expect(result.generatedContent).toContain('readonly patch: number');
      expect(result.generatedContent).toContain(
        'readonly prerelease: string | undefined'
      );
    });

    it('includes auto-generated warning comment', async () => {
      const testDir = path.join(tempDir, 'warning-check');
      await fs.mkdir(testDir, { recursive: true });

      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '1.0.0' })
      );

      const result = await execGenerateVersion(testDir);

      expect(result.exitCode).toBe(0);
      expect(result.generatedContent).toContain(
        '// AUTO-GENERATED - DO NOT EDIT'
      );
      expect(result.generatedContent).toContain(
        '// Generated by scripts/generate-version.ts'
      );
    });
  });
});
