/**
 * Rill Runtime Tests: the built-in error_code type at the host boundary
 *
 * Host signatures accept error_code and list(error_code), invalidate values
 * carry a code that satisfies it, and manifests print it in a form that
 * parses back.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  atomName,
  createRuntimeContext,
  ERROR_CODES,
  execute,
  formatStructure,
  generateManifest,
  isAtom,
  parse,
  type RillValue,
} from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

describe('error_code host signatures', () => {
  const makeCtx = (body: () => RillValue) =>
    createRuntimeContext({
      functions: {
        check: { signature: '|codes: list(error_code)| :bool', fn: body },
      },
    });

  it('accepts a list of error codes', async () => {
    const body = vi.fn((): RillValue => true);
    const result = await execute(
      parse('check(list[#TIMEOUT, #AUTH])'),
      makeCtx(body)
    );
    expect(result.result).toBe(true);
    expect(body).toHaveBeenCalledTimes(1);
  });

  it('rejects #ok in the list before calling the host function', async () => {
    const body = vi.fn((): RillValue => true);
    await expect(
      execute(parse('check(list[#ok])'), makeCtx(body))
    ).rejects.toHaveProperty('errorId', 'RILL-R001');
    expect(body).not.toHaveBeenCalled();
  });

  it('throws at registration when error_code takes type arguments', () => {
    expect(() =>
      createRuntimeContext({
        functions: {
          bad: {
            signature: '|c: error_code(string)| :bool',
            fn: (): RillValue => true,
          },
        },
      })
    ).toThrow(/does not accept type arguments/);
  });
});

describe('error_code from invalidate', () => {
  it.each(ERROR_CODES)(
    'accepts the code of an invalidate with %s',
    async (code) => {
      const ctx = createRuntimeContext({});
      const invalid = ctx.invalidate(new Error('x'), {
        code,
        provider: 'test',
      });
      const result = await run('$v.!code -> :error_code', {
        variables: { v: invalid },
      });
      expect(isAtom(result) ? atomName(result.atom) : undefined).toBe(code);
    }
  );
});

describe('error_code manifest round-trip', () => {
  it('prints list(error_code) in the manifest', () => {
    const ctx = createRuntimeContext({
      functions: {
        check: {
          signature: '|codes: list(error_code)| :bool',
          fn: (): RillValue => true,
        },
      },
    });
    expect(generateManifest(ctx)).toContain('list(error_code)');
  });

  it('parses a printed union(#ok, error_code) back to an equal type', async () => {
    const printed = (await run('union(#ok, error_code)')) as {
      structure: Parameters<typeof formatStructure>[0];
    };
    const text = formatStructure(printed.structure);
    expect(text).toBe('union(error_code, #ok)');
    expect(await run(`union(#ok, error_code) == ${text}`)).toBe(true);
  });
});
