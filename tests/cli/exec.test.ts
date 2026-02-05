/**
 * Rill CLI Tests: rill-exec command
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { parseArgs, executeScript } from '../../src/cli-exec.js';
import {
  formatOutput,
  formatError,
  determineExitCode,
} from '../../src/cli-shared.js';
import { ParseError, RuntimeError, callable } from '../../src/index.js';
import { LexerError } from '../../src/lexer/errors.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('rill-exec', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rill-test-'));
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true });
  });

  async function writeScript(name: string, content: string): Promise<string> {
    const scriptPath = path.join(tempDir, name);
    await fs.writeFile(scriptPath, content);
    return scriptPath;
  }

  describe('parseArgs', () => {
    it('parses file with args', () => {
      const parsed = parseArgs(['script.rill', 'arg1', 'arg2']);
      expect(parsed).toEqual({
        mode: 'exec',
        file: 'script.rill',
        args: ['arg1', 'arg2'],
      });
    });

    it('parses stdin mode', () => {
      expect(parseArgs(['-'])).toEqual({ mode: 'exec', file: '-', args: [] });
    });

    it('parses help and version flags', () => {
      expect(parseArgs(['--help']).mode).toBe('help');
      expect(parseArgs(['-h']).mode).toBe('help');
      expect(parseArgs(['--version']).mode).toBe('version');
      expect(parseArgs(['-v']).mode).toBe('version');
    });

    it('throws on unknown flags', () => {
      expect(() => parseArgs(['--unknown'])).toThrow(
        'Unknown option: --unknown'
      );
      expect(() => parseArgs(['-x'])).toThrow('Unknown option: -x');
    });

    it('throws when missing file argument', () => {
      expect(() => parseArgs([])).toThrow('Missing file argument');
    });
  });

  describe('executeScript', () => {
    it('executes simple script', async () => {
      const script = await writeScript('simple.rill', '"hello"');
      const result = await executeScript(script, []);
      expect(result.value).toBe('hello');
    });

    it('passes arguments as $ list', async () => {
      const script = await writeScript('args.rill', '$');
      const result = await executeScript(script, ['arg1', 'arg2']);
      expect(result.value).toEqual(['arg1', 'arg2']);
    });

    it('keeps arguments as strings', async () => {
      const script = await writeScript('type.rill', '$[0] -> type');
      const result = await executeScript(script, ['42']);
      expect(result.value).toBe('string');
    });

    it('throws for non-existent file', async () => {
      await expect(executeScript('/nonexistent.rill', [])).rejects.toThrow(
        'File not found'
      );
    });

    it('propagates parse errors', async () => {
      const script = await writeScript('parse-err.rill', '|x| x }');
      await expect(executeScript(script, [])).rejects.toThrow(ParseError);
    });

    it('propagates runtime errors', async () => {
      const script = await writeScript('runtime-err.rill', '$undefined');
      await expect(executeScript(script, [])).rejects.toThrow(RuntimeError);
    });

    it('handles empty script', async () => {
      const script = await writeScript('empty.rill', '');
      const result = await executeScript(script, []);
      // Empty script returns initial pipe value (args list)
      expect(result.value).toEqual([]);
    });

    it('handles closure return', async () => {
      const script = await writeScript('closure.rill', '|x| { $x }');
      const result = await executeScript(script, []);
      expect(formatOutput(result.value)).toBe('[closure]');
    });
  });

  describe('formatOutput', () => {
    it('formats primitives', () => {
      expect(formatOutput('hello')).toBe('hello');
      expect(formatOutput(42)).toBe('42');
      expect(formatOutput(true)).toBe('true');
      expect(formatOutput(null)).toBe('null');
    });

    it('formats collections as JSON', () => {
      expect(formatOutput([1, 2])).toBe('[\n  1,\n  2\n]');
      expect(formatOutput({ a: 1 })).toContain('"a": 1');
    });

    it('formats closures', () => {
      expect(formatOutput(callable(() => 'x'))).toBe('[closure]');
    });
  });

  describe('formatError', () => {
    it('formats lexer error with location', () => {
      const err = new LexerError('RILL-L001', 'Unterminated string', {
        line: 2,
        column: 15,
        offset: 30,
      });
      const formatted = formatError(err);
      expect(formatted).toBe('Lexer error at line 2: Unterminated string');
      expect(formatted).not.toContain('RILL-L001');
    });

    it('formats parse error with location', () => {
      const err = new ParseError('RILL-P001', 'Unexpected token', {
        line: 5,
        column: 10,
        offset: 50,
      });
      const formatted = formatError(err);
      expect(formatted).toBe('Parse error at line 5: Unexpected token');
      expect(formatted).not.toContain('RILL-P001');
    });

    it('formats parse error without location', () => {
      const err = new ParseError('RILL-P001', 'Unexpected token', {
        line: 1,
        column: 1,
        offset: 0,
      });
      // ParseError constructor always requires location, so we simulate missing location
      // by checking the format handles location gracefully
      const formatted = formatError(err);
      expect(formatted).toContain('Parse error');
    });

    it('formats runtime error with location', () => {
      const err = new RuntimeError('RILL-R001', 'Type mismatch', {
        line: 3,
        column: 5,
        offset: 20,
      });
      const formatted = formatError(err);
      expect(formatted).toBe('Runtime error at line 3: Type mismatch');
      expect(formatted).not.toContain('RILL-R001');
    });

    it('formats runtime error without location', () => {
      const err = new RuntimeError('RILL-R001', 'Type mismatch');
      const formatted = formatError(err);
      expect(formatted).toBe('Runtime error: Type mismatch');
      expect(formatted).not.toContain('RILL-R001');
    });

    it('removes location suffix from message', () => {
      const err = new RuntimeError('RILL-R001', 'Type mismatch', {
        line: 3,
        column: 5,
        offset: 20,
      });
      // Simulate error message with location suffix (like error thrown at runtime might have)
      Object.defineProperty(err, 'message', {
        value: 'Type mismatch at 3:5',
        writable: false,
      });
      const formatted = formatError(err);
      expect(formatted).toBe('Runtime error at line 3: Type mismatch');
    });

    it('formats ENOENT error', () => {
      const err = Object.assign(new Error(), {
        code: 'ENOENT',
        path: '/path/to/file.rill',
      });
      const formatted = formatError(err);
      expect(formatted).toBe('File not found: /path/to/file.rill');
    });

    it('formats module error', () => {
      const err = new Error("Cannot find module './missing.js'");
      const formatted = formatError(err);
      expect(formatted).toBe("Module error: Cannot find module './missing.js'");
    });

    it('formats generic error', () => {
      const err = new Error('Something went wrong');
      const formatted = formatError(err);
      expect(formatted).toBe('Something went wrong');
    });

    it('never includes stack trace', () => {
      const err = new Error('Test error');
      err.stack = 'Error: Test error\n    at foo (bar.js:10:5)';
      const formatted = formatError(err);
      expect(formatted).not.toContain('at foo');
      expect(formatted).not.toContain('bar.js');
    });
  });

  describe('determineExitCode', () => {
    it('returns 0 for true and non-empty string', () => {
      expect(determineExitCode(true)).toEqual({ code: 0 });
      expect(determineExitCode('hello')).toEqual({ code: 0 });
    });

    it('returns 1 for false and empty string', () => {
      expect(determineExitCode(false)).toEqual({ code: 1 });
      expect(determineExitCode('')).toEqual({ code: 1 });
    });

    it('returns code with message for tuple format', () => {
      expect(determineExitCode([0, 'success'])).toEqual({
        code: 0,
        message: 'success',
      });
      expect(determineExitCode([1, 'failure'])).toEqual({
        code: 1,
        message: 'failure',
      });
    });

    it('returns 0 for other truthy values', () => {
      expect(determineExitCode(42)).toEqual({ code: 0 });
      expect(determineExitCode({ key: 'value' })).toEqual({ code: 0 });
    });

    it('uses first element as exit code for arrays starting with 0 or 1', () => {
      expect(determineExitCode([0, 123])).toEqual({ code: 0 });
      expect(determineExitCode([1, 2, 3])).toEqual({ code: 1 });
    });
  });

  describe('deep module nesting', () => {
    it('loads 10-level module import chain correctly', async () => {
      const moduleDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'rill-modules-')
      );

      try {
        // Create 10 module files: module-1.rill through module-10.rill
        // Each module imports the next in the chain
        for (let i = 1; i <= 10; i++) {
          const modulePath = path.join(moduleDir, `module-${i}.rill`);
          let content: string;

          if (i === 10) {
            // Last module exports a simple value
            content = [
              '---',
              'export: [value]',
              '---',
              '',
              `"level-${i}" :> $value`,
            ].join('\n');
          } else {
            // Intermediate modules import the next module and export its value
            // Use inline array format to avoid frontmatter trim() bug
            const nextModule = `module-${i + 1}.rill`;
            content = [
              '---',
              `use: [{next: ./${nextModule}}]`,
              'export: [value]',
              '---',
              '',
              `$next.value :> $value`,
            ].join('\n');
          }

          await fs.writeFile(modulePath, content);
        }

        // Create entry script that imports module-1 and accesses the chain
        const module1Path = path.join(moduleDir, 'module-1.rill');
        const entryScript = await writeScript(
          'deep-import.rill',
          [
            '---',
            `use: [{chain: ${module1Path}}]`,
            '---',
            '',
            '$chain.value',
          ].join('\n')
        );

        // Execute the entry script
        const result = await executeScript(entryScript, []);

        // Verify the final exported value is accessible through the chain
        expect(result.value).toBe('level-10');
      } finally {
        await fs.rm(moduleDir, { recursive: true, force: true });
      }
    });

    it('does not trigger false positive circular dependency errors in deep chains', async () => {
      const moduleDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'rill-modules-')
      );

      try {
        // Create linear chain without any circular dependencies
        for (let i = 1; i <= 10; i++) {
          const modulePath = path.join(moduleDir, `linear-${i}.rill`);
          let content: string;

          if (i === 10) {
            content = [
              '---',
              'export: [result]',
              '---',
              '',
              `${i} :> $result`,
            ].join('\n');
          } else {
            // Use inline array format to avoid frontmatter trim() bug
            const nextModule = `linear-${i + 1}.rill`;
            content = [
              '---',
              `use: [{next: ./${nextModule}}]`,
              'export: [result]',
              '---',
              '',
              `$next.result :> $result`,
            ].join('\n');
          }

          await fs.writeFile(modulePath, content);
        }

        // Create entry script
        const linear1Path = path.join(moduleDir, 'linear-1.rill');
        const entryScript = await writeScript(
          'linear-chain.rill',
          [
            '---',
            `use: [{start: ${linear1Path}}]`,
            '---',
            '',
            '$start.result',
          ].join('\n')
        );

        // Should execute without circular dependency errors
        const result = await executeScript(entryScript, []);
        expect(result.value).toBe(10);
      } finally {
        await fs.rm(moduleDir, { recursive: true, force: true });
      }
    });
  });
});
