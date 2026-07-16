/**
 * Rill Language Tests: pass<async: true> Block (Phase 1, Task 1.5)
 *
 * Covers:
 * - AC-2  / SC-2  : pass<async: true> flows pipe-entry value downstream immediately
 * - AC-13 / EC-6  : pass<async: non-bool> is a parse-time error (parser rejects non-BoolLiteral)
 * - AC-21 / BC-4  : async body settling at dispose-time: quickly-completing body settles
 * - EC-7          : non-catchable halt in async body propagates through trackInflight
 * - EC-8          : catchable halt without on_error: #IGNORE surfaces at dispose-time
 * - EC-9          : dispose-timeout existing behavior: in-flight bodies are awaited
 *
 * Notes on async semantics:
 * - pass<async: true> registers the body promise via ctx.trackInflight (fire-and-forget).
 * - The pipe-entry value ($) is returned immediately; the body return value is discarded.
 * - Catchable body halts propagate unless on_error: #IGNORE is also set [EC-8].
 * - Non-catchable halts (ControlSignal, catchable:false) re-throw per §NOD.10.4 [EC-7].
 * - ctx.dispose() awaits all trackInflight promises with a 5000ms ceiling [EC-9].
 *
 * [DEVIATION] Syntax: pass<async: true> { body } — the body block follows `>` directly.
 * pass<async: true>({ body }) is invalid syntax (parser rejects it as a missing body block).
 */

import { describe, expect, it } from 'vitest';
import { createRuntimeContext, execute, parse, ParseError } from '@rcrsr/rill';
import { invalidate } from '../../src/runtime/core/types/status.js';
import { createTraceFrame } from '../../src/runtime/core/types/trace.js';
import { RuntimeHaltSignal } from '../../src/runtime/core/eval/mixins/access.js';
import { run, runWithContext } from '../helpers/runtime.js';

// ---------------------------------------------------------------------------
// AC-2 / SC-2: pass<async: true> flows pipe-entry value downstream unchanged
// ---------------------------------------------------------------------------

describe('AC-2 / SC-2: pass<async: true> flows pipe-entry value downstream', () => {
  it('returns the pipe-entry value immediately when async body is fired', async () => {
    // The body runs asynchronously. The pipe-entry value (42) is returned
    // immediately without waiting for body completion.
    const result = await run('42 -> pass<async: true> { $ }');
    expect(result).toBe(42);
  });

  it('returns a string pipe-entry value unchanged', async () => {
    const result = await run('"hello" -> pass<async: true> { $ -> .upper }');
    expect(result).toBe('hello');
  });

  it('does not block on async body — body return value is discarded', async () => {
    // The body captures its computation result but pass<async: true> returns
    // the original pipe value, not the body's result.
    const result = await run('10 -> pass<async: true> { $ * 100 }');
    expect(result).toBe(10);
  });

  it('can chain after async pass — downstream sees original pipe value', async () => {
    const result = await run('5 -> pass<async: true> { $ + 1 } -> { $ * 2 }');
    expect(result).toBe(10);
  });

  it('async body runs and observable side effect confirms execution', async () => {
    // The async body calls a host function that records it ran.
    // We assert both that pass<async:> returned the pipe-entry value AND
    // that the host function was eventually called.
    let sideEffectRan = false;
    const result = await run('"input" -> pass<async: true> { record_run() }', {
      functions: {
        record_run: {
          params: [],
          returnType: { __type: 'any' } as never,
          fn: async () => {
            sideEffectRan = true;
            return 'recorded';
          },
        },
      },
    });
    expect(result).toBe('input');
    // Allow microtasks and the async body's promise to settle.
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(sideEffectRan).toBe(true);
  });

  it('pass<async: true, on_error: #IGNORE> returns pipe-entry value', async () => {
    // Combined options: async + suppress. The pipe-entry value flows through;
    // catchable halts from the body are silently discarded.
    const result = await run(
      '"data" -> pass<async: true, on_error: #IGNORE> { "a" -> number }'
    );
    expect(result).toBe('data');
  });
});

// ---------------------------------------------------------------------------
// AC-13 / EC-6: pass<async: non-bool> is a parse-time error
// ---------------------------------------------------------------------------

describe('AC-13 / EC-6: pass<async: non-bool> is rejected at parse time', () => {
  it('rejects pass<async: "yes"> with a ParseError', () => {
    // The parser enforces BoolLiteral for the async option; "yes" is a
    // StringLiteral and fails the check immediately.
    expect(() => parse('"x" -> pass<async: "yes"> { $ }')).toThrow(ParseError);
  });

  it('rejects pass<async: 1> with a ParseError', () => {
    expect(() => parse('"x" -> pass<async: 1> { $ }')).toThrow(ParseError);
  });

  it('rejects pass<async: #IGNORE> with a ParseError', () => {
    expect(() => parse('"x" -> pass<async: #IGNORE> { $ }')).toThrow(
      ParseError
    );
  });

  it('parse error message mentions async option requires boolean', () => {
    try {
      parse('"x" -> pass<async: "yes"> { $ }');
      expect.fail('Expected ParseError');
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      const parseErr = err as ParseError;
      expect(parseErr.message).toMatch(/async.*bool/i);
    }
  });

  it('accepts pass<async: true> without error', () => {
    expect(() => parse('"x" -> pass<async: true> { $ }')).not.toThrow();
  });

  it('accepts pass<async: false> without error', () => {
    expect(() => parse('"x" -> pass<async: false> { $ }')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC-21 / BC-4: async body settling at dispose-time
// ---------------------------------------------------------------------------

describe('AC-21 / BC-4: async body settles correctly at dispose-time', () => {
  it('quickly-completing async body settles before dispose returns', async () => {
    // A body with no delay settles in the same microtask tick.
    // After execute() completes, dispose() is called. The body
    // should have settled (no in-flight work at dispose time).
    let bodyRan = false;
    const { context } = await runWithContext(
      '"pipe_val" -> pass<async: true> { record_body() }',
      {
        functions: {
          record_body: {
            params: [],
            returnType: { __type: 'any' } as never,
            fn: async () => {
              bodyRan = true;
              return 'body_done';
            },
          },
        },
      }
    );

    // Dispose the context. The in-flight body promise should settle
    // within DISPOSE_TIMEOUT_MS (5000ms), well before any test timeout.
    await context.dispose();

    // After dispose, the body has settled and its side effect is visible.
    expect(bodyRan).toBe(true);
  });

  it('async body with short delay settles within dispose window', async () => {
    let completedAt: number | undefined;
    const { context } = await runWithContext(
      '"x" -> pass<async: true> { delay_record() }',
      {
        functions: {
          delay_record: {
            params: [],
            returnType: { __type: 'any' } as never,
            fn: async () => {
              await new Promise<void>((resolve) => setTimeout(resolve, 30));
              completedAt = Date.now();
              return 'delayed';
            },
          },
        },
      }
    );

    // Before dispose, the body may or may not have completed yet.
    await context.dispose();

    // After dispose() returns, all in-flight work has settled.
    expect(completedAt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// EC-7: non-catchable halt in async body propagates through trackInflight
// ---------------------------------------------------------------------------

describe('EC-7: non-catchable halt in async body propagates', () => {
  it('non-catchable body halt causes inflight promise rejection', async () => {
    // The runBody lambda in evaluatePassBlock re-throws non-catchable halts
    // (catchable:false) per §NOD.10.4. The trackInflight promise rejects.
    // We verify by intercepting trackInflight before execute().
    let inflightRejected = false;

    const ast = parse('"v" -> pass<async: true> { uncatchable_fn() }');
    const ctx = createRuntimeContext({
      functions: {
        uncatchable_fn: {
          params: [],
          returnType: { __type: 'any' } as never,
          fn: () => {
            const invalid = invalidate(
              {},
              { code: 'RILL_R010', provider: 'uncatchable_fn' },
              createTraceFrame({
                site: '',
                kind: 'host',
                fn: 'uncatchable_fn',
              })
            );
            throw new RuntimeHaltSignal(invalid, false /* non-catchable */);
          },
        },
      },
    });

    // Wrap trackInflight to intercept the promise.
    const originalTrackInflight = ctx.trackInflight.bind(ctx);
    ctx.trackInflight = (promise: Promise<unknown>) => {
      originalTrackInflight(promise);
      promise.catch(() => {
        inflightRejected = true;
      });
    };

    await execute(ast, ctx);
    // Allow microtasks to settle.
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(inflightRejected).toBe(true);
  });

  it('non-catchable body halt does not cause dispose() to throw (allSettled)', async () => {
    // dispose() uses Promise.allSettled internally so it resolves
    // regardless of individual inflight rejections.
    const { context } = await runWithContext(
      '"v" -> pass<async: true> { fatal_halt_fn() }',
      {
        functions: {
          fatal_halt_fn: {
            params: [],
            returnType: { __type: 'any' } as never,
            fn: () => {
              const invalid = invalidate(
                {},
                { code: 'RILL_R010', provider: 'fatal_halt_fn' },
                createTraceFrame({
                  site: '',
                  kind: 'host',
                  fn: 'fatal_halt_fn',
                })
              );
              throw new RuntimeHaltSignal(invalid, false);
            },
          },
        },
      }
    );

    // Should not throw — dispose uses allSettled.
    await expect(context.dispose()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// EC-8: catchable halt without on_error: #IGNORE surfaces at dispose-time
// ---------------------------------------------------------------------------

describe('EC-8: catchable halt without on_error: #IGNORE surfaces at dispose', () => {
  it('catchable body halt without suppress causes inflight promise rejection', async () => {
    // Without on_error: #IGNORE, catchable halts from the body re-throw from
    // runBody. The trackInflight promise rejects.
    let inflightRejected = false;

    const ast = parse('"v" -> pass<async: true> { bad_type_op() }');
    const ctx = createRuntimeContext({
      functions: {
        bad_type_op: {
          params: [],
          returnType: { __type: 'any' } as never,
          fn: () => {
            const invalid = invalidate(
              {},
              { code: 'INVALID_INPUT', provider: 'bad_type_op' },
              createTraceFrame({ site: '', kind: 'host', fn: 'bad_type_op' })
            );
            throw new RuntimeHaltSignal(invalid, true /* catchable */);
          },
        },
      },
    });

    const originalTrackInflight = ctx.trackInflight.bind(ctx);
    ctx.trackInflight = (promise: Promise<unknown>) => {
      originalTrackInflight(promise);
      promise.catch(() => {
        inflightRejected = true;
      });
    };

    await execute(ast, ctx);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(inflightRejected).toBe(true);
  });

  it('catchable body halt IS suppressed when on_error: #IGNORE is set', async () => {
    // With on_error: #IGNORE, the catchable halt is swallowed; inflight promise
    // resolves without rejection.
    let inflightRejected = false;
    let inflightSettled = false;

    const ast = parse(
      '"v" -> pass<async: true, on_error: #IGNORE> { bad_type_suppressed() }'
    );
    const ctx = createRuntimeContext({
      functions: {
        bad_type_suppressed: {
          params: [],
          returnType: { __type: 'any' } as never,
          fn: () => {
            const invalid = invalidate(
              {},
              { code: 'INVALID_INPUT', provider: 'bad_type_suppressed' },
              createTraceFrame({
                site: '',
                kind: 'host',
                fn: 'bad_type_suppressed',
              })
            );
            throw new RuntimeHaltSignal(invalid, true);
          },
        },
      },
    });

    const originalTrackInflight = ctx.trackInflight.bind(ctx);
    ctx.trackInflight = (promise: Promise<unknown>) => {
      originalTrackInflight(promise);
      promise
        .then(() => {
          inflightSettled = true;
        })
        .catch(() => {
          inflightRejected = true;
        });
    };

    await execute(ast, ctx);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(inflightRejected).toBe(false);
    expect(inflightSettled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EC-9: dispose-timeout: in-flight bodies are awaited within 5000ms
// ---------------------------------------------------------------------------

describe('EC-9: dispose() awaits in-flight async bodies', () => {
  it('dispose() waits for short-running async body before returning', async () => {
    const settled: string[] = [];

    const { context } = await runWithContext(
      '"v" -> pass<async: true> { short_async() }',
      {
        functions: {
          short_async: {
            params: [],
            returnType: { __type: 'any' } as never,
            fn: async () => {
              await new Promise<void>((resolve) => setTimeout(resolve, 50));
              settled.push('body');
              return 'done';
            },
          },
        },
      }
    );

    // Before dispose, body may not have settled yet.
    const beforeDispose = settled.length;
    await context.dispose();
    // After dispose, body must have settled (DISPOSE_TIMEOUT_MS = 5000ms > 50ms).
    expect(settled.length).toBeGreaterThan(beforeDispose);
    expect(settled).toContain('body');
  });

  it('dispose() with no in-flight bodies returns immediately', async () => {
    // pass<async: false> (sync path) does not register with trackInflight.
    const { context } = await runWithContext('"v" -> pass<async: false> { $ }');
    const start = Date.now();
    await context.dispose();
    const elapsed = Date.now() - start;
    // Should complete nearly instantly — well under 1000ms.
    expect(elapsed).toBeLessThan(1000);
  });

  it('dispose() resolves even when async body throws synchronously', async () => {
    // A synchronously-throwing host function in an async body produces a
    // rejected inflight promise. dispose() uses Promise.allSettled so it
    // resolves regardless.
    const { context } = await runWithContext(
      '"v" -> pass<async: true> { sync_thrower() }',
      {
        functions: {
          sync_thrower: {
            params: [],
            returnType: { __type: 'any' } as never,
            fn: () => {
              const invalid = invalidate(
                {},
                { code: 'INVALID_INPUT', provider: 'sync_thrower' },
                createTraceFrame({ site: '', kind: 'host', fn: 'sync_thrower' })
              );
              throw new RuntimeHaltSignal(invalid, true);
            },
          },
        },
      }
    );

    // Should not throw — dispose uses allSettled.
    await expect(context.dispose()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// EC-6 (runtime defense): non-bool async value at runtime halts with RILL_R003
// ---------------------------------------------------------------------------

describe('EC-6 (runtime defense): non-bool async value at runtime', () => {
  it('runtime defense: host-injected non-bool async value halts with RILL_R003', async () => {
    // The parser blocks non-BoolLiteral at parse time. The runtime defense at
    // literals.ts:242 runs when a host synthesises a PassBlockNode directly
    // with a non-bool async option value. We construct that AST manually.
    //
    // Build: pass<async: true> { $ } AST but mutate async value to a string.
    const ast = parse('"v" -> pass<async: true> { $ }');

    // Navigate to PassBlockNode options dict to mutate the async entry value.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stmt = ast.statements[0] as any;
    const passBlock = stmt.expression.pipes[0];
    // passBlock.options is a DictNode with entries[0] = { key: 'async', value: PipeChain }
    expect(passBlock.type).toBe('PassBlock');
    // Mutate the primary literal inside the value PipeChain to a StringLiteral.
    // This simulates a host that bypassed the parser.
    passBlock.options.entries[0].value.head.primary = {
      type: 'StringLiteral',
      parts: ['not_a_bool'],
      span: passBlock.options.entries[0].value.head.primary.span,
    };

    const ctx = createRuntimeContext({});

    // The runtime defense throws a catchable RILL_R003 halt that escapes
    // execute() as a RuntimeError (convertHaltToRuntimeError converts it).
    await expect(execute(ast, ctx)).rejects.toThrow(
      expect.objectContaining({ errorId: 'RILL-R003' })
    );
  });
});
