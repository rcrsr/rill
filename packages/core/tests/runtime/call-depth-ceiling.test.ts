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
    await expect(run(script, { maxCallDepth: 50 })).rejects.toThrow(
      expect.objectContaining({ errorId: 'RILL-R010' })
    );
  });

  it('dict-bound self-referential recursion halts with RILL-R010, not a host RangeError', async () => {
    const script = `
      dict[a: || { $.a }] => $o
      $o.a
    `;
    await expect(run(script, { maxCallDepth: 50 })).rejects.toThrow(
      expect.objectContaining({ errorId: 'RILL-R010' })
    );
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
    await expect(run(script, { maxCallDepth: 5000 })).rejects.toThrow(
      expect.objectContaining({ errorId: 'RILL-R010' })
    );
  });

  it('bounds recursion driven through the no-call-site auto-invoke dispatch path', async () => {
    // `$f` is never called with `(...)` here; every recursive step is a bare
    // zero-param closure reference resolved with `$` bound, which routes
    // through invokeCallable's no-location dispatch branch exclusively.
    const script = `
      || { 1 -> ($f + 0) } => $f
      1 -> ($f + 0)
    `;
    await expect(run(script, { maxCallDepth: 50 })).rejects.toThrow(
      expect.objectContaining({ errorId: 'RILL-R010' })
    );
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
    await expect(execute(recursiveAst, ctx)).rejects.toThrow(
      expect.objectContaining({ errorId: 'RILL-R010' })
    );

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
});
