/**
 * Rill Runtime Tests: fn type provenance
 *
 * A fn literal carries the exact signature it was written with, and fn type
 * equality compares names, param types, defaults, and the outer type.
 */

import { describe, expect, it } from 'vitest';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

describe('fn type provenance', () => {
  it('halts #TYPE_MISMATCH at creation when a default does not match its param type', async () => {
    await expectHalt(() => run('fn(x: number = "a") { $x }'), {
      code: 'TYPE_MISMATCH',
    });
  });

  it('reports a fn literal type equal to the fn type written with the same signature', async () => {
    expect(
      await run('fn(x: number):string { "{$x}" }.^type == fn(x: number):string')
    ).toBe(true);
  });

  it('does not match a fn carrying a default the asserted type omits', async () => {
    expect(await run('fn(x: number = 1) { $x } -> :?fn(x: number)')).toBe(
      false
    );
  });

  it('compares fn types unequal when only a param name differs', async () => {
    expect(await run('fn(y: string):string == fn(x: string):string')).toBe(
      false
    );
  });

  it('keeps both union members when one fn type adds a default', async () => {
    const signature = await run(
      'union(fn(x: number), fn(x: number = 1)) => $u\n$u.signature'
    );
    expect(signature).toContain('fn(x: number = 1)');
    expect(signature).toContain('fn(x: number):any');
  });
});
