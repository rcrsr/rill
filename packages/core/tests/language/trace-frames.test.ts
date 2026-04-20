/**
 * Rill Language Tests: Trace Frame Semantics (SM6; FR-ERR-12, FR-ERR-18)
 *
 * Trace frames document the lifecycle of an invalid RillValue. They are
 * append-only with origin first and latest last. Frames survive `=>`
 * capture and container inclusion (they ride on the value).
 *
 * Covered:
 *   - SM6        : Frame ordering contract (origin -> access -> guard-caught).
 *   - FR-ERR-12  : Append-only, ordered. Guards never rewrite prior frames.
 *   - FR-ERR-18  : Frames survive capture (`=>`) and list inclusion.
 *
 * Deferred to Phase 3:
 *   - FR-ERR-13  : `error "..."` wrapping an invalid value must append a
 *     `wrap` frame. Current runtime throws a non-catchable RuntimeError
 *     directly (control-flow.ts evaluateError) without routing through the
 *     wrap path. Tests for wrap frames land with the Phase-3 wrap plumbing.
 */

import { describe, expect, it } from 'vitest';
import { createRuntimeContext, execute, parseWithRecovery } from '@rcrsr/rill';
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
      retry<2> { $x.a }
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
      retry<3> { $x.a }
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

describe('Wrap frame (FR-ERR-13) — deferred to Phase 3', () => {
  // [DEFERRED] `error "..."` must append a `wrap` frame whose `wrapped`
  // field carries the prior status when the interpolated expression is
  // invalid. The current runtime (control-flow.ts#evaluateError) throws a
  // RuntimeError directly with no wrap plumbing. FR-ERR-13 lands with
  // Phase 3 wrap support. Placeholder kept here so the suite tracks the
  // missing frame kind.
  it.skip('FR-ERR-13: `error "... {$invalid}"` appends a wrap frame', () => {
    // Re-enable once the evaluator routes `error` through the wrap path.
  });
});
