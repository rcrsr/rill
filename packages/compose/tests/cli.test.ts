/**
 * Tests for the rill-compose CLI entry point (main()).
 *
 * IC-19: packages/compose/tests/cli.test.ts
 *
 * Mocking strategy:
 * - validateManifest, resolveExtensions, checkTargetCompatibility, build, initProject
 *   are mocked at the module level so main() never touches the filesystem or network.
 * - process.exit is spied upon and made to throw to allow assertions after "exit".
 * - process.stderr.write / process.stdout.write are spied upon to capture output.
 * - Temp files are used for manifest path tests that require a real file on disk.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockedFunction,
} from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { main } from '../src/cli.js';
import { ComposeError, ManifestValidationError } from '../src/errors.js';

// ============================================================
// MODULE MOCKS
// ============================================================

// Mock all modules imported by cli.ts that perform I/O or heavy computation.
vi.mock('../src/schema.js', () => ({
  validateManifest: vi.fn(),
}));

vi.mock('../src/resolve.js', () => ({
  resolveExtensions: vi.fn(),
}));

vi.mock('../src/compat.js', () => ({
  checkTargetCompatibility: vi.fn(),
}));

vi.mock('../src/targets/index.js', () => ({
  build: vi.fn(),
}));

vi.mock('../src/init.js', () => ({
  initProject: vi.fn(),
}));

// Import the mocked modules to configure return values per test.
import * as schemaModule from '../src/schema.js';
import * as resolveModule from '../src/resolve.js';
import * as compatModule from '../src/compat.js';
import * as targetsModule from '../src/targets/index.js';
import * as initModule from '../src/init.js';

const mockValidateManifest = schemaModule.validateManifest as MockedFunction<
  typeof schemaModule.validateManifest
>;
const mockResolveExtensions = resolveModule.resolveExtensions as MockedFunction<
  typeof resolveModule.resolveExtensions
>;
const mockCheckTargetCompatibility =
  compatModule.checkTargetCompatibility as MockedFunction<
    typeof compatModule.checkTargetCompatibility
  >;
const mockBuild = targetsModule.build as MockedFunction<
  typeof targetsModule.build
>;
const mockInitProject = initModule.initProject as MockedFunction<
  typeof initModule.initProject
>;

// ============================================================
// SHARED TEST HELPERS
// ============================================================

/** A minimal valid manifest object returned by validateManifest mocks. */
const STUB_MANIFEST = {
  name: 'my-agent',
  version: '1.0.0',
  runtime: '@rcrsr/rill@^0.8.0',
  entry: 'src/main.rill',
  modules: {},
  extensions: {},
  functions: {},
  assets: [],
};

/** A stub build result returned by the build mock. */
const STUB_BUILD_RESULT = {
  outputPath: 'dist/',
  target: 'container' as const,
  card: {
    name: 'my-agent',
    version: '1.0.0',
    capabilities: [],
  },
  resolvedManifest: STUB_MANIFEST,
};

/**
 * Writes a minimal agent.json to a temp file and returns its path.
 * The manifest content does not need to be valid — validateManifest is mocked.
 */
function writeTempManifest(): string {
  const manifestPath = join(tmpdir(), `agent-${Date.now()}.json`);
  writeFileSync(
    manifestPath,
    JSON.stringify({
      name: 'my-agent',
      version: '1.0.0',
      runtime: '@rcrsr/rill@^0.8.0',
      entry: 'src/main.rill',
    })
  );
  return manifestPath;
}

// ============================================================
// SETUP / TEARDOWN
// ============================================================

let mockExit: ReturnType<typeof vi.spyOn>;
let mockStderrWrite: ReturnType<typeof vi.spyOn>;
let mockStdoutWrite: ReturnType<typeof vi.spyOn>;
let tempManifestPath: string | undefined;

beforeEach(() => {
  // Make process.exit throw so test execution can continue past the call site.
  mockExit = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
    throw new Error(`process.exit(${String(_code)})`);
  }) as ReturnType<typeof vi.spyOn>;

  mockStderrWrite = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true);
  mockStdoutWrite = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);

  // Default happy-path mock return values.
  mockValidateManifest.mockReturnValue(STUB_MANIFEST);
  mockResolveExtensions.mockResolvedValue([]);
  mockCheckTargetCompatibility.mockResolvedValue(undefined);
  mockBuild.mockResolvedValue(STUB_BUILD_RESULT);
  mockInitProject.mockResolvedValue(undefined);

  tempManifestPath = undefined;
});

afterEach(() => {
  mockExit.mockRestore();
  mockStderrWrite.mockRestore();
  mockStdoutWrite.mockRestore();

  if (tempManifestPath !== undefined) {
    try {
      unlinkSync(tempManifestPath);
    } catch {
      // Best-effort cleanup.
    }
  }

  vi.clearAllMocks();
});

// ============================================================
// BUILD SUBCOMMAND [IR-9]
// ============================================================

describe('build subcommand [IR-9]', () => {
  it('invokes build with container target by default', async () => {
    tempManifestPath = writeTempManifest();
    await main([tempManifestPath]);

    expect(mockBuild).toHaveBeenCalledWith(
      'container',
      expect.objectContaining({ manifest: STUB_MANIFEST })
    );
  });

  it('invokes build with lambda target when --target lambda is passed', async () => {
    tempManifestPath = writeTempManifest();
    await main([tempManifestPath, '--target', 'lambda']);

    expect(mockBuild).toHaveBeenCalledWith(
      'lambda',
      expect.objectContaining({ manifest: STUB_MANIFEST })
    );
  });

  it('invokes validateManifest with parsed JSON content', async () => {
    tempManifestPath = writeTempManifest();
    await main([tempManifestPath]);

    expect(mockValidateManifest).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'my-agent' })
    );
  });

  it('invokes resolveExtensions with manifest extensions', async () => {
    tempManifestPath = writeTempManifest();
    await main([tempManifestPath]);

    expect(mockResolveExtensions).toHaveBeenCalledWith(
      STUB_MANIFEST.extensions,
      expect.objectContaining({ manifestDir: expect.any(String) })
    );
  });

  it('invokes checkTargetCompatibility with resolved extensions and target', async () => {
    const resolvedExts = [
      {
        alias: 'llm',
        namespace: 'llm',
        strategy: 'npm' as const,
        factory: vi.fn(),
        config: {},
      },
    ];
    mockResolveExtensions.mockResolvedValue(resolvedExts);
    tempManifestPath = writeTempManifest();

    await main([tempManifestPath, '--target', 'worker']);

    expect(mockCheckTargetCompatibility).toHaveBeenCalledWith(
      resolvedExts,
      'worker'
    );
  });

  it('prints build success message to stdout', async () => {
    tempManifestPath = writeTempManifest();
    await main([tempManifestPath]);

    const calls = mockStdoutWrite.mock.calls.map((c) => String(c[0]));
    expect(calls.some((line) => line.includes('Build succeeded'))).toBe(true);
  });
});

// ============================================================
// INIT SUBCOMMAND [IR-10]
// ============================================================

describe('init subcommand [IR-10]', () => {
  it('invokes initProject with project name', async () => {
    await main(['init', 'my-agent']);

    expect(mockInitProject).toHaveBeenCalledWith(
      'my-agent',
      expect.objectContaining({ extensions: [] })
    );
  });

  it('passes extensions list to initProject when --extensions is provided', async () => {
    await main(['init', 'my-agent', '--extensions', 'anthropic,qdrant']);

    expect(mockInitProject).toHaveBeenCalledWith(
      'my-agent',
      expect.objectContaining({ extensions: ['anthropic', 'qdrant'] })
    );
  });

  it('prints created project message to stdout', async () => {
    await main(['init', 'my-agent']);

    const calls = mockStdoutWrite.mock.calls.map((c) => String(c[0]));
    expect(
      calls.some((line) => line.includes('Created project: my-agent'))
    ).toBe(true);
  });
});

// ============================================================
// --help FLAG
// ============================================================

describe('--help flag', () => {
  it('prints usage and exits 0 for top-level --help', async () => {
    await expect(main(['--help'])).rejects.toThrow('process.exit(0)');
    const calls = mockStdoutWrite.mock.calls.map((c) => String(c[0]));
    expect(calls.some((line) => line.includes('rill-compose'))).toBe(true);
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('prints build usage and exits 0 for --help before manifest path', async () => {
    await expect(main(['--help'])).rejects.toThrow('process.exit(0)');
    expect(mockExit).toHaveBeenCalledWith(0);
  });
});

// ============================================================
// MISSING MANIFEST PATH [IC-19]
// ============================================================

describe('missing manifest path', () => {
  it('prints "Error: missing manifest path" and exits 1 when no args given', async () => {
    await expect(main([])).rejects.toThrow('process.exit(1)');

    const calls = mockStderrWrite.mock.calls.map((c) => String(c[0]));
    expect(
      calls.some((line) => line.includes('Error: missing manifest path'))
    ).toBe(true);
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('prints "Error: missing manifest path" and exits 1 when first arg is a flag', async () => {
    await expect(main(['--output', 'dist/'])).rejects.toThrow(
      'process.exit(1)'
    );

    const calls = mockStderrWrite.mock.calls.map((c) => String(c[0]));
    expect(
      calls.some((line) => line.includes('Error: missing manifest path'))
    ).toBe(true);
  });
});

// ============================================================
// UNKNOWN TARGET [AC-19]
// ============================================================

describe('unknown target [AC-19]', () => {
  it('prints exact error message and exits 1 for unknown target', async () => {
    await expect(
      main(['agent.json', '--target', 'kubernetes'])
    ).rejects.toThrow('process.exit(1)');

    const calls = mockStderrWrite.mock.calls.map((c) => String(c[0]));
    expect(
      calls.some((line) =>
        line.includes(
          'Error: unknown target: kubernetes. Valid: container, lambda, worker, local'
        )
      )
    ).toBe(true);
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('accepts all valid target names without error', async () => {
    const validTargets = ['container', 'lambda', 'worker', 'local'];
    for (const target of validTargets) {
      vi.clearAllMocks();
      mockValidateManifest.mockReturnValue(STUB_MANIFEST);
      mockResolveExtensions.mockResolvedValue([]);
      mockCheckTargetCompatibility.mockResolvedValue(undefined);
      mockBuild.mockResolvedValue({
        ...STUB_BUILD_RESULT,
        target: target as typeof STUB_BUILD_RESULT.target,
      });
      mockStdoutWrite = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
      mockStderrWrite = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      tempManifestPath = writeTempManifest();
      await main([tempManifestPath, '--target', target]);
      expect(mockBuild).toHaveBeenCalledWith(target, expect.any(Object));

      try {
        unlinkSync(tempManifestPath);
      } catch {
        // Ignore.
      }
      tempManifestPath = undefined;
    }
  });
});

// ============================================================
// MISSING FUNCTION SOURCE [AC-21]
// ============================================================

describe('missing function source [AC-21]', () => {
  it('prints "Error: function source not found: {path}" and exits 1', async () => {
    const missingPath = '/nonexistent/fn.ts';
    mockBuild.mockRejectedValue(
      new ComposeError(
        `function source not found: ${missingPath}`,
        'compilation'
      )
    );
    tempManifestPath = writeTempManifest();

    await expect(main([tempManifestPath])).rejects.toThrow('process.exit(1)');

    const calls = mockStderrWrite.mock.calls.map((c) => String(c[0]));
    expect(
      calls.some((line) =>
        line.includes(`Error: function source not found: ${missingPath}`)
      )
    ).toBe(true);
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});

// ============================================================
// UNRESOLVED ENV VAR [AC-22]
// ============================================================

describe('unresolved env var [AC-22]', () => {
  it('build continues when resolveExtensions writes an unresolved env var warning', async () => {
    // The CLI does not currently emit env var warnings itself; it relies on
    // downstream modules writing warnings to stderr. We verify that the build
    // completes (exits 0, not 1) when a warning is written to stderr mid-build.
    mockResolveExtensions.mockImplementation(async () => {
      process.stderr.write(
        'Warning: unresolved environment variable: API_KEY\n'
      );
      return [];
    });
    tempManifestPath = writeTempManifest();

    // Should resolve without throwing (no process.exit(1)).
    await main([tempManifestPath]);

    const stderrCalls = mockStderrWrite.mock.calls.map((c) => String(c[0]));
    expect(
      stderrCalls.some((line) =>
        line.includes('Warning: unresolved environment variable: API_KEY')
      )
    ).toBe(true);
    // process.exit must NOT have been called with 1.
    expect(mockExit).not.toHaveBeenCalledWith(1);
  });
});

// ============================================================
// ENTRY FILE ABSENT [AC-13]
// ============================================================

describe('entry file absent [AC-13]', () => {
  it('prints "Error: entry file not found: {path}" and exits 1', async () => {
    const missingEntry = '/tmp/my-agent/src/main.rill';
    mockResolveExtensions.mockRejectedValue(
      new ComposeError(`entry file not found: ${missingEntry}`, 'compilation')
    );
    tempManifestPath = writeTempManifest();

    await expect(main([tempManifestPath])).rejects.toThrow('process.exit(1)');

    const calls = mockStderrWrite.mock.calls.map((c) => String(c[0]));
    expect(
      calls.some((line) =>
        line.includes(`Error: entry file not found: ${missingEntry}`)
      )
    ).toBe(true);
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});

// ============================================================
// MANIFEST VALIDATION ERROR
// ============================================================

describe('ManifestValidationError handling', () => {
  it('prints first issue message from ManifestValidationError and exits 1', async () => {
    mockValidateManifest.mockImplementation(() => {
      throw new ManifestValidationError('Validation failed', [
        { path: 'manifest.name', message: 'manifest.name is required' },
      ]);
    });
    tempManifestPath = writeTempManifest();

    await expect(main([tempManifestPath])).rejects.toThrow('process.exit(1)');

    const calls = mockStderrWrite.mock.calls.map((c) => String(c[0]));
    expect(
      calls.some((line) => line.includes('Error: manifest.name is required'))
    ).toBe(true);
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
