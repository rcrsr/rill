/**
 * Tests for use<ext:...> resolution with correct return types and annotations.
 * Verifies that convertTreeToRillValues preserves returnType and annotations
 * from extension RillFunctions, enabling accurate type introspection.
 */

import { describe, it, expect } from 'vitest';
import { runScript } from '../../src/run/runner.js';
import type { RunCliOptions } from '../../src/run/types.js';
import type { NestedExtConfig, RillConfigFile } from '@rcrsr/rill-config';
import { buildExtensionBindings } from '@rcrsr/rill-config';
import { rillTypeToTypeValue } from '@rcrsr/rill';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function makeOpts(scriptPath: string): RunCliOptions {
  return {
    scriptPath,
    scriptArgs: [],
    config: './rill-config.json',
    format: 'human',
    verbose: false,
    maxStackDepth: 10,
  };
}

function makeConfig(): RillConfigFile {
  return { modules: {} };
}

function makeExtTree(): NestedExtConfig {
  return {
    tools: {
      greet: {
        fn: async (_args: unknown[]) => 'hello',
        params: [
          {
            name: 'name',
            type: { type: 'string' },
            defaultValue: undefined,
            annotations: { description: 'The name to greet' },
          },
        ],
        returnType: rillTypeToTypeValue({ type: 'string' }),
        annotations: { description: 'Greets a user by name' },
      },
      compute: {
        fn: async (_args: unknown[]) => 42,
        params: [],
        returnType: rillTypeToTypeValue({ type: 'number' }),
        annotations: {},
      },
    },
  } as NestedExtConfig;
}

async function runTempScript(
  source: string,
  extTree: NestedExtConfig = {},
  bindingsSrc?: string
): Promise<{ exitCode: number; output?: string; errorOutput?: string }> {
  const scriptPath = path.join(os.tmpdir(), `rill-ext-test-${Date.now()}.rill`);
  fs.writeFileSync(scriptPath, source, 'utf-8');
  const resolvedBindings = bindingsSrc ?? buildExtensionBindings(extTree);
  try {
    return await runScript(
      makeOpts(scriptPath),
      makeConfig(),
      extTree,
      resolvedBindings,
      []
    );
  } finally {
    fs.unlinkSync(scriptPath);
  }
}

describe('ext-resolution', () => {
  describe('type reflection', () => {
    it('resolves use<ext:tools.greet> without error', async () => {
      const result = await runTempScript(
        'use<ext:tools.greet> => $greet\ntrue',
        makeExtTree()
      );
      expect(result.exitCode).toBe(0);
    });

    it('accesses ^type on greet without crashing', async () => {
      const result = await runTempScript(
        'use<ext:tools.greet> => $greet\n$greet.^type',
        makeExtTree()
      );
      expect(result.exitCode).toBe(0);
    });

    it('returns string type for greet function', async () => {
      const result = await runTempScript(
        'use<ext:tools.greet> => $greet\n$greet.^type',
        makeExtTree()
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('string');
    });

    it('returns number type for compute function', async () => {
      const result = await runTempScript(
        'use<ext:tools.compute> => $compute\n$compute.^type',
        makeExtTree()
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('number');
    });
  });

  describe('annotation reflection', () => {
    it('accesses ^description on greet without error', async () => {
      const result = await runTempScript(
        'use<ext:tools.greet> => $greet\n$greet.^description',
        makeExtTree()
      );
      expect(result.exitCode).toBe(0);
    });

    it('returns correct description annotation for greet', async () => {
      const result = await runTempScript(
        'use<ext:tools.greet> => $greet\n$greet.^description',
        makeExtTree()
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toBe('Greets a user by name');
    });

    it('accesses ^description on compute without error', async () => {
      const result = await runTempScript(
        'use<ext:tools.compute> => $compute\n$compute.^description',
        makeExtTree()
      );
      expect(result.exitCode).toBe(0);
    });
  });

  describe('invocability', () => {
    it('calls greet and returns hello', async () => {
      const result = await runTempScript(
        'use<ext:tools.greet> => $greet\n$greet("world")',
        makeExtTree()
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toBe('hello');
    });

    it('calls compute and exits 0 for numeric result', async () => {
      const result = await runTempScript(
        'use<ext:tools.compute> => $compute\n$compute()',
        makeExtTree()
      );
      expect(result.exitCode).toBe(0);
    });
  });

  describe('nested namespaces', () => {
    const deepTree: NestedExtConfig = {
      tools: {
        inner: {
          fn: {
            fn: async (_args: unknown[]) => 'deep',
            params: [],
            returnType: rillTypeToTypeValue({ type: 'string' }),
            annotations: { description: 'A deeply nested function' },
          },
        },
      },
    } as NestedExtConfig;

    it('resolves a deeper nested function at tools.inner.fn', async () => {
      const result = await runTempScript(
        'use<ext:tools.inner.fn> => $deepFn\n$deepFn()',
        deepTree
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toBe('deep');
    });

    it('returns correct ^type for nested function', async () => {
      const result = await runTempScript(
        'use<ext:tools.inner.fn> => $deepFn\n$deepFn.^type',
        deepTree
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('string');
    });
  });
});
