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
  RuntimeError,
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
 * test-only atom code ('TEST_HALT'). The atom is unregistered, so it
 * resolves to the `#R001` fallback; `execute()` rematerialises the escaped
 * signal into a `RuntimeError` at the host boundary (the generic fatal
 * error ID), carrying the original invalid value and catchable flag under
 * the non-enumerable `haltValue` / `haltCatchable` properties.
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
 * Shape shared by a raw `RuntimeHaltSignal` and a `RuntimeError`
 * rematerialised from one, exposing the fields these tests probe: the
 * invalid value, the catchable flag, and the original signal instance
 * (needed for `isExtensionThrow` identity checks against the
 * enrichment-site `WeakSet` tag).
 */
interface CaughtHalt {
  readonly value: RillValue;
  readonly catchable: boolean;
  readonly signal: RuntimeHaltSignal;
}

/**
 * Catch the rejected value from a promise, asserting it is a halt (either
 * a raw `RuntimeHaltSignal`, or a `RuntimeError` rematerialised from one at
 * the host boundary) and normalising both shapes to `CaughtHalt`.
 */
async function catchHaltSignal(
  exec: () => Promise<unknown>
): Promise<CaughtHalt> {
  let caught: unknown;
  try {
    await exec();
  } catch (e) {
    caught = e;
  }
  if (caught instanceof RuntimeHaltSignal) {
    return { value: caught.value, catchable: caught.catchable, signal: caught };
  }
  if (caught instanceof RuntimeError && caught.haltSignal !== undefined) {
    const signal = caught.haltSignal;
    return { value: signal.value, catchable: signal.catchable, signal };
  }
  expect(caught).toBeInstanceOf(RuntimeHaltSignal);
  throw new Error('unreachable: expect() above always throws');
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
// EC-9: BreakSignal re-thrown unchanged through enrichment sites,
// converted to a coded fatal halt at the top-level statement boundary
// ============================================================

describe('EC-9: BreakSignal passthrough at enrichment sites', () => {
  it('BreakSignal thrown from a host function surfaces as a coded RuntimeError, not the raw signal', async () => {
    // BreakSignal is NOT a RuntimeHaltSignal, so enrichment sites re-throw it
    // unchanged after markExtensionThrow. The signal reaches the top-level
    // statement stepper unmodified; the stepper's catch clause then routes
    // it through rejectBreakAsHalt (before reshapeUnhandledThrow runs),
    // converting it to a fatal, non-catchable halt rather than letting the
    // raw signal escape run().
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

    expect(caught).not.toBeInstanceOf(BreakSignal);
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).errorId).toBe('RILL-R002');
  });

  it('any escaped BreakSignal instance converts the same way (not identity-preserved past the top-level boundary)', async () => {
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

    expect(caught).not.toBe(sentinel);
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).errorId).toBe('RILL-R002');
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

describe('EC-10: Non-Error throws materialize as #R999 at the dispatch boundary', () => {
  it('string thrown from a host function materializes as a #R999 invalid value', async () => {
    // A raw JS string is NOT an instance of RuntimeHaltSignal, and
    // markExtensionThrow(e) is a no-op for primitives (its WeakSet cannot
    // tag a non-object value). Site 1's catch materializes it directly as a
    // #R999 invalid value instead of re-throwing the raw string, so the
    // script resolves normally rather than run() rejecting with the string.
    const result = await run('thrower()', {
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

    const status = getStatus(result as RillValue);
    expect(atomName(status.code)).toBe('R999');
    expect(status.raw['original']).toBe('raw-string-throw');
  });

  it('null thrown from a host function materializes as a #R999 invalid value', async () => {
    const result = await run('thrower()', {
      functions: {
        thrower: {
          params: [],
          returnType: anyTypeValue,
          fn: async (): Promise<RillValue> => {
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw null;
          },
        },
      },
    });

    const status = getStatus(result as RillValue);
    expect(atomName(status.code)).toBe('R999');
    expect(status.raw['original']).toBe('null');
  });
});

// ============================================================
// W-1/W-2: sync host-fn throws and non-object rejections reshape
// the same way as an async Error rejection.
// ============================================================

describe('W-1/W-2: sync throws and non-object throws reach the same reshape as an async Error', () => {
  it('a synchronous `throw new Error(...)` materializes as a #R999 invalid value', async () => {
    // Before the fix, `callable.fn(...)` ran outside invokeFnCallable's
    // try/catch, so a synchronous throw escaped run() as a raw exception.
    // It must now enter the same catch as an async rejection.
    const result = await run('thrower()', {
      functions: {
        thrower: {
          params: [],
          returnType: anyTypeValue,
          fn: (): RillValue => {
            throw new Error('sync boom');
          },
        },
      },
    });

    const status = getStatus(result as RillValue);
    expect(atomName(status.code)).toBe('R999');
    expect(status.raw['message']).toBe('sync boom');
  });

  it('a synchronous `throw null` materializes as a #R999 invalid value', async () => {
    const result = await run('thrower()', {
      functions: {
        thrower: {
          params: [],
          returnType: anyTypeValue,
          fn: (): RillValue => {
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw null;
          },
        },
      },
    });

    expect(atomName(getStatus(result as RillValue).code)).toBe('R999');
  });

  it('a synchronous `throw "str"` materializes as a #R999 invalid value', async () => {
    const result = await run('thrower()', {
      functions: {
        thrower: {
          params: [],
          returnType: anyTypeValue,
          fn: (): RillValue => {
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw 'str';
          },
        },
      },
    });

    const status = getStatus(result as RillValue);
    expect(atomName(status.code)).toBe('R999');
    expect(status.raw['original']).toBe('str');
  });

  it('a rejected `Promise.reject("str")` materializes as a #R999 invalid value', async () => {
    const result = await run('thrower()', {
      functions: {
        thrower: {
          params: [],
          returnType: anyTypeValue,
          fn: (): Promise<RillValue> => Promise.reject('str'),
        },
      },
    });

    const status = getStatus(result as RillValue);
    expect(atomName(status.code)).toBe('R999');
    expect(status.raw['original']).toBe('str');
  });

  it('each reshaped value is catchable by guard, not a raw JS throw out of execute()', async () => {
    // guard{...} => $r captures the invalid value as an ordinary result
    // rather than the call unwinding through a thrown signal.
    const result = await run('guard { thrower() } => $r\n$r.!code == #R999', {
      functions: {
        thrower: {
          params: [],
          returnType: anyTypeValue,
          fn: (): RillValue => {
            throw new Error('caught by guard');
          },
        },
      },
    });

    expect(result).toBe(true);
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

    expect(isExtensionThrow(signal.signal)).toBe(true);
  });

  it('site 2 (invokeRegularScriptCallable): enriched newSignal carries the extension-throw tag', async () => {
    // The closure calls thrower(). Site 2 enrichment constructs a new signal
    // and calls markExtensionThrow on it (the AC-NOD-4 fix being tested).
    const signal = await catchHaltSignal(() =>
      run('|| { thrower() } => $fn\n$fn()', {
        functions: { thrower: makeThrowingHostFn() },
      })
    );

    expect(isExtensionThrow(signal.signal)).toBe(true);
  });
});

// ============================================================
// BC-NOD-2: Host JS stack overflow semantics unchanged
// ============================================================

describe('BC-NOD-2: host JS RangeError from a synchronous host-fn throw reshapes like any other host error', () => {
  it('RangeError thrown synchronously from a host function materializes as a #R999 invalid value', async () => {
    // `invokeFnCallable` now calls `callable.fn(fnArgs, ...)` INSIDE its try
    // block, so a synchronous throw — including what a native stack
    // overflow looks like — enters the same enrichment/reshape catch as an
    // async rejection instead of escaping run() as a raw RangeError.
    const result = await run('thrower()', {
      functions: {
        thrower: {
          params: [],
          returnType: anyTypeValue,
          fn: (): RillValue => {
            throw new RangeError('Maximum call stack size exceeded');
          },
        },
      },
    });

    const status = getStatus(result as RillValue);
    expect(atomName(status.code)).toBe('R999');
    expect(status.raw['message']).toBe('Maximum call stack size exceeded');
  });
});
