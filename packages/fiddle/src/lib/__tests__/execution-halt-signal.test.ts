/**
 * Tests for an escaped RuntimeHaltSignal reaching executeRill's catch path
 *
 * RuntimeHaltSignal exposes errorId as a prototype getter, so it must be
 * handled by the halt branch rather than the RillError-shaped branch.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as rill from '@rcrsr/rill';
import { executeRill } from '../execution.js';

// ============================================================
// HELPERS
// ============================================================

/** Build a real RuntimeHaltSignal around an invalid value the runtime produced. */
async function buildHaltSignal(): Promise<rill.RuntimeHaltSignal> {
  const ctx = rill.createRuntimeContext({});
  const executed = await rill.execute(
    rill.parse('guard { "hello" -> :number }'),
    ctx
  );
  return new rill.RuntimeHaltSignal(executed.result, false);
}

// ============================================================
// TESTS
// ============================================================

describe('executeRill escaped RuntimeHaltSignal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes an escaped halt through the halt branch with status fields', async () => {
    const halt = await buildHaltSignal();
    vi.spyOn(rill, 'execute').mockRejectedValue(halt);

    const state = await executeRill('1');

    expect(state.status).toBe('error');
    expect(state.error?.errorId).toBeNull();
    expect(state.error?.category).toBe('runtime');
    expect(state.error?.message).toBeTruthy();
    expect(state.error?.statusCode).toBe('TYPE_MISMATCH');
    expect(state.error?.statusMessage).toBeTruthy();
  });
});
