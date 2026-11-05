/**
 * Rill Runtime Tests: Pipe Target Postfix Chains
 *
 * Pass blocks, timeout blocks, while loops, and do-while loops used as pipe
 * targets accept a trailing method or index chain.
 */

import { describe, expect, it } from 'vitest';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

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

  it('applies a method after a type assertion on a pass block target', async () => {
    expect(await run('"a" -> pass { "x" }:string.upper')).toBe('A');
  });

  it('applies a method after a type assertion on a timeout block target', async () => {
    expect(
      await run('"a" -> timeout<total: duration(0,0,1)> { "x" }:string.upper')
    ).toBe('X');
  });

  it('halts catchably on a status probe chain over a pass block target', async () => {
    await expectHalt(() => run('"a" -> pass { "x" }.!.len'), {
      code: 'INVALID_INPUT',
      messagePattern: /Unsupported pipe target type: StatusProbe/,
    });
  });

  it('halts with a type mismatch when a trailing assertion fails on a pass block target', async () => {
    await expectHalt(() => run('"a" -> pass { 1 }:number'), {
      code: 'TYPE_MISMATCH',
      messagePattern: /Type assertion failed: expected number, got string/,
    });
  });

  it('passes the piped value through when a trailing assertion holds on a pass block target', async () => {
    expect(await run('"a" -> pass { "x" }:string')).toBe('a');
  });

  it('returns a boolean for a trailing type check on a pass block target', async () => {
    expect(await run('"a" -> pass { 1 }:?string')).toBe(true);
  });

  it('halts catchably on a bare status probe over a pass block target', async () => {
    await expectHalt(() => run('"a" -> pass { 1 }.!'), {
      code: 'INVALID_INPUT',
      messagePattern: /Unsupported pipe target type: StatusProbe/,
    });
  });

  it('halts catchably on a code status probe over a pass block target', async () => {
    await expectHalt(() => run('"a" -> pass { 1 }.!code'), {
      code: 'INVALID_INPUT',
      messagePattern: /Unsupported pipe target type: StatusProbe/,
    });
  });
});
