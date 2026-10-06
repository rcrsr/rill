/**
 * Rill Runtime Tests: Call-Depth Ceiling
 *
 * invokeCallable bounds recursive closure invocation with a dedicated,
 * boxed call-depth counter (RuntimeContext.callDepth / maxCallDepth),
 * distinct from the display-only maxCallStackDepth. Unbounded recursion
 * must halt with RILL-R010 instead of exhausting the host call stack
 * (RangeError) or the heap.
 */

import { describe, expect, it } from 'vitest';
import { createRuntimeContext, execute, parse } from '@rcrsr/rill';
import type { RuntimeContext } from '@rcrsr/rill';

import { run } from '../helpers/runtime.js';
import { expectHalt, expectHaltMessage } from '../helpers/halt.js';
import { invokeCallable } from '../../src/runtime/core/eval/handlers/closures.js';
import { getEvalState } from '../../src/runtime/core/eval/state.js';
import type { ScriptCallable } from '../../src/runtime/core/callable.js';
import { RuntimeHaltSignal } from '../../src/runtime/core/types/halt.js';
import { getStatus } from '../../src/runtime/core/types/status.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../src/error-registry.js';

describe('Rill Runtime: Call-Depth Ceiling', () => {
  it('direct self-recursion halts with RILL-R010, not a host RangeError', async () => {
    const script = `
      || { $f() } => $f
      $f()
    `;
    await expectHalt(() => run(script, { maxCallDepth: 50 }), {
      code: 'RILL_R010',
      hostErrorId: 'RILL-R010',
    });
  });

  it('dict-bound self-referential recursion halts with RILL-R010, not a host RangeError', async () => {
    const script = `
      dict[a: || { $.a }] => $o
      $o.a
    `;
    await expectHalt(() => run(script, { maxCallDepth: 50 }), {
      code: 'RILL_R010',
      hostErrorId: 'RILL-R010',
    });
  });

  it('reaches a high ceiling on a path with no suspension point between call levels', async () => {
    // The dict-bound property path recurses without awaiting anything
    // pending between levels, so without a per-call microtask yield the
    // native JS stack grows in lockstep with call depth and overflows with
    // a raw RangeError well before a ceiling in the thousands. The yield
    // in invokeCallable makes the ceiling the only bound that applies.
    const script = `
      dict[a: || { $.a }] => $o
      $o.a
    `;
    await expectHalt(() => run(script, { maxCallDepth: 5000 }), {
      code: 'RILL_R010',
      hostErrorId: 'RILL-R010',
    });
  });

  it('bounds recursion driven through the no-call-site auto-invoke dispatch path', async () => {
    // `$f` is never called with `(...)` here; every recursive step is a bare
    // zero-param closure reference resolved with `$` bound, which routes
    // through invokeCallable's no-location dispatch branch exclusively.
    const script = `
      || { 1 -> ($f + 0) } => $f
      1 -> ($f + 0)
    `;
    await expectHalt(() => run(script, { maxCallDepth: 50 }), {
      code: 'RILL_R010',
      hostErrorId: 'RILL-R010',
    });
  });

  it('bounds recursion driven through the internal (frameless) dispatch path', async () => {
    // No production call site currently passes `internal: true`; this test
    // exercises that dispatch branch directly to prove the depth check runs
    // before all three branches, not just the call-location-present one.
    const ast = parse(`
      || { $f() } => $f
    `);
    const ctx = createRuntimeContext({ maxCallDepth: 50 });
    await execute(ast, ctx);

    const callable = ctx.getVariable('f') as ScriptCallable;
    const s = getEvalState(ctx);

    let caught: unknown;
    try {
      await invokeCallable(s, callable, [], undefined, 'f', true);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(RuntimeHaltSignal);
    const signal = caught as RuntimeHaltSignal;
    expect(signal.catchable).toBe(false);
    expect((getStatus(signal.value).code as { name: string }).name).toBe(
      ERROR_ATOMS[ERROR_IDS.RILL_R010]
    );
  });

  it('allows legitimately deep but finite recursion below the ceiling', async () => {
    const script = `
      |n| { ($n < 1) ? 0 ! (1 + $count($n - 1)) } => $count
      $count(400)
    `;
    const result = await run(script, { maxCallDepth: 500 });
    expect(result).toBe(400);
  });

  it('decrements the shared call-depth counter on every exit path (no leak after a halt)', async () => {
    const ctx: RuntimeContext = createRuntimeContext({ maxCallDepth: 50 });

    const recursiveAst = parse(`
      || { $f() } => $f
      $f()
    `);
    await expectHalt(() => execute(recursiveAst, ctx), {
      code: 'RILL_R010',
      hostErrorId: 'RILL-R010',
    });

    // The counter must be back at (or below) its pre-call value; a leaked
    // increment would falsely trip the ceiling on this unrelated, shallow
    // follow-up call sharing the same context.
    const shallowAst = parse(`
      |n| { $n + 1 } => $inc
      $inc(41)
    `);
    const result = await execute(shallowAst, ctx);
    expect(result.result).toBe(42);
  });

  describe('concurrent branches', () => {
    const CEILING = /Call depth exceeded/;

    it('completes a flat fan over 1500 elements at the default ceiling', async () => {
      const result = await run('range(0, 1500) -> fan({ $ }) -> .len');
      expect(result).toBe(1500);
    });

    it('completes a flat filter over 1500 elements at the default ceiling', async () => {
      const result = await run(
        'range(0, 1500) -> filter({ ($ % 2) == 0 }) -> .len'
      );
      expect(result).toBe(750);
    });

    it('completes batched fan and filter wider than the ceiling', async () => {
      const fanResult = await run(
        'range(0, 200) -> fan({ $ }, dict[concurrency: 100]) -> .len',
        { maxCallDepth: 20 }
      );
      expect(fanResult).toBe(200);

      const filterResult = await run(
        'range(0, 200) -> filter({ ($ % 2) == 0 }, dict[concurrency: 100]) -> .len',
        { maxCallDepth: 20 }
      );
      expect(filterResult).toBe(100);
    });

    it('completes a keyed sort over a list wider than the ceiling', async () => {
      const result = await run(
        'range(0, 30) -> fan({ $ }) -> sort({ 0 - $ }) -> .len',
        { maxCallDepth: 5 }
      );
      expect(result).toBe(30);
    });

    it('completes a sort over a dict with more keys than the ceiling', async () => {
      const keys = Array.from({ length: 20 }, (_, i) => `k${i}: ${i}`).join(
        ', '
      );
      const result = await run(`dict[${keys}] -> sort -> .len`, {
        maxCallDepth: 5,
      });
      expect(result).toBe(20);
    });

    it('still halts on recursion through a fan body', async () => {
      const script = `
        || { list[1] -> fan({ $f() }) } => $f
        $f()
      `;
      await expectHaltMessage(() => run(script, { maxCallDepth: 50 }), CEILING);
    });

    it('still halts on recursion through a filter body', async () => {
      const script = `
        || { list[1] -> filter({ $f() }) } => $f
        $f()
      `;
      await expectHaltMessage(() => run(script, { maxCallDepth: 50 }), CEILING);
    });

    it('still halts on recursion through a sort key function', async () => {
      const script = `
        || { list[1] -> sort({ $f() }) } => $f
        $f()
      `;
      await expectHaltMessage(() => run(script, { maxCallDepth: 50 }), CEILING);
    });

    it('measures depth inside a fan branch the same as inside a seq body', async () => {
      const recurse = (op: 'seq' | 'fan', k: number): string => `
        |n| { ($n < 1) ? 0 ! (list[1] -> ${op}({ $count($n - 1) }) -> .len) } => $count
        $count(${k})
      `;
      const options = { maxCallDepth: 50 };
      const limit = 16;

      expect(await run(recurse('seq', limit), options)).toBe(1);
      expect(await run(recurse('fan', limit), options)).toBe(1);
      await expectHaltMessage(
        () => run(recurse('seq', limit + 1), options),
        CEILING
      );
      await expectHaltMessage(
        () => run(recurse('fan', limit + 1), options),
        CEILING
      );
    });

    it('leaves the parent call-depth counter unchanged after a wide fan', async () => {
      const ctx: RuntimeContext = createRuntimeContext({ maxCallDepth: 50 });

      const fanAst = parse('range(0, 2000) -> fan({ $ }) -> .len');
      const fanResult = await execute(fanAst, ctx);
      expect(fanResult.result).toBe(2000);

      const shallowAst = parse(`
        |n| { $n + 1 } => $inc
        $inc(41)
      `);
      const result = await execute(shallowAst, ctx);
      expect(result.result).toBe(42);
    });
  });
});
