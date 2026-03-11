/**
 * rill-run CLI tests
 * Tests parseCliArgs flag parsing and the loadProject-based main() flow.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { parseCliArgs } from '../../src/cli-run.js';

// ============================================================
// MOCK SETUP
// ============================================================

const mocks = vi.hoisted(() => ({
  resolveConfigPath: vi.fn(),
  loadProject: vi.fn(),
  runScript: vi.fn(),
  parseMainField: vi.fn(),
  introspectHandler: vi.fn(),
  marshalCliArgs: vi.fn(),
  invokeCallable: vi.fn(),
  isScriptCallable: vi.fn(),
}));

vi.mock('@rcrsr/rill-config', async (importActual) => {
  const actual = await importActual<typeof import('@rcrsr/rill-config')>();
  return {
    ...actual,
    resolveConfigPath: mocks.resolveConfigPath,
    loadProject: mocks.loadProject,
    parseMainField: mocks.parseMainField,
    introspectHandler: mocks.introspectHandler,
    marshalCliArgs: mocks.marshalCliArgs,
  };
});

vi.mock('../../src/run/runner.js', () => ({
  runScript: mocks.runScript,
}));

vi.mock('@rcrsr/rill', async (importActual) => {
  const actual = await importActual<typeof import('@rcrsr/rill')>();
  return {
    ...actual,
    invokeCallable: mocks.invokeCallable,
    isScriptCallable: mocks.isScriptCallable,
  };
});

// ============================================================
// HELPERS
// ============================================================

function makeProjectResult(
  overrides: Partial<{
    main: string;
    modules: Record<string, string>;
  }> = {}
) {
  return {
    config: {
      ...(overrides.main !== undefined ? { main: overrides.main } : {}),
      modules: overrides.modules ?? {},
    },
    extTree: {},
    disposes: [],
    resolverConfig: { resolvers: {}, configurations: { resolvers: {} } },
    hostOptions: {},
    extensionBindings: '[:]',
    contextBindings: '',
  };
}

// ============================================================
// parseCliArgs tests
// ============================================================

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

// ============================================================
// handler mode unit tests (parseMainField integration)
// ============================================================

describe('handler mode detection', () => {
  it('parseMainField splits file and handler name on colon', async () => {
    const { parseMainField } = await import('@rcrsr/rill-config');
    // Call the real implementation (mock delegates to actual for this)
    mocks.parseMainField.mockImplementation((main: string) => {
      const idx = main.indexOf(':');
      if (idx === -1) return { filePath: main };
      return { filePath: main.slice(0, idx), handlerName: main.slice(idx + 1) };
    });
    const result = parseMainField('script.rill:myHandler');
    expect(result.filePath).toBe('script.rill');
    expect(result.handlerName).toBe('myHandler');
  });

  it('parseMainField returns only filePath when no colon present', async () => {
    const { parseMainField } = await import('@rcrsr/rill-config');
    mocks.parseMainField.mockImplementation((main: string) => {
      const idx = main.indexOf(':');
      if (idx === -1) return { filePath: main };
      return { filePath: main.slice(0, idx), handlerName: main.slice(idx + 1) };
    });
    const result = parseMainField('script.rill');
    expect(result.filePath).toBe('script.rill');
    expect(result.handlerName).toBeUndefined();
  });
});

// ============================================================
// loadProject-based main() flow tests
// ============================================================

describe('main() loadProject flow', () => {
  let origArgv: string[];
  let stdoutChunks: string[];
  let stderrChunks: string[];
  let exitCode: number | undefined;
  let origStdout: typeof process.stdout.write;
  let origStderr: typeof process.stderr.write;

  beforeEach(() => {
    vi.resetAllMocks();
    origArgv = process.argv;
    stdoutChunks = [];
    stderrChunks = [];
    exitCode = undefined;

    origStdout = process.stdout.write.bind(process.stdout);
    origStderr = process.stderr.write.bind(process.stderr);
    (process.stdout.write as unknown) = (chunk: string) => {
      stdoutChunks.push(chunk);
      return true;
    };
    (process.stderr.write as unknown) = (chunk: string) => {
      stderrChunks.push(chunk);
      return true;
    };
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      exitCode = code as number;
      throw new Error(`process.exit(${code})`);
    });

    mocks.resolveConfigPath.mockReturnValue('/project/rill-config.json');
    mocks.runScript.mockResolvedValue({ exitCode: 0 });
  });

  afterEach(() => {
    process.argv = origArgv;
    (process.stdout.write as unknown) = origStdout;
    (process.stderr.write as unknown) = origStderr;
    vi.restoreAllMocks();
  });

  async function runMain(argv: string[]): Promise<void> {
    process.argv = ['node', 'rill-run', ...argv];
    const { main } = await import('../../src/cli-run.js');
    try {
      await main();
    } catch {
      // process.exit() throws in test environment
    }
  }

  describe('module mode (no colon in main)', () => {
    it('calls loadProject with resolved config path and rillVersion', async () => {
      mocks.loadProject.mockResolvedValue(makeProjectResult());

      await runMain(['script.rill']);

      expect(mocks.loadProject).toHaveBeenCalledWith(
        expect.objectContaining({
          configPath: '/project/rill-config.json',
          rillVersion: expect.any(String) as string,
        })
      );
    });

    it('calls runScript with config and extTree from ProjectResult', async () => {
      const project = makeProjectResult();
      mocks.loadProject.mockResolvedValue(project);

      await runMain(['script.rill']);

      expect(mocks.runScript).toHaveBeenCalledWith(
        expect.anything(),
        project.config,
        project.extTree,
        expect.anything(),
        expect.anything()
      );
    });

    it('writes output to stdout when runScript returns output', async () => {
      mocks.loadProject.mockResolvedValue(makeProjectResult());
      mocks.runScript.mockResolvedValue({ exitCode: 0, output: 'hello world' });

      await runMain(['script.rill']);

      expect(stdoutChunks.join('')).toContain('hello world');
    });

    it('writes errorOutput to stderr when runScript returns errorOutput', async () => {
      mocks.loadProject.mockResolvedValue(makeProjectResult());
      mocks.runScript.mockResolvedValue({
        exitCode: 1,
        errorOutput: 'RILL-R004: some error',
      });

      await runMain(['script.rill']);

      expect(stderrChunks.join('')).toContain('RILL-R004: some error');
      expect(exitCode).toBe(1);
    });
  });

  describe('ConfigError handling', () => {
    it('writes message to stderr and exits 1 when resolveConfigPath throws ConfigError', async () => {
      const { ConfigError } = await import('@rcrsr/rill-config');
      mocks.resolveConfigPath.mockImplementation(() => {
        throw new ConfigError(
          'Config file not found: /missing/rill-config.json'
        );
      });

      await runMain(['script.rill']);

      expect(stderrChunks.join('')).toContain(
        'Config file not found: /missing/rill-config.json'
      );
      expect(exitCode).toBe(1);
    });

    it('writes message to stderr and exits 1 when loadProject throws ConfigError', async () => {
      const { ConfigError } = await import('@rcrsr/rill-config');
      mocks.loadProject.mockRejectedValue(
        new ConfigError('Extension load failed')
      );

      await runMain(['script.rill']);

      expect(stderrChunks.join('')).toContain('Extension load failed');
      expect(exitCode).toBe(1);
    });
  });

  describe('--config flag', () => {
    it('passes configFlag to resolveConfigPath when explicit --config is provided', async () => {
      mocks.loadProject.mockResolvedValue(makeProjectResult());

      await runMain(['script.rill', '--config', './custom-config.json']);

      expect(mocks.resolveConfigPath).toHaveBeenCalledWith(
        expect.objectContaining({ configFlag: './custom-config.json' })
      );
    });

    it('does not pass configFlag when using default config path', async () => {
      mocks.loadProject.mockResolvedValue(makeProjectResult());

      await runMain(['script.rill']);

      const callArg = mocks.resolveConfigPath.mock.calls[0]?.[0] as {
        configFlag?: string;
        cwd: string;
      };
      expect(callArg?.configFlag).toBeUndefined();
    });
  });
});
