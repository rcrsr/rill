/**
 * Closure Enrichment Tests
 *
 * Validates trace-frame enrichment at the two extension-boundary sites in
 * `closures.ts`:
 *   Site 1 — `invokeFnCallable` (host-function dispatch boundary)
 *   Site 2 — `invokeRegularScriptCallable` (script-callable boundary)
 *
 * Coverage:
 *   EC-8    RuntimeHaltSignal gets an additional trace frame; catchable preserved
 *   EC-9    BreakSignal re-thrown unchanged through enrichment sites
 *   EC-10   Non-Error throws from host functions pass through the enrichment
 *           site without modification
 *   AC-NOD-4 markExtensionThrow tag survives enrichment at sites 1 and 2
 *   EC-NOD-2 ReturnSignal re-thrown unchanged through enrichment sites
 *   BC-NOD-2 Deep recursion produces a host-JS RangeError, not a custom error
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  atomName,
  BreakSignal,
  getStatus,
  ReturnSignal,
  RuntimeHaltSignal,
  type RillFunction,
  type RillValue,
} from '@rcrsr/rill';
import { isExtensionThrow } from '../../src/runtime/core/extension-throw.js';
import { throwCatchableHostHalt } from '../../src/runtime/core/types/halt.js';
import { run } from '../helpers/runtime.js';

// ============================================================
// Helpers
// ============================================================

/**
 * Build a host function that throws a catchable RuntimeHaltSignal with a
 * test-only atom code ('TEST_HALT'). This code is NOT in HALT_ATOM_TO_ERROR_ID
 * so the signal propagates as-is through execute() without conversion.
 *
 * The throw must happen inside a Promise (async fn) so that the catch block
 * in `invokeFnCallable` — which wraps `await dispatchPromise` — intercepts it.
 * A synchronous throw from `callable.fn(...)` escapes before the try block.
 */
function makeThrowingHostFn(): RillFunction {
  return {
    params: [],
    returnType: anyTypeValue,
    fn: async (): Promise<RillValue> => {
      throwCatchableHostHalt(
        { fn: 'testThrowingFn', sourceId: 'test.rill' },
        'TEST_HALT',
        'test halt message'
      );
    },
  };
}

/**
 * Catch the rejected value from a promise, asserting it is a RuntimeHaltSignal.
 */
async function catchHaltSignal(
  exec: () => Promise<unknown>
): Promise<RuntimeHaltSignal> {
  let caught: unknown;
  try {
    await exec();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(RuntimeHaltSignal);
  return caught as RuntimeHaltSignal;
}

// ============================================================
// EC-8: RuntimeHaltSignal gets trace frame appended; catchable preserved
// ============================================================

describe('EC-8: RuntimeHaltSignal trace-frame enrichment', () => {
  it('site 1 (invokeFnCallable): appends a trace frame to the signal value', async () => {
    // The host function throws a signal with 1 frame (from throwCatchableHostHalt).
    // Site 1 enrichment appends a second frame.
    const signal = await catchHaltSignal(() =>
      run('thrower()', {
        functions: { thrower: makeThrowingHostFn() },
      })
    );

    const status = getStatus(signal.value);
    expect(status.trace.length).toBeGreaterThanOrEqual(2);
  });

  it('site 1: catchable flag is preserved after enrichment', async () => {
    const signal = await catchHaltSignal(() =>
      run('thrower()', {
        functions: { thrower: makeThrowingHostFn() },
      })
    );

    // throwCatchableHostHalt produces catchable=true; enrichment must not flip it.
    expect(signal.catchable).toBe(true);
  });

  it('site 2 (invokeRegularScriptCallable): appends a trace frame when closure calls a throwing host fn', async () => {
    // Define a zero-param closure that calls the throwing host fn, then invoke it.
    // The signal originates in thrower (site 1), then crosses the
    // script-callable boundary (site 2), gaining another trace frame.
    const signal = await catchHaltSignal(() =>
      run('|| { thrower() } => $fn\n$fn()', {
        functions: { thrower: makeThrowingHostFn() },
      })
    );

    const status = getStatus(signal.value);
    // At least 3 frames: original (throwCatchableHostHalt) + site 1 + site 2.
    expect(status.trace.length).toBeGreaterThanOrEqual(3);
  });

  it('site 2: catchable flag is preserved after enrichment', async () => {
    const signal = await catchHaltSignal(() =>
      run('|| { thrower() } => $fn\n$fn()', {
        functions: { thrower: makeThrowingHostFn() },
      })
    );

    expect(signal.catchable).toBe(true);
  });

  it('enriched signal code atom is unchanged after enrichment', async () => {
    const signal = await catchHaltSignal(() =>
      run('thrower()', {
        functions: { thrower: makeThrowingHostFn() },
      })
    );

    const status = getStatus(signal.value);
    // 'TEST_HALT' is unregistered so it resolves to the 'R001' fallback atom.
    expect(atomName(status.code)).toBe('R001');
  });
});

// ============================================================
// EC-9: BreakSignal re-thrown unchanged through enrichment sites
// ============================================================

describe('EC-9: BreakSignal passthrough at enrichment sites', () => {
  it('BreakSignal thrown from a host function propagates out of run() unchanged', async () => {
    // BreakSignal is NOT a RuntimeHaltSignal, so enrichment sites re-throw
    // it unchanged after markExtensionThrow. execute.ts then re-throws it
    // through reshapeUnhandledThrow (which returns undefined for BreakSignal).
    let caught: unknown;
    try {
      await run('thrower()', {
        functions: {
          thrower: {
            params: [],
            returnType: anyTypeValue,
            fn: async (): Promise<RillValue> => {
              throw new BreakSignal('break-payload');
            },
          },
        },
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(BreakSignal);
    expect((caught as BreakSignal).value).toBe('break-payload');
  });

  it('BreakSignal identity is preserved (same instance re-thrown)', async () => {
    const sentinel = new BreakSignal('sentinel');
    let caught: unknown;
    try {
      await run('thrower()', {
        functions: {
          thrower: {
            params: [],
            returnType: anyTypeValue,
            fn: async (): Promise<RillValue> => {
              throw sentinel;
            },
          },
        },
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBe(sentinel);
  });
});

// ============================================================
// EC-NOD-2: ReturnSignal re-thrown unchanged through enrichment sites
// ============================================================

describe('EC-NOD-2: ReturnSignal passthrough at enrichment sites', () => {
  it('ReturnSignal thrown from a host function produces the carried value as the script result', async () => {
    // ReturnSignal is NOT a RuntimeHaltSignal, so enrichment sites (invokeFnCallable)
    // re-throw it unchanged after markExtensionThrow (which no-ops on the signal
    // since it is an object but execute.ts handles it as a script-level return
    // before any reshape step, preserving its semantics).
    const result = await run('thrower()', {
      functions: {
        thrower: {
          params: [],
          returnType: anyTypeValue,
          fn: async (): Promise<RillValue> => {
            throw new ReturnSignal(42);
          },
        },
      },
    });

    // execute.ts catches ReturnSignal and uses its value as the script result.
    expect(result).toBe(42);
  });

  it('ReturnSignal value is preserved through the enrichment site', async () => {
    const sentinel = { __sentinel: true };
    const result = await run('thrower()', {
      functions: {
        thrower: {
          params: [],
          returnType: anyTypeValue,
          fn: async (): Promise<RillValue> => {
            throw new ReturnSignal(sentinel as unknown as RillValue);
          },
        },
      },
    });

    expect(result).toBe(sentinel);
  });
});

// ============================================================
// EC-10: Non-Error throws from host functions
// ============================================================

describe('EC-10: Non-Error throws pass through enrichment sites without modification', () => {
  it('string thrown from a host function propagates without enrichment-site wrapping', async () => {
    // A raw JS string is NOT an instance of RuntimeHaltSignal. Site 1's catch
    // calls markExtensionThrow(e) — a no-op for primitives — then re-throws.
    // reshapeUnhandledThrow in execute.ts sees !isExtensionThrow(error) (string
    // was not tagged) and returns undefined, so the string propagates as-is.
    let caught: unknown;
    try {
      await run('thrower()', {
        functions: {
          thrower: {
            params: [],
            returnType: anyTypeValue,
            fn: async (): Promise<RillValue> => {
              throw 'raw-string-throw' as unknown as Error;
            },
          },
        },
      });
    } catch (e) {
      caught = e;
    }

    // The enrichment site re-throws the string unchanged.
    expect(caught).toBe('raw-string-throw');
  });
});

// ============================================================
// AC-NOD-4: markExtensionThrow tag survives enrichment at sites 1 and 2
// ============================================================

describe('AC-NOD-4: isExtensionThrow tag on enriched signals', () => {
  it('site 1 (invokeFnCallable): enriched newSignal carries the extension-throw tag', async () => {
    // After site 1 enrichment, `markExtensionThrow(newSignal)` is called.
    // The newSignal is the one that propagates out of execute() and is caught here.
    const signal = await catchHaltSignal(() =>
      run('thrower()', {
        functions: { thrower: makeThrowingHostFn() },
      })
    );

    expect(isExtensionThrow(signal)).toBe(true);
  });

  it('site 2 (invokeRegularScriptCallable): enriched newSignal carries the extension-throw tag', async () => {
    // The closure calls thrower(). Site 2 enrichment constructs a new signal
    // and calls markExtensionThrow on it (the AC-NOD-4 fix being tested).
    const signal = await catchHaltSignal(() =>
      run('|| { thrower() } => $fn\n$fn()', {
        functions: { thrower: makeThrowingHostFn() },
      })
    );

    expect(isExtensionThrow(signal)).toBe(true);
  });
});

// ============================================================
// BC-NOD-2: Host JS stack overflow semantics unchanged
// ============================================================

describe('BC-NOD-2: host JS stack overflow produces RangeError, not a rill-wrapped error', () => {
  it('RangeError thrown synchronously from a host function bypasses the enrichment-site try/catch', async () => {
    // `invokeFnCallable` calls `callable.fn(fnArgs, ...)` BEFORE its try block.
    // A synchronous throw escapes without entering the enrichment catch block,
    // so the RangeError is NOT tagged by markExtensionThrow and NOT enriched.
    // It propagates upward through invocationStrategy.invoke and execute.ts
    // without being reshaped, since !isExtensionThrow(e) causes reshapeUnhandledThrow
    // to return undefined and convertHaltToRuntimeError skips non-RuntimeHaltSignals.
    let caught: unknown;
    try {
      await run('thrower()', {
        functions: {
          thrower: {
            params: [],
            returnType: anyTypeValue,
            fn: (): RillValue => {
              // Synchronous throw: this is what a native stack overflow looks like.
              throw new RangeError('Maximum call stack size exceeded');
            },
          },
        },
      });
    } catch (e) {
      caught = e;
    }

    // The RangeError must propagate unchanged — not wrapped in RuntimeHaltSignal
    // or reshaped to #R999, because synchronous throws bypass the enrichment
    // try/catch and are therefore not marked as isExtensionThrow.
    expect(caught).toBeInstanceOf(RangeError);
    expect(caught).not.toBeInstanceOf(RuntimeHaltSignal);
    expect((caught as RangeError).message).toBe(
      'Maximum call stack size exceeded'
    );
  });
});
