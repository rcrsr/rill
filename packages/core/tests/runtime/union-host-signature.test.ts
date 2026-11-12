/**
 * Rill Runtime Tests: union(...) in host signatures and manifests
 *
 * Host signature strings take the union(...) form. A union parameter rejects
 * values outside its members before the host function runs, duplicate or
 * compound members fail at registration, and a manifest prints the union in
 * a form that parses back.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createRuntimeContext,
  execute,
  generateManifest,
  parse,
  type RillValue,
} from '@rcrsr/rill';

describe('union host signatures', () => {
  it('halts R001 for a value outside the members and never calls the host function', async () => {
    const body = vi.fn((): RillValue => 'ok');
    const ctx = createRuntimeContext({
      functions: {
        convert: { signature: '|u: union("c", "f")|:string', fn: body },
      },
    });

    await expect(execute(parse('convert("x")'), ctx)).rejects.toHaveProperty(
      'errorId',
      'RILL-R001'
    );
    expect(body).not.toHaveBeenCalled();
  });

  it('registers a single-literal union and halts R001 for another value', async () => {
    const body = vi.fn((): RillValue => 'ok');
    const ctx = createRuntimeContext({
      functions: {
        convert: { signature: '|u: union("c")|:string', fn: body },
        pick: { signature: '|u: union(#a)|:string', fn: body },
      },
    });

    await expect(execute(parse('convert("x")'), ctx)).rejects.toHaveProperty(
      'errorId',
      'RILL-R001'
    );
    await expect(execute(parse('pick(#b)'), ctx)).rejects.toHaveProperty(
      'errorId',
      'RILL-R001'
    );
    expect(body).not.toHaveBeenCalled();
  });

  it('calls the host function for a member value', async () => {
    const body = vi.fn((): RillValue => 'ok');
    const ctx = createRuntimeContext({
      functions: {
        convert: { signature: '|u: union("c", "f")|:string', fn: body },
      },
    });

    const result = await execute(parse('convert("c")'), ctx);
    expect(result.result).toBe('ok');
    expect(body).toHaveBeenCalledTimes(1);
  });

  it('throws at registration for a member listed twice', () => {
    expect(() =>
      createRuntimeContext({
        functions: {
          fn: {
            signature: '|u: union(string, string)|',
            fn: (): RillValue => 'ok',
          },
        },
      })
    ).toThrow(/Invalid signature for function 'fn'/);
  });

  it('throws at registration for a compound literal member', () => {
    expect(() =>
      createRuntimeContext({
        functions: {
          fn: {
            signature: '|u: union(list[1])|',
            fn: (): RillValue => 'ok',
          },
        },
      })
    ).toThrow(/unsupported union member 'list\['/);
  });
});

describe('union manifest round-trip', () => {
  it('prints a union parameter as union(...) and parses it back', () => {
    const ctx = createRuntimeContext({
      functions: {
        convert: {
          signature: '|u: union("c", "f")|:string',
          fn: (): RillValue => 'ok',
        },
      },
    });

    const manifest = generateManifest(ctx);
    expect(manifest).toContain('u: union("c", "f")');
    expect(() => parse(manifest)).not.toThrow();
  });
});

describe('union atom members in host signatures', () => {
  it('prints atom members as #name in the manifest and parses it back', () => {
    const ctx = createRuntimeContext({
      functions: {
        pick: {
          signature: '|u: union(#a, #b)|:string',
          fn: (): RillValue => 'ok',
        },
      },
    });

    const manifest = generateManifest(ctx);
    expect(manifest).toContain('u: union(#a, #b)');
    expect(() => parse(manifest)).not.toThrow();
  });

  it('names atom members in the R001 mismatch and accepts a member', async () => {
    const ctx = createRuntimeContext({
      functions: {
        pick: {
          signature: '|u: union(#a, #b)|:string',
          fn: (): RillValue => 'ok',
        },
      },
    });

    const failure = await execute(parse('pick(#c)'), ctx).catch(
      (err: unknown) => err
    );
    expect(failure).toHaveProperty('errorId', 'RILL-R001');
    expect(String((failure as Error).message)).toContain('union(#a, #b)');
    expect((await execute(parse('pick(#a)'), ctx)).result).toBe('ok');
  });
});
