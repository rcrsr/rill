/**
 * Unit tests for the typed-atom halt builders in `runtime/core/types/halt.ts`
 * and the status sidecar in `runtime/core/types/status.ts`.
 *
 * This file is a deliberate internal unit test, an exception to the
 * public-API-only rule for runtime tests: the host-error shape carrier
 * accessors (`getHostShape`, `fillHostShape`) and the halt builders are not
 * exported from `src/index.ts`, so the carrier and builder contracts can only
 * be asserted through the internal modules. Every other behavior in this file
 * is exercised through `execute`, `createStepper`, and the public API.
 *
 * Each builder constructs an invalid RillValue via `invalidate`, attaches a
 * `host`-kind trace frame, and throws a `RuntimeHaltSignal`. Tests read the
 * thrown signal's invalid value directly via `getStatus` so assertions target
 * the sidecar shape, not the textual halt output.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  atomName,
  BUILT_IN_TYPES,
  createRillStream,
  createRuntimeContext,
  createStepper,
  execute,
  getStatus,
  isInvalid,
  parse,
  resolveAtom,
  RuntimeError,
  type ResolverResult,
  type RillFunction,
  type RillValue,
  type RuntimeOptions,
  type TimeoutScheduler,
} from '@rcrsr/rill';
import {
  enrichHaltOriginLocation,
  fillHostShape,
  getHostShape,
  RuntimeHaltSignal,
  throwAbortHalt,
  throwAutoExceptionHalt,
  throwCatchableHostHalt,
  throwErrorHalt,
  throwFatalHostHalt,
  throwTypeHalt,
  type TypeHaltSite,
} from '../../src/runtime/core/types/halt.js';
import {
  appendTraceFrame,
  formatHalt,
  invalidate,
  mergeRaw,
  withOriginSite,
} from '../../src/runtime/core/types/status.js';
import {
  createTraceFrame,
  TRACE_KINDS,
} from '../../src/runtime/core/types/trace.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../src/error-registry.js';
import {
  expectHalt,
  expectRuntimeError,
  expectThrowMessage,
} from '../helpers/halt.js';
import { run } from '../helpers/runtime.js';

/** Awaits `fn` and returns the RuntimeError it rejects with. */
async function captureRuntimeError(
  fn: () => Promise<unknown>
): Promise<RuntimeError> {
  let resolved: unknown;
  try {
    resolved = await fn();
  } catch (e) {
    if (e instanceof RuntimeError) return e;
    throw e;
  }
  throw new Error(
    `expected a RuntimeError, but fn resolved with ${JSON.stringify(resolved)}`
  );
}

function catchHalt(exec: () => never): RuntimeHaltSignal {
  try {
    exec();
  } catch (e) {
    if (e instanceof RuntimeHaltSignal) return e;
    throw e;
  }
  throw new Error('expected RuntimeHaltSignal, but no error was thrown');
}

const SITE: TypeHaltSite = {
  location: { line: 3, column: 7 },
  sourceId: 'test.rill',
  fn: '',
};

describe('throwAbortHalt (IR-1 / EC-1)', () => {
  it('throws a non-catchable RuntimeHaltSignal with code=#DISPOSED', () => {
    const site: TypeHaltSite = { ...SITE, fn: 'checkAborted' };
    const signal = catchHalt(() => throwAbortHalt(site));

    expect(signal).toBeInstanceOf(RuntimeHaltSignal);
    expect(signal.catchable).toBe(false);

    const status = getStatus(signal.value);
    expect(atomName(status.code)).toBe('DISPOSED');
    expect(status.provider).toBe('runtime');
    expect(status.message).toBe('aborted');
    expect(status.raw.message).toBe('aborted');
  });

  it('attaches a single host-kind trace frame with the caller fn', () => {
    const site: TypeHaltSite = { ...SITE, fn: 'checkAborted' };
    const signal = catchHalt(() => throwAbortHalt(site));

    const status = getStatus(signal.value);
    expect(status.trace).toHaveLength(1);
    const [frame] = status.trace;
    expect(frame).toBeDefined();
    expect(frame!.kind).toBe('host');
    expect(frame!.fn).toBe('checkAborted');
    expect(frame!.site).toBe('test.rill:3:7');
  });
});

describe('throwAutoExceptionHalt (IR-2 / EC-2)', () => {
  it('throws a non-catchable RuntimeHaltSignal with code=#R999', () => {
    const site: TypeHaltSite = { ...SITE, fn: 'checkAutoExceptions' };
    const signal = catchHalt(() =>
      throwAutoExceptionHalt(site, 'timeout', 'request timed out')
    );

    expect(signal).toBeInstanceOf(RuntimeHaltSignal);
    expect(signal.catchable).toBe(false);

    const status = getStatus(signal.value);
    expect(atomName(status.code)).toBe('R999');
    expect(status.provider).toBe('extension');
  });

  it('stores pattern and matchedValue under raw and derives message', () => {
    const site: TypeHaltSite = { ...SITE, fn: 'checkAutoExceptions' };
    const signal = catchHalt(() =>
      throwAutoExceptionHalt(site, 'timeout', 'request timed out')
    );

    const status = getStatus(signal.value);
    expect(status.raw.pattern).toBe('timeout');
    expect(status.raw.matchedValue).toBe('request timed out');
    // Message is derived by the builder; assert it mentions pattern and value.
    expect(status.message).toContain('timeout');
    expect(status.message).toContain('request timed out');
    expect(status.raw.message).toBe(status.message);
  });

  it('attaches a single host-kind trace frame with fn=checkAutoExceptions', () => {
    const site: TypeHaltSite = { ...SITE, fn: 'checkAutoExceptions' };
    const signal = catchHalt(() =>
      throwAutoExceptionHalt(site, 'timeout', 'request timed out')
    );

    const status = getStatus(signal.value);
    expect(status.trace).toHaveLength(1);
    const [frame] = status.trace;
    expect(frame!.kind).toBe('host');
    expect(frame!.fn).toBe('checkAutoExceptions');
    expect(frame!.site).toBe('test.rill:3:7');
  });
});

describe('throwErrorHalt (IR-3 / EC-4)', () => {
  const ERROR_SITE: TypeHaltSite = { ...SITE, fn: 'evaluateError' };

  it('throws a non-catchable RuntimeHaltSignal with code=#RILL_R016', () => {
    const signal = catchHalt(() => throwErrorHalt(ERROR_SITE, 'oh no', false));

    expect(signal).toBeInstanceOf(RuntimeHaltSignal);
    expect(signal.catchable).toBe(false);

    const status = getStatus(signal.value);
    // `RILL_R016` is pre-registered in CORE_ATOM_REGISTRATIONS so
    // `resolveAtom` returns the interned atom (no `#R001` fallback).
    expect(atomName(status.code)).toBe(ERROR_ATOMS[ERROR_IDS.RILL_R016]);
    expect(status.provider).toBe('runtime');
    expect(status.message).toBe('oh no');
    expect(status.raw.message).toBe('oh no');
  });

  it('interpolated=false emits a single host frame and no wrap frame', () => {
    const signal = catchHalt(() =>
      throwErrorHalt(ERROR_SITE, 'literal message', false)
    );

    const status = getStatus(signal.value);
    expect(status.trace).toHaveLength(1);
    const [host] = status.trace;
    expect(host!.kind).toBe('host');
    expect(host!.fn).toBe('evaluateError');
    expect(host!.site).toBe('test.rill:3:7');
  });

  it('interpolated=true appends a wrap frame carrying the prior status dict', () => {
    const signal = catchHalt(() =>
      throwErrorHalt(ERROR_SITE, 'interpolated message', true)
    );

    const status = getStatus(signal.value);
    expect(status.trace).toHaveLength(2);

    const [host, wrap] = status.trace;
    expect(host!.kind).toBe('host');
    expect(wrap!.kind).toBe('wrap');
    expect(wrap!.fn).toBe('evaluateError');
    expect(wrap!.site).toBe('test.rill:3:7');

    // Wrapped dict preserves the prior status fields.
    const wrapped = wrap!.wrapped as Record<string, unknown>;
    expect(wrapped.message).toBe('interpolated message');
    expect(wrapped.provider).toBe('runtime');
    expect(typeof wrapped.code).toBe('string');
    expect(wrapped.raw).toBeDefined();
  });
});

describe('EC-3: builder does not validate inputs (doc-only)', () => {
  it('documents caller responsibility via JSDoc (smoke check)', async () => {
    // JSDoc presence verification: load the source file and confirm the
    // builder's JSDoc still documents that it validates nothing.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const source = await fs.readFile(
      path.resolve(import.meta.dirname, '../../src/runtime/core/types/halt.ts'),
      'utf8'
    );
    expect(source).toContain('Caller responsibility:');
    expect(source).toContain('non-empty string');
  });
});

// ============================================================
// throwCatchableHostHalt (EC-5, EC-6)
// ============================================================

describe('throwCatchableHostHalt (EC-5 / EC-6)', () => {
  const HOST_SITE: TypeHaltSite = { ...SITE, fn: 'evaluateCallExpr' };

  it('throws a RuntimeHaltSignal with catchable=true [EC-5]', () => {
    const signal = catchHalt(() =>
      throwCatchableHostHalt(
        HOST_SITE,
        ERROR_ATOMS[ERROR_IDS.RILL_R006],
        'function not found'
      )
    );

    expect(signal).toBeInstanceOf(RuntimeHaltSignal);
    expect(signal.catchable).toBe(true);
  });

  it('stores code, message, and provider=runtime in the invalid status [EC-5]', () => {
    const signal = catchHalt(() =>
      throwCatchableHostHalt(
        HOST_SITE,
        ERROR_ATOMS[ERROR_IDS.RILL_R006],
        'function not found'
      )
    );

    const status = getStatus(signal.value);
    expect(status.message).toBe('function not found');
    expect(status.raw.message).toBe('function not found');
    expect(status.provider).toBe('runtime');
  });

  it('attaches a single host-kind trace frame [BC-NOD-1]', () => {
    const signal = catchHalt(() =>
      throwCatchableHostHalt(
        HOST_SITE,
        ERROR_ATOMS[ERROR_IDS.RILL_R006],
        'function not found'
      )
    );

    const status = getStatus(signal.value);
    expect(status.trace).toHaveLength(1);
    const [frame] = status.trace;
    expect(frame!.kind).toBe('host');
    expect(frame!.fn).toBe('evaluateCallExpr');
    expect(frame!.site).toBe('test.rill:3:7');
  });

  it('merges optional raw fields alongside message [EC-5]', () => {
    const signal = catchHalt(() =>
      throwCatchableHostHalt(
        HOST_SITE,
        ERROR_ATOMS[ERROR_IDS.RILL_R006],
        'function not found',
        {
          callee: 'myFn',
        }
      )
    );

    const status = getStatus(signal.value);
    expect(status.raw.callee).toBe('myFn');
    expect(status.raw.message).toBe('function not found');
  });

  it('caught.catchable === true satisfies guard/retry contract surface [EC-6]', () => {
    // Verifies the contract surface: guard and retry check catchable===true.
    // Full guard/retry recovery is exercised by the language suite.
    let caught: RuntimeHaltSignal | undefined;
    try {
      throwCatchableHostHalt(
        HOST_SITE,
        ERROR_ATOMS[ERROR_IDS.RILL_R006],
        'function not found'
      );
    } catch (e) {
      if (e instanceof RuntimeHaltSignal) caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught!.catchable).toBe(true);
  });
});

// ============================================================
// throwFatalHostHalt (EC-5, EC-7)
// ============================================================

describe('throwFatalHostHalt (EC-5 / EC-7)', () => {
  const HOST_SITE: TypeHaltSite = { ...SITE, fn: 'checkIterationLimit' };

  it('throws a RuntimeHaltSignal with catchable=false [EC-5]', () => {
    const signal = catchHalt(() =>
      throwFatalHostHalt(
        HOST_SITE,
        ERROR_ATOMS[ERROR_IDS.RILL_R010],
        'iteration limit exceeded'
      )
    );

    expect(signal).toBeInstanceOf(RuntimeHaltSignal);
    expect(signal.catchable).toBe(false);
  });

  it('stores code, message, and provider=runtime in the invalid status [EC-5]', () => {
    const signal = catchHalt(() =>
      throwFatalHostHalt(
        HOST_SITE,
        ERROR_ATOMS[ERROR_IDS.RILL_R010],
        'iteration limit exceeded'
      )
    );

    const status = getStatus(signal.value);
    expect(status.message).toBe('iteration limit exceeded');
    expect(status.raw.message).toBe('iteration limit exceeded');
    expect(status.provider).toBe('runtime');
  });

  it('attaches a single host-kind trace frame [BC-NOD-1]', () => {
    const signal = catchHalt(() =>
      throwFatalHostHalt(
        HOST_SITE,
        ERROR_ATOMS[ERROR_IDS.RILL_R010],
        'iteration limit exceeded'
      )
    );

    const status = getStatus(signal.value);
    expect(status.trace).toHaveLength(1);
    const [frame] = status.trace;
    expect(frame!.kind).toBe('host');
    expect(frame!.fn).toBe('checkIterationLimit');
    expect(frame!.site).toBe('test.rill:3:7');
  });

  it('merges optional raw fields alongside message [EC-5]', () => {
    const signal = catchHalt(() =>
      throwFatalHostHalt(
        HOST_SITE,
        ERROR_ATOMS[ERROR_IDS.RILL_R010],
        'iteration limit exceeded',
        {
          limit: 10000,
        }
      )
    );

    const status = getStatus(signal.value);
    expect(status.raw.limit).toBe(10000);
    expect(status.raw.message).toBe('iteration limit exceeded');
  });

  it('payload has code and trace frame suitable for convertHaltToRuntimeError [EC-7]', () => {
    // convertHaltToRuntimeError looks up atomName(status.code) in
    // HALT_ATOM_TO_ERROR_ID. Unregistered codes (not RILL_R016) return
    // undefined and the signal propagates unchanged. This test verifies the
    // payload contract: a non-empty status code and a single trace frame
    // are present so downstream consumers can inspect the signal.
    const signal = catchHalt(() =>
      throwFatalHostHalt(
        HOST_SITE,
        ERROR_ATOMS[ERROR_IDS.RILL_R010],
        'iteration limit exceeded'
      )
    );

    const status = getStatus(signal.value);
    expect(atomName(status.code)).toBeTruthy();
    expect(status.trace).toHaveLength(1);
    expect(signal.catchable).toBe(false);
  });
});

// ============================================================
// Statelessness across builders (BC-NOD-3)
// ============================================================

describe('builder statelessness — two invocations produce distinct signal instances [BC-NOD-3]', () => {
  it('throwCatchableHostHalt: two calls produce non-identical signals with equal payload content', () => {
    const site: TypeHaltSite = { ...SITE, fn: 'evaluateCallExpr' };
    const signalA = catchHalt(() =>
      throwCatchableHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R006],
        'not found'
      )
    );
    const signalB = catchHalt(() =>
      throwCatchableHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R006],
        'not found'
      )
    );

    // Distinct instances — no shared mutable state.
    expect(signalA).not.toBe(signalB);
    expect(signalA.value).not.toBe(signalB.value);

    // Equal payload content.
    const statusA = getStatus(signalA.value);
    const statusB = getStatus(signalB.value);
    expect(atomName(statusA.code)).toBe(atomName(statusB.code));
    expect(statusA.message).toBe(statusB.message);
    expect(statusA.provider).toBe(statusB.provider);
    expect(statusA.trace).toHaveLength(1);
    expect(statusB.trace).toHaveLength(1);
  });

  it('throwFatalHostHalt: two calls produce non-identical signals with equal payload content', () => {
    const site: TypeHaltSite = { ...SITE, fn: 'checkIterationLimit' };
    const signalA = catchHalt(() =>
      throwFatalHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R010],
        'limit exceeded'
      )
    );
    const signalB = catchHalt(() =>
      throwFatalHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R010],
        'limit exceeded'
      )
    );

    expect(signalA).not.toBe(signalB);
    expect(signalA.value).not.toBe(signalB.value);

    const statusA = getStatus(signalA.value);
    const statusB = getStatus(signalB.value);
    expect(atomName(statusA.code)).toBe(atomName(statusB.code));
    expect(statusA.message).toBe(statusB.message);
    expect(statusA.provider).toBe(statusB.provider);
    expect(statusA.trace).toHaveLength(1);
    expect(statusB.trace).toHaveLength(1);
  });
});

// ============================================================
// Already-invalid payload nesting (EC-NOD-5)
// ============================================================

describe('already-invalid payload — builder always invalidates a fresh {} base [EC-NOD-5]', () => {
  it('throwCatchableHostHalt ignores a pre-built invalid value and always invalidates {}', () => {
    // EC-NOD-5 spec says: "constructs nested invalid via invalidate(...) plus
    // new trace frame". However, both throwCatchableHostHalt and
    // throwFatalHostHalt call `invalidate({}, ...)` with a fresh empty object
    // as the base — they do not accept a RillValue payload parameter. There is
    // no way to pass an already-invalid value to either builder. The builders
    // always produce a single-frame trace regardless of prior state.
    //
    // [SPEC] EC-NOD-5 describes a "nested invalid" scenario that assumes the
    // builder accepts a RillValue payload. The actual builders accept only
    // (site, code, message, raw?) and never receive an existing invalid value.
    // The test below verifies the actual contract: builders always produce a
    // fresh single-frame invalid, not a nested one.
    //
    // To demonstrate the gap: build an invalid via invalidate() directly.
    // That value cannot be passed to throwCatchableHostHalt — the builder
    // accepts no RillValue parameter. The resulting signal always has one frame.
    const priorFrame = createTraceFrame({
      site: 'prior.rill:1:1',
      kind: TRACE_KINDS.HOST,
      fn: 'priorFn',
    });
    // Call invalidate() to show the API exists; result is intentionally unused
    // because the builder provides no way to supply it.
    void invalidate(
      {},
      {
        code: ERROR_ATOMS[ERROR_IDS.RILL_R006],
        provider: 'runtime',
        raw: { message: 'prior' },
      },
      priorFrame
    );
    const site: TypeHaltSite = { ...SITE, fn: 'evaluateCallExpr' };
    const signal = catchHalt(() =>
      throwCatchableHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R006],
        'outer message'
      )
    );

    const status = getStatus(signal.value);
    // Always one frame — fresh {} base, no nesting.
    expect(status.trace).toHaveLength(1);
    expect(status.message).toBe('outer message');
  });

  it('throwFatalHostHalt always produces a single-frame trace from a fresh {} base', () => {
    const site: TypeHaltSite = { ...SITE, fn: 'checkIterationLimit' };
    const signal = catchHalt(() =>
      throwFatalHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R010],
        'fatal message'
      )
    );

    const status = getStatus(signal.value);
    expect(status.trace).toHaveLength(1);
    expect(status.message).toBe('fatal message');
  });
});

// ============================================================
// Empty status payload (BC-NOD-5)
// ============================================================

describe('RuntimeHaltSignal.message and .errorId derivation', () => {
  it('message is never the literal string "runtime halt" for a registered code', () => {
    const site: TypeHaltSite = { ...SITE, fn: 'checkIterationLimit' };
    const signal = catchHalt(() =>
      throwFatalHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R010],
        'iteration limit exceeded'
      )
    );

    expect(signal.message).not.toBe('runtime halt');
    expect(signal.message).toBe('#RILL_R010: iteration limit exceeded');
  });

  it('errorId resolves to the registered host-facing error ID when the atom is registered', () => {
    const site: TypeHaltSite = { ...SITE, fn: 'checkIterationLimit' };
    const signal = catchHalt(() =>
      throwFatalHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R010],
        'iteration limit exceeded'
      )
    );

    expect(signal.errorId).toBe('RILL-R010');
  });

  it('message is never the literal string "runtime halt" for an unregistered generic-taxonomy atom', () => {
    const site: TypeHaltSite = { ...SITE, fn: 'evaluateTypeAssertion' };
    const signal = catchHalt(() =>
      throwTypeHalt(
        site,
        'TYPE_MISMATCH',
        'expected number, got string',
        'runtime'
      )
    );

    expect(signal.message).not.toBe('runtime halt');
    expect(signal.message).toBe('#TYPE_MISMATCH: expected number, got string');
  });

  it('errorId is undefined for an unregistered generic-taxonomy atom (TYPE_MISMATCH / INVALID_INPUT)', () => {
    const site: TypeHaltSite = { ...SITE, fn: 'evaluateTypeAssertion' };
    const typeMismatch = catchHalt(() =>
      throwTypeHalt(
        site,
        'TYPE_MISMATCH',
        'expected number, got string',
        'runtime'
      )
    );
    const invalidInput = catchHalt(() =>
      throwCatchableHostHalt(site, 'INVALID_INPUT', 'n must be an integer')
    );

    expect(typeMismatch.errorId).toBeUndefined();
    expect(invalidInput.errorId).toBeUndefined();
  });

  it('enrichHaltOriginLocation backfills an undefined location with a real one', () => {
    const site: TypeHaltSite = { fn: 'compareTuple' };
    const signal = catchHalt(() =>
      throwTypeHalt(
        site,
        'TYPE_MISMATCH',
        'expected tuple, got list',
        'runtime'
      )
    );

    expect(signal.location).toBeUndefined();

    const enriched = enrichHaltOriginLocation(
      signal,
      { line: 3, column: 7, offset: 0 },
      'file.rill'
    );

    expect(enriched.location).toEqual({
      sourceId: 'file.rill',
      line: 3,
      column: 7,
    });
  });

  it('enrichHaltOriginLocation preserves trace length and the origin frame kind/fn', () => {
    const site: TypeHaltSite = { fn: 'compareTuple' };
    const signal = catchHalt(() =>
      throwTypeHalt(
        site,
        'TYPE_MISMATCH',
        'expected tuple, got list',
        'runtime'
      )
    );
    const before = getStatus(signal.value).trace;

    const enriched = enrichHaltOriginLocation(
      signal,
      { line: 3, column: 7, offset: 0 },
      'file.rill'
    );
    const after = getStatus(enriched.value).trace;

    expect(after.length).toBe(before.length);
    expect(after[0]!.kind).toBe(before[0]!.kind);
    expect(after[0]!.fn).toBe(before[0]!.fn);
  });

  it('enrichHaltOriginLocation returns the signal unchanged when the origin site already parses', () => {
    const signal = catchHalt(() =>
      throwFatalHostHalt(
        SITE,
        ERROR_ATOMS[ERROR_IDS.RILL_R010],
        'iteration limit exceeded'
      )
    );

    const enriched = enrichHaltOriginLocation(
      signal,
      { line: 99, column: 99, offset: 0 },
      'other.rill'
    );

    expect(enriched).toBe(signal);
    expect(enriched.location).toEqual(signal.location);
  });

  it('enrichHaltOriginLocation preserves catchable=true', () => {
    const site: TypeHaltSite = { fn: 'compareTuple' };
    const signal = catchHalt(() =>
      throwTypeHalt(
        site,
        'TYPE_MISMATCH',
        'expected tuple, got list',
        'runtime'
      )
    );

    const enriched = enrichHaltOriginLocation(
      signal,
      { line: 3, column: 7, offset: 0 },
      'file.rill'
    );

    expect(enriched.catchable).toBe(true);
  });

  it('enrichHaltOriginLocation preserves catchable=false', () => {
    const site: TypeHaltSite = { fn: 'checkAutoExceptions' };
    const signal = catchHalt(() =>
      throwAutoExceptionHalt(site, 'abc', 'abcdef')
    );

    const enriched = enrichHaltOriginLocation(
      signal,
      { line: 3, column: 7, offset: 0 },
      'file.rill'
    );

    expect(enriched.catchable).toBe(false);
  });
});

// ============================================================
// Trace-frame kind threading (issue #431 part 1)
// ============================================================

describe('trace-frame kind parameter — defaults to host, overridable per call site', () => {
  it('throwAbortHalt defaults to host and accepts an explicit override', () => {
    const site: TypeHaltSite = { ...SITE, fn: 'checkAborted' };

    const defaulted = catchHalt(() => throwAbortHalt(site));
    expect(getStatus(defaulted.value).trace[0]!.kind).toBe('host');

    const overridden = catchHalt(() =>
      throwAbortHalt(site, TRACE_KINDS.ACCESS)
    );
    expect(getStatus(overridden.value).trace[0]!.kind).toBe('access');
  });

  it('throwAutoExceptionHalt defaults to host and accepts an explicit override', () => {
    const site: TypeHaltSite = { ...SITE, fn: 'checkAutoExceptions' };

    const defaulted = catchHalt(() =>
      throwAutoExceptionHalt(site, 'timeout', 'value')
    );
    expect(getStatus(defaulted.value).trace[0]!.kind).toBe('host');

    const overridden = catchHalt(() =>
      throwAutoExceptionHalt(site, 'timeout', 'value', TRACE_KINDS.ACCESS)
    );
    expect(getStatus(overridden.value).trace[0]!.kind).toBe('access');
  });

  it('throwCatchableHostHalt defaults to host and accepts an explicit override', () => {
    const site: TypeHaltSite = { ...SITE, fn: 'evaluateCallExpr' };

    const defaulted = catchHalt(() =>
      throwCatchableHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R006],
        'not found'
      )
    );
    expect(getStatus(defaulted.value).trace[0]!.kind).toBe('host');

    const overridden = catchHalt(() =>
      throwCatchableHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R006],
        'not found',
        undefined,
        TRACE_KINDS.ACCESS
      )
    );
    expect(getStatus(overridden.value).trace[0]!.kind).toBe('access');
  });

  it('throwFatalHostHalt defaults to host and accepts an explicit override', () => {
    const site: TypeHaltSite = { ...SITE, fn: 'checkIterationLimit' };

    const defaulted = catchHalt(() =>
      throwFatalHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R010],
        'limit exceeded'
      )
    );
    expect(getStatus(defaulted.value).trace[0]!.kind).toBe('host');

    const overridden = catchHalt(() =>
      throwFatalHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R010],
        'limit exceeded',
        undefined,
        TRACE_KINDS.ACCESS
      )
    );
    expect(getStatus(overridden.value).trace[0]!.kind).toBe('access');
  });

  it('throwErrorHalt defaults to host and accepts an explicit override', () => {
    const site: TypeHaltSite = { ...SITE, fn: 'evaluateError' };

    const defaulted = catchHalt(() => throwErrorHalt(site, 'oh no', false));
    expect(getStatus(defaulted.value).trace[0]!.kind).toBe('host');

    const overridden = catchHalt(() =>
      throwErrorHalt(site, 'oh no', false, TRACE_KINDS.ACCESS)
    );
    expect(getStatus(overridden.value).trace[0]!.kind).toBe('access');
  });
});

describe('empty raw payload — trace frame still constructed [BC-NOD-5]', () => {
  it('throwCatchableHostHalt with no raw arg still produces a trace frame', () => {
    const site: TypeHaltSite = { ...SITE, fn: 'evaluateCallExpr' };
    const signal = catchHalt(() =>
      throwCatchableHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R006],
        'no extras'
      )
    );

    const status = getStatus(signal.value);
    expect(status.trace).toHaveLength(1);
    expect(status.message).toBe('no extras');
    // code must be set to a non-empty atom name.
    expect(atomName(status.code).length).toBeGreaterThan(0);
  });

  it('throwFatalHostHalt with no raw arg still produces a trace frame', () => {
    const site: TypeHaltSite = { ...SITE, fn: 'checkIterationLimit' };
    const signal = catchHalt(() =>
      throwFatalHostHalt(site, ERROR_ATOMS[ERROR_IDS.RILL_R010], 'no extras')
    );

    const status = getStatus(signal.value);
    expect(status.trace).toHaveLength(1);
    expect(status.message).toBe('no extras');
    expect(atomName(status.code).length).toBeGreaterThan(0);
  });
});

describe('protocol converter halt remap', () => {
  /**
   * Protocol-converter remap: a converter that raises a halt carrying a
   * protocol conversion atom is remapped to the evaluator-level conversion
   * errors, while any other halt propagates unchanged.
   */

  type Converter = (v: RillValue) => RillValue;

  function getConverters(sourceType: string): Record<string, Converter> {
    const reg = BUILT_IN_TYPES.find((r) => r.name === sourceType);
    const table = reg?.protocol.convertTo as Record<string, Converter>;
    return table;
  }

  const restores: Array<() => void> = [];

  function stubConverter(
    sourceType: string,
    target: string,
    code: string,
    message: string
  ): void {
    const table = getConverters(sourceType);
    const original = table[target];
    table[target] = () =>
      throwCatchableHostHalt({ fn: 'stub-converter' }, code, message);
    restores.push(() => {
      table[target] = original as Converter;
    });
  }

  /** Runs a script expected to halt and returns the halt's invalid value. */
  async function runHalt(source: string): Promise<{ value: RillValue }> {
    try {
      await run(source);
    } catch (e) {
      if (e instanceof RuntimeHaltSignal) return e;
      if (e instanceof RuntimeError && e.haltValue !== undefined) {
        return { value: e.haltValue };
      }
      throw e;
    }
    throw new Error('expected a halt');
  }

  afterEach(() => {
    while (restores.length > 0) restores.pop()?.();
  });

  describe('protocol converter halt remap with unrelated or unregistered atoms', () => {
    it('propagates an unrelated halt unchanged', async () => {
      stubConverter('string', 'number', 'INVALID_INPUT', 'stub failure');

      const halt = await runHalt('"abc" -> number');

      expect(getStatus(halt.value).code).toBe(resolveAtom('INVALID_INPUT'));
      expect(getStatus(halt.value).message).toBe('stub failure');
    });

    it('does not treat the shared fallback atom as a protocol halt', async () => {
      const unregisteredAtom = 'TEST_NEVER_REGISTERED_ATOM';
      expect(resolveAtom(unregisteredAtom)).toBe(resolveAtom('R001'));
      stubConverter('string', 'number', unregisteredAtom, 'stub failure');

      const halt = await runHalt('"abc" -> number');

      expect(getStatus(halt.value).code).toBe(resolveAtom('R001'));
      expect(getStatus(halt.value).message).toBe('stub failure');
    });

    it('maps the built-in string-to-number parse failure to R038', async () => {
      const halt = await runHalt('"abc" -> number');

      const status = getStatus(halt.value);
      expect(status.code).toBe(resolveAtom(ERROR_ATOMS[ERROR_IDS.RILL_R038]));
      expect(status.message).toBe('cannot convert string "abc" to number');
      expect(status.raw['value']).toBe('abc');
    });

    it('maps a converter that throws a plain RuntimeError to R038', async () => {
      const table = getConverters('string');
      const original = table['number'];
      table['number'] = () => {
        throw new RuntimeError(ERROR_IDS.RILL_R064, 'legacy parse failure');
      };
      restores.push(() => {
        table['number'] = original as Converter;
      });

      const halt = await runHalt('"abc" -> number');

      const status = getStatus(halt.value);
      expect(status.code).toBe(resolveAtom(ERROR_ATOMS[ERROR_IDS.RILL_R038]));
      expect(status.message).toContain('legacy parse failure');
      expect(status.raw['value']).toBe('abc');
    });
  });

  describe('protocol converter halt remap with registered protocol atoms', () => {
    it.each([ERROR_IDS.RILL_R064, ERROR_IDS.RILL_R065, ERROR_IDS.RILL_R066])(
      'remaps a string-to-number %s protocol halt to catchable R038',
      async (id) => {
        stubConverter('string', 'number', ERROR_ATOMS[id], 'bad number "abc"');

        const halt = await runHalt('"abc" -> number');

        const status = getStatus(halt.value);
        expect(status.code).toBe(resolveAtom(ERROR_ATOMS[ERROR_IDS.RILL_R038]));
        expect(status.message).toBe('bad number "abc"');
        expect(status.raw['value']).toBe('abc');
      }
    );

    it('lets guard recover a remapped protocol halt', async () => {
      stubConverter(
        'string',
        'number',
        ERROR_ATOMS[ERROR_IDS.RILL_R064],
        'bad number'
      );

      const result = await run('guard { "abc" -> number } ?? "recovered"');

      expect(result).toBe('recovered');
    });

    it('remaps a string-to-bool protocol halt to catchable R036', async () => {
      stubConverter(
        'string',
        'bool',
        ERROR_ATOMS[ERROR_IDS.RILL_R065],
        'ignored message'
      );

      const halt = await runHalt('"maybe" -> bool');

      const status = getStatus(halt.value);
      expect(status.code).toBe(resolveAtom(ERROR_ATOMS[ERROR_IDS.RILL_R036]));
      expect(status.message).toBe('cannot convert string to bool');
      expect(status.raw['source']).toBe('string');
      expect(status.raw['target']).toBe('bool');
    });

    it('remaps a number-to-bool protocol halt to catchable R036', async () => {
      stubConverter(
        'number',
        'bool',
        ERROR_ATOMS[ERROR_IDS.RILL_R066],
        'ignored message'
      );

      const halt = await runHalt('5 -> bool');

      const status = getStatus(halt.value);
      expect(status.code).toBe(resolveAtom(ERROR_ATOMS[ERROR_IDS.RILL_R036]));
      expect(status.message).toBe('cannot convert number to bool');
    });
  });
});

describe('halt atom registration (file)', () => {
  /**
   * Atom registration for the string, number, and callable built-in halts:
   * each atom resolves to itself (not the `#R001` fallback) and a halt carrying
   * it reaches the host as a RuntimeError with the matching errorId.
   */

  const ATOM_CASES = [
    [ERROR_ATOMS[ERROR_IDS.RILL_R064], ERROR_IDS.RILL_R064],
    [ERROR_ATOMS[ERROR_IDS.RILL_R065], ERROR_IDS.RILL_R065],
    [ERROR_ATOMS[ERROR_IDS.RILL_R066], ERROR_IDS.RILL_R066],
    [ERROR_ATOMS[ERROR_IDS.RILL_R085], ERROR_IDS.RILL_R085],
  ] as const;

  function makeRaiser(atom: string): RillFunction {
    return {
      params: [],
      fn: () => throwFatalHostHalt({ fn: 'raise' }, atom, `${atom} raised`),
    };
  }

  describe('halt atom registration', () => {
    it.each(ATOM_CASES)('%s resolves to its own atom', (atom) => {
      expect(atomName(resolveAtom(atom))).toBe(atom);
    });

    it.each(ATOM_CASES)(
      '%s halt leaves execute() as a RuntimeError with its errorId and haltValue',
      async (atom, errorId) => {
        const ctx = createRuntimeContext({
          functions: { raise: makeRaiser(atom) },
        });
        const err = await captureRuntimeError(() =>
          execute(parse('raise()'), ctx)
        );

        expect(err.errorId).toBe(errorId);
        expect(err.rawMessage).toBe(`${atom} raised`);
        expect(err.haltSignal).toBeInstanceOf(RuntimeHaltSignal);
        expect(err.haltValue).toBe(err.haltSignal?.value);
        expect(isInvalid(err.haltValue)).toBe(true);
        expect(atomName(getStatus(err.haltValue).code)).toBe(atom);
        await ctx.dispose();
      }
    );
  });
});

describe('halt assertion helpers', () => {
  /**
   * Self-tests for the halt assertion helpers: each helper accepts its own
   * error class and rejects the others. A helper's failure is captured with
   * try/catch and asserted synchronously.
   */

  /** Raw halt signal, as thrown by a direct builder call. */
  function throwRawHalt(): Promise<never> {
    return Promise.reject(
      captureRawHalt(() =>
        throwCatchableHostHalt(
          { fn: 'probe' },
          ERROR_ATOMS[ERROR_IDS.RILL_R003],
          'wrong receiver'
        )
      )
    );
  }

  function captureRawHalt(fn: () => never): RuntimeHaltSignal {
    try {
      fn();
    } catch (e) {
      if (e instanceof RuntimeHaltSignal) return e;
      throw e;
    }
    throw new Error('expected a halt');
  }

  /** Script that halts and is rematerialised as RuntimeError(RILL-R003). */
  function runRematerialisedHalt(): Promise<unknown> {
    return run('5 -> .head');
  }

  function throwPlainRuntimeError(): Promise<never> {
    return Promise.reject(new RuntimeError('RILL-R003', 'plain failure'));
  }

  function throwPlainError(): Promise<never> {
    return Promise.reject(new Error('plain failure'));
  }

  function resolveNormally(): Promise<unknown> {
    return Promise.resolve(1);
  }

  /** Runs a helper and returns the assertion error it threw; fails if none. */
  async function captureFailure(check: () => Promise<void>): Promise<Error> {
    let captured: unknown;
    try {
      await check();
    } catch (e) {
      captured = e;
    }
    if (captured === undefined) {
      throw new Error('expected the helper to fail, but it passed');
    }
    expect(captured).toBeInstanceOf(Error);
    return captured as Error;
  }

  describe('expectRuntimeError', () => {
    it('passes on a RuntimeError without haltValue', async () => {
      await expectRuntimeError(throwPlainRuntimeError, {
        code: 'RILL-R003',
        messagePattern: 'plain failure',
      });
    });

    it('fails on a rematerialised halt', async () => {
      const failure = await captureFailure(() =>
        expectRuntimeError(runRematerialisedHalt, { code: 'RILL-R003' })
      );
      expect(failure.message).toMatch(/expected \{.*\} to be undefined/s);
    });

    it('fails on a non-RuntimeError', async () => {
      const failure = await captureFailure(() =>
        expectRuntimeError(throwPlainError, { code: 'RILL-R003' })
      );
      expect(failure.message).toMatch(
        /expected Error: plain failure to be an instance of RuntimeError/
      );
    });

    it('fails when exec resolves', async () => {
      const failure = await captureFailure(() =>
        expectRuntimeError(resolveNormally, { code: 'RILL-R003' })
      );
      expect(failure.message).toMatch(
        /expected undefined to be an instance of RuntimeError/
      );
    });

    it('fails on an errorId mismatch', async () => {
      const failure = await captureFailure(() =>
        expectRuntimeError(throwPlainRuntimeError, { code: 'RILL-R004' })
      );
      expect(failure.message).toMatch(/expected 'RILL-R003' to be 'RILL-R004'/);
    });

    it('fails on a message mismatch', async () => {
      const failure = await captureFailure(() =>
        expectRuntimeError(throwPlainRuntimeError, {
          code: 'RILL-R003',
          messagePattern: 'different text',
        })
      );
      expect(failure.message).toMatch(
        /expected 'plain failure' to contain 'different text'/
      );
    });
  });

  describe('expectThrowMessage', () => {
    it('passes on a plain Error with a matching message', async () => {
      await expectThrowMessage(throwPlainError, 'plain failure');
      await expectThrowMessage(throwPlainError, /plain/);
    });

    it('fails on a RuntimeHaltSignal', async () => {
      const failure = await captureFailure(() =>
        expectThrowMessage(throwRawHalt, /./)
      );
      expect(failure.message).toMatch(
        /RuntimeHaltSignal.* to not be an instance of RuntimeHaltSignal/s
      );
    });

    it('fails on a RuntimeError', async () => {
      const failure = await captureFailure(() =>
        expectThrowMessage(throwPlainRuntimeError, /./)
      );
      expect(failure.message).toMatch(
        /RuntimeError: plain failure.* to not be an instance of RuntimeError/s
      );
    });

    it('fails when exec resolves', async () => {
      const failure = await captureFailure(() =>
        expectThrowMessage(resolveNormally, /./)
      );
      expect(failure.message).toMatch(
        /expected undefined to be an instance of Error/
      );
    });

    it('fails on a message mismatch', async () => {
      const failure = await captureFailure(() =>
        expectThrowMessage(throwPlainError, 'different text')
      );
      expect(failure.message).toMatch(
        /expected 'plain failure' to contain 'different text'/
      );
    });
  });

  describe('expectHalt with hostErrorId', () => {
    const expected = {
      code: ERROR_ATOMS[ERROR_IDS.RILL_R003],
      hostErrorId: 'RILL-R003',
    };

    it('passes on a rematerialised halt through execute', async () => {
      await expectHalt(runRematerialisedHalt, expected);
    });

    it('still accepts a raw halt when hostErrorId is omitted', async () => {
      await expectHalt(throwRawHalt, {
        code: ERROR_ATOMS[ERROR_IDS.RILL_R003],
      });
    });

    it('fails on a raw halt', async () => {
      const failure = await captureFailure(() =>
        expectHalt(throwRawHalt, expected)
      );
      expect(failure.message).toMatch(
        /RuntimeHaltSignal.* to be an instance of RuntimeError/s
      );
    });

    it('fails on a RuntimeError without haltValue', async () => {
      const failure = await captureFailure(() =>
        expectHalt(throwPlainRuntimeError, expected)
      );
      expect(failure.message).toMatch(/expected undefined to be defined/);
    });

    it('fails on an errorId mismatch', async () => {
      const failure = await captureFailure(() =>
        expectHalt(runRematerialisedHalt, {
          code: ERROR_ATOMS[ERROR_IDS.RILL_R003],
          hostErrorId: 'RILL-R004',
        })
      );
      expect(failure.message).toMatch(/expected 'RILL-R003' to be 'RILL-R004'/);
    });
  });
});

describe('host-error shape (file)', () => {
  /**
   * Halts that carry a host-error shape: carrier seeding and fills, host
   * boundary conversion, closure boundary fills, and the timeout<> and deferred
   * log class branches.
   */

  // SHAPE CARRIER

  const SHAPE_LOCATION = {
    line: 3,
    column: 7,
    offset: 20,
  } as const;

  function captureHalt(fn: () => never): RuntimeHaltSignal {
    try {
      fn();
    } catch (e) {
      if (e instanceof RuntimeHaltSignal) return e;
      throw e;
    }
    throw new Error('expected a halt');
  }

  function haltValue(
    site: Partial<TypeHaltSite> = {},
    fatal = false
  ): RillValue {
    const full: TypeHaltSite = { fn: 'probe', ...site };
    return captureHalt(() =>
      fatal
        ? throwFatalHostHalt(full, ERROR_ATOMS[ERROR_IDS.RILL_R010], 'boom', {
            extra: 'x',
          })
        : throwCatchableHostHalt(
            full,
            ERROR_ATOMS[ERROR_IDS.RILL_R006],
            'boom',
            { extra: 'x' }
          )
    ).value;
  }

  describe('host-error shape carrier', () => {
    describe('seeding', () => {
      it.each([false, true])(
        'seeds location with undefined sourceId when flagged (fatal=%s)',
        (fatal) => {
          const value = haltValue(
            {
              location: SHAPE_LOCATION,
              sourceId: 'a.rill',
              preserveHostShape: true,
            },
            fatal
          );

          const shape = getHostShape(value);

          expect(shape).toBeDefined();
          expect(shape?.location).toEqual(SHAPE_LOCATION);
          expect(shape?.sourceId).toBeUndefined();
          expect(shape?.contextExtras).toBeUndefined();
        }
      );

      it.each([false, true])(
        'records no carrier without the flag (fatal=%s)',
        (fatal) => {
          const value = haltValue({ location: SHAPE_LOCATION }, fatal);

          expect(getHostShape(value)).toBeUndefined();
        }
      );
    });

    describe('fillHostShape', () => {
      it('fills unset fields and keeps set ones (first writer wins)', () => {
        const value = haltValue({
          location: SHAPE_LOCATION,
          preserveHostShape: true,
        });
        const other = { line: 9, column: 9, offset: 99 };

        const filled = fillHostShape(value, {
          location: other,
          sourceId: 'first.rill',
        });
        const refilled = fillHostShape(filled, {
          sourceId: 'second.rill',
          contextExtras: { sourceText: 'src' },
        });

        const shape = getHostShape(refilled);
        expect(shape?.location).toEqual(SHAPE_LOCATION);
        expect(shape?.sourceId).toBe('first.rill');
        expect(shape?.contextExtras).toBeUndefined();
      });

      it('fills sourceId and contextExtras together when both are unset', () => {
        const value = haltValue({
          location: SHAPE_LOCATION,
          preserveHostShape: true,
        });

        const filled = fillHostShape(value, {
          sourceId: 'first.rill',
          contextExtras: { sourceText: 'src' },
        });

        const shape = getHostShape(filled);
        expect(shape?.sourceId).toBe('first.rill');
        expect(shape?.contextExtras).toEqual({ sourceText: 'src' });
      });

      it('installs a new record and leaves the prior one unchanged', () => {
        const value = haltValue({
          location: SHAPE_LOCATION,
          preserveHostShape: true,
        });
        const before = getHostShape(value);

        const filled = fillHostShape(value, { sourceId: 'a.rill' });

        expect(getHostShape(filled)).not.toBe(before);
        expect(getHostShape(value)).toBe(before);
        expect(before?.sourceId).toBeUndefined();
      });

      it('is a no-op without a carrier', () => {
        const value = haltValue({ location: SHAPE_LOCATION });

        expect(fillHostShape(value, { sourceId: 'a.rill' })).toBe(value);
        expect(getHostShape(fillHostShape(value, { sourceId: 'a' }))).toBe(
          undefined
        );
      });
    });

    describe('invisibility', () => {
      it('is absent from Object.keys(raw), JSON, and formatHalt', () => {
        const value = fillHostShape(
          haltValue({ location: SHAPE_LOCATION, preserveHostShape: true }),
          { sourceId: 'secret.rill' }
        );

        const raw = getStatus(value).raw;

        expect(Object.keys(raw).sort()).toEqual(['extra', 'message']);
        expect(JSON.stringify(raw)).not.toContain('secret.rill');
        expect(formatHalt(value)).not.toContain('secret.rill');
      });
    });

    describe('rewraps', () => {
      const value = haltValue({
        location: SHAPE_LOCATION,
        preserveHostShape: true,
      });
      const shape = getHostShape(value);

      it('survives appendTraceFrame', () => {
        const next = appendTraceFrame(
          value,
          createTraceFrame({ site: 'x:1:1', kind: 'host', fn: 'f' })
        );

        expect(getHostShape(next)).toBe(shape);
      });

      it('survives withOriginSite', () => {
        expect(getHostShape(withOriginSite(value, 'y:2:2'))).toBe(shape);
      });

      it('survives mergeRaw', () => {
        const next = mergeRaw(value, { callStack: 'frames' });

        expect(getHostShape(next)).toBe(shape);
        expect(Object.keys(getStatus(next).raw)).toContain('callStack');
      });

      it('survives a fill followed by mergeRaw', () => {
        const filled = fillHostShape(value, { sourceId: 'a.rill' });

        expect(getHostShape(mergeRaw(filled, { k: 'v' }))?.sourceId).toBe(
          'a.rill'
        );
      });
    });
  });

  // HOST BOUNDARY

  const LOCATION = { line: 4, column: 9, offset: 30 } as const;

  interface HostOptions {
    readonly preserve: boolean;
    readonly fill?: boolean;
    /** Omit to raise with LOCATION; false raises a location-less carrier. */
    readonly located?: boolean;
  }

  function makeBoundaryBoom(options: HostOptions): RillFunction {
    return {
      params: [],
      fn: () => {
        try {
          throwFatalHostHalt(
            {
              fn: 'boom',
              location: options.located === false ? undefined : LOCATION,
              preserveHostShape: options.preserve ? true : undefined,
            },
            ERROR_ATOMS[ERROR_IDS.RILL_R010],
            'boom message',
            { limit: 5 }
          );
        } catch (e) {
          if (!(e instanceof RuntimeHaltSignal)) throw e;
          if (options.fill !== true) throw e;
          const filled = fillHostShape(e.value, {
            sourceId: 'mod.rill',
            contextExtras: Object.fromEntries([
              ['extra', 'x'],
              ['__proto__', 'p'],
            ]),
          });
          throw new RuntimeHaltSignal(filled, e.catchable);
        }
        return '';
      },
    };
  }

  describe('host boundary conversion with a host-error shape', () => {
    it('execute rebuilds location, derived span, sourceId and context from the carrier', async () => {
      const ctx = createRuntimeContext({
        functions: { boom: makeBoundaryBoom({ preserve: true, fill: true }) },
      });
      const err = await captureRuntimeError(() =>
        execute(parse('1\nboom()'), ctx)
      );

      expect(err.errorId).toBe('RILL-R010');
      expect(err.rawMessage).toBe('boom message');
      expect(err.location).toEqual(LOCATION);
      expect(err.span).toEqual({ start: LOCATION, end: LOCATION });
      expect(err.message).toBe('boom message at 4:9');
      expect(err.sourceId).toBe('mod.rill');
      expect(err.context?.['limit']).toBe(5);
      expect(err.context?.['extra']).toBe('x');
      expect(
        Object.getOwnPropertyDescriptor(err.context, '__proto__')?.value
      ).toBe('p');
      expect(Object.getPrototypeOf(err.context)).toBe(Object.prototype);
      expect(err.haltValue).toBeDefined();
      expect(err.haltCatchable).toBe(false);
      expect(err.haltSignal).toBeInstanceOf(RuntimeHaltSignal);
      await ctx.dispose();
    });

    it('leaves sourceId undefined when the carrier has none', async () => {
      const ctx = createRuntimeContext({
        functions: { boom: makeBoundaryBoom({ preserve: true }) },
      });
      const err = await captureRuntimeError(() =>
        execute(parse('boom()'), ctx)
      );

      expect(err.location).toEqual(LOCATION);
      expect(err.sourceId).toBeUndefined();
      expect(err.context?.['limit']).toBe(5);
      await ctx.dispose();
    });

    it('leaves context undefined for a carrier halt with no raw extras', async () => {
      // A stream chunk halt reaches the host boundary without the call-stack
      // payload a host-call dispatch adds, so no raw extras remain.
      const stream: RillFunction = {
        params: [],
        fn: (): RillValue =>
          createRillStream({
            chunks: (async function* () {
              throwFatalHostHalt(
                { fn: 'next', preserveHostShape: true },
                ERROR_ATOMS[ERROR_IDS.RILL_R010],
                'stream boom'
              );
              yield 1;
            })(),
            resolve: async () => 'resolved',
          }),
      };
      const ctx = createRuntimeContext({ functions: { s: stream } });
      const err = await captureRuntimeError(() =>
        execute(parse('s() => $st\n$st()'), ctx)
      );

      expect(err.errorId).toBe('RILL-R010');
      expect(err.rawMessage).toBe('stream boom');
      expect(err.context).toBeUndefined();
      expect(err.location).toBeUndefined();
      expect(err.span).toBeUndefined();
      expect(err.sourceId).toBeUndefined();
      await ctx.dispose();
    });

    it('keeps statement location and span when there is no carrier', async () => {
      const ctx = createRuntimeContext({
        functions: { boom: makeBoundaryBoom({ preserve: false }) },
      });
      const err = await captureRuntimeError(() =>
        execute(parse('1\nboom()'), ctx)
      );

      expect(err.errorId).toBe('RILL-R010');
      expect(err.location?.line).toBe(2);
      expect(err.span?.start.line).toBe(2);
      expect(err.context?.['limit']).toBe(5);
      await ctx.dispose();
    });

    it('stepper rebuilds from the carrier and getResult returns the last completed value', async () => {
      const ctx = createRuntimeContext({
        functions: { boom: makeBoundaryBoom({ preserve: true, fill: true }) },
      });
      const stepper = createStepper(parse('7\nboom()'), ctx);
      const first = await stepper.step();
      expect(first.value).toBe(7);

      const err = await captureRuntimeError(() => stepper.step());

      expect(err.errorId).toBe('RILL-R010');
      expect(err.location).toEqual(LOCATION);
      expect(err.span).toEqual({ start: LOCATION, end: LOCATION });
      expect(err.sourceId).toBe('mod.rill');
      expect(err.context?.['extra']).toBe('x');
      expect(stepper.getResult().result).toBe(7);
      await ctx.dispose();
    });
  });

  // CLOSURE BOUNDARIES

  const OWN_LOCATION = { line: 7, column: 3, offset: 50 } as const;

  function makeClosureBoom(
    location: typeof OWN_LOCATION | undefined
  ): RillFunction {
    return {
      params: [],
      fn: () => {
        throwFatalHostHalt(
          { fn: 'boom', location, preserveHostShape: true },
          ERROR_ATOMS[ERROR_IDS.RILL_R010],
          'boom message'
        );
        return '';
      },
    };
  }

  const MODULE_SOURCE = '|| { boom() }';
  const MODULE_RESOLVER = {
    module: (_resource: string): ResolverResult => ({
      kind: 'source',
      text: MODULE_SOURCE,
      sourceId: 'mod.rill',
    }),
  };

  describe('host call boundary fills a location-less carrier', () => {
    it('uses the host call location', async () => {
      const ctx = createRuntimeContext({
        functions: { boom: makeClosureBoom(undefined) },
      });
      const err = await captureRuntimeError(() =>
        execute(parse('1\n  boom()'), ctx)
      );

      expect(err.location?.line).toBe(2);
      expect(err.location?.column).toBe(3);
    });

    it('keeps a location the carrier already has', async () => {
      const ctx = createRuntimeContext({
        functions: { boom: makeClosureBoom(OWN_LOCATION) },
      });
      const err = await captureRuntimeError(() =>
        execute(parse('1\n  boom()'), ctx)
      );

      expect(err.location).toEqual(OWN_LOCATION);
    });
  });

  describe('script closure boundary fills sourceId and sourceText', () => {
    it('fills both for a closure defined in module source', async () => {
      const ctx = createRuntimeContext({
        functions: { boom: makeClosureBoom(undefined) },
        resolvers: MODULE_RESOLVER,
        parseSource: (text: string) => parse(text),
      });
      const err = await captureRuntimeError(() =>
        execute(parse('use<module:m> => $f\n$f()'), ctx)
      );

      expect(err.sourceId).toBe('mod.rill');
      expect(err.context?.['sourceText']).toBe(MODULE_SOURCE);
    });

    it('adds neither for a closure defined with no module in play', async () => {
      const ctx = createRuntimeContext({
        functions: { boom: makeClosureBoom(undefined) },
      });
      const err = await captureRuntimeError(() =>
        execute(parse('|| { boom() } => $f\n$f()'), ctx)
      );

      expect(err.sourceId).toBeUndefined();
      expect(err.context?.['sourceText']).toBeUndefined();
    });
  });

  function makeStreamWithNext(raw: Record<string, RillValue>): RillFunction {
    return {
      params: [],
      fn: (): RillValue =>
        createRillStream({
          chunks: (async function* () {
            throwFatalHostHalt(
              { fn: 'next' },
              ERROR_ATOMS[ERROR_IDS.RILL_R002],
              'Stream already consumed',
              raw
            );
            yield 1;
          })(),
          resolve: async () => 'resolved',
        }),
    };
  }

  describe('stream end detection with halts', () => {
    it('ends cleanly on a halt marking alreadyConsumed', async () => {
      const ctx = createRuntimeContext({
        functions: { s: makeStreamWithNext({ alreadyConsumed: true }) },
      });
      const { result } = await execute(parse('s() => $st\n$st()'), ctx);

      expect(result).toBe('resolved');
    });

    it('propagates a halt without the alreadyConsumed marker', async () => {
      const ctx = createRuntimeContext({
        functions: { s: makeStreamWithNext({ alreadyConsumed: false }) },
      });
      const err = await captureRuntimeError(() =>
        execute(parse('s() => $st\n$st()'), ctx)
      );

      expect(err.rawMessage).toBe('Stream already consumed');
    });
  });

  // CLASS BRANCHES

  // Completion of every boom body started by this file, so a test can wait for
  // fire-and-forget or timeout<>-outliving work instead of sleeping.
  const lateWork: Promise<void>[] = [];

  async function drainLateWork(): Promise<void> {
    await Promise.all(lateWork.splice(0));
  }

  interface BoomOptions {
    readonly preserve: boolean;
    readonly located: boolean;
    readonly gate?: Promise<void> | undefined;
  }

  function makeClassBoom(options: BoomOptions): RillFunction {
    const raise = async (): Promise<string> => {
      if (options.gate !== undefined) await options.gate;
      throwFatalHostHalt(
        {
          fn: 'boom',
          location: options.located ? LOCATION : undefined,
          preserveHostShape: options.preserve ? true : undefined,
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R010],
        'boom message',
        { limit: 5 }
      );
      return '';
    };
    return {
      params: [],
      fn: () => {
        const work = raise();
        lateWork.push(
          work.then(
            () => undefined,
            () => undefined
          )
        );
        return work;
      },
    };
  }

  interface ExpiringScheduler {
    readonly scheduler: TimeoutScheduler;
    readonly expired: Promise<void>;
  }

  // A scheduler whose timers fire fast; `expired` settles once a timer has fired,
  // so a host body can wait for the timeout<> to expire before it halts.
  function makeExpiringScheduler(): ExpiringScheduler {
    let markExpired: () => void = () => undefined;
    const expired = new Promise<void>((resolve) => {
      markExpired = resolve;
    });
    return {
      expired,
      scheduler: {
        setTimeout: (fn) =>
          setTimeout(() => {
            fn();
            markExpired();
          }, 5),
        clearTimeout: (handle) => clearTimeout(handle),
      },
    };
  }

  async function captureError(
    source: string,
    options: RuntimeOptions
  ): Promise<unknown> {
    const ctx = createRuntimeContext(options);
    try {
      await execute(parse(source), ctx);
    } catch (e) {
      return e;
    } finally {
      await ctx.dispose();
    }
    throw new Error('expected the script to throw');
  }

  async function runValue(
    source: string,
    options: RuntimeOptions
  ): Promise<unknown> {
    const ctx = createRuntimeContext(options);
    try {
      const result = await execute(parse(source), ctx);
      return result.result;
    } finally {
      await ctx.dispose();
    }
  }

  describe('timeout<> with a carrier halt', () => {
    const expiring = (preserve: boolean): RuntimeOptions => {
      const { scheduler, expired } = makeExpiringScheduler();
      return {
        functions: {
          boom: makeClassBoom({ preserve, located: true, gate: expired }),
        },
        scheduler,
      };
    };

    it('after total expiry a guard recovers the timeout halt', async () => {
      const source =
        'guard { timeout<total: duration(0,0,1)> { boom() } } => $r\n($r.!code == #RILL_R082)';
      expect(await runValue(source, expiring(true))).toBe(true);
      await drainLateWork();
    });

    it('after idle expiry a guard recovers the idle timeout halt', async () => {
      const source =
        'guard { timeout<idle: duration(0,0,1)> { boom() } } => $r\n($r.!code == #RILL_R083)';
      expect(await runValue(source, expiring(true))).toBe(true);
      await drainLateWork();
    });

    it('after expiry without guard raises RILL-R082 with durationMs', async () => {
      const err = await captureError(
        'timeout<total: duration(0,0,1)> { boom() }',
        expiring(true)
      );
      expect(err).toBeInstanceOf(RuntimeError);
      expect((err as RuntimeError).errorId).toBe('RILL-R082');
      expect((err as RuntimeError).context).toEqual({ durationMs: 86400000 });
      await drainLateWork();
    });

    it('before expiry the original fatal error propagates unchanged', async () => {
      const err = await captureError(
        'guard { timeout<total: duration(0,1,0)> { boom() } } => $r\n$r',
        {
          functions: {
            boom: makeClassBoom({
              preserve: true,
              located: true,
              gate: undefined,
            }),
          },
        }
      );
      expect(err).toBeInstanceOf(RuntimeError);
      expect((err as RuntimeError).errorId).toBe('RILL-R010');
      expect((err as RuntimeError).location).toEqual(LOCATION);
      await drainLateWork();
    });

    it('a fatal halt without a carrier keeps the fatal rethrow after expiry', async () => {
      const err = await captureError(
        'guard { timeout<total: duration(0,0,1)> { boom() } } => $r\n$r',
        expiring(false)
      );
      expect(err).toBeInstanceOf(RuntimeError);
      expect((err as RuntimeError).errorId).toBe('RILL-R010');
      await drainLateWork();
    });
  });

  describe('deferred halt log with a carrier halt', () => {
    async function collectLog(
      located: boolean,
      withEvent: boolean
    ): Promise<string[]> {
      const out: string[] = [];
      const ctx = createRuntimeContext({
        functions: {
          boom: makeClassBoom({ preserve: true, located, gate: undefined }),
        },
        callbacks: {
          onLog: (message: string): void => {
            if (!withEvent) out.push(message);
          },
          ...(withEvent
            ? {
                onLogEvent: (event: { detail?: string | undefined }): void => {
                  out.push(event.detail ?? '');
                },
              }
            : {}),
        },
      });
      await execute(parse('pass<async: true> { boom() }'), ctx);
      await drainLateWork();
      await ctx.dispose();
      return out;
    }

    it('appends the location suffix in onLog and onLogEvent', async () => {
      expect(await collectLog(true, false)).toEqual([
        'runtime: pass<async> body halted: boom message at 4:9',
      ]);
      expect(await collectLog(true, true)).toEqual(['boom message at 4:9']);
    });

    it('uses the call-site location when the thrown carrier has none', async () => {
      const lines = await collectLog(false, false);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(
        /^runtime: pass<async> body halted: boom message at \d+:\d+$/
      );
      const events = await collectLog(false, true);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatch(/^boom message at \d+:\d+$/);
    });

    it('adds no suffix when the carrier has no location at any boundary', async () => {
      const out: string[] = [];
      let markHalted: () => void = () => undefined;
      lateWork.push(
        new Promise<void>((resolve) => {
          markHalted = resolve;
        })
      );
      const ctx = createRuntimeContext({
        functions: {
          s: {
            params: [],
            fn: (): RillValue =>
              createRillStream({
                chunks: (async function* () {
                  try {
                    throwFatalHostHalt(
                      { fn: 'next', preserveHostShape: true },
                      ERROR_ATOMS[ERROR_IDS.RILL_R010],
                      'stream boom'
                    );
                  } finally {
                    markHalted();
                  }
                  yield 1;
                })(),
                resolve: async () => 'resolved',
              }),
          },
        },
        callbacks: {
          onLog: () => undefined,
          onLogEvent: (event: { detail?: string | undefined }): void => {
            out.push(event.detail ?? '');
          },
        },
      });
      await execute(parse('pass<async: true> { s() => $st\n$st() }'), ctx);
      await drainLateWork();
      await ctx.dispose();
      expect(out).toEqual(['stream boom']);
    });

    it('keeps the halt rendering when there is no carrier', async () => {
      const out: string[] = [];
      const ctx = createRuntimeContext({
        functions: {
          boom: makeClassBoom({
            preserve: false,
            located: true,
            gate: undefined,
          }),
        },
        callbacks: {
          onLog: () => undefined,
          onLogEvent: (event: { detail?: string | undefined }): void => {
            out.push(event.detail ?? '');
          },
        },
      });
      await execute(parse('pass<async: true> { boom() }'), ctx);
      await drainLateWork();
      await ctx.dispose();
      expect(out).toHaveLength(1);
      expect(out[0]).toContain('boom message');
      expect(out[0]?.startsWith('#')).toBe(true);
    });
  });
});
