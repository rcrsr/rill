/**
 * Rill CLI Tests: rill-exec command
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { parseArgs, executeScript } from '../../src/cli-exec.js';
import { formatError, determineExitCode } from '../../src/cli-shared.js';
import { ParseError, RuntimeError } from '@rcrsr/rill';
import { LexerError } from '@rcrsr/rill';
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
        format: 'human',
        verbose: false,
        maxStackDepth: 10,
      });
    });

    it('parses stdin mode', () => {
      expect(parseArgs(['-'])).toEqual({
        mode: 'exec',
        file: '-',
        args: [],
        format: 'human',
        verbose: false,
        maxStackDepth: 10,
      });
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

    // IC-11: --format, --verbose, --explain, --max-stack-depth flags
    describe('new CLI flags', () => {
      it('parses --format flag with human value', () => {
        const parsed = parseArgs(['--format', 'human', 'script.rill']);
        expect(parsed).toEqual({
          mode: 'exec',
          file: 'script.rill',
          args: [],
          format: 'human',
          verbose: false,
          maxStackDepth: 10,
        });
      });

      it('parses --format flag with json value', () => {
        const parsed = parseArgs(['--format', 'json', 'script.rill']);
        expect(parsed).toEqual({
          mode: 'exec',
          file: 'script.rill',
          args: [],
          format: 'json',
          verbose: false,
          maxStackDepth: 10,
        });
      });

      it('parses --format flag with compact value', () => {
        const parsed = parseArgs(['--format', 'compact', 'script.rill']);
        expect(parsed).toEqual({
          mode: 'exec',
          file: 'script.rill',
          args: [],
          format: 'compact',
          verbose: false,
          maxStackDepth: 10,
        });
      });

      // AC-15: Unknown --format value throws error
      it('throws error for invalid --format value', () => {
        expect(() => parseArgs(['--format', 'xml', 'script.rill'])).toThrow(
          'Invalid --format value: xml. Must be one of: human, json, compact'
        );
      });

      it('parses --verbose flag', () => {
        const parsed = parseArgs(['--verbose', 'script.rill']);
        expect(parsed).toEqual({
          mode: 'exec',
          file: 'script.rill',
          args: [],
          format: 'human',
          verbose: true,
          maxStackDepth: 10,
        });
      });

      it('parses --max-stack-depth flag', () => {
        const parsed = parseArgs(['--max-stack-depth', '20', 'script.rill']);
        expect(parsed).toEqual({
          mode: 'exec',
          file: 'script.rill',
          args: [],
          format: 'human',
          verbose: false,
          maxStackDepth: 20,
        });
      });

      it('throws error for missing --max-stack-depth value', () => {
        expect(() => parseArgs(['--max-stack-depth'])).toThrow(
          'Missing value after --max-stack-depth'
        );
      });

      it('throws error for invalid --max-stack-depth value', () => {
        expect(() =>
          parseArgs(['--max-stack-depth', 'abc', 'script.rill'])
        ).toThrow('--max-stack-depth must be a number between 1 and 100');
      });

      it('throws error for --max-stack-depth out of range (too low)', () => {
        expect(() =>
          parseArgs(['--max-stack-depth', '0', 'script.rill'])
        ).toThrow('--max-stack-depth must be a number between 1 and 100');
      });

      it('throws error for --max-stack-depth out of range (too high)', () => {
        expect(() =>
          parseArgs(['--max-stack-depth', '101', 'script.rill'])
        ).toThrow('--max-stack-depth must be a number between 1 and 100');
      });

      it('parses combined flags', () => {
        const parsed = parseArgs([
          '--format',
          'json',
          '--verbose',
          '--max-stack-depth',
          '5',
          'script.rill',
          'arg1',
        ]);
        expect(parsed).toEqual({
          mode: 'exec',
          file: 'script.rill',
          args: ['arg1'],
          format: 'json',
          verbose: true,
          maxStackDepth: 5,
        });
      });

      it('parses --explain flag with valid error ID', () => {
        const parsed = parseArgs(['--explain', 'RILL-R009']);
        expect(parsed).toEqual({
          mode: 'explain',
          errorId: 'RILL-R009',
        });
      });

      it('throws error for missing --explain value', () => {
        expect(() => parseArgs(['--explain'])).toThrow(
          'Missing error ID after --explain'
        );
      });

      // AC-16: Malformed --explain errorId throws error
      it('parses --explain with malformed error ID (handled by explainError)', () => {
        // parseArgs accepts any string after --explain
        // Validation happens in explainError function
        const parsed = parseArgs(['--explain', 'INVALID']);
        expect(parsed).toEqual({
          mode: 'explain',
          errorId: 'INVALID',
        });
      });
    });
  });

  describe('executeScript', () => {
    it('executes simple script', async () => {
      const script = await writeScript('simple.rill', '"hello"');
      const result = await executeScript(script, []);
      expect(result.result).toBe('hello');
    });

    it('passes arguments as $ list', async () => {
      const script = await writeScript('args.rill', '$');
      const result = await executeScript(script, ['arg1', 'arg2']);
      expect(result.result).toEqual(['arg1', 'arg2']);
    });

    it('keeps arguments as strings', async () => {
      const script = await writeScript('type.rill', '$[0] -> :?string');
      const result = await executeScript(script, ['42']);
      expect(result.result).toBe(true);
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
      expect(result.result).toEqual([]);
    });

    it('returns closure as RillValue when script returns a closure', async () => {
      const script = await writeScript('closure.rill', '|x| { $x }');
      const result = await executeScript(script, []);
      expect(result.result).not.toBeNull();
      expect(typeof result.result).toBe('object');
    });

    // BUG-1: typed zero-param functions must not receive injected pipeValue
    it('calls now() without RILL-R045 when pipeValue is set', async () => {
      const script = await writeScript('now.rill', 'now()');
      const result = await executeScript(script, []);
      const value = result.result as Record<string, unknown>;
      expect(value.__rill_datetime).toBe(true);
      expect(typeof value.unix).toBe('number');
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

  describe('removed frontmatter syntax', () => {
    it('rejects scripts with use: frontmatter (removed syntax)', async () => {
      const script = await writeScript(
        'use-frontmatter.rill',
        ['---', 'use: [{mod: ./other.rill}]', '---', '', '1'].join('\n')
      );

      await expect(executeScript(script, [])).rejects.toThrow(/use:|removed/i);
    });

    it('rejects scripts with export: frontmatter (removed syntax)', async () => {
      const script = await writeScript(
        'export-frontmatter.rill',
        ['---', 'export: [value]', '---', '', '1 => $value'].join('\n')
      );

      await expect(executeScript(script, [])).rejects.toThrow(
        /export:|removed/i
      );
    });
  });
});
