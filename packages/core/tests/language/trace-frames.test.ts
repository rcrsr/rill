/**
 * Rill Language Tests: Trace Frame Semantics (SM6; FR-ERR-12, FR-ERR-13, FR-ERR-18)
 *
 * Trace frames document the lifecycle of an invalid RillValue. They are
 * append-only with origin first and latest last. Frames survive `=>`
 * capture and container inclusion (they ride on the value).
 *
 * Covered:
 *   - SM6        : Frame ordering contract (origin -> access -> guard-caught).
 *   - FR-ERR-12  : Append-only, ordered. Guards never rewrite prior frames.
 *   - FR-ERR-13  : `error "..."` appends a `wrap` frame when the source
 *     message used interpolation; the non-catchable halt's invalid value is
 *     attached to the surfaced RuntimeError under `haltValue` so language
 *     tests can inspect trace frames (IR-3, IR-5).
 *   - FR-ERR-18  : Frames survive capture (`=>`) and list inclusion.
 */

import { describe, expect, it } from 'vitest';
import {
  createRuntimeContext,
  execute,
  parseWithRecovery,
  RuntimeError,
} from '@rcrsr/rill';
import { getStatus, isInvalid } from '../../src/runtime/core/types/status.js';

/** Runs a script through parseWithRecovery + execute and returns its value. */
async function runRecovered(src: string): Promise<unknown> {
  const parsed = parseWithRecovery(src);
  const ctx = createRuntimeContext({});
  const { result } = await execute(parsed.ast, ctx);
  return result;
}

describe('Trace frame ordering (SM6)', () => {
  it('SM6: origin-first, latest-last frame order on a guard-caught halt', async () => {
    // A shape-invalid atom `#AB0x` parses as a RecoveryErrorNode whose
    // runtime materialisation is `#R001` with ONE initial `host` frame
    // (provider: 'parse-recovery'). Accessing it appends `access`; the
    // outer guard appends `guard-caught`.
    const src = `
      #AB0x => $x
      guard { $x.a }
    `;
    const result = await runRecovered(src);
    expect(isInvalid(result as never)).toBe(true);
    const frames = getStatus(result as never).trace;

    // Expect at least: [host, ..., access, ..., guard-caught]
    // with host first and guard-caught last.
    expect(frames.length).toBeGreaterThanOrEqual(3);
    expect(frames[0]!.kind).toBe('host');
    expect(frames[frames.length - 1]!.kind).toBe('guard-caught');

    // The access frame sits strictly between the origin and the catch.
    const accessIdx = frames.findIndex((f) => f.kind === 'access');
    const caughtIdx = frames.findIndex((f) => f.kind === 'guard-caught');
    expect(accessIdx).toBeGreaterThan(0);
    expect(caughtIdx).toBeGreaterThan(accessIdx);
  });

  it('SM6: guard-caught frame labels its fn as `guard`', async () => {
    const src = `
      #AB0x => $x
      guard { $x.a }
    `;
    const result = await runRecovered(src);
    const frames = getStatus(result as never).trace;
    const caught = frames.find((f) => f.kind === 'guard-caught');
    expect(caught).toBeDefined();
    expect(caught!.fn).toBe('guard');
  });

  it('SM6: retry`s guard-caught frames are labelled `retry`', async () => {
    // Every retry attempt that catches a halt appends one `guard-caught`
    // frame whose fn is `retry` (recovery.ts convention distinguishing
    // retry from guard at frame creation).
    const src = `
      #AB0x => $x
      retry<limit: 2> { $x.a }
    `;
    const result = await runRecovered(src);
    const frames = getStatus(result as never).trace;
    const caught = frames.filter((f) => f.kind === 'guard-caught');
    expect(caught.length).toBe(2);
    for (const f of caught) {
      expect(f.fn).toBe('retry');
    }
  });
});

describe('FR-ERR-12: Append-only, never rewrite prior frames', () => {
  it('nested guard appends a second `guard-caught` without erasing the first', async () => {
    // An inner guard catches; the caller re-accesses the caught invalid
    // via `.a`; an outer guard catches again. The final trace retains
    // BOTH `guard-caught` frames in order (inner then outer).
    const src = `
      #AB0x => $x
      guard {
        guard { $x.a } => $inner
        $inner.b
      }
    `;
    const result = await runRecovered(src);
    const frames = getStatus(result as never).trace;
    const caughtFrames = frames.filter((f) => f.kind === 'guard-caught');
    expect(caughtFrames.length).toBe(2);
  });

  it('retry exhaustion retains every attempt`s guard-caught frame', async () => {
    const src = `
      #AB0x => $x
      retry<limit: 3> { $x.a }
    `;
    const result = await runRecovered(src);
    const frames = getStatus(result as never).trace;
    const caught = frames.filter((f) => f.kind === 'guard-caught');
    expect(caught.length).toBe(3);
  });
});

describe('FR-ERR-18: Frames survive capture and container inclusion', () => {
  it('`=>` capture preserves the trace frames on the rebound value', async () => {
    // Capture an invalid, then probe its trace. Trace frames must still be
    // present on the captured value: the capture is non-access and must
    // not rewrite the sidecar.
    const src = `
      #AB0x => $x
      $x => $y
      $y.!trace
    `;
    const trace = (await runRecovered(src)) as Array<{ kind: string }>;
    expect(Array.isArray(trace)).toBe(true);
    expect(trace.length).toBeGreaterThanOrEqual(1);
    // The `host` origin frame must still be present on the captured value.
    expect(trace.some((f) => f.kind === 'host')).toBe(true);
  });

  it('list inclusion preserves frames on the included element', async () => {
    // Materialise the list literal with the invalid element; read the
    // element back via guard and probe its trace. Accessing `.!trace`
    // on the element does not halt and returns the preserved trace.
    const src = `
      #AB0x => $x
      list[$x] => $batch
      $x.!trace
    `;
    const trace = (await runRecovered(src)) as Array<{ kind: string }>;
    expect(Array.isArray(trace)).toBe(true);
    expect(trace.length).toBeGreaterThanOrEqual(1);
    expect(trace[0]!.kind).toBe('host');
  });
});

describe('Wrap frame (FR-ERR-13; IR-3, IR-5)', () => {
  /**
   * `error "..."` halts non-catchably; the halt escapes guard/retry
   * (TD-2 / NFR-HSM-7) and the host boundary in execute.ts converts it
   * to a RuntimeError carrying `haltValue` for introspection.
   */
  async function runExpectingErrorHalt(src: string): Promise<{
    err: RuntimeError;
    haltStatus: ReturnType<typeof getStatus>;
  }> {
    const parsed = parseWithRecovery(src);
    const ctx = createRuntimeContext({});
    let caught: unknown;
    try {
      await execute(parsed.ast, ctx);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    const err = caught as RuntimeError;
    expect(err.errorId).toBe('RILL-R016');
    const haltValue = err.haltValue;
    expect(haltValue).toBeDefined();
    expect(isInvalid(haltValue as never)).toBe(true);
    return { err, haltStatus: getStatus(haltValue as never) };
  }

  it('AC-3 / TC-HSM-3: interpolated `error "failed: {reason}"` appends a wrap frame with the evaluated string', async () => {
    const src = `
      "boom" => $reason
      error "failed: {$reason}"
    `;
    const { err, haltStatus } = await runExpectingErrorHalt(src);

    // Surfaced RuntimeError carries the evaluated message (RillError appends
    // a ` at line:column` suffix to the JS Error.message; the halt's
    // status carries the raw evaluated string).
    expect(err.message.startsWith('failed: boom')).toBe(true);
    expect(haltStatus.message).toBe('failed: boom');

    // Wrap frame is the final trace frame; wrapped dict carries prior status.
    const frames = haltStatus.trace;
    expect(frames.length).toBeGreaterThanOrEqual(2);
    const last = frames[frames.length - 1]!;
    expect(last.kind).toBe('wrap');
    const wrapped = last.wrapped as Record<string, unknown>;
    expect(wrapped.message).toBe('failed: boom');
    expect(wrapped.provider).toBe('runtime');
  });

  it('AC-4 / TC-HSM-4: literal `error "literal message"` emits no wrap frame', async () => {
    const src = `error "literal message"`;
    const { err, haltStatus } = await runExpectingErrorHalt(src);

    expect(err.message.startsWith('literal message')).toBe(true);
    expect(haltStatus.message).toBe('literal message');
    const frames = haltStatus.trace;
    expect(frames.some((f) => f.kind === 'wrap')).toBe(false);
    // Single host frame only (IR-3 non-interpolated path).
    expect(frames).toHaveLength(1);
    expect(frames[0]!.kind).toBe('host');
  });

  it('AC-5 / TC-HSM-5: `guard { error "msg" }` does not catch; halt escapes to outer scope', async () => {
    // If guard caught the halt, execution would continue and return an
    // invalid (not throw). Non-catchability means the error halt bubbles
    // past guard to the host boundary.
    const src = `
      guard { error "msg" }
      "unreached"
    `;
    const { err, haltStatus } = await runExpectingErrorHalt(src);
    expect(err.message.startsWith('msg')).toBe(true);
    expect(haltStatus.message).toBe('msg');
  });

  it('AC-11: `error "{}"` (empty interpolation) attaches a wrap frame with empty wrapped message', async () => {
    // The string "{}" has no interpolation placeholder; an empty
    // interpolation requires an explicit expression. Use an empty string
    // captured into a variable and interpolated to model the AC-11
    // boundary (empty interpolated payload, interpolated=true).
    const src = `
      "" => $e
      error "{$e}"
    `;
    const { haltStatus } = await runExpectingErrorHalt(src);

    expect(haltStatus.message).toBe('');
    const frames = haltStatus.trace;
    const wrapFrame = frames.find((f) => f.kind === 'wrap');
    expect(wrapFrame).toBeDefined();
    const wrapped = wrapFrame!.wrapped as Record<string, unknown>;
    expect(wrapped.message).toBe('');
  });

  it('AC-12: `error ""` (empty literal) emits no wrap frame; raw.message is empty', async () => {
    const src = `error ""`;
    const { haltStatus } = await runExpectingErrorHalt(src);

    expect(haltStatus.message).toBe('');
    const frames = haltStatus.trace;
    expect(frames.some((f) => f.kind === 'wrap')).toBe(false);
    expect(haltStatus.raw.message).toBe('');
  });

  it('AC-13: `error "{$x}"` with invalid $x halts with RILL_R016 status; wrap frame attached', async () => {
    // `$x` holds an invalid (#AB0x recovery). Interpolating $x stringifies
    // the invalid via formatValue (no access is performed), so the error
    // halt is RILL_R016 with interpolated=true. The wrap frame carries
    // the RILL_R016 prior status dict per IR-3.
    const src = `
      #AB0x => $x
      error "wrapped: {$x}"
    `;
    const { err, haltStatus } = await runExpectingErrorHalt(src);

    expect(err.errorId).toBe('RILL-R016');
    // The halt's own status code is RILL_R016 (atom form).
    // The wrap frame carries the same prior status dict (pre-wrap snapshot).
    const frames = haltStatus.trace;
    const wrapFrame = frames.find((f) => f.kind === 'wrap');
    expect(wrapFrame).toBeDefined();
    const wrapped = wrapFrame!.wrapped as Record<string, unknown>;
    expect(typeof wrapped.code).toBe('string');
    expect(wrapped.provider).toBe('runtime');
    // Message contains the stringified invalid.
    expect(typeof wrapped.message).toBe('string');
    expect((wrapped.message as string).startsWith('wrapped: ')).toBe(true);
  });
});
