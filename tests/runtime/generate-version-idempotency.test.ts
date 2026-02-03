/**
 * Rill Generation Script Tests: Idempotency
 * Tests that generate-version.ts produces identical output on repeated execution
 *
 * Specification Mapping (conduct/specifications/runtime-version.md):
 *
 * Acceptance Criteria:
 * - AC-11: Idempotency verification
 *   - AC-B3: consecutive builds unchanged -> files identical
 *
 * Implementation Coverage:
 * - IC-11: Script idempotency verification
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('Generation Script: Idempotency', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'rill-generate-version-idempotency-')
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
   * Compute SHA-256 hash of content for reliable comparison.
   */
  function computeHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  describe('AC-11: Idempotency verification [AC-B3]', () => {
    it('produces identical output on consecutive runs with unchanged package.json', async () => {
      // AC-B3: Given consecutive builds unchanged
      // When compare outputs
      // Then files identical
      const testDir = path.join(tempDir, 'idempotency-basic');
      await fs.mkdir(testDir, { recursive: true });

      // Create package.json with stable version
      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '1.2.3' })
      );

      // First execution
      const result1 = await execGenerateVersion(testDir);
      expect(result1.exitCode).toBe(0);
      expect(result1.generatedContent).not.toBeNull();

      const hash1 = computeHash(result1.generatedContent!);

      // Second execution (without changing package.json)
      const result2 = await execGenerateVersion(testDir);
      expect(result2.exitCode).toBe(0);
      expect(result2.generatedContent).not.toBeNull();

      const hash2 = computeHash(result2.generatedContent!);

      // Hashes must be identical
      expect(hash2).toBe(hash1);

      // Ensure content is byte-for-byte identical
      expect(result2.generatedContent).toBe(result1.generatedContent);
    });

    it('produces identical output across three consecutive runs', async () => {
      const testDir = path.join(tempDir, 'idempotency-triple');
      await fs.mkdir(testDir, { recursive: true });

      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '2.0.0-beta.1' })
      );

      // Execute three times
      const result1 = await execGenerateVersion(testDir);
      const result2 = await execGenerateVersion(testDir);
      const result3 = await execGenerateVersion(testDir);

      expect(result1.exitCode).toBe(0);
      expect(result2.exitCode).toBe(0);
      expect(result3.exitCode).toBe(0);

      const hash1 = computeHash(result1.generatedContent!);
      const hash2 = computeHash(result2.generatedContent!);
      const hash3 = computeHash(result3.generatedContent!);

      // All hashes identical
      expect(hash2).toBe(hash1);
      expect(hash3).toBe(hash1);

      // Byte-for-byte content identity
      expect(result2.generatedContent).toBe(result1.generatedContent);
      expect(result3.generatedContent).toBe(result1.generatedContent);
    });

    it('produces identical output for version with prerelease identifier', async () => {
      const testDir = path.join(tempDir, 'idempotency-prerelease');
      await fs.mkdir(testDir, { recursive: true });

      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '0.4.5-alpha.1.2.3' })
      );

      const result1 = await execGenerateVersion(testDir);
      const result2 = await execGenerateVersion(testDir);

      expect(result1.exitCode).toBe(0);
      expect(result2.exitCode).toBe(0);

      const hash1 = computeHash(result1.generatedContent!);
      const hash2 = computeHash(result2.generatedContent!);

      expect(hash2).toBe(hash1);
      expect(result2.generatedContent).toBe(result1.generatedContent);
    });

    it('produces identical output for boundary version "0.0.0"', async () => {
      const testDir = path.join(tempDir, 'idempotency-zero');
      await fs.mkdir(testDir, { recursive: true });

      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '0.0.0' })
      );

      const result1 = await execGenerateVersion(testDir);
      const result2 = await execGenerateVersion(testDir);

      expect(result1.exitCode).toBe(0);
      expect(result2.exitCode).toBe(0);

      const hash1 = computeHash(result1.generatedContent!);
      const hash2 = computeHash(result2.generatedContent!);

      expect(hash2).toBe(hash1);
      expect(result2.generatedContent).toBe(result1.generatedContent);
    });

    it('produces different output when package.json version changes', async () => {
      // Negative test: verify that script DOES change output when input changes
      const testDir = path.join(tempDir, 'idempotency-negative');
      await fs.mkdir(testDir, { recursive: true });

      // First version
      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '1.0.0' })
      );

      const result1 = await execGenerateVersion(testDir);
      expect(result1.exitCode).toBe(0);

      const hash1 = computeHash(result1.generatedContent!);

      // Change version
      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '2.0.0' })
      );

      const result2 = await execGenerateVersion(testDir);
      expect(result2.exitCode).toBe(0);

      const hash2 = computeHash(result2.generatedContent!);

      // Hashes must be DIFFERENT (version changed)
      expect(hash2).not.toBe(hash1);
      expect(result2.generatedContent).not.toBe(result1.generatedContent);
    });
  });

  describe('Idempotency with Package Metadata', () => {
    it('produces identical output regardless of package.json field order', async () => {
      const testDir = path.join(tempDir, 'idempotency-field-order');
      await fs.mkdir(testDir, { recursive: true });

      // First run: version field first
      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ version: '1.5.0', name: 'test-package' })
      );

      const result1 = await execGenerateVersion(testDir);
      expect(result1.exitCode).toBe(0);

      // Second run: name field first (different order)
      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '1.5.0' })
      );

      const result2 = await execGenerateVersion(testDir);
      expect(result2.exitCode).toBe(0);

      // Output should be identical (only version field matters)
      const hash1 = computeHash(result1.generatedContent!);
      const hash2 = computeHash(result2.generatedContent!);

      expect(hash2).toBe(hash1);
      expect(result2.generatedContent).toBe(result1.generatedContent);
    });

    it('produces identical output regardless of additional package.json fields', async () => {
      const testDir = path.join(tempDir, 'idempotency-extra-fields');
      await fs.mkdir(testDir, { recursive: true });

      // First run: minimal package.json
      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '3.0.0' })
      );

      const result1 = await execGenerateVersion(testDir);
      expect(result1.exitCode).toBe(0);

      // Second run: additional fields (description, license, etc.)
      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({
          name: 'test-package',
          version: '3.0.0',
          description: 'Test description',
          license: 'MIT',
          author: 'Test Author',
          keywords: ['test', 'example'],
        })
      );

      const result2 = await execGenerateVersion(testDir);
      expect(result2.exitCode).toBe(0);

      // Output should be identical (only version field matters)
      const hash1 = computeHash(result1.generatedContent!);
      const hash2 = computeHash(result2.generatedContent!);

      expect(hash2).toBe(hash1);
      expect(result2.generatedContent).toBe(result1.generatedContent);
    });

    it('produces identical output regardless of JSON formatting', async () => {
      const testDir = path.join(tempDir, 'idempotency-formatting');
      await fs.mkdir(testDir, { recursive: true });

      // First run: compact JSON
      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '4.5.6' })
      );

      const result1 = await execGenerateVersion(testDir);
      expect(result1.exitCode).toBe(0);

      // Second run: pretty-printed JSON with indentation
      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '4.5.6' }, null, 2)
      );

      const result2 = await execGenerateVersion(testDir);
      expect(result2.exitCode).toBe(0);

      // Output should be identical (JSON content is same)
      const hash1 = computeHash(result1.generatedContent!);
      const hash2 = computeHash(result2.generatedContent!);

      expect(hash2).toBe(hash1);
      expect(result2.generatedContent).toBe(result1.generatedContent);
    });
  });

  describe('Hash Verification', () => {
    it('uses cryptographic hash for reliable comparison', async () => {
      const testDir = path.join(tempDir, 'hash-verification');
      await fs.mkdir(testDir, { recursive: true });

      await writeFile(
        testDir,
        'package.json',
        JSON.stringify({ name: 'test-package', version: '1.0.0' })
      );

      const result1 = await execGenerateVersion(testDir);
      expect(result1.exitCode).toBe(0);

      const hash = computeHash(result1.generatedContent!);

      // Hash should be 64 hex characters (SHA-256)
      expect(hash).toMatch(/^[a-f0-9]{64}$/);

      // Same content produces same hash
      const hash2 = computeHash(result1.generatedContent!);
      expect(hash2).toBe(hash);
    });

    it('detects even single character differences', async () => {
      const content1 = 'export const VERSION = "1.0.0";';
      const content2 = 'export const VERSION = "1.0.1";'; // Changed '0' to '1'

      const hash1 = computeHash(content1);
      const hash2 = computeHash(content2);

      // Hashes must be different (content differs by one character)
      expect(hash2).not.toBe(hash1);
    });
  });
});
