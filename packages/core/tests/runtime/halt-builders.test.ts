/**
 * Unit tests for typed-atom halt builders (Phase 1, DEBT-2).
 *
 * Covers IR-1 (abort), IR-2 (auto-exception), IR-3 (error wrap) in
 * `runtime/core/types/halt.ts`. Each builder:
 *   - constructs an invalid RillValue via `invalidate`,
 *   - attaches a `host`-kind trace frame,
 *   - throws a non-catchable `RuntimeHaltSignal`.
 *
 * Tests read the thrown signal's invalid value directly via `getStatus`
 * so assertions target the sidecar shape, not the textual halt output.
 */

import { describe, expect, it } from 'vitest';
import {
  RuntimeHaltSignal,
  throwAbortHalt,
  throwAutoExceptionHalt,
  throwErrorHalt,
  type TypeHaltSite,
} from '../../src/runtime/core/types/halt.js';
import { getStatus } from '../../src/runtime/core/types/status.js';
import { atomName } from '../../src/runtime/core/types/atom-registry.js';

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
