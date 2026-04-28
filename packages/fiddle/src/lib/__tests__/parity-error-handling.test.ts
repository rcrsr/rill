/**
 * Byte-equal parity harness: Fiddle vs Node runtime for error-handling fixtures
 *
 * DEC-8: Both sides call formatHalt on the same invalid value. Fiddle and
 * Node share the identical @rcrsr/rill runtime (no fork), so formatHalt
 * output is structurally identical when both receive the same invalid value.
 *
 * "Node side": raw @rcrsr/rill parse + createRuntimeContext + execute.
 * "Fiddle side": executeRill from lib/execution.ts (which wraps the same calls).
 *
 * Parity is trivial at the formatter level; the fixtures prove the invalid
 * value *content* (code, message, trace) is byte-equal across both paths.
 *
 * AC-FDL-1  : guard fixture
 * AC-FDL-2  : retry<limit: 3> exhausted, 3 guard-caught frames
 * AC-FDL-3  : .! probe variants (valid and invalid)
 * AC-FDL-4  : atom literal / .!code comparison
 * AC-FDL-5  : invalid LHS coerced to default with ??
 * AC-FDL-9  : harness runs as part of pnpm --filter @rcrsr/rill-fiddle test
 * AC-FDL-E1 : formatHalt export present (release gate)
 * AC-FDL-E2 : unregistered atom -> #R001 byte-equal
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  parse,
  createRuntimeContext,
  execute,
  formatHalt,
  isInvalid,
  toNative,
} from '@rcrsr/rill';
import { executeRill } from '../execution.js';

// process.cwd() is packages/fiddle when running via pnpm test
const FIXTURES_DIR = join(
  process.cwd(),
  'src/lib/__tests__/fixtures/error-parity'
);

/**
 * Load a fixture file by name (without extension).
 */
function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, `${name}.rill`), 'utf-8');
}

/**
 * Execute a rill script via the raw @rcrsr/rill API (the "Node side").
 *
 * Returns either formatHalt output (for invalid final values) or a JSON
 * serialised native representation (for valid final values). The Fiddle
 * side uses executeRill which wraps the same pipeline.
 */
async function nodeExecute(source: string): Promise<string> {
  const ast = parse(source);
  const ctx = createRuntimeContext({});
  const { result } = await execute(ast, ctx);
  if (isInvalid(result)) {
    return formatHalt(result);
  }
  // executeRill uses JSON.stringify(nativeResult, null, 2) — match that format
  return JSON.stringify(toNative(result), null, 2);
}

/**
 * Execute a rill script via executeRill (the "Fiddle side").
 *
 * Returns the same text representation as nodeExecute so the two can be
 * compared with a strict equality assertion.
 */
async function fiddleExecute(source: string): Promise<string> {
  const state = await executeRill(source);
  if (state.status === 'error' && state.error !== null) {
    return state.error.message;
  }
  // Success: return the result string (already JSON.stringify'd by executeRill)
  return state.result ?? '';
}

// ============================================================
// AC-FDL-E1: Release gate — formatHalt must be exported
// ============================================================

describe('AC-FDL-E1: release gate', () => {
  it('formatHalt is exported from @rcrsr/rill and is a function', () => {
    expect(typeof formatHalt).toBe('function');
  });
});

// ============================================================
// Parity fixtures
// ============================================================

describe('error-handling parity: Fiddle vs Node', () => {
  // AC-FDL-1: guard fixture
  it('AC-FDL-1: guard { "hello" -> :number } produces byte-equal halt output', async () => {
    const source = loadFixture('guard');
    const nodeSide = await nodeExecute(source);
    const fiddleSide = await fiddleExecute(source);
    expect(fiddleSide).toBe(nodeSide);
    // Confirm the output carries the expected atom name
    expect(nodeSide).toContain('#TYPE_MISMATCH');
  });

  // AC-FDL-2: retry exhausted — exactly 3 guard-caught frames
  it('AC-FDL-2: retry<limit: 3> exhausted renders exactly 3 guard-caught frames, byte-equal', async () => {
    const source = loadFixture('retry-exhausted');
    const nodeSide = await nodeExecute(source);
    const fiddleSide = await fiddleExecute(source);
    expect(fiddleSide).toBe(nodeSide);
    // 3 guard-caught lines in the formatHalt output
    const guardCaughtLines = nodeSide
      .split('\n')
      .filter((l) => l.includes('guard-caught'));
    expect(guardCaughtLines).toHaveLength(3);
    // All guard-caught frames carry fn === "retry"
    for (const line of guardCaughtLines) {
      expect(line).toContain('/retry');
    }
  });

  // AC-FDL-3: .! probe on valid value
  it('AC-FDL-3 (valid probe): 42.! returns false, byte-equal', async () => {
    const source = loadFixture('probe-valid');
    const nodeSide = await nodeExecute(source);
    const fiddleSide = await fiddleExecute(source);
    expect(fiddleSide).toBe(nodeSide);
    // Valid result serialises to native JSON
    const native = JSON.parse(nodeSide) as { value: unknown };
    expect(native.value).toBe(false);
  });

  // AC-FDL-3: .! probe on invalid value
  it('AC-FDL-3 (invalid probe): $invalid.! returns true, byte-equal', async () => {
    const source = loadFixture('probe-invalid');
    const nodeSide = await nodeExecute(source);
    const fiddleSide = await fiddleExecute(source);
    expect(fiddleSide).toBe(nodeSide);
    const native = JSON.parse(nodeSide) as { value: unknown };
    expect(native.value).toBe(true);
  });

  // AC-FDL-4: #TIMEOUT literal identity
  it('AC-FDL-4 (literal): #TIMEOUT == #TIMEOUT returns true, byte-equal', async () => {
    const source = loadFixture('code-literal');
    const nodeSide = await nodeExecute(source);
    const fiddleSide = await fiddleExecute(source);
    expect(fiddleSide).toBe(nodeSide);
    const native = JSON.parse(nodeSide) as { value: unknown };
    expect(native.value).toBe(true);
  });

  // AC-FDL-4: .!code comparison (.!code == #TYPE_MISMATCH)
  it('AC-FDL-4 (conversion): .!code == #TYPE_MISMATCH returns true, byte-equal', async () => {
    const source = loadFixture('code-conversion');
    const nodeSide = await nodeExecute(source);
    const fiddleSide = await fiddleExecute(source);
    expect(fiddleSide).toBe(nodeSide);
    const native = JSON.parse(nodeSide) as { value: unknown };
    expect(native.value).toBe(true);
  });

  // AC-FDL-5: invalid LHS coerced to default with ??
  it('AC-FDL-5: invalid $x ?? "default" returns "default", byte-equal', async () => {
    const source = loadFixture('coerce-invalid');
    const nodeSide = await nodeExecute(source);
    const fiddleSide = await fiddleExecute(source);
    expect(fiddleSide).toBe(nodeSide);
    expect(nodeSide).toContain('default');
  });

  // Nested guard + retry
  it('nested guard { retry<limit: 2> { ... } } byte-equal', async () => {
    const source = loadFixture('nested-guard-retry');
    const nodeSide = await nodeExecute(source);
    const fiddleSide = await fiddleExecute(source);
    expect(fiddleSide).toBe(nodeSide);
    expect(nodeSide).toContain('#TYPE_MISMATCH');
  });

  // AC-FDL-E2: unregistered atom #FOO -> #R001
  it('AC-FDL-E2: unregistered #FOO collapses to #R001, byte-equal', async () => {
    const source = loadFixture('unregistered-atom');
    const nodeSide = await nodeExecute(source);
    const fiddleSide = await fiddleExecute(source);
    expect(fiddleSide).toBe(nodeSide);
    // Result is a valid atom value whose atom name is R001
    const native = JSON.parse(nodeSide) as {
      value: { atom: { name: string } };
    };
    expect(native.value.atom.name).toBe('R001');
  });

  // error-wrap: thrown error (uncatchable) — not an invalid-value halt
  it('error "wrapped" produces a runtime error via the error keyword', async () => {
    const source = loadFixture('error-wrap');
    const state = await executeRill(source);
    expect(state.status).toBe('error');
    expect(state.error).not.toBe(null);
    // The error keyword produces a thrown RuntimeError (not an invalid value)
    // so statusCode is null (convertError path, not convertInvalidValue path).
    expect(state.error?.statusCode).toBe(null);
    expect(state.error?.category).toBe('runtime');
    expect(state.error?.message).toContain('wrapped');
  });
});
