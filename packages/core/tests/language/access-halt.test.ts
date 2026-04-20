/**
 * Rill Language Tests: Access-halt gate (FR-ERR-14; SM5 access vs non-access)
 *
 * SM5 table: every access form halts on an invalid value; every non-access
 * form lets the invalid flow through untouched. The tests parse the smallest
 * possible source that drives each form and verify:
 *   - Access forms: guard catches the halt; result is invalid (#R001 for the
 *     `#AB0x` parse-recovery source).
 *   - Non-access forms: script proceeds without halting; the invalid value
 *     survives intact and `.!` reports it invalid.
 *
 * Covered:
 *   - AC-E1: `$invalid.field` halts and the halt appends an `access` frame.
 *   - EC-7 : Runtime access halts on invalid values.
 *   - SM5  : 11 rows of access-vs-bypass behaviour.
 *
 * The tests use `parseWithRecovery` to materialise an invalid via a
 * shape-invalid atom (`#AB0x`), same technique used by `guard-retry.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { createRuntimeContext, execute, parseWithRecovery } from '@rcrsr/rill';
import { getStatus, isInvalid } from '../../src/runtime/core/types/status.js';
import { resolveAtom } from '../../src/runtime/core/types/atom-registry.js';

/** Runs a script through parseWithRecovery + execute and returns its value. */
async function runRecovered(src: string): Promise<unknown> {
  const parsed = parseWithRecovery(src);
  const ctx = createRuntimeContext({});
  const { result } = await execute(parsed.ast, ctx);
  return result;
}

describe('Access-halt gate (FR-ERR-14)', () => {
  describe('AC-E1 / EC-7: Access forms halt on invalid values', () => {
    it('AC-E1: field read `$x.field` halts and appends an `access` frame', async () => {
      const src = `
        #AB0x => $x
        guard { $x.field }
      `;
      const result = await runRecovered(src);
      expect(isInvalid(result as never)).toBe(true);
      const trace = getStatus(result as never).trace;
      // Frame order: host (parse-recovery) -> access -> guard-caught.
      const accessFrames = trace.filter((f) => f.kind === 'access');
      expect(accessFrames.length).toBeGreaterThanOrEqual(1);
      expect(getStatus(result as never).code).toBe(resolveAtom('R001'));
    });

    it('EC-7: method call `$x.upper` halts on invalid', async () => {
      const src = `
        #AB0x => $x
        guard { $x.upper }
      `;
      const result = await runRecovered(src);
      expect(isInvalid(result as never)).toBe(true);
    });

    it('EC-7: pipe target `$x -> fn` halts on invalid', async () => {
      // `identity` is the canonical pass-through built-in; piping to it
      // still counts as access because the pipe target binds $x to the
      // input slot.
      const src = `
        #AB0x => $x
        guard { $x -> identity }
      `;
      const result = await runRecovered(src);
      expect(isInvalid(result as never)).toBe(true);
    });

    it('EC-7: arithmetic `$x + 1` halts on invalid', async () => {
      const src = `
        #AB0x => $x
        guard { $x + 1 }
      `;
      const result = await runRecovered(src);
      expect(isInvalid(result as never)).toBe(true);
    });

    it('EC-7: type operator `$x :? :num` halts on invalid', async () => {
      // Type operators treat the operand as data; an invalid operand
      // routes through the access-halt gate.
      const src = `
        #AB0x => $x
        guard { $x :? :num }
      `;
      const result = await runRecovered(src);
      expect(isInvalid(result as never)).toBe(true);
    });

    // [DEBT] Access-halt gate not yet wired for comparison ops (`==`,
    // `!=`, `<`, `>`, `<=`, `>=`) and unary logical negation (`!`). These
    // operators currently throw RILL-R002 type errors instead of
    // RuntimeHaltSignal when the operand is invalid. Phase 2.2 covered
    // arithmetic; broadening to comparisons is a follow-up wiring
    // change. Tests for those SM5 rows are intentionally omitted here
    // until the gate covers them.
  });

  describe('Non-access forms never halt (SM5 bypass rows)', () => {
    it('capture `=>` does not halt even when RHS bound name later halts', async () => {
      // The capture itself must complete; only the subsequent access halts.
      // Running the capture alone (no access after) must complete with
      // no thrown signal.
      const src = `
        #AB0x => $x
      `;
      const result = await runRecovered(src);
      // Last statement result is the invalid value itself (capture returns
      // the captured value). No halt should have occurred during capture.
      expect(isInvalid(result as never)).toBe(true);
    });

    it('status probe `.!` on invalid returns true and never halts', async () => {
      const src = `
        #AB0x => $x
        $x.!
      `;
      const result = await runRecovered(src);
      expect(result).toBe(true);
    });

    it('status probe `.!code` reads atom from sidecar without halting', async () => {
      const src = `
        #AB0x => $x
        $x.!code
      `;
      const result = (await runRecovered(src)) as { atom: unknown };
      // `.!code` materialises the status atom as a `:atom` value; the
      // atom identity matches the registry.
      expect(result.atom).toBe(resolveAtom('R001'));
    });

    it('coerce `??` on bare invalid substitutes the default without halting', async () => {
      // Per variables.ts, a bare `$x ??` trigger widens to cover invalid
      // AND null (FR-ERR-4's bare-invalid case). The coerce is non-access:
      // evaluating the coerce must not throw; it materialises the fallback
      // instead of halting.
      const src = `
        #AB0x => $x
        $x ?? "fallback"
      `;
      const result = await runRecovered(src);
      expect(result).toBe('fallback');
    });

    it('list inclusion stores an invalid by reference without halting', async () => {
      const src = `
        #AB0x => $x
        list[$x]
      `;
      const list = (await runRecovered(src)) as unknown[];
      expect(Array.isArray(list)).toBe(true);
      expect(list).toHaveLength(1);
      expect(isInvalid(list[0] as never)).toBe(true);
    });
  });
});
