/**
 * Rill Runtime Tests: default-value catch scope
 *
 * A `?? default` on a postfix chain or a pipe target recovers only from a
 * missing method, field, or annotation key raised while computing the
 * receiver value. The default body runs outside that recovery scope, so a
 * missing-field halt raised inside the default body itself surfaces as is and
 * the body is not evaluated a second time.
 */

import { anyTypeValue, type RillFunction } from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

/** Host function that counts its invocations and returns a number. */
function makeCountedFn(): { fn: RillFunction; count: () => number } {
  let calls = 0;
  return {
    fn: {
      params: [],
      returnType: anyTypeValue,
      fn: (): number => {
        calls += 1;
        return calls;
      },
    },
    count: () => calls,
  };
}

describe('default value catch scope', () => {
  it('surfaces a missing-field halt from a postfix default body for a vacant value after one evaluation', async () => {
    const tick = makeCountedFn();

    await expectHalt(
      () =>
        run('dict[a: ""].a ?? { tick() => $n\n dict[b: 2].gone }', {
          functions: { tick: tick.fn },
        }),
      { code: 'RILL_R009' }
    );

    expect(tick.count()).toBe(1);
  });

  it('surfaces a missing-field halt from a pipe-target default body for a vacant value after one evaluation', async () => {
    const tick = makeCountedFn();

    await expectHalt(
      () =>
        run('dict[a: ""] -> .a ?? { tick() => $n\n dict[b: 2].gone }', {
          functions: { tick: tick.fn },
        }),
      { code: 'RILL_R009' }
    );

    expect(tick.count()).toBe(1);
  });

  it('still recovers a missing field with the default in both forms', async () => {
    const postfix = await run('dict[a: 1].absent ?? "fallback"');
    const piped = await run('dict[a: 1] -> .absent ?? "fallback"');

    expect(postfix).toBe('fallback');
    expect(piped).toBe('fallback');
  });
});
