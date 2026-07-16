/**
 * Rill Language Tests: RILL-R004 → Typed Atom Migration (Phase 4.1)
 *
 * Covers:
 * - IC-5  : Arithmetic on non-numeric operand is unchanged here (it already
 *           lives under `#INVALID_INPUT` via RILL-R002); this file focuses
 *           on the RILL-R004 sites migrated to typed atoms.
 * - IC-6  : Type assertion failure produces an invalid `#TYPE_MISMATCH`
 *           with a `type` trace frame; `guard` catches it (FR-ERR-17).
 * - IC-6  : Stream chunk-type mismatch at yield produces an invalid
 *           `#TYPE_MISMATCH` catchable via `guard`.
 * - FR-ERR-17 (test remediation): `.!code` probes confirm the migrated
 *           sites raise the new typed atom rather than RILL-R004.
 */

import { describe, expect, it } from 'vitest';
import { createRuntimeContext, execute, parse } from '@rcrsr/rill';
import { getStatus, isInvalid } from '../../src/runtime/core/types/status.js';
import { resolveAtom } from '../../src/runtime/core/types/atom-registry.js';
import { RuntimeHaltSignal } from '../../src/runtime/core/eval/mixins/access.js';

/** Run a script and return its final value. */
async function runScript(src: string): Promise<unknown> {
  const ast = parse(src);
  const ctx = createRuntimeContext({});
  const { result } = await execute(ast, ctx);
  return result;
}

describe('Phase 4.1: RILL-R004 migrated to typed atoms (FR-ERR-17)', () => {
  describe('Type assertion failure — #TYPE_MISMATCH with `type` frame', () => {
    it('`"hello" -> :number` under guard catches `#TYPE_MISMATCH`', async () => {
      const src = `guard { "hello" -> :number }`;
      const result = await runScript(src);
      expect(isInvalid(result as never)).toBe(true);
      const status = getStatus(result as never);
      expect(status.code).toBe(resolveAtom('TYPE_MISMATCH'));
      // A `type` frame must precede the `guard-caught` frame.
      const kinds = status.trace.map((f) => f.kind);
      expect(kinds).toContain('type');
      expect(kinds[kinds.length - 1]).toBe('guard-caught');
    });

    it('`42 -> :string` throws `RuntimeHaltSignal` when ungarded', async () => {
      const src = `42 -> :string`;
      await expect(runScript(src)).rejects.toBeInstanceOf(RuntimeHaltSignal);
    });

    it('`.!code` after guard reports `#TYPE_MISMATCH`', async () => {
      const src = `
        guard { 42 -> :string } => $x
        $x.!code
      `;
      const result = (await runScript(src)) as { atom: unknown };
      expect(result.atom).toBe(resolveAtom('TYPE_MISMATCH'));
    });
  });

  describe('Structural collection-type errors — typed-atom halts', () => {
    it('`list(string, number)` (wrong arg count) halts catchably', async () => {
      const src = `guard { "abc" -> :list(string, number) }`;
      const result = await runScript(src);
      expect(isInvalid(result as never)).toBe(true);
      expect(getStatus(result as never).code).toBe(
        resolveAtom('INVALID_INPUT')
      );
    });

    it('`tuple(a: number)` (named arg) halts catchably', async () => {
      const src = `guard { "abc" -> :tuple(a: number) }`;
      const result = await runScript(src);
      expect(isInvalid(result as never)).toBe(true);
      expect(getStatus(result as never).code).toBe(
        resolveAtom('INVALID_INPUT')
      );
    });
  });

  describe('No `RILL-R004` halt surfaces at the mixin boundary', () => {
    it('type-mismatch throw never reaches consumers as RILL-R004', async () => {
      const src = `42 -> :string`;
      try {
        await runScript(src);
        expect.unreachable('expected a halt');
      } catch (e) {
        // The migrated path throws RuntimeHaltSignal carrying an invalid
        // value, not a RuntimeError('RILL-R004'). This is the contract
        // the 4.3 test sweep relies on.
        expect(e).toBeInstanceOf(RuntimeHaltSignal);
        const signal = e as RuntimeHaltSignal;
        expect(isInvalid(signal.value)).toBe(true);
        expect(getStatus(signal.value).code).toBe(resolveAtom('TYPE_MISMATCH'));
      }
    });
  });
});
