/**
 * Rill Runtime Tests: exhausted retry surfaces the FINAL attempt's error
 *
 * An exhausted `retry<limit: N>` must return the LAST attempt's invalid
 * value (its `#code` / message), not the first attempt's, while still
 * carrying one `guard-caught` frame per attempt (N frames total).
 *
 * Regression guard: a prior implementation seeded the returned invalid
 * value from attempt 1 and only appended frames on later attempts, so
 * `.!code` / `.!message` described the first failure instead of the final
 * one.
 */

import { describe, expect, it } from 'vitest';
import { createRuntimeContext, execute, parse } from '@rcrsr/rill';
import type { RillFunction, RillValue } from '@rcrsr/rill';
import { getStatus, isInvalid } from '../../src/runtime/core/types/status.js';
import { resolveAtom } from '../../src/runtime/core/types/atom-registry.js';
import { run } from '../helpers/runtime.js';

/**
 * A host function that returns a different value on each call, driven by a
 * shared call counter, so successive retry attempts fail differently.
 */
function makeSequenceFn(values: RillValue[]): RillFunction {
  let call = 0;
  return {
    params: [],
    fn: () => {
      const v = values[Math.min(call, values.length - 1)];
      call += 1;
      return v;
    },
  };
}

describe('Retry exhaustion surfaces the final attempt (bug #271)', () => {
  it('message reflects the LAST attempt, not the first, with N frames', async () => {
    // Attempt 1: `"str" + 1`  -> "Arithmetic requires number, got string"
    // Attempt 2: `list[1] + 1` -> "Arithmetic requires number, got list"
    const flaky = makeSequenceFn(['str', [1] as unknown as RillValue]);

    const result = await run(
      `
        retry<limit: 2> { flaky() + 1 } => $r
        $r
      `,
      { functions: { flaky } }
    );

    expect(isInvalid(result)).toBe(true);
    const status = getStatus(result);

    // The final failure's message must win, not attempt 1's.
    expect(status.message).toContain('got list');
    expect(status.message).not.toContain('got string');

    // Two attempts => two guard-caught frames, all tagged fn === 'retry'.
    const guardCaught = status.trace.filter((f) => f.kind === 'guard-caught');
    expect(guardCaught.length).toBe(2);
    for (const frame of guardCaught) {
      expect(frame.fn).toBe('retry');
    }
  });

  it('.!message probe surfaces the final attempt', async () => {
    const flaky = makeSequenceFn(['str', [1] as unknown as RillValue]);

    const message = await run(
      `
        retry<limit: 2> { flaky() + 1 } => $r
        $r.!message
      `,
      { functions: { flaky } }
    );

    expect(message).toContain('got list');
    expect(message).not.toContain('got string');
  });

  it('.!code reflects the LAST attempt when attempts fail with different codes', async () => {
    // The body fails with a different error code on each attempt:
    //   attempt 1 (flaky() -> 5)   : `.upper` on a number halts with
    //                                RILL-R007 (unknown method).
    //   attempt 2 (flaky() -> "hi"): `.upper` succeeds, then `"HI" + 1`
    //                                halts with RILL-R002 (arithmetic).
    // The exhausted retry must surface the FINAL attempt's code (R002),
    // not the first attempt's (R007).
    let call = 0;
    const flaky: RillFunction = {
      params: [],
      fn: () => {
        call += 1;
        return call === 1 ? 5 : 'hi';
      },
    };

    const src = `
      retry<limit: 2> { flaky() -> .upper -> { $ + 1 } } => $r
      $r
    `;
    const ast = parse(src);
    const ctx = createRuntimeContext({ functions: { flaky } });
    const result = (await execute(ast, ctx)).result;

    expect(isInvalid(result)).toBe(true);
    const status = getStatus(result);

    // Final attempt's code and message win, not the first attempt's.
    expect(status.code).toBe(resolveAtom('RILL_R002'));
    expect(status.code).not.toBe(resolveAtom('RILL_R007'));
    expect(status.message).toContain('Arithmetic requires number');

    // Still N guard-caught frames for N attempts.
    const guardCaught = status.trace.filter((f) => f.kind === 'guard-caught');
    expect(guardCaught.length).toBe(2);
  });
});
