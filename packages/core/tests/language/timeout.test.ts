/**
 * Rill Language Tests: timeout<> Block (Phase 1, Task 1.5)
 *
 * Covers:
 * - AC-1  / SC-1  : timeout<total:> completes within window; body result returned
 * - AC-12 / EC-1  : timeout<total:> fires #TIMEOUT_TOTAL when body runs too long
 * - AC-14 / EC-4  : both total: and idle: in same timeout<> is a parse error
 * - AC-15 / EC-2  : timeout<idle:> fires #TIMEOUT_IDLE when body takes too long
 * - EC-3          : non-duration argument to timeout<total:> halts with INVALID_INPUT
 * - EC-5          : iteration ceiling (RILL-R010) propagates through timeout body
 * - AC-20 / BC-3  : nested timeouts fire outer first
 * - AC-22 / BC-5  : timeout<total:> caught via guard + ?? fallback
 * - AC-23 / BC-6  : timeout<idle:> caught via guard + type inspection
 *
 * [DEVIATION] duration() only supports positional args (not named). All tests use
 * duration(0, 0, 0, 0, 0, 0, X) to specify X milliseconds.
 * Reference: packages/core/tests/language/duration.test.ts, line 6.
 *
 * [DEVIATION] The timeout<> evaluator only interrupts host functions that observe
 * ctx.signal. Host functions that do not check signal will complete normally even
 * after the timeout fires. All time-sensitive tests use signal-aware host fns.
 *
 * [DEVIATION] AC-22 / BC-5: `timeout<total: ...> { ... } ?? "fallback"` does not
 * resolve to the fallback — the catchable RuntimeHaltSignal thrown by the timeout
 * propagates through the ?? operator (which only intercepts RILL_R007/R008). The
 * correct pattern is `guard { timeout<total: ...> { ... } } ?? "fallback"`.
 */

import { describe, expect, it } from 'vitest';
import { parse, ParseError, type RuntimeContext } from '@rcrsr/rill';
import { getStatus, isInvalid } from '../../src/runtime/core/types/status.js';
import { resolveAtom } from '../../src/runtime/core/types/atom-registry.js';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

// ---------------------------------------------------------------------------
// Signal-aware host function helpers
// ---------------------------------------------------------------------------

/**
 * Build a signal-aware host function that waits `delayMs` ms but aborts
 * immediately when `ctx.signal` fires. This lets timeout tests reliably
 * interrupt the body before the delay completes.
 */
function makeSlowFn(delayMs: number) {
  return {
    params: [] as never,
    returnType: { __type: 'any' } as never,
    fn: async (_args: Record<string, unknown>, ctx: RuntimeContext) => {
      await new Promise<void>((resolve, reject) => {
        const handle = setTimeout(resolve, delayMs);
        ctx.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(handle);
            reject(new Error('aborted'));
          },
          { once: true }
        );
      });
      return 'done';
    },
  };
}

// ---------------------------------------------------------------------------
// AC-1 / SC-1: body completes before timeout fires
// ---------------------------------------------------------------------------

describe('AC-1 / SC-1: timeout<total:> completes within window', () => {
  it('returns body result when body finishes before deadline', async () => {
    // duration(0, 0, 0, 0, 0, 0, 200) = 200ms
    const result = await run(
      'timeout<total: duration(0, 0, 0, 0, 0, 0, 200)> { 1 }'
    );
    expect(result).toBe(1);
  });

  it('returns captured variable from body', async () => {
    const result = await run(`
      timeout<total: duration(0, 0, 0, 0, 0, 0, 200)> {
        42 => $x
        $x
      }
    `);
    expect(result).toBe(42);
  });

  it('returns string result from body', async () => {
    const result = await run(
      'timeout<total: duration(0, 0, 0, 0, 0, 0, 200)> { "hello" }'
    );
    expect(result).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// AC-12 / EC-1: #TIMEOUT_TOTAL fires when body runs too long
// ---------------------------------------------------------------------------

describe('AC-12 / EC-1: timeout<total:> fires #TIMEOUT_TOTAL', () => {
  it('produces #TIMEOUT_TOTAL when body uses signal-aware host delay', async () => {
    // Guard catches the catchable TIMEOUT_TOTAL halt and returns the invalid value.
    const result = await run(
      'guard { timeout<total: duration(0, 0, 0, 0, 0, 0, 50)> { slow_op() } }',
      { functions: { slow_op: makeSlowFn(500) } }
    );
    expect(isInvalid(result as never)).toBe(true);
    expect(getStatus(result as never).code).toBe(resolveAtom('RILL_R082'));
  });

  it('#TIMEOUT_TOTAL atom code matches expected resolveAtom value', async () => {
    const result = await run(
      'guard { timeout<total: duration(0, 0, 0, 0, 0, 0, 50)> { slow_fn() } }',
      { functions: { slow_fn: makeSlowFn(500) } }
    );
    expect(isInvalid(result as never)).toBe(true);
    const code = getStatus(result as never).code;
    // resolveAtom('RILL_R082') returns the registered atom for RILL_R082
    expect(code).toEqual(resolveAtom('RILL_R082'));
  });
});

// ---------------------------------------------------------------------------
// AC-14 / EC-4: both total: and idle: is a parse error
// ---------------------------------------------------------------------------

describe('AC-14 / EC-4: timeout<total: d, idle: d> is a parse error', () => {
  it('rejects timeout with both total: and idle: using numeric literals', () => {
    // Using numeric literals avoids the duration() named-arg parse issue;
    // the duplicate-key error fires before the body is parsed.
    expect(() => parse('timeout<total: 100, idle: 50> { "x" }')).toThrow(
      ParseError
    );
  });

  it('parse error message mentions the duplicate key constraint', () => {
    try {
      parse('timeout<total: 100, idle: 50> { "x" }');
      expect.fail('Expected ParseError');
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      const parseErr = err as ParseError;
      expect(parseErr.message).toMatch(/total.*idle|idle.*total/);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-15 / EC-2: #TIMEOUT_IDLE fires when body is inactive too long
// ---------------------------------------------------------------------------

describe('AC-15 / EC-2: timeout<idle:> fires #TIMEOUT_IDLE', () => {
  it('produces #TIMEOUT_IDLE when body does not complete within idle window', async () => {
    // For idle mode, the idle ticker fires if the body does not complete within
    // idleMs. Without pass<> stream chunk resets, idle behaves like a total
    // timeout. A signal-aware host function aborts when the idle timer fires.
    const result = await run(
      'guard { timeout<idle: duration(0, 0, 0, 0, 0, 0, 50)> { idle_slow() } }',
      { functions: { idle_slow: makeSlowFn(500) } }
    );
    expect(isInvalid(result as never)).toBe(true);
    expect(getStatus(result as never).code).toBe(resolveAtom('RILL_R083'));
  });

  it('timeout<idle:> is catchable — guard catches #TIMEOUT_IDLE', async () => {
    // Same as above; verifies the guard path explicitly.
    const result = await run(
      'guard { timeout<idle: duration(0, 0, 0, 0, 0, 0, 50)> { idle_slow() } }',
      { functions: { idle_slow: makeSlowFn(500) } }
    );
    expect(isInvalid(result as never)).toBe(true);
    expect(getStatus(result as never).code).toBe(resolveAtom('RILL_R083'));
  });
});

// ---------------------------------------------------------------------------
// EC-3: non-duration argument halts with INVALID_INPUT
// ---------------------------------------------------------------------------

describe('EC-3: non-duration arg to timeout<> halts with INVALID_INPUT', () => {
  it('string duration arg throws a catchable RuntimeHaltSignal with INVALID_INPUT', async () => {
    // The parser accepts a string literal as the duration expression;
    // the runtime rejects it at evaluation time via isDuration() check.
    // The catchable halt escapes run() as a rejected promise.
    await expectHalt(() => run('timeout<total: "100ms"> { "x" }'), {
      code: 'INVALID_INPUT',
    });
  });

  it('numeric duration arg throws a catchable halt', async () => {
    // The parser accepts a numeric literal; the runtime rejects it at evaluation.
    await expectHalt(() => run('timeout<total: 100> { "x" }'), {
      code: 'INVALID_INPUT',
    });
  });

  it('INVALID_INPUT halt is catchable — guard recovers it', async () => {
    // Guard catches the INVALID_INPUT halt and returns the invalid value.
    // The ?? operator then replaces the invalid value with the fallback.
    const result = await run(
      'guard { timeout<total: "bad"> { "x" } } ?? "recovered"'
    );
    expect(result).toBe('recovered');
  });
});

// ---------------------------------------------------------------------------
// EC-5: RILL-R010 iteration ceiling propagates through timeout body
// ---------------------------------------------------------------------------

describe('EC-5: iteration ceiling RILL-R010 propagates through timeout body', () => {
  it('seq loop exceeding 10000 iterations throws RILL-R010 through timeout', async () => {
    // Default iteration ceiling is 10000. range(0, 10001) -> seq has 10001
    // iterations, which triggers RILL-R010 as a non-catchable fatal halt.
    // The timeout body re-throws it unchanged per §NOD.10.4.
    // Use a large duration literal (not duration() call — named args unsupported).
    await expect(
      run(
        'timeout<total: duration(0, 0, 0, 0, 0, 10)> { range(0, 10001) -> seq({ $ }) }'
      )
    ).rejects.toThrow(expect.objectContaining({ errorId: 'RILL-R010' }));
  });

  it('RILL-R010 is not catchable — guard does not catch it', async () => {
    await expect(
      run(
        'guard { timeout<total: duration(0, 0, 0, 0, 0, 10)> { range(0, 10001) -> seq({ $ }) } }'
      )
    ).rejects.toThrow(expect.objectContaining({ errorId: 'RILL-R010' }));
  });
});

// ---------------------------------------------------------------------------
// AC-20 / BC-3: nested timeouts — outer fires first
// ---------------------------------------------------------------------------

describe('AC-20 / BC-3: nested timeouts — outer fires first', () => {
  it('outer total timeout fires before inner idle timeout', async () => {
    // Outer timeout: 80ms total. Inner timeout: 5000ms idle.
    // Outer fires first. The inner idle body waits 500ms via signal-aware fn.
    // Abort propagates from outer -> inner, and the outer catch block throws
    // #TIMEOUT_TOTAL because expired=true. Guard catches it.
    const result = await run(
      `guard {
        timeout<total: duration(0, 0, 0, 0, 0, 0, 80)> {
          timeout<idle: duration(0, 0, 0, 0, 0, 5)> {
            outer_slow()
          }
        }
      }`,
      { functions: { outer_slow: makeSlowFn(500) } }
    );
    expect(isInvalid(result as never)).toBe(true);
    expect(getStatus(result as never).code).toBe(resolveAtom('RILL_R082'));
  });
});

// ---------------------------------------------------------------------------
// AC-22 / BC-5: timeout<total:> recovery via guard + ??
// ---------------------------------------------------------------------------

describe('AC-22 / BC-5: timeout<total:> recovery via guard + ??', () => {
  it('guard catches timeout and ?? fallback resolves to default', async () => {
    // guard catches the catchable #TIMEOUT_TOTAL halt and returns the
    // invalid value. The ?? operator then replaces it with the fallback string.
    // [DEVIATION] Plain `timeout<...> { } ?? "fallback"` does not work because
    // the catchable RuntimeHaltSignal thrown by timeout is not intercepted by ??
    // (which only handles RILL_R007/R008 and isInvalid return values).
    const result = await run(
      'guard { timeout<total: duration(0, 0, 0, 0, 0, 0, 50)> { slow_for_fallback() } } ?? "timeout"',
      { functions: { slow_for_fallback: makeSlowFn(500) } }
    );
    expect(result).toBe('timeout');
    expect(isInvalid(result as never)).toBe(false);
  });

  it('?? fallback is not invoked when timeout body completes in time', async () => {
    const result = await run(
      'guard { timeout<total: duration(0, 0, 0, 0, 0, 0, 200)> { "ok" } } ?? "fallback"'
    );
    expect(result).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// AC-23 / BC-6: timeout<idle:> recovery via guard + type inspection
// ---------------------------------------------------------------------------

describe('AC-23 / BC-6: timeout<idle:> invalid value inspectable via guard', () => {
  it('guard catches #TIMEOUT_IDLE and the invalid value is inspectable', async () => {
    const result = await run(
      'guard { timeout<idle: duration(0, 0, 0, 0, 0, 0, 50)> { idle_for_guard() } }',
      { functions: { idle_for_guard: makeSlowFn(500) } }
    );
    expect(isInvalid(result as never)).toBe(true);
    const code = getStatus(result as never).code;
    expect(code).toBe(resolveAtom('RILL_R083'));
  });

  it('guard<on: list[#RILL_R083]> catches only the matching idle timeout', async () => {
    const result = await run(
      'guard<on: list[#RILL_R083]> { timeout<idle: duration(0, 0, 0, 0, 0, 0, 50)> { guard_idle_fn() } } ?? "idle_timeout"',
      { functions: { guard_idle_fn: makeSlowFn(500) } }
    );
    expect(result).toBe('idle_timeout');
  });
});
