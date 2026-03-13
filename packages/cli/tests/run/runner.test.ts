/**
 * Runner tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runScript, buildModuleResolver } from '../../src/run/runner.js';
import type { RunCliOptions } from '../../src/run/types.js';
import type { NestedExtConfig, RillConfigFile } from '@rcrsr/rill-config';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RuntimeError, rillTypeToTypeValue } from '@rcrsr/rill';

let _executeErrorOverride: Error | null = null;

vi.mock('@rcrsr/rill', async (importActual) => {
  const actual = await importActual<typeof import('@rcrsr/rill')>();
  return {
    ...actual,
    execute: vi.fn(async (...args: Parameters<typeof actual.execute>) => {
      if (_executeErrorOverride !== null) throw _executeErrorOverride;
      return actual.execute(...args);
    }),
  };
});

function makeOpts(overrides: Partial<RunCliOptions> = {}): RunCliOptions {
  return {
    scriptPath: '/tmp/test.rill',
    scriptArgs: [],
    config: './rill-config.json',
    format: 'human',
    verbose: false,
    maxStackDepth: 10,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<RillConfigFile> = {}): RillConfigFile {
  return { modules: {}, ...overrides };
}

async function runTempScript(
  source: string,
  optsOverrides: Partial<RunCliOptions> = {},
  config: RillConfigFile = makeConfig(),
  extTree: NestedExtConfig = {},
  bindingsSrc: string = '[:]',
  disposes: Array<() => void | Promise<void>> = []
) {
  const scriptPath = path.join(os.tmpdir(), `rill-test-${Date.now()}.rill`);
  fs.writeFileSync(scriptPath, source, 'utf-8');
  try {
    return await runScript(
      makeOpts({ scriptPath, ...optsOverrides }),
      config,
      extTree,
      bindingsSrc,
      disposes
    );
  } finally {
    fs.unlinkSync(scriptPath);
  }
}

describe('runScript', () => {
  describe('Exit Code Interface', () => {
    it('returns exit 0 when script returns true', async () => {
      expect((await runTempScript('true')).exitCode).toBe(0);
    });

    it('returns exit 1 when script returns false', async () => {
      const result = await runTempScript('false');
      expect(result.exitCode).toBe(1);
      expect(result.output).toBeUndefined();
    });

    it('returns exit 0 and output when script returns non-empty string', async () => {
      const result = await runTempScript('"hello world"');
      expect(result.exitCode).toBe(0);
      expect(result.output).toBe('hello world');
    });

    it('returns exit 1 when script returns empty string', async () => {
      const result = await runTempScript('""');
      expect(result.exitCode).toBe(1);
      expect(result.output).toBeUndefined();
    });

    it('returns exit code from two-element tuple result', async () => {
      const result = await runTempScript('tuple[42, "custom error"]');
      expect(result.exitCode).toBe(42);
      expect(result.output).toBe('custom error');
    });

    it('returns exit 0 from two-element tuple result with code 0', async () => {
      const result = await runTempScript('tuple[0, "success"]');
      expect(result.exitCode).toBe(0);
      expect(result.output).toBe('success');
    });

    it('produces no output when two-element tuple has empty message', async () => {
      const result = await runTempScript('tuple[1, ""]');
      expect(result.exitCode).toBe(1);
      expect(result.output).toBeUndefined();
    });

    it('returns exit 0 for numeric results', async () => {
      expect((await runTempScript('42')).exitCode).toBe(0);
    });
  });

  describe('File not found', () => {
    it('returns exit 1 when script file does not exist', async () => {
      const result = await runScript(
        makeOpts({ scriptPath: '/nonexistent/path/script.rill' }),
        makeConfig(),
        {},
        '[:]',
        []
      );
      expect(result.exitCode).toBe(1);
      expect(result.errorOutput).toContain('/nonexistent/path/script.rill');
    });
  });

  describe('Parse errors (EC-8)', () => {
    it('returns exit 1 with error message on parse error', async () => {
      const result = await runTempScript('??? invalid syntax !!!');
      expect(result.exitCode).toBe(1);
      expect(result.errorOutput).toBeDefined();
    });

    it('returns error output containing error ID for a script syntax error', async () => {
      const result = await runTempScript('@@@@@@ not valid rill at all @@@@@@');
      expect(result.exitCode).toBe(1);
      expect(result.errorOutput).toMatch(/RILL-[A-Z]\d+/);
    });

    it('does not include output when script has a parse error', async () => {
      const result = await runTempScript('<<< invalid >>>');
      expect(result.exitCode).toBe(1);
      expect(result.output).toBeUndefined();
    });
  });

  describe('Runtime errors (EC-9)', () => {
    it('returns exit 1 with RuntimeError shape on runtime error', async () => {
      const result = await runTempScript('$undefined_variable_xyz');
      expect(result.exitCode).toBe(1);
      expect(result.errorOutput).toBeDefined();
    });
  });

  describe('ext scheme resolver', () => {
    it('returns exit 1 when ext name not found (RILL-R052)', async () => {
      const result = await runTempScript(
        'use<ext:unknown_extension_xyz> => $ext\n$ext',
        {},
        makeConfig(),
        {},
        '[:]'
      );
      expect(result.exitCode).toBe(1);
      expect(result.errorOutput).toContain('unknown_extension_xyz');
    });
  });

  describe('ext drilling', () => {
    function makeExtTree(): NestedExtConfig {
      return {
        llm: {
          openai: {
            message: {
              fn: async () => true,
              params: [],
              returnType: rillTypeToTypeValue({ type: 'any' }),
            },
          },
        },
      };
    }

    it('resolves ext.llm.openai to a subtree source with full ext paths', () => {
      const resolver = buildModuleResolver('[:]', {}, makeExtTree());
      const resolution = resolver('ext.llm.openai');
      expect(resolution).toEqual(expect.objectContaining({ kind: 'source' }));
      const { text } = resolution as { kind: 'source'; text: string };
      expect(text).toContain('message:');
      expect(text).toContain('use<ext:llm.openai.message>');
    });

    it('returns exit 1 for unknown drill path ext.nonexistent', async () => {
      const result = await runTempScript(
        'use<module:ext.nonexistent> => $x\ntrue',
        {},
        makeConfig(),
        {},
        '[:]'
      );
      expect(result.exitCode).toBe(1);
    });

    it('returns exit 1 when drilling to a leaf function', async () => {
      const result = await runTempScript(
        'use<module:ext.llm.openai.message> => $x\ntrue',
        {},
        makeConfig(),
        makeExtTree(),
        '[:]'
      );
      expect(result.exitCode).toBe(1);
    });
  });

  describe('module scheme resolver', () => {
    it('ignores user-defined modules.ext and uses generated bindings', async () => {
      const config = makeConfig({ modules: { ext: '/some/user/path.rill' } });
      const result = await runTempScript(
        'use<module:ext> => $ext\ntrue',
        {},
        config,
        {},
        '[:]'
      );
      expect(result.exitCode).toBe(0);
    });

    it('resolves user-defined module IDs via moduleResolver', async () => {
      const utilPath = path.join(os.tmpdir(), `rill-utils-${Date.now()}.rill`);
      fs.writeFileSync(utilPath, '"hello from utils"', 'utf-8');
      try {
        const config = makeConfig({ modules: { utils: utilPath } });
        const result = await runTempScript(
          'use<module:utils> => $utils\n$utils',
          {},
          config,
          {},
          '[:]'
        );
        expect(result.exitCode).toBe(0);
        expect(result.output).toBe('hello from utils');
      } finally {
        fs.unlinkSync(utilPath);
      }
    });
  });

  describe('dispose callbacks', () => {
    it('calls all dispose callbacks after execution', async () => {
      const dispose1 = vi.fn().mockResolvedValue(undefined);
      const dispose2 = vi.fn().mockResolvedValue(undefined);
      await runTempScript('true', {}, makeConfig(), {}, '[:]', [
        dispose1,
        dispose2,
      ]);
      expect(dispose1).toHaveBeenCalledOnce();
      expect(dispose2).toHaveBeenCalledOnce();
    });

    it('calls dispose callbacks even when script throws runtime error', async () => {
      const dispose = vi.fn().mockResolvedValue(undefined);
      await runTempScript('$undefined_xyz', {}, makeConfig(), {}, '[:]', [
        dispose,
      ]);
      expect(dispose).toHaveBeenCalledOnce();
    });
  });

  describe('output format', () => {
    it('formats output as JSON when format is json', async () => {
      const result = await runTempScript('"hello"', { format: 'json' });
      expect(result.exitCode).toBe(0);
      expect(result.output).toBe(JSON.stringify('hello'));
    });

    it('formats dict output in human mode', async () => {
      const result = await runTempScript('[a: 1, b: 2]', { format: 'human' });
      expect(result.exitCode).toBe(0);
      expect(result.output).toBeDefined();
    });
  });

  describe('pipe value from CLI args', () => {
    it('sets pipeValue when scriptArgs are provided', async () => {
      const result = await runTempScript('$', { scriptArgs: ['hello'] });
      expect(result.exitCode).toBe(0);
      expect(result.output).toBe('hello');
    });
  });

  describe('stack frame limiting (--max-stack-depth)', () => {
    const fakeFrames = [
      {
        location: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 5, offset: 4 },
        },
        functionName: 'outer',
      },
      {
        location: {
          start: { line: 2, column: 3, offset: 10 },
          end: { line: 2, column: 8, offset: 15 },
        },
        functionName: 'middle',
      },
      {
        location: {
          start: { line: 3, column: 1, offset: 20 },
          end: { line: 3, column: 4, offset: 23 },
        },
        functionName: 'inner',
      },
    ];

    beforeEach(() => {
      _executeErrorOverride = new RuntimeError(
        'RILL-R004',
        'test frame error',
        undefined,
        {
          callStack: fakeFrames,
        }
      );
    });

    afterEach(() => {
      _executeErrorOverride = null;
    });

    it('suppresses all stack frames when maxStackDepth is 0', async () => {
      const result = await runTempScript('true', { maxStackDepth: 0 });
      expect(result.exitCode).toBe(1);
      expect(result.errorOutput).toContain('RILL-R004');
      expect(result.errorOutput).not.toContain('at 1:');
      expect(result.errorOutput).not.toContain('at 2:');
      expect(result.errorOutput).not.toContain('at 3:');
    });

    it('limits stack frames to 2 when maxStackDepth is 2', async () => {
      const result = await runTempScript('true', { maxStackDepth: 2 });
      expect(result.exitCode).toBe(1);
      // Frame at line 1 shown as source snippet, frame at line 2 shown as fallback
      expect(result.errorOutput).toMatch(/1 \|/);
      expect(result.errorOutput).toContain('at 2:3');
      expect(result.errorOutput).not.toContain('at 3:1');
    });

    it('shows all frames when maxStackDepth exceeds frame count', async () => {
      const result = await runTempScript('true', { maxStackDepth: 10 });
      expect(result.exitCode).toBe(1);
      // Frame at line 1 shown as source snippet, frames at lines 2 and 3 as fallback
      expect(result.errorOutput).toMatch(/1 \|/);
      expect(result.errorOutput).toContain('at 2:3');
      expect(result.errorOutput).toContain('at 3:1');
    });
  });
});
