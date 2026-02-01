import { describe, it, expect } from 'vitest';
import { run } from './helpers/runtime.js';

describe('.params property access', () => {
  it('returns param dict with type annotations', async () => {
    const result = await run(`
      |a: string, b: number| { $a } :> $fn
      $fn.params
    `);
    expect(result).toEqual({
      a: { type: 'string' },
      b: { type: 'number' },
    });
  });

  it('returns empty dict for no-param closure', async () => {
    const result = await run(`
      || { 42 } :> $fn
      $fn.params
    `);
    expect(result).toEqual({});
  });

  it('throws for non-closure target', async () => {
    await expect(run(`
      "hello" :> $str
      $str.params
    `)).rejects.toThrow('Cannot access .params on string');
  });
});
