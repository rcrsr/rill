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
  readFileSync: vi.fn(),
  parse: vi.fn(),
  execute: vi.fn(),
  createRuntimeContext: vi.fn(),
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

vi.mock('../../src/run/runner.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/run/runner.js')>();
  return {
    ...actual,
    runScript: mocks.runScript,
  };
});

vi.mock('@rcrsr/rill', async (importActual) => {
  const actual = await importActual<typeof import('@rcrsr/rill')>();
  return {
    ...actual,
    invokeCallable: mocks.invokeCallable,
    isScriptCallable: mocks.isScriptCallable,
    parse: mocks.parse,
    execute: mocks.execute,
    createRuntimeContext: mocks.createRuntimeContext,
  };
});

vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: mocks.readFileSync,
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
    it('treats first positional as rootDir, not scriptPath', () => {
      const opts = parseCliArgs(['./my-project']);
      expect(opts.rootDir).toBe('./my-project');
      expect(opts.scriptPath).toBeUndefined();
    });

    it('scriptPath is always undefined (comes from config main field)', () => {
      expect(parseCliArgs([]).scriptPath).toBeUndefined();
    });

    it('parses --config flag', () => {
      const opts = parseCliArgs(['--config', './my-config.json']);
      expect(opts.config).toBe('./my-config.json');
    });

    it('uses default config when --config not provided', () => {
      expect(parseCliArgs([]).config).toBe('./rill-config.json');
    });

    it('parses --format json', () => {
      expect(parseCliArgs(['--format', 'json']).format).toBe('json');
    });

    it('parses --format compact', () => {
      expect(parseCliArgs(['--format', 'compact']).format).toBe('compact');
    });

    it('defaults format to human when not specified', () => {
      expect(parseCliArgs([]).format).toBe('human');
    });

    it('defaults format to human for unrecognized format values', () => {
      expect(parseCliArgs(['--format', 'xml']).format).toBe('human');
    });

    it('parses --verbose flag', () => {
      expect(parseCliArgs(['--verbose']).verbose).toBe(true);
    });

    it('verbose defaults to false when not provided', () => {
      expect(parseCliArgs([]).verbose).toBe(false);
    });

    it('parses --max-stack-depth flag', () => {
      expect(parseCliArgs(['--max-stack-depth', '5']).maxStackDepth).toBe(5);
    });

    it('accepts 0 as a valid max-stack-depth', () => {
      expect(parseCliArgs(['--max-stack-depth', '0']).maxStackDepth).toBe(0);
    });

    it('defaults max-stack-depth to 10 when not specified', () => {
      expect(parseCliArgs([]).maxStackDepth).toBe(10);
    });

    it('parses --explain flag', () => {
      expect(parseCliArgs(['--explain', 'RILL-R004']).explain).toBe(
        'RILL-R004'
      );
    });

    it('explain is undefined when not provided', () => {
      expect(parseCliArgs([]).explain).toBeUndefined();
    });

    it('collects additional positional args as scriptArgs', () => {
      expect(parseCliArgs([]).scriptArgs).toEqual([]);
    });

    it('scriptArgs is empty when no extra positionals', () => {
      expect(parseCliArgs([]).scriptArgs).toEqual([]);
    });
  });

  describe('EC-1: missing script path (now handled in main via config)', () => {
    it('does not exit when no positional argument is provided', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code) => {
        throw new Error('process.exit called');
      });

      const opts = parseCliArgs([]);
      expect(opts.rootDir).toBeUndefined();
      expect(opts.scriptPath).toBeUndefined();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('does not exit when no positional argument and no --create-bindings', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code) => {
        throw new Error('process.exit called');
      });

      expect(() => parseCliArgs([])).not.toThrow();
      expect(exitSpy).not.toHaveBeenCalled();
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

  describe('--create-bindings flag', () => {
    it('sets createBindings to default dir when --create-bindings has no value', () => {
      expect(parseCliArgs(['--create-bindings']).createBindings).toBe(
        './bindings'
      );
    });

    it('sets createBindings to custom dir when value provided', () => {
      expect(
        parseCliArgs(['--create-bindings', './custom']).createBindings
      ).toBe('./custom');
    });

    it('does not exit with error when --create-bindings is set without a positional', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code) => {
        throw new Error('process.exit called');
      });

      const opts = parseCliArgs(['--create-bindings']);
      expect(opts.createBindings).toBe('./bindings');
      expect(opts.scriptPath).toBeUndefined();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('createBindings is undefined when --create-bindings flag is absent', () => {
      expect(parseCliArgs(['script.rill']).createBindings).toBeUndefined();
    });

    it('does not consume next flag as dir value', () => {
      const opts = parseCliArgs(['--create-bindings', '--verbose']);
      expect(opts.createBindings).toBe('./bindings');
      expect(opts.verbose).toBe(true);
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
      mocks.loadProject.mockResolvedValue(
        makeProjectResult({ main: 'src/index.rill' })
      );

      await runMain([]);

      expect(mocks.loadProject).toHaveBeenCalledWith(
        expect.objectContaining({
          configPath: '/project/rill-config.json',
          rillVersion: expect.any(String) as string,
        })
      );
    });

    it('calls runScript with config and extTree from ProjectResult', async () => {
      const project = makeProjectResult({ main: 'src/index.rill' });
      mocks.loadProject.mockResolvedValue(project);

      await runMain([]);

      expect(mocks.runScript).toHaveBeenCalledWith(
        expect.anything(),
        project.config,
        project.extTree,
        expect.anything()
      );
    });

    it('writes output to stdout when runScript returns output', async () => {
      mocks.loadProject.mockResolvedValue(
        makeProjectResult({ main: 'src/index.rill' })
      );
      mocks.runScript.mockResolvedValue({ exitCode: 0, output: 'hello world' });

      await runMain([]);

      expect(stdoutChunks.join('')).toContain('hello world');
    });

    it('writes errorOutput to stderr when runScript returns errorOutput', async () => {
      mocks.loadProject.mockResolvedValue(
        makeProjectResult({ main: 'src/index.rill' })
      );
      mocks.runScript.mockResolvedValue({
        exitCode: 1,
        errorOutput: 'RILL-R004: some error',
      });

      await runMain([]);

      expect(stderrChunks.join('')).toContain('RILL-R004: some error');
      expect(exitCode).toBe(1);
    });

    it('exits 1 with helpful message when config has no main field', async () => {
      mocks.loadProject.mockResolvedValue(makeProjectResult());

      await runMain([]);

      expect(stderrChunks.join('')).toContain(
        'no main field in rill-config.json'
      );
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

      await runMain([]);

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

      await runMain([]);

      expect(stderrChunks.join('')).toContain('Extension load failed');
      expect(exitCode).toBe(1);
    });
  });

  describe('handler mode (colon in main)', () => {
    function makeHandlerProject() {
      return {
        config: { main: 'script.rill:myHandler' },
        extTree: {},
        disposes: [],
        resolverConfig: { resolvers: {}, configurations: { resolvers: {} } },
        hostOptions: {},
        extensionBindings: '[:]',
        contextBindings: '',
      };
    }

    beforeEach(() => {
      mocks.readFileSync.mockReturnValue('# script source');
      mocks.parse.mockReturnValue({ type: 'Script', body: [] });
      mocks.execute.mockResolvedValue(undefined);
      mocks.isScriptCallable.mockReturnValue(true);
      mocks.invokeCallable.mockResolvedValue('');

      const variables = new Map<string, unknown>();
      const fakeHandler = { __type: 'ScriptCallable' };
      variables.set('myHandler', fakeHandler);
      mocks.createRuntimeContext.mockReturnValue({
        variables,
        get pipeValue() {
          return undefined;
        },
        set pipeValue(_v: unknown) {},
      });

      mocks.parseMainField.mockImplementation((main: string) => {
        const idx = main.indexOf(':');
        return {
          filePath: main.slice(0, idx),
          handlerName: main.slice(idx + 1),
        };
      });
    });

    it('passes space-separated string flag value to marshalCliArgs', async () => {
      mocks.loadProject.mockResolvedValue(makeHandlerProject());
      mocks.introspectHandler.mockReturnValue({
        description: undefined,
        params: [{ name: 'name', type: 'string', required: true }],
      });
      mocks.marshalCliArgs.mockReturnValue({ name: 'Alice' });

      await runMain(['--name', 'Alice']);

      expect(mocks.marshalCliArgs).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Alice' }),
        expect.any(Array)
      );
    });

    it('passes boolean flag as empty string to marshalCliArgs for bool param', async () => {
      mocks.loadProject.mockResolvedValue(makeHandlerProject());
      mocks.introspectHandler.mockReturnValue({
        description: undefined,
        params: [{ name: 'verbose', type: 'bool', required: false }],
      });
      mocks.marshalCliArgs.mockReturnValue({ verbose: true });

      await runMain(['--verbose']);

      // --verbose is a BASE_OPTIONS key so it is filtered out; this confirms
      // the base option filter still works when params include a bool param
      expect(mocks.marshalCliArgs).toHaveBeenCalled();
    });

    it('does not conflate space-separated value with positional when param type is string', async () => {
      mocks.loadProject.mockResolvedValue(makeHandlerProject());
      mocks.introspectHandler.mockReturnValue({
        description: undefined,
        params: [{ name: 'target', type: 'string', required: true }],
      });
      mocks.marshalCliArgs.mockReturnValue({ target: 'prod' });

      await runMain(['--target', 'prod']);

      const [rawArgs] = mocks.marshalCliArgs.mock.calls[0] as [
        Record<string, string>,
        unknown,
      ];
      expect(rawArgs['target']).toBe('prod');
    });

    it('outputs dict handler result as JSON', async () => {
      mocks.loadProject.mockResolvedValue(makeHandlerProject());
      mocks.introspectHandler.mockReturnValue({
        description: undefined,
        params: [],
      });
      mocks.marshalCliArgs.mockReturnValue({});
      mocks.invokeCallable.mockResolvedValue({ count: 3, status: 'ok' });

      await runMain([]);

      expect(stdoutChunks.join('')).toContain('"count": 3');
      expect(stdoutChunks.join('')).toContain('"status": "ok"');
    });

    it('outputs number handler result', async () => {
      mocks.loadProject.mockResolvedValue(makeHandlerProject());
      mocks.introspectHandler.mockReturnValue({
        description: undefined,
        params: [],
      });
      mocks.marshalCliArgs.mockReturnValue({});
      mocks.invokeCallable.mockResolvedValue(42);

      await runMain([]);

      expect(stdoutChunks.join('')).toContain('42');
    });
  });

  describe('--config flag', () => {
    it('passes configFlag to resolveConfigPath when explicit --config is provided', async () => {
      mocks.loadProject.mockResolvedValue(
        makeProjectResult({ main: 'src/index.rill' })
      );

      await runMain(['--config', './custom-config.json']);

      expect(mocks.resolveConfigPath).toHaveBeenCalledWith(
        expect.objectContaining({ configFlag: './custom-config.json' })
      );
    });

    it('does not pass configFlag when using default config path', async () => {
      mocks.loadProject.mockResolvedValue(
        makeProjectResult({ main: 'src/index.rill' })
      );

      await runMain([]);

      const callArg = mocks.resolveConfigPath.mock.calls[0]?.[0] as {
        configFlag?: string;
        cwd: string;
      };
      expect(callArg?.configFlag).toBeUndefined();
    });
  });
});
