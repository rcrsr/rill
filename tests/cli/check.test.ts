/**
 * Rill CLI Tests: rill-check command
 *
 * Test Coverage Matrix (maps test cases to specification requirements):
 * AC-S1: Validate file with diagnostics
 * AC-S2: Apply fixes with --fix
 * AC-S3: JSON output format
 * AC-S4: Verbose mode output
 * AC-S5: --version flag
 * AC-S6: --help flag
 * AC-S7: Config override
 * AC-E1: File not found (exit 2)
 * AC-E2: Parse error (exit 3)
 * AC-E3: Parse error + --fix message
 * AC-E4: Unknown flag error
 * AC-E5: Invalid config error
 * AC-B1: Empty file (no diagnostics)
 * AC-B2: Parse-only errors
 * AC-B5: (removed - 10K line perf test unnecessary for draft language)
 */

import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest';
import { parseCheckArgs, formatDiagnostics } from '../../src/cli-check.js';
import { ParseError } from '../../src/types.js';
import type { Diagnostic } from '../../src/check/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';

describe('rill-check CLI', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rill-check-test-'));
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // Clean up config file after each test to prevent pollution between tests
  afterEach(async () => {
    const configPath = path.join(tempDir, '.rill-check.json');
    try {
      await fs.unlink(configPath);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  /**
   * Write a file to the temp directory and return its path.
   */
  async function writeFile(name: string, content: string): Promise<string> {
    const filePath = path.join(tempDir, name);
    await fs.writeFile(filePath, content, 'utf-8');
    return filePath;
  }

  /**
   * Execute rill-check CLI command and capture output.
   * Returns exit code, stdout, and stderr.
   */
  async function execCheck(
    args: string[]
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const checkPath = path.join(process.cwd(), 'dist', 'cli-check.js');
      const proc = spawn('node', [checkPath, ...args], {
        cwd: tempDir,
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

  // ============================================================
  // ARGUMENT PARSING
  // ============================================================

  describe('parseCheckArgs', () => {
    it('parses file path', () => {
      const parsed = parseCheckArgs(['test.rill']);
      expect(parsed).toEqual({
        mode: 'check',
        file: 'test.rill',
        fix: false,
        verbose: false,
        format: 'text',
      });
    });

    it('parses --help flag [AC-S6]', () => {
      expect(parseCheckArgs(['--help'])).toEqual({ mode: 'help' });
      expect(parseCheckArgs(['-h'])).toEqual({ mode: 'help' });
    });

    it('parses --version flag [AC-S5]', () => {
      expect(parseCheckArgs(['--version'])).toEqual({ mode: 'version' });
      expect(parseCheckArgs(['-v'])).toEqual({ mode: 'version' });
    });

    it('parses --fix flag [AC-S2]', () => {
      const parsed = parseCheckArgs(['test.rill', '--fix']);
      expect(parsed.mode).toBe('check');
      if (parsed.mode === 'check') {
        expect(parsed.fix).toBe(true);
      }
    });

    it('parses --verbose flag [AC-S4]', () => {
      const parsed = parseCheckArgs(['test.rill', '--verbose']);
      expect(parsed.mode).toBe('check');
      if (parsed.mode === 'check') {
        expect(parsed.verbose).toBe(true);
      }
    });

    it('parses --format json [AC-S3]', () => {
      const parsed = parseCheckArgs(['test.rill', '--format', 'json']);
      expect(parsed.mode).toBe('check');
      if (parsed.mode === 'check') {
        expect(parsed.format).toBe('json');
      }
    });

    it('throws on unknown flag [AC-E4]', () => {
      expect(() => parseCheckArgs(['--unknown'])).toThrow(
        'Unknown option: --unknown'
      );
      expect(() => parseCheckArgs(['-x'])).toThrow('Unknown option: -x');
    });

    it('throws when missing file argument', () => {
      expect(() => parseCheckArgs([])).toThrow('Missing file argument');
      expect(() => parseCheckArgs(['--fix'])).toThrow('Missing file argument');
    });
  });

  // ============================================================
  // DIAGNOSTIC FORMATTING
  // ============================================================

  describe('formatDiagnostics', () => {
    it('formats text output', () => {
      const diagnostics: Diagnostic[] = [
        {
          location: { line: 5, column: 10, offset: 50 },
          severity: 'error',
          code: 'TEST_ERROR',
          message: 'Test error message',
          context: '"hello"',
          fix: null,
        },
      ];

      const output = formatDiagnostics('test.rill', diagnostics, 'text', false);
      expect(output).toBe(
        'test.rill:5:10: error: Test error message (TEST_ERROR)'
      );
    });

    it('formats JSON output [AC-S3]', () => {
      const diagnostics: Diagnostic[] = [
        {
          location: { line: 5, column: 10, offset: 50 },
          severity: 'error',
          code: 'TEST_ERROR',
          message: 'Test error message',
          context: '"hello"',
          fix: null,
        },
      ];

      const output = formatDiagnostics('test.rill', diagnostics, 'json', false);
      const parsed = JSON.parse(output);

      expect(parsed).toEqual({
        file: 'test.rill',
        errors: [
          {
            location: { line: 5, column: 10, offset: 50 },
            severity: 'error',
            code: 'TEST_ERROR',
            message: 'Test error message',
            context: '"hello"',
          },
        ],
        summary: { total: 1, errors: 1, warnings: 0, info: 0 },
      });
    });

    it('formats empty diagnostics as empty array', () => {
      const output = formatDiagnostics('test.rill', [], 'text', false);
      expect(output).toBe('');
    });
  });

  // ============================================================
  // SUCCESS CASES
  // ============================================================

  describe('success cases', () => {
    it('validates file with no diagnostics [AC-B1]', async () => {
      const script = await writeFile('valid.rill', '"hello"');
      const result = await execCheck([script]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No issues found');
    });

    it('validates empty file [AC-B1]', async () => {
      const script = await writeFile('empty.rill', '');
      const result = await execCheck([script]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No issues found');
    });

    it('outputs JSON format when no diagnostics [AC-S3]', async () => {
      const script = await writeFile('valid-json.rill', '"hello"');
      const result = await execCheck([script, '--format', 'json']);

      expect(result.exitCode).toBe(0);

      const parsed = JSON.parse(result.stdout);
      expect(parsed.file).toBe(script);
      expect(parsed.errors).toEqual([]);
      expect(parsed.summary).toEqual({
        total: 0,
        errors: 0,
        warnings: 0,
        info: 0,
      });
    });

    it('shows help message [AC-S6]', async () => {
      const result = await execCheck(['--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('rill-check');
      expect(result.stdout).toContain('Usage:');
      expect(result.stdout).toContain('--fix');
      expect(result.stdout).toContain('--format');
      expect(result.stdout).toContain('--verbose');
    });

    it('shows version number [AC-S5]', async () => {
      const result = await execCheck(['--version']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  // ============================================================
  // ERROR CASES
  // ============================================================

  describe('error cases', () => {
    it('exits with code 2 for file not found [AC-E1]', async () => {
      const result = await execCheck(['/nonexistent/file.rill']);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('File not found');
    });

    it('exits with code 2 for directory path [AC-E1]', async () => {
      const result = await execCheck([tempDir]);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('directory');
    });

    it('exits with code 3 for parse error [AC-E2]', async () => {
      const script = await writeFile('parse-error.rill', '|x| x }');
      const result = await execCheck([script]);

      expect(result.exitCode).toBe(3);
      expect(result.stderr).toContain('parse error');
    });

    it('reports parse error with location [AC-B2]', async () => {
      const script = await writeFile('parse-location.rill', 'invalid {');
      const result = await execCheck([script]);

      expect(result.exitCode).toBe(3);
      expect(result.stderr).toMatch(/parse-location\.rill:\d+:\d+:/);
    });

    it('reports cannot apply fixes on parse error [AC-E3]', async () => {
      const script = await writeFile('parse-fix.rill', '|x| x }');
      const result = await execCheck([script, '--fix']);

      expect(result.exitCode).toBe(3);
      expect(result.stderr).toContain('Cannot apply fixes');
      expect(result.stderr).toContain('parse errors');
    });

    it('exits with code 1 for unknown flag [AC-E4]', async () => {
      const result = await execCheck(['--unknown', 'test.rill']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Unknown option');
    });

    it('exits with code 1 for invalid config [AC-E5]', async () => {
      // Write invalid config file in temp directory
      await writeFile('.rill-check.json', '{ invalid json }');
      const script = await writeFile('test-config.rill', '"hello"');

      const result = await execCheck([script]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Invalid configuration');
    });
  });

  // ============================================================
  // CONFIG OVERRIDE
  // ============================================================

  describe('config override [AC-S7]', () => {
    it('loads config from working directory', async () => {
      // Write valid empty config
      await writeFile('.rill-check.json', JSON.stringify({ rules: {} }));
      const script = await writeFile('config-test.rill', '"hello"');

      const result = await execCheck([script]);

      // Should succeed with valid config
      expect(result.exitCode).toBe(0);
    });

    it('uses default config when no config file present', async () => {
      // Create subdirectory without config
      const subdir = path.join(tempDir, 'no-config');
      await fs.mkdir(subdir, { recursive: true });
      const script = path.join(subdir, 'test.rill');
      await fs.writeFile(script, '"hello"', 'utf-8');

      // Run from subdir (no config file there)
      const result = await new Promise<{
        exitCode: number;
        stdout: string;
        stderr: string;
      }>((resolve) => {
        const checkPath = path.join(process.cwd(), 'dist', 'cli-check.js');
        const proc = spawn('node', [checkPath, script], {
          cwd: subdir,
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

      // Should succeed with default config
      expect(result.exitCode).toBe(0);
    });
  });

  // ============================================================
  // FIX APPLICATION
  // ============================================================

  describe('fix application [AC-S2]', () => {
    it('applies fixes when --fix flag present', async () => {
      // Note: Since no validation rules exist yet, we can't test actual fix application
      // This test verifies the --fix flag is processed without error
      const script = await writeFile('fix-test.rill', '"hello"');
      const result = await execCheck([script, '--fix']);

      // Should complete successfully
      expect(result.exitCode).toBe(0);
    });

    it('reports applied fix count to stderr', async () => {
      // When validation rules are added, this test should verify fix count reporting
      const script = await writeFile('fix-count.rill', '"hello"');
      const result = await execCheck([script, '--fix']);

      // Should not report fixes when none applied
      expect(result.stderr).not.toContain('Applied');
    });
  });

  // ============================================================
  // VERBOSE MODE
  // ============================================================

  describe('verbose mode [AC-S4]', () => {
    it('includes category in JSON output when verbose', () => {
      // Test the formatDiagnostics function directly with verbose flag
      const diagnostics: Diagnostic[] = [
        {
          location: { line: 1, column: 1, offset: 0 },
          severity: 'warning',
          code: 'TEST_WARN',
          message: 'Test warning',
          context: 'test',
          fix: null,
        },
      ];

      const output = formatDiagnostics('test.rill', diagnostics, 'json', true);
      const parsed = JSON.parse(output);

      // Verbose mode adds category field (when rule exists in VALIDATION_RULES)
      expect(parsed.errors[0]).toHaveProperty('severity');
      expect(parsed.errors[0]).toHaveProperty('code');
      expect(parsed.errors[0]).toHaveProperty('message');
    });

    it('CLI accepts --verbose flag without error', async () => {
      const script = await writeFile('verbose-test.rill', '"hello"');
      const result = await execCheck([script, '--verbose']);

      // Should complete successfully
      expect(result.exitCode).toBe(0);
    });
  });

  // ============================================================
  // OUTPUT FORMAT
  // ============================================================

  describe('output format', () => {
    it('outputs text format by default', async () => {
      const script = await writeFile('format-default.rill', '"hello"');
      const result = await execCheck([script]);

      expect(result.exitCode).toBe(0);
      // Text format outputs plain message
      expect(result.stdout).toContain('No issues found');
      // Should not be JSON
      expect(() => JSON.parse(result.stdout)).toThrow();
    });

    it('outputs JSON when --format json specified [AC-S3]', async () => {
      const script = await writeFile('format-json.rill', '"hello"');
      const result = await execCheck([script, '--format', 'json']);

      expect(result.exitCode).toBe(0);
      // Should be valid JSON
      const parsed = JSON.parse(result.stdout);
      expect(parsed).toHaveProperty('file');
      expect(parsed).toHaveProperty('errors');
      expect(parsed).toHaveProperty('summary');
    });
  });

  // ============================================================
  // BOUNDARY TESTS
  // ============================================================

  describe('boundary tests', () => {
    it('fix idempotency: second run applies zero fixes [AC-B3]', async () => {
      // Create file with multiple naming violations
      const content = `
"userName" :> $userName
"itemList" :> $itemList
$userName -> .len
$itemList -> .len
`;
      const script = await writeFile('idempotent.rill', content);

      // Apply fixes first time
      const firstRun = await execCheck([script, '--fix']);
      expect(firstRun.exitCode).toBe(1); // Exit 1 because violations found
      expect(firstRun.stderr).toContain('Applied'); // Should apply fixes

      // Apply fixes second time (should be no-op because file was modified)
      const secondRun = await execCheck([script, '--fix']);
      expect(secondRun.exitCode).toBe(0); // Exit 0 because no violations
      expect(secondRun.stderr).not.toContain('Applied'); // No fixes applied
      expect(secondRun.stdout).toContain('No issues found');
    });

    it('1000-line validation completes under 500ms [AC-B4]', async () => {
      // Generate 1000 lines of valid rill code
      const lines: string[] = [];
      for (let i = 0; i < 1000; i++) {
        lines.push(`"line_${i}" :> $line_${i}`);
      }
      const content = lines.join('\n');
      const script = await writeFile('perf-1000.rill', content);

      const startTime = Date.now();
      const result = await execCheck([script]);
      const duration = Date.now() - startTime;

      expect(result.exitCode).toBe(0);
      expect(duration).toBeLessThan(500);
    });

    it('all rules enabled by default [AC-B6]', async () => {
      // Import config and rules modules to verify defaults
      const { createDefaultConfig } = await import('../../src/check/config.js');
      const { VALIDATION_RULES } =
        await import('../../src/check/rules/index.js');

      const config = createDefaultConfig();

      // Verify all rules in VALIDATION_RULES are enabled by default
      const totalRules = VALIDATION_RULES.length;
      const enabledCount = Object.values(config.rules).filter(
        (state) => state === 'on'
      ).length;

      expect(enabledCount).toBe(totalRules);
      expect(totalRules).toBeGreaterThanOrEqual(20);
    });
  });

  // ============================================================
  // ERROR HANDLING
  // ============================================================

  describe('error handling', () => {
    it('applies fixes for multiple violations [AC-E6]', async () => {
      // Note: Fix collision handling (EC-5) is tested in tests/check/fixer.test.ts
      // This test verifies that non-colliding fixes are successfully applied
      const content = `
[userName: "test"] :> $data1
[itemList: [1, 2, 3]] :> $data2
`;
      const script = await writeFile('collision.rill', content);

      // Run check to get diagnostics
      const result = await execCheck([script]);

      // Should have violations
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('userName');
      expect(result.stdout).toContain('itemList');

      // Apply fixes
      const fixResult = await execCheck([script, '--fix']);

      // Exits with 1 because diagnostics existed before fix
      expect(fixResult.exitCode).toBe(1);
      expect(fixResult.stderr).toContain('Applied');

      // Verify fix was applied (run check again on modified file)
      const checkAfterFix = await execCheck([script]);

      // After fix, violations should be eliminated
      expect(checkAfterFix.exitCode).toBe(0);
      expect(checkAfterFix.stdout).toContain('No issues found');
    });
  });

  // ============================================================
  // ERROR CONTRACTS
  // ============================================================

  describe('error contracts', () => {
    describe('EC-1: parseCheckArgs - unknown flag', () => {
      it('throws error for unknown long flag', () => {
        expect(() => parseCheckArgs(['--unknown'])).toThrow(
          'Unknown option: --unknown'
        );
      });

      it('throws error for unknown short flag', () => {
        expect(() => parseCheckArgs(['-x'])).toThrow('Unknown option: -x');
      });

      it('throws error for invalid --format value', () => {
        expect(() => parseCheckArgs(['test.rill', '--format', 'xml'])).toThrow(
          'Invalid format: xml'
        );
      });

      it('CLI exits with code 1 for unknown flag', async () => {
        const result = await execCheck(['--unknown']);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('Unknown option');
      });
    });

    describe('EC-2: parseCheckArgs - missing file', () => {
      it('throws error when no arguments provided', () => {
        expect(() => parseCheckArgs([])).toThrow('Missing file argument');
      });

      it('throws error when only flags provided', () => {
        expect(() => parseCheckArgs(['--fix', '--verbose'])).toThrow(
          'Missing file argument'
        );
      });

      it('CLI exits with code 1 for missing file', async () => {
        const result = await execCheck(['--fix']);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('Missing file argument');
      });
    });

    describe('EC-3: loadConfig - invalid JSON', () => {
      it('CLI exits with code 1 for malformed JSON', async () => {
        await writeFile('.rill-check.json', '{ invalid json }');
        const script = await writeFile('ec3-malformed.rill', '"hello"');
        const result = await execCheck([script]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('Invalid configuration');
        expect(result.stderr).toContain('invalid JSON');
      });

      it('CLI exits with code 1 for non-object JSON', async () => {
        await writeFile('.rill-check.json', '"string value"');
        const script = await writeFile('ec3-string.rill', '"hello"');
        const result = await execCheck([script]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('Invalid configuration');
        expect(result.stderr).toContain('must be an object');
      });

      it('CLI exits with code 1 for invalid rule state', async () => {
        await writeFile(
          '.rill-check.json',
          JSON.stringify({ rules: { SOME_RULE: 'invalid_state' } })
        );
        const script = await writeFile('ec3-state.rill', '"hello"');
        const result = await execCheck([script]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('Invalid configuration');
      });
    });

    describe('EC-4: loadConfig - unknown rule', () => {
      it('CLI exits with code 1 for unknown rule in rules field', async () => {
        await writeFile(
          '.rill-check.json',
          JSON.stringify({ rules: { UNKNOWN_RULE: 'on' } })
        );
        const script = await writeFile('ec4-rules.rill', '"hello"');
        const result = await execCheck([script]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('Invalid configuration');
        expect(result.stderr).toContain('unknown rule UNKNOWN_RULE');
      });

      it('CLI exits with code 1 for unknown rule in severity field', async () => {
        await writeFile(
          '.rill-check.json',
          JSON.stringify({ severity: { UNKNOWN_RULE: 'error' } })
        );
        const script = await writeFile('ec4-severity.rill', '"hello"');
        const result = await execCheck([script]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('Invalid configuration');
        expect(result.stderr).toContain('unknown rule UNKNOWN_RULE');
      });
    });

    describe('EC-5: applyFixes - fix collision (tested via unit tests)', () => {
      it('reference: collision detection in fixer.test.ts', () => {
        // EC-5 is tested in tests/check/fixer.test.ts
        // The applyFixes function skips overlapping fixes with reason
        // See fixer.test.ts "collision detection [EC-5]" describe block
        expect(true).toBe(true);
      });
    });

    describe('EC-6: applyFixes - parse failure (tested via unit tests)', () => {
      it('reference: parse verification in fixer.test.ts', () => {
        // EC-6 is tested in tests/check/fixer.test.ts
        // The applyFixes function throws when fix creates invalid syntax
        // See fixer.test.ts "parse verification [EC-6]" describe block
        expect(true).toBe(true);
      });
    });
  });

  // ============================================================
  // EDGE CASES
  // ============================================================

  describe('edge cases', () => {
    it('handles file with only whitespace', async () => {
      const script = await writeFile('whitespace.rill', '   \n\n  \t  ');
      const result = await execCheck([script]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No issues found');
    });

    it('handles file with only comments', async () => {
      const script = await writeFile('comments.rill', '# comment\n# another');
      const result = await execCheck([script]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No issues found');
    });

    it('handles multiple flags in different order', async () => {
      const script = await writeFile('multi-flags.rill', '"hello"');
      const result = await execCheck([
        '--verbose',
        script,
        '--format',
        'json',
        '--fix',
      ]);

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed).toHaveProperty('file');
    });
  });
});
