/**
 * Unit tests for `formatHalt` — the canonical plain-text halt renderer.
 *
 * Coverage targets:
 * - IR-14 / AC-FDL-E1: `formatHalt` is importable from `@rcrsr/rill`
 *   top-level (the package barrel re-exports the runtime barrel).
 * - FR-ERR-28: deterministic byte-equal output. Identical inputs must
 *   produce identical strings. No platform APIs, no timestamps.
 * - NFR-ERR-2 / AC-N3 / AC-B5: zero-allocation fast path for valid
 *   values. `formatHalt` on a valid value returns `""` without touching
 *   the trace array.
 *
 * Construction strategy:
 * - Single-frame fixtures are built via the public `ctx.invalidate`
 *   (§NOD.2.1; task 3.2). `ctx.invalidate` always appends one frame with
 *   `site: ""`, `kind: "host"`, `fn: meta.provider`.
 * - Multi-frame ordering uses `execute()` on a small Rill script that
 *   naturally produces a `[host, access, guard-caught]` trace.
 */

import { describe, expect, it } from 'vitest';
import {
  createRuntimeContext,
  execute,
  formatHalt,
  parseWithRecovery,
  type RillValue,
} from '@rcrsr/rill';

function invalid(meta: {
  code: string;
  provider: string;
  raw?: Record<string, unknown>;
}): RillValue {
  const ctx = createRuntimeContext({});
  return ctx.invalidate(null, meta);
}

describe('formatHalt', () => {
  it('returns an empty string for a valid plain value', () => {
    expect(formatHalt('hello')).toBe('');
    expect(formatHalt(42)).toBe('');
    expect(formatHalt({})).toBe('');
    expect(formatHalt([])).toBe('');
    expect(formatHalt(null)).toBe('');
  });

  it('renders an invalid value with code atom, message, provider, and trace', () => {
    // ctx.invalidate frame: { site: "", kind: "host", fn: provider }.
    const value = invalid({
      code: 'TIMEOUT',
      provider: 'test-provider',
      raw: { message: 'request timed out' },
    });
    const output = formatHalt(value);
    expect(output).toBe(
      [
        '#TIMEOUT: request timed out',
        'at test-provider',
        '  host /test-provider',
      ].join('\n')
    );
  });

  it('omits the provider line when provider is empty', () => {
    // With provider === "" the "at ..." line is omitted and the frame
    // prints as `"  host "` (empty site, empty fn => no suffix).
    const value = invalid({
      code: 'NOT_FOUND',
      provider: '',
      raw: { message: 'missing' },
    });
    expect(formatHalt(value)).toBe(
      ['#NOT_FOUND: missing', '  host '].join('\n')
    );
  });

  it('omits the trailing message when message is empty', () => {
    // No `raw.message` and a non-Error first argument: merge keeps message empty.
    const value = invalid({ code: 'CONFLICT', provider: 'db' });
    expect(formatHalt(value)).toBe(
      ['#CONFLICT:', 'at db', '  host /db'].join('\n')
    );
  });

  it('renders trace frames in append order, origin first', async () => {
    // A recovery-atom followed by an access + guard produces a natural
    // multi-frame trace: origin `host` (provider "parse-recovery"), then
    // one or more `access` frames (from `$x.a`), then a `guard-caught`
    // frame. formatHalt renders them in append order.
    const src = `
      #AB0x => $x
      guard { $x.a }
    `;
    const parsed = parseWithRecovery(src);
    const ctx = createRuntimeContext({});
    const { result } = await execute(parsed.ast, ctx);

    const output = formatHalt(result);
    const lines = output.split('\n');

    // Header line names the atom (recovery atom resolves to #R001).
    expect(lines[0]!.startsWith('#R001')).toBe(true);

    // Origin host frame is the first trace line.
    const firstFrameIdx = lines.findIndex((l) => l.startsWith('  host '));
    expect(firstFrameIdx).toBeGreaterThan(0);

    // The last trace line is the guard-caught frame (latest-last order).
    const lastLine = lines[lines.length - 1]!;
    expect(lastLine.startsWith('  guard-caught ')).toBe(true);
    expect(lastLine.endsWith('/guard')).toBe(true);

    // An access frame sits strictly between the origin host frame and
    // the final guard-caught frame.
    const accessIdx = lines.findIndex((l) => l.startsWith('  access '));
    expect(accessIdx).toBeGreaterThan(firstFrameIdx);
    expect(accessIdx).toBeLessThan(lines.length - 1);
  });

  it('produces byte-equal output for identical inputs', () => {
    const build = (): RillValue =>
      invalid({
        code: 'AUTH',
        provider: 'idp',
        raw: { message: 'denied' },
      });
    const a = formatHalt(build());
    const b = formatHalt(build());
    expect(a).toBe(b);
    expect(a.endsWith('\n')).toBe(false);
  });

  it('resolves unregistered atom names to #R001 (fallback)', () => {
    const value = invalid({
      code: 'NOT_A_REGISTERED_ATOM_NAME',
      provider: 'x',
      raw: { message: 'm' },
    });
    expect(formatHalt(value).startsWith('#R001: m')).toBe(true);
  });
});
