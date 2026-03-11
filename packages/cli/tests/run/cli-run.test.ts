/**
 * rill-run CLI argument parsing tests
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseCliArgs } from '../../src/cli-run.js';

describe('parseCliArgs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('flag parsing', () => {
    it('parses script path from first positional argument', () => {
      expect(parseCliArgs(['script.rill']).scriptPath).toBe('script.rill');
    });

    it('parses --config flag', () => {
      const opts = parseCliArgs([
        'script.rill',
        '--config',
        './my-config.json',
      ]);
      expect(opts.config).toBe('./my-config.json');
    });

    it('uses default config when --config not provided', () => {
      expect(parseCliArgs(['script.rill']).config).toBe('./rill-config.json');
    });

    it('parses --format json', () => {
      expect(parseCliArgs(['script.rill', '--format', 'json']).format).toBe(
        'json'
      );
    });

    it('parses --format compact', () => {
      expect(parseCliArgs(['script.rill', '--format', 'compact']).format).toBe(
        'compact'
      );
    });

    it('defaults format to human when not specified', () => {
      expect(parseCliArgs(['script.rill']).format).toBe('human');
    });

    it('defaults format to human for unrecognized format values', () => {
      expect(parseCliArgs(['script.rill', '--format', 'xml']).format).toBe(
        'human'
      );
    });

    it('parses --verbose flag', () => {
      expect(parseCliArgs(['script.rill', '--verbose']).verbose).toBe(true);
    });

    it('verbose defaults to false when not provided', () => {
      expect(parseCliArgs(['script.rill']).verbose).toBe(false);
    });

    it('parses --max-stack-depth flag', () => {
      expect(
        parseCliArgs(['script.rill', '--max-stack-depth', '5']).maxStackDepth
      ).toBe(5);
    });

    it('accepts 0 as a valid max-stack-depth', () => {
      expect(
        parseCliArgs(['script.rill', '--max-stack-depth', '0']).maxStackDepth
      ).toBe(0);
    });

    it('defaults max-stack-depth to 10 when not specified', () => {
      expect(parseCliArgs(['script.rill']).maxStackDepth).toBe(10);
    });

    it('parses --explain flag', () => {
      expect(
        parseCliArgs(['script.rill', '--explain', 'RILL-R004']).explain
      ).toBe('RILL-R004');
    });

    it('explain is undefined when not provided', () => {
      expect(parseCliArgs(['script.rill']).explain).toBeUndefined();
    });

    it('collects additional positional args as scriptArgs', () => {
      expect(parseCliArgs(['script.rill', 'arg1', 'arg2']).scriptArgs).toEqual([
        'arg1',
        'arg2',
      ]);
    });

    it('scriptArgs is empty when no extra positionals', () => {
      expect(parseCliArgs(['script.rill']).scriptArgs).toEqual([]);
    });
  });

  describe('EC-1: missing script path', () => {
    it('exits 1 when no script path is provided', () => {
      vi.spyOn(process, 'exit').mockImplementation((_code) => {
        throw new Error('process.exit called');
      });

      let stderr = '';
      const origStderr = process.stderr.write.bind(process.stderr);
      (process.stderr.write as unknown) = (chunk: string) => {
        stderr += chunk;
        return true;
      };

      try {
        expect(() => parseCliArgs([])).toThrow('process.exit called');
        expect(stderr).toContain('Error: no script path provided');
      } finally {
        (process.stderr.write as unknown) = origStderr;
      }
    });

    it('includes usage help text when no script path is provided', () => {
      vi.spyOn(process, 'exit').mockImplementation((_code) => {
        throw new Error('process.exit called');
      });

      let stderr = '';
      const origStderr = process.stderr.write.bind(process.stderr);
      (process.stderr.write as unknown) = (chunk: string) => {
        stderr += chunk;
        return true;
      };

      try {
        expect(() => parseCliArgs([])).toThrow('process.exit called');
        expect(stderr).toContain('Usage:');
      } finally {
        (process.stderr.write as unknown) = origStderr;
      }
    });
  });

  describe('--help flag', () => {
    it('exits 0 when --help is provided', () => {
      vi.spyOn(process, 'exit').mockImplementation((_code) => {
        throw new Error('process.exit called');
      });

      let stdout = '';
      const origStdout = process.stdout.write.bind(process.stdout);
      (process.stdout.write as unknown) = (chunk: string) => {
        stdout += chunk;
        return true;
      };

      try {
        expect(() => parseCliArgs(['--help'])).toThrow('process.exit called');
        expect(stdout).toContain('Usage:');
      } finally {
        (process.stdout.write as unknown) = origStdout;
      }
    });
  });

  describe('--version flag', () => {
    it('exits 0 and prints rill-run version when --version is provided', () => {
      vi.spyOn(process, 'exit').mockImplementation((_code) => {
        throw new Error('process.exit called');
      });

      let stdout = '';
      const origStdout = process.stdout.write.bind(process.stdout);
      (process.stdout.write as unknown) = (chunk: string) => {
        stdout += chunk;
        return true;
      };

      try {
        expect(() => parseCliArgs(['--version'])).toThrow(
          'process.exit called'
        );
        expect(stdout).toContain('rill-run');
      } finally {
        (process.stdout.write as unknown) = origStdout;
      }
    });
  });

  describe('--emit-bindings flag', () => {
    it('sets emitBindings to true when --emit-bindings is provided', () => {
      expect(
        parseCliArgs(['script.rill', '--emit-bindings']).emitBindings
      ).toBe(true);
    });

    it('does not exit with error when --emit-bindings is set without a positional', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code) => {
        throw new Error('process.exit called');
      });

      const opts = parseCliArgs(['--emit-bindings']);
      expect(opts.emitBindings).toBe(true);
      expect(opts.scriptPath).toBeUndefined();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('emitBindings is false when --emit-bindings flag is absent', () => {
      expect(parseCliArgs(['script.rill']).emitBindings).toBe(false);
    });
  });
});
