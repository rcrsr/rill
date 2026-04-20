/**
 * Rill Language Tests: Vacancy coerce (??)
 *
 * Covers (Phase 1, reachable runtime behavior):
 * - AC-6: `$x ?? default` on a non-empty valid `$x` returns `$x`.
 * - Parser recognizes `??` at general-expression precedence and allows
 *   composition with the existence check `.?` (the `.?` / `??` mutex was
 *   removed in task 1.4).
 *
 * Deferred to Phase 2 (task 2.2, full vacancy trigger runtime):
 * - Vacancy trigger on invalid values (status.code != #ok).
 * - Full empty-value trigger widened from legacy null-only handling.
 *   See default-value-operator.test.ts for existing dict-missing-field
 *   cases that already work via the null-returning access path.
 *
 * This suite adds positive language-level tests for new `??` behavior
 * that are fully reachable in Phase 1.
 */

import { describe, expect, it } from 'vitest';
import { createRuntimeContext, execute, parseWithRecovery } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

describe('Vacancy coerce (??) — Phase 1 reachable behavior', () => {
  describe('AC-6: valid non-empty LHS passes through', () => {
    it('returns the string literal when LHS is a non-empty string', async () => {
      const result = await run('"value" ?? "default"');
      expect(result).toBe('value');
    });

    it('returns the number when LHS is a non-zero number', async () => {
      const result = await run('42 ?? 0');
      expect(result).toBe(42);
    });

    it('returns the bool when LHS is true', async () => {
      const result = await run('true ?? false');
      expect(result).toBe(true);
    });

    it('returns the variable value when the variable holds a non-empty string', async () => {
      const result = await run(`
        "hello" => $x
        $x ?? "default"
      `);
      expect(result).toBe('hello');
    });

    it('returns the variable value when the variable holds a populated list', async () => {
      const result = await run(`
        list[1, 2, 3] => $x
        $x ?? list[0]
      `);
      expect(result).toEqual([1, 2, 3]);
    });

    it('returns the variable value when the variable holds a populated dict', async () => {
      const result = await run(`
        dict[a: 1] => $data
        $data ?? dict[fallback: 0]
      `);
      expect(result).toEqual({ a: 1 });
    });
  });

  describe('Precedence and composition', () => {
    it('allows chaining after the default via parentheses', async () => {
      // Existing behavior verified in default-value-operator.test.ts;
      // reiterate here to anchor the precedence expectation.
      const result = await run(`
        dict[name: "test"] => $data
        ($data.status ?? "unknown") -> .upper
      `);
      expect(result).toBe('UNKNOWN');
    });

    it('parses `.?field ?? default` without error (mutex removed in task 1.4)', async () => {
      // Prior to task 1.4 the parser rejected composing `.?` with `??`.
      // With the mutex removed, the combined form parses. `.?field` returns
      // a boolean (existence check), so the Phase 1 evaluator returns that
      // boolean unchanged when the left side is non-null. Full vacancy
      // semantics that fold `.?`/`??` into an invalid-then-default chain
      // land in Phase 2 task 2.2.
      const present = await run(`
        dict[status: "active"] => $data
        $data.?status ?? "fallback"
      `);
      expect(present).toBe(true);

      const absent = await run(`
        dict[name: "test"] => $data
        $data.?status ?? "fallback"
      `);
      expect(absent).toBe(false);
    });
  });
});

// ============================================================
// PHASE 2 DEFERRED (full vacancy trigger runtime, task 2.2)
// ============================================================

describe('Vacancy coerce full semantics (Phase 2)', () => {
  it('substitutes default when LHS carries invalid status', async () => {
    // Task 2.2: widen `??` trigger from null-only to cover invalid
    // values (status.code != #ok) for bare variables. Uses
    // parseWithRecovery to produce an invalid value in rill source:
    // the malformed atom `#AB0x` (lexer accepts, parser rejects strict
    // shape) becomes a RecoveryErrorNode that execute() materialises
    // as an invalid #R001 value.
    const src = '#AB0x => $x\n$x ?? "fallback"';
    const parsed = parseWithRecovery(src);
    const ctx = createRuntimeContext({});
    const result = await execute(parsed.ast, ctx);
    expect(result.result).toBe('fallback');
  });

  it.skip('substitutes default when LHS is an empty string (widened trigger)', () => {
    // Gated by pipe-target disambiguation: widening bare-variable `??`
    // for empty valid primitives would short-circuit the pipe
    // dispatcher path (AC-19: `0 -> $empty_list ?? "default"` relies
    // on dispatcher consuming `target.defaultValue` after receiving
    // the empty collection). Lifting this requires distinguishing
    // pipe-target position from expression position on VariableNode,
    // tracked separately from task 2.2.
  });
});
