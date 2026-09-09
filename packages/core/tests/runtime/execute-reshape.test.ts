/**
 * execute.ts reshape and halt-conversion tests (Task 2.4).
 *
 * `reshapeUnhandledThrow` and `convertHaltToRuntimeError` are internal to
 * execute.ts and not exported from the package barrel. All assertions go
 * through the public `run` / `runFull` APIs from tests/helpers/runtime.ts.
 *
 * Coverage map:
 *   EC-11   ControlSignal (ReturnSignal/YieldSignal) propagates unchanged;
 *           a bare BreakSignal reaching the top-level statement stepper
 *           converts to a coded fatal halt instead of escaping raw.
 *   EC-12   RuntimeHaltSignal propagates to convertHaltToRuntimeError
 *   EC-13   RillError at extension boundary propagates unchanged
 *   EC-14 / EC-NOD-4   Generic JS Error from extension dispatch reshapes to #R999
 *   EC-NOD-3   Non-catchable RuntimeHaltSignal propagates through guard to host
 *   AC-NOD-6   convertHaltToRuntimeError message/errorId baseline
 *   BC-NOD-4   a top-level `break` (no enclosing break-accepting construct)
 *              surfaces as a coded, non-catchable RuntimeError
 */

import { describe, expect, it } from 'vitest';
import {
  BreakSignal,
  ControlSignal,
  getStatus,
  isInvalid,
  resolveAtom,
  RillError,
  RuntimeError,
  RuntimeHaltSignal,
  type RillFunction,
  type RillValue,
  YieldSignal,
} from '@rcrsr/rill';
import { run, runFull, runWithContext } from '../helpers/runtime.js';

// ============================================================
// EC-11: ControlSignal reaches reshapeUnhandledThrow → propagates
// ============================================================
//
// reshapeUnhandledThrow returns undefined for any instanceof ControlSignal,
// so ReturnSignal and YieldSignal continue unwinding past execute() and
// surface as a rejected promise. A bare BreakSignal is intercepted one step
// earlier, before reshapeUnhandledThrow runs: the statement stepper's catch
// clause converts it into a coded fatal RuntimeHaltSignal (RILL_R002) via
// rejectBreakAsHalt, which then flows through convertHaltToRuntimeError like
// any other fatal halt.

describe('EC-11: ControlSignal propagates through reshapeUnhandledThrow', () => {
  it('BreakSignal at outermost boundary surfaces as a coded RuntimeError, not a raw signal', async () => {
    // "1 -> break" evaluates 1 then throws BreakSignal(1). The top-level
    // stepper converts it to a fatal halt before it ever reaches
    // reshapeUnhandledThrow, so the host sees RuntimeError, not BreakSignal.
    const err = await run('1 -> break').catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(BreakSignal);
    expect(err).toBeInstanceOf(RuntimeError);
    expect((err as RuntimeError).errorId).toBe('RILL-R002');
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
// Call-site materialization: invokeFnCallable returns the invalid value
// directly, so same-statement `=>`, `??`, and `guard` observe it without
// waiting for the statement-boundary fallback (reshapeUnhandledThrow).
// ============================================================
//
// h_throw_async is an async host function that always rejects with a plain
// (non-RillError) Error, exercising the invokeFnCallable catch block's
// final branch (`makeUnhandledHostThrowInvalid`).

describe('call-site materialization: invalid observed at the same statement', () => {
  const throwingHost: RillFunction = {
    params: [],
    returnType: { type: 'any' } as RillValue,
    fn: async () => {
      throw new Error('call-site throw');
    },
  };

  it('h_throw_async() => $g binds an invalid value ($g.! truthy)', async () => {
    const { context } = await runWithContext('h_throw_async() => $g', {
      functions: { h_throw_async: throwingHost },
    });
    const g = context.variables.get('g');
    expect(g).toBeDefined();
    expect(isInvalid(g as RillValue)).toBe(true);
  });

  it('h_throw_async() ?? "fallback" resolves to the fallback', async () => {
    const result = await run('h_throw_async() ?? "fallback"', {
      functions: { h_throw_async: throwingHost },
    });
    expect(result).toBe('fallback');
  });

  it('guard { h_throw_async() } => $out yields $out.! (invalid)', async () => {
    const { context } = await runWithContext(
      'guard { h_throw_async() } => $out',
      { functions: { h_throw_async: throwingHost } }
    );
    const out = context.variables.get('out');
    expect(out).toBeDefined();
    expect(isInvalid(out as RillValue)).toBe(true);
  });

  it('bare-statement h_throw_async() still surfaces as #R999 (unchanged outcome)', async () => {
    const result = await run('h_throw_async()', {
      functions: { h_throw_async: throwingHost },
    });
    expect(isInvalid(result)).toBe(true);
    const status = getStatus(result);
    const { atomName } = await import('@rcrsr/rill');
    expect(atomName(status.code)).toBe('R999');
    expect(status.provider).toBe('extension');
  });
});

// ============================================================
// BC-NOD-4: top-level break at the outermost statement boundary
// ============================================================
//
// A `break` reaching the outermost statement boundary (no enclosing
// break-accepting construct) is the script's own control-flow misuse: it
// broke out of nothing. The stepper's catch clause routes it through
// rejectBreakAsHalt before reshapeUnhandledThrow runs, so it never escapes
// as a raw BreakSignal — it surfaces as a coded, non-catchable RuntimeError.

describe('BC-NOD-4: top-level break surfaces as a coded RuntimeError', () => {
  it('"1 -> break" rejects with a RuntimeError, not a raw BreakSignal', async () => {
    const err = await run('1 -> break').catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(BreakSignal);
    await expect(run('1 -> break')).rejects.toBeInstanceOf(RuntimeError);
  });

  it('the converted RuntimeError carries errorId RILL-R002', async () => {
    const err = await run('1 -> break').catch((e: unknown) => e);
    expect((err as RuntimeError).errorId).toBe('RILL-R002');
  });

  it('a guard wrapping the bare break does not swallow or recover it', async () => {
    // RILL_R002 is thrown as a fatal (non-catchable) halt, so guard's
    // catchable check rejects it and it still reaches the host.
    const err = await run('guard { 1 -> break }').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RuntimeError);
    expect((err as RuntimeError).errorId).toBe('RILL-R002');
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

// ============================================================
// Allowlist-backed halt resolution: `convertHaltToRuntimeError`
// resolves a halt's atom code against the explicit
// `HALT_ATOM_TO_ERROR_ID` allowlist, not a blanket registry lookup.
// ============================================================
//
// Scripts below split into two groups: allowlisted `RILL-R0xx` atoms
// (built directly via a halt-builder atom, e.g. `ERROR_ATOMS[ERROR_IDS.RILL_R002]`)
// still rematerialise into a coded `RuntimeError`. Generic taxonomy
// atoms (`TYPE_MISMATCH`, `INVALID_INPUT`) have no allowlist entry and
// keep escaping as a raw, catchable `RuntimeHaltSignal` — this is the
// locked contract asserted by the type-assertion and comparison
// language-spec tests, so it is not converted here.

describe('allowlist-backed halt resolution', () => {
  it('sort(5) (allowlisted RILL_R002) surfaces as a coded RuntimeError with a location', async () => {
    const err = await run('sort(5)').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RuntimeError);
    const runtimeErr = err as RuntimeError;
    expect(runtimeErr.errorId).toBeTruthy();
    expect(runtimeErr.message).not.toBe('runtime halt');
    expect(runtimeErr.location).toBeDefined();
  });

  const unallowlistedScripts = [
    '"x":number',
    'tuple[1] < tuple[1,2]',
    '"1e309" -> number',
    'dict[a: "x"]:dict(a:number)',
    'list[1,2,3] -> take(1.5)',
  ];

  for (const src of unallowlistedScripts) {
    it(`${src} (unallowlisted generic-taxonomy atom) keeps escaping as a raw RuntimeHaltSignal`, async () => {
      const err = await run(src).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RuntimeHaltSignal);
    });
  }

  it('an aborted execution still propagates its #DISPOSED halt unconverted', async () => {
    const controller = new AbortController();
    controller.abort();

    const err = await run('"hello"', { signal: controller.signal }).catch(
      (e: unknown) => e
    );

    // #DISPOSED is an explicit exclusion: abort halts keep escaping as a
    // raw, non-catchable RuntimeHaltSignal rather than rematerialising
    // into a RuntimeError.
    expect(err).not.toBeInstanceOf(RuntimeError);
    const status = getStatus((err as { value: RillValue }).value);
    const { atomName } = await import('@rcrsr/rill');
    expect(atomName(status.code)).toBe('DISPOSED');
  });
});

// ============================================================
// applyConversion's converter-catch clause enriches a rethrown
// RuntimeHaltSignal's origin trace frame with the conversion site's
// location, rather than leaving a placeholder site behind.
// ============================================================

function extractConversionHaltInvalid(caught: unknown): RillValue {
  if (caught instanceof RuntimeHaltSignal) {
    return caught.value;
  }
  if (caught instanceof RuntimeError && caught.haltValue !== undefined) {
    return caught.haltValue;
  }
  expect(caught).toBeInstanceOf(RuntimeHaltSignal);
  throw new Error('unreachable: expect() above always throws');
}

describe('applyConversion enriches the rethrown halt origin location', () => {
  it('"1e309" -> number halts #INVALID_INPUT with a located trace origin', async () => {
    const caught = await run('"1e309" -> number').catch((e: unknown) => e);
    const status = getStatus(extractConversionHaltInvalid(caught));
    expect(status.code).toBe(resolveAtom('INVALID_INPUT'));
    expect(status.message).toMatch(/not finite/i);
    expect(status.trace[0]?.site).toMatch(/:\d+:\d+$/);
    if (caught instanceof RuntimeHaltSignal) {
      expect(caught.location).toBeDefined();
    }
  });

  it('"ok" -> atom halts #INVALID_INPUT with a located trace origin', async () => {
    const caught = await run('"ok" -> atom').catch((e: unknown) => e);
    const status = getStatus(extractConversionHaltInvalid(caught));
    expect(status.code).toBe(resolveAtom('INVALID_INPUT'));
    expect(status.trace[0]?.site).toMatch(/:\d+:\d+$/);
    if (caught instanceof RuntimeHaltSignal) {
      expect(caught.location).toBeDefined();
    }
  });
});
