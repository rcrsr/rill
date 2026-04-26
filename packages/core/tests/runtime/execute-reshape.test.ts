/**
 * execute.ts reshape and halt-conversion tests (Task 2.4).
 *
 * `reshapeUnhandledThrow` and `convertHaltToRuntimeError` are internal to
 * execute.ts and not exported from the package barrel. All assertions go
 * through the public `run` / `runFull` APIs from tests/helpers/runtime.ts.
 *
 * Coverage map:
 *   EC-11   ControlSignal (BreakSignal/ReturnSignal/YieldSignal) propagates unchanged
 *   EC-12   RuntimeHaltSignal propagates to convertHaltToRuntimeError
 *   EC-13   RillError at extension boundary propagates unchanged
 *   EC-14 / EC-NOD-4   Generic JS Error from extension dispatch reshapes to #R999
 *   EC-NOD-3   Non-catchable RuntimeHaltSignal propagates through guard to host
 *   AC-NOD-6   convertHaltToRuntimeError message/errorId baseline
 *   BC-NOD-4   ControlSignal at outermost statement boundary propagates
 */

import { describe, expect, it } from 'vitest';
import {
  BreakSignal,
  ControlSignal,
  getStatus,
  isInvalid,
  RillError,
  RuntimeError,
  type RillFunction,
  type RillValue,
  YieldSignal,
} from '@rcrsr/rill';
import { run, runFull } from '../helpers/runtime.js';

// ============================================================
// EC-11: ControlSignal reaches reshapeUnhandledThrow → propagates
// ============================================================
//
// reshapeUnhandledThrow returns undefined for any instanceof ControlSignal.
// The signal continues unwinding past execute() and surfaces as a rejected
// promise. YieldSignal is exercised via a stream context where an outer
// break is issued; break and return are exercised at the statement boundary.

describe('EC-11: ControlSignal propagates through reshapeUnhandledThrow', () => {
  it('BreakSignal at outermost boundary rejects with BreakSignal instance', async () => {
    // "1 -> break" evaluates 1 then throws BreakSignal(1) which reshapeUnhandledThrow
    // returns undefined for, so it propagates as a rejected promise.
    await expect(run('1 -> break')).rejects.toBeInstanceOf(BreakSignal);
  });

  it('BreakSignal is an instance of ControlSignal', async () => {
    const err = await run('1 -> break').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ControlSignal);
  });

  it('ReturnSignal at script level is caught by execute() as script-level return', async () => {
    // "42 -> return" causes ReturnSignal which the execute stepper catches
    // directly (ReturnSignal branch before reshapeUnhandledThrow); the result
    // is the return value, confirming the signal unwound normally.
    const result = await run('42 -> return');
    expect(result).toBe(42);
  });
});

// ============================================================
// EC-12: RuntimeHaltSignal reaches reshapeUnhandledThrow → convertHaltToRuntimeError
// ============================================================
//
// A non-catchable RuntimeHaltSignal that escapes guard/retry flows through
// reshapeUnhandledThrow (returns undefined for it), then hits the
// convertHaltToRuntimeError path. For mapped atom codes (e.g. RILL_R015 /
// assert, RILL_R016 / error) the host sees a RuntimeError.

describe('EC-12: non-catchable RuntimeHaltSignal surfaces as RuntimeError', () => {
  // RILL_R016 is mapped in HALT_ATOM_TO_ERROR_ID; `error "..."` converts to RuntimeError.
  it('error statement surfaces as RuntimeError with errorId RILL-R016', async () => {
    const err = await run('error "boom"').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RuntimeError);
    expect((err as RuntimeError).errorId).toBe('RILL-R016');
  });

  it('RuntimeError is a RillError (instanceof chain preserved)', async () => {
    const err = await run('error "chain test"').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RillError);
  });

  it('assert failure surfaces as RuntimeError with errorId RILL-R015', async () => {
    const err = await run('1 -> assert (1 == 2)').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RuntimeError);
    expect((err as RuntimeError).errorId).toBe('RILL-R015');
  });
});

// ============================================================
// EC-13: RillError thrown at extension boundary → propagates unchanged
// ============================================================
//
// reshapeUnhandledThrow returns undefined when the caught error is a RillError
// (including RuntimeError constructed by the extension itself). The host sees
// the original RillError rather than a reshaped #R999 invalid.

describe('EC-13: RillError from extension boundary propagates unchanged', () => {
  it('RuntimeError thrown by host function propagates as RuntimeError (not reshaped)', async () => {
    // The host function throws a RuntimeError directly. reshapeUnhandledThrow
    // checks `error instanceof RillError` and returns undefined, so the
    // original RuntimeError propagates.
    const hostFn: RillFunction = {
      params: [],
      returnType: { type: 'any' } as RillValue,
      fn: async () => {
        throw new RuntimeError(
          'RILL-R006',
          'host-constructed error',
          { line: 1, column: 1 },
          undefined,
          { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } }
        );
      },
    };

    const err = await run('ext::throwRillError()', {
      functions: { 'ext::throwRillError': hostFn },
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RuntimeError);
    const runtimeErr = err as RuntimeError;
    expect(runtimeErr.errorId).toBe('RILL-R006');
    // RuntimeError message may include location suffix; assert the core message is present.
    expect(runtimeErr.message).toContain('host-constructed error');
  });
});

// ============================================================
// EC-14 / EC-NOD-4: Generic JS Error from extension dispatch → #R999 invalid
// ============================================================
//
// A host function that rejects its returned Promise with a plain (non-RillError)
// Error gets tagged as an extension throw by the `invokeFnCallable` catch block.
// `reshapeUnhandledThrow` then sees `isExtensionThrow(error) === true` and
// `error instanceof Error` (not RillError), so it reshapes it to a #R999 invalid
// value at the statement's mount point. The step resolves with the invalid
// instead of rejecting.
//
// NOTE: Only async (Promise-rejecting) throws are tagged by `markExtensionThrow`
// because `invokeFnCallable` wraps only the `await dispatchPromise` in its
// try/catch. Synchronous throws from `callable.fn()` bypass the tagging and
// propagate as plain rejections (not reshaped). Tests therefore use async
// host functions to exercise the reshape path correctly.

describe('EC-14 / EC-NOD-4: generic JS Error from extension reshapes to #R999', () => {
  it('plain Error from async host function resolves as an invalid value (not a rejection)', async () => {
    const hostFn: RillFunction = {
      params: [],
      returnType: { type: 'any' } as RillValue,
      fn: async () => {
        throw new Error('something went wrong in extension');
      },
    };

    // The script resolves (not rejects) because the error is reshaped to an invalid.
    const result = await run('ext::throwPlain()', {
      functions: { 'ext::throwPlain': hostFn },
    });

    expect(isInvalid(result)).toBe(true);
  });

  it('reshaped invalid has code #R999 and provider extension', async () => {
    const hostFn: RillFunction = {
      params: [],
      returnType: { type: 'any' } as RillValue,
      fn: async () => {
        throw new Error('extension failure message');
      },
    };

    const result = await run('ext::fail()', {
      functions: { 'ext::fail': hostFn },
    });

    const status = getStatus(result);
    expect(status.code).toBeDefined();
    // atomName representation; the builder uses 'R999' as the code input to invalidate()
    const { atomName } = await import('@rcrsr/rill');
    expect(atomName(status.code)).toBe('R999');
    expect(status.provider).toBe('extension');
  });

  it('reshaped invalid carries sanitized message from the original Error', async () => {
    const hostFn: RillFunction = {
      params: [],
      returnType: { type: 'any' } as RillValue,
      fn: async () => {
        throw new Error('sanitize this message\nstacktrace line');
      },
    };

    const result = await run('ext::throwMsg()', {
      functions: { 'ext::throwMsg': hostFn },
    });

    const status = getStatus(result);
    // sanitizeErrorMessage strips multi-line stack; raw.message is first line trimmed.
    expect(status.raw.message).toBe('sanitize this message');
  });

  it('full execution result resolves (runFull) — no exception propagates to host', async () => {
    const hostFn: RillFunction = {
      params: [],
      returnType: { type: 'any' } as RillValue,
      fn: async () => {
        throw new Error('runFull reshape test');
      },
    };

    await expect(
      runFull('ext::throwFull()', { functions: { 'ext::throwFull': hostFn } })
    ).resolves.toBeDefined();
  });
});

// ============================================================
// EC-NOD-3: non-catchable RuntimeHaltSignal propagates through guard
// ============================================================
//
// Non-catchable halts (assert, error) set catchable=false on the
// RuntimeHaltSignal. The guard recovery block checks catchable===true
// before catching; a false halt propagates straight through. At the
// statement boundary convertHaltToRuntimeError rematerialises it as a
// RuntimeError for host consumption.

describe('EC-NOD-3: non-catchable RuntimeHaltSignal propagates through guard to host', () => {
  // `error "..."` uses RILL_R016 which is mapped in HALT_ATOM_TO_ERROR_ID.
  it('error statement inside guard propagates to host as RuntimeError', async () => {
    const err = await run('guard { error "non-catchable" }').catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(RuntimeError);
    expect((err as RuntimeError).errorId).toBe('RILL-R016');
    // RuntimeError message may include location suffix; assert core text is present.
    expect((err as RuntimeError).message).toContain('non-catchable');
  });

  it('error statement inside guard is not swallowed — rejected promise carries RuntimeError', async () => {
    // Verify the rejected promise carries a RuntimeError, not undefined or
    // a plain Error, confirming convertHaltToRuntimeError ran for RILL_R016.
    const err = await run('guard { error "guard test" }').catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(RuntimeError);
    expect((err as RuntimeError).errorId).toBe('RILL-R016');
  });

  it('assert failure inside guard propagates to host as RuntimeError with RILL-R015', async () => {
    const err = await run('guard { 1 -> assert (1 == 2) }').catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(RuntimeError);
    expect((err as RuntimeError).errorId).toBe('RILL-R015');
  });
});

// ============================================================
// AC-NOD-6: convertHaltToRuntimeError message/errorId/context baseline
// ============================================================
//
// These tests capture the expected output of convertHaltToRuntimeError for
// representative atoms. They serve as regression guards for HALT_ATOM_TO_ERROR_ID.
//
// All entries in HALT_ATOM_TO_ERROR_ID in execute.ts are now mapped:
//   - RILL_R016 → mapped (error statement)
//   - RILL_R006 → mapped (unknown function)
//   - RILL_R007 → mapped (unknown method)
//   - RILL_R015 → mapped (assert failure)
//
// The RILL_R016 baseline is verified by the EC-12 describe block above.

describe('AC-NOD-6: convertHaltToRuntimeError output baseline', () => {
  // RILL_R016 is already mapped; this is the one active baseline test.
  describe('RILL-R016 (error statement)', () => {
    it('errorId is RILL-R016', async () => {
      const err = await run('error "baseline test"').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RuntimeError);
      expect((err as RuntimeError).errorId).toBe('RILL-R016');
    });

    it('message contains the error text', async () => {
      const err = await run('error "baseline test"').catch((e: unknown) => e);
      expect((err as RuntimeError).message).toContain('baseline test');
    });

    it('context is undefined (error halt carries no extra raw fields beyond message)', async () => {
      const err = await run('error "baseline test"').catch((e: unknown) => e);
      expect((err as RuntimeError).context).toBeUndefined();
    });
  });

  describe('RILL-R006 (unknown function)', () => {
    it('errorId is RILL-R006', async () => {
      const err = await run('unknown::fn()').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RuntimeError);
      expect((err as RuntimeError).errorId).toBe('RILL-R006');
    });

    it('message contains the unknown function name', async () => {
      const err = await run('unknown::fn()').catch((e: unknown) => e);
      expect((err as RuntimeError).message).toContain('unknown::fn');
    });

    it('context carries functionName field', async () => {
      const err = await run('unknown::fn()').catch((e: unknown) => e);
      expect((err as RuntimeError).context).toBeDefined();
      expect((err as RuntimeError).context?.functionName).toBe('unknown::fn');
    });
  });

  describe('RILL-R007 (unknown method)', () => {
    it('errorId is RILL-R007', async () => {
      const err = await run('"hello".nonexistentMethod()').catch(
        (e: unknown) => e
      );
      expect(err).toBeInstanceOf(RuntimeError);
      expect((err as RuntimeError).errorId).toBe('RILL-R007');
    });

    it('message contains the method name', async () => {
      const err = await run('"hello".nonexistentMethod()').catch(
        (e: unknown) => e
      );
      expect((err as RuntimeError).message).toContain('nonexistentMethod');
    });

    it('context carries methodName and typeName fields', async () => {
      const err = await run('"hello".nonexistentMethod()').catch(
        (e: unknown) => e
      );
      expect((err as RuntimeError).context).toBeDefined();
      expect((err as RuntimeError).context?.methodName).toBe(
        'nonexistentMethod'
      );
      expect((err as RuntimeError).context?.typeName).toBe('string');
    });
  });

  describe('RILL-R015 (assert failure)', () => {
    it('errorId is RILL-R015', async () => {
      const err = await run('1 -> assert (1 == 2)').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RuntimeError);
      expect((err as RuntimeError).errorId).toBe('RILL-R015');
    });

    it('message contains "Assertion failed" for default', async () => {
      const err = await run('1 -> assert (1 == 2)').catch((e: unknown) => e);
      expect((err as RuntimeError).message).toContain('Assertion failed');
    });

    it('message contains custom text when provided', async () => {
      const err = await run('1 -> assert (1 == 2) "custom text"').catch(
        (e: unknown) => e
      );
      expect((err as RuntimeError).message).toContain('custom text');
    });

    it('context is undefined for assert failure', async () => {
      const err = await run('1 -> assert (1 == 2)').catch((e: unknown) => e);
      expect((err as RuntimeError).context).toBeUndefined();
    });
  });
});

// ============================================================
// BC-NOD-4: ControlSignal at outermost statement boundary
// ============================================================
//
// BreakSignal thrown at the outermost statement boundary (no enclosing loop)
// reaches reshapeUnhandledThrow which returns undefined for it (preserves
// pre-migration behavior). The signal propagates as a rejected promise.
// This mirrors the test in control-signals.test.ts and provides the coverage
// required by the execute-reshape task spec.

describe('BC-NOD-4: ControlSignal at outermost statement boundary', () => {
  it('"1 -> break" rejects with BreakSignal (reshapeUnhandledThrow returns undefined)', async () => {
    await expect(run('1 -> break')).rejects.toBeInstanceOf(BreakSignal);
  });

  it('propagated BreakSignal carries the value from the throw site', async () => {
    const err = await run('1 -> break').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BreakSignal);
    expect((err as BreakSignal).value).toBe(1);
  });

  it('reshapeUnhandledThrow does not convert BreakSignal to an invalid value', async () => {
    // If reshapeUnhandledThrow had reshaped it, the promise would resolve
    // (not reject) with an invalid. We verify it rejects instead.
    let resolved = false;
    let rejected = false;
    await run('1 -> break')
      .then(() => {
        resolved = true;
      })
      .catch(() => {
        rejected = true;
      });
    expect(resolved).toBe(false);
    expect(rejected).toBe(true);
  });

  it('YieldSignal propagates unchanged at statement boundary (no stream context)', async () => {
    // YieldSignal is a ControlSignal subclass. Without a stream consumer,
    // it propagates through reshapeUnhandledThrow and reaches the host.
    // Construct a host function that throws YieldSignal to exercise the path.
    const hostFn: RillFunction = {
      params: [],
      returnType: { type: 'any' } as RillValue,
      fn: () => {
        throw new YieldSignal('yield-value');
      },
    };

    const err = await run('ext::throwYield()', {
      functions: { 'ext::throwYield': hostFn },
    }).catch((e: unknown) => e);

    // YieldSignal is a ControlSignal, not a RillError, so reshapeUnhandledThrow
    // returns undefined and it propagates to the host.
    expect(err).toBeInstanceOf(YieldSignal);
    expect(err).toBeInstanceOf(ControlSignal);
  });
});
