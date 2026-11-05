/**
 * Rill Runtime Tests: Pipe Target Postfix Chains
 *
 * Pass blocks, timeout blocks, while loops, and do-while loops used as pipe
 * targets accept a trailing method or index chain.
 */

import { describe, expect, it } from 'vitest';
import { run } from '../helpers/runtime.js';

describe('pipe target postfix chains', () => {
  it('applies a method to a pass block target', async () => {
    expect(await run('"a" -> pass { 1 } .upper')).toBe('A');
  });

  it('applies a property to a pass block target', async () => {
    expect(await run('"a" -> pass { 1 } .len')).toBe(1);
  });

  it('indexes the result of a do-while target', async () => {
    expect(await run('list[5, 6] -> do { $ } while (false) [0]')).toBe(5);
  });

  it('applies a method to a while loop target', async () => {
    expect(await run('0 -> while ($ < 3) do { $ + 1 } .eq(3)')).toBe(true);
  });

  it('applies a method to a timeout block target', async () => {
    expect(
      await run('"a" -> timeout<total: duration(0,0,1)> { "x" } .upper')
    ).toBe('X');
  });
});
