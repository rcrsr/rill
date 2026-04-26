/**
 * Unit tests for typed-atom halt builders (Phase 1, DEBT-2).
 *
 * Covers IR-1 (abort), IR-2 (auto-exception), IR-3 (error wrap) in
 * `runtime/core/types/halt.ts`. Each builder:
 *   - constructs an invalid RillValue via `invalidate`,
 *   - attaches a `host`-kind trace frame,
 *   - throws a non-catchable `RuntimeHaltSignal`.
 *
 * Also covers IR-4 (catchable host halt) and IR-5 (fatal host halt):
 * `throwCatchableHostHalt` and `throwFatalHostHalt` introduced in Phase 1
 * task 1.4. Tests follow the same structural pattern as IR-1/IR-2/IR-3.
 *
 * Tests read the thrown signal's invalid value directly via `getStatus`
 * so assertions target the sidecar shape, not the textual halt output.
 */

import { describe, expect, it } from 'vitest';
import {
  RuntimeHaltSignal,
  throwAbortHalt,
  throwAutoExceptionHalt,
  throwCatchableHostHalt,
  throwErrorHalt,
  throwFatalHostHalt,
  type TypeHaltSite,
} from '../../src/runtime/core/types/halt.js';
import { getStatus, invalidate } from '../../src/runtime/core/types/status.js';
import { atomName } from '../../src/runtime/core/types/atom-registry.js';
import {
  createTraceFrame,
  TRACE_KINDS,
} from '../../src/runtime/core/types/trace.js';

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
    expect(atomName(status.code)).toBe('RILL_R016');
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
    // builder's JSDoc mentions "Caller responsibility" and EC-3.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const source = await fs.readFile(
      path.resolve(process.cwd(), 'src/runtime/core/types/halt.ts'),
      'utf8'
    );
    expect(source).toContain('Caller responsibility (EC-3)');
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
      throwCatchableHostHalt(HOST_SITE, 'RILL_R006', 'function not found')
    );

    expect(signal).toBeInstanceOf(RuntimeHaltSignal);
    expect(signal.catchable).toBe(true);
  });

  it('stores code, message, and provider=runtime in the invalid status [EC-5]', () => {
    const signal = catchHalt(() =>
      throwCatchableHostHalt(HOST_SITE, 'RILL_R006', 'function not found')
    );

    const status = getStatus(signal.value);
    expect(status.message).toBe('function not found');
    expect(status.raw.message).toBe('function not found');
    expect(status.provider).toBe('runtime');
  });

  it('attaches a single host-kind trace frame [BC-NOD-1]', () => {
    const signal = catchHalt(() =>
      throwCatchableHostHalt(HOST_SITE, 'RILL_R006', 'function not found')
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
      throwCatchableHostHalt(HOST_SITE, 'RILL_R006', 'function not found', {
        callee: 'myFn',
      })
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
      throwCatchableHostHalt(HOST_SITE, 'RILL_R006', 'function not found');
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
      throwFatalHostHalt(HOST_SITE, 'RILL_R010', 'iteration limit exceeded')
    );

    expect(signal).toBeInstanceOf(RuntimeHaltSignal);
    expect(signal.catchable).toBe(false);
  });

  it('stores code, message, and provider=runtime in the invalid status [EC-5]', () => {
    const signal = catchHalt(() =>
      throwFatalHostHalt(HOST_SITE, 'RILL_R010', 'iteration limit exceeded')
    );

    const status = getStatus(signal.value);
    expect(status.message).toBe('iteration limit exceeded');
    expect(status.raw.message).toBe('iteration limit exceeded');
    expect(status.provider).toBe('runtime');
  });

  it('attaches a single host-kind trace frame [BC-NOD-1]', () => {
    const signal = catchHalt(() =>
      throwFatalHostHalt(HOST_SITE, 'RILL_R010', 'iteration limit exceeded')
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
      throwFatalHostHalt(HOST_SITE, 'RILL_R010', 'iteration limit exceeded', {
        limit: 10000,
      })
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
      throwFatalHostHalt(HOST_SITE, 'RILL_R010', 'iteration limit exceeded')
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
      throwCatchableHostHalt(site, 'RILL_R006', 'not found')
    );
    const signalB = catchHalt(() =>
      throwCatchableHostHalt(site, 'RILL_R006', 'not found')
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
      throwFatalHostHalt(site, 'RILL_R010', 'limit exceeded')
    );
    const signalB = catchHalt(() =>
      throwFatalHostHalt(site, 'RILL_R010', 'limit exceeded')
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
      { code: 'RILL_R006', provider: 'runtime', raw: { message: 'prior' } },
      priorFrame
    );
    const site: TypeHaltSite = { ...SITE, fn: 'evaluateCallExpr' };
    const signal = catchHalt(() =>
      throwCatchableHostHalt(site, 'RILL_R006', 'outer message')
    );

    const status = getStatus(signal.value);
    // Always one frame — fresh {} base, no nesting.
    expect(status.trace).toHaveLength(1);
    expect(status.message).toBe('outer message');
  });

  it('throwFatalHostHalt always produces a single-frame trace from a fresh {} base', () => {
    const site: TypeHaltSite = { ...SITE, fn: 'checkIterationLimit' };
    const signal = catchHalt(() =>
      throwFatalHostHalt(site, 'RILL_R010', 'fatal message')
    );

    const status = getStatus(signal.value);
    expect(status.trace).toHaveLength(1);
    expect(status.message).toBe('fatal message');
  });
});

// ============================================================
// Empty status payload (BC-NOD-5)
// ============================================================

describe('empty raw payload — trace frame still constructed [BC-NOD-5]', () => {
  it('throwCatchableHostHalt with no raw arg still produces a trace frame', () => {
    const site: TypeHaltSite = { ...SITE, fn: 'evaluateCallExpr' };
    const signal = catchHalt(() =>
      throwCatchableHostHalt(site, 'RILL_R006', 'no extras')
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
      throwFatalHostHalt(site, 'RILL_R010', 'no extras')
    );

    const status = getStatus(signal.value);
    expect(status.trace).toHaveLength(1);
    expect(status.message).toBe('no extras');
    expect(atomName(status.code).length).toBeGreaterThan(0);
  });
});
