/**
 * Rill Language Tests: Status probe (.! and .!field)
 *
 * Covers (Phase 1, parser-level):
 * - FR-ERR-1/5: Parser recognizes `.!` and `.!field` and produces a
 *   StatusProbeNode wrapping the probed expression.
 *
 * Deferred to Phase 2 (evaluator for StatusProbeNode, task 2.1):
 * - AC-1: `$valid.!` returns `false` at runtime.
 * - AC-2: `$valid.!code` returns `#ok` at runtime.
 * - Field projections against the status sidecar (`.!provider`, `.!message`).
 */

import { describe, expect, it } from 'vitest';
import { createRuntimeContext, execute, parse } from '@rcrsr/rill';
import { resolveAtom } from '../../src/runtime/core/types/atom-registry.js';
import type { RillAtomValue } from '../../src/runtime/core/types/structures.js';

/**
 * Unwraps a script's first statement and returns the head primary of its
 * pipe chain so tests can inspect the parsed node shape directly.
 */
function firstPrimary(source: string): unknown {
  const ast = parse(source);
  const stmt = ast.statements[0];
  if (!stmt || stmt.type !== 'Statement') {
    throw new Error(
      `Expected Statement at index 0, got ${stmt ? stmt.type : 'undefined'}`
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const expr = (stmt as any).expression;
  return expr.head.primary;
}

describe('Status probe (.!): parser', () => {
  describe('Bare probe `.!`', () => {
    it('parses `"value".!` into a StatusProbeNode with no field', () => {
      const primary = firstPrimary('"value".!');
      expect(primary).toMatchObject({
        type: 'StatusProbe',
      });
      // field should be undefined on bare probes
      expect((primary as { field?: string }).field).toBeUndefined();
    });

    it('parses `42.!` into a StatusProbeNode', () => {
      const primary = firstPrimary('42.!');
      expect(primary).toMatchObject({
        type: 'StatusProbe',
      });
    });

    it('wraps a variable target in the probe node', () => {
      // `"x" => $v; $v.!` — second statement carries the probe.
      const ast = parse(`"x" => $v\n$v.!`);
      const second = ast.statements[1];
      expect(second).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const expr = (second as any).expression;
      const primary = expr.head.primary;
      expect(primary.type).toBe('StatusProbe');
      expect(primary.field).toBeUndefined();
      // The probe target should be a pipe chain whose head primary is the
      // variable reference we wrote.
      expect(primary.target.type).toBe('PipeChain');
    });
  });

  describe('Field projection `.!field`', () => {
    it('parses `"x".!code` with field "code"', () => {
      const primary = firstPrimary('"x".!code');
      expect(primary).toMatchObject({
        type: 'StatusProbe',
        field: 'code',
      });
    });

    it('parses `"x".!provider` with field "provider"', () => {
      const primary = firstPrimary('"x".!provider');
      expect(primary).toMatchObject({
        type: 'StatusProbe',
        field: 'provider',
      });
    });

    it('parses `"x".!message` with field "message"', () => {
      const primary = firstPrimary('"x".!message');
      expect(primary).toMatchObject({
        type: 'StatusProbe',
        field: 'message',
      });
    });
  });
});

// ============================================================
// PHASE 2 DEFERRED (evaluator for StatusProbeNode)
// ============================================================

describe('Status probe runtime (Phase 2)', () => {
  it('AC-1: `$valid.!` returns false on a valid value', async () => {
    // Runtime StatusProbe dispatch landed in Phase 2.2. Bare `.!` reports
    // false on valid values (per recovery.ts evaluateStatusProbe).
    const ast = parse('"hello".!');
    const ctx = createRuntimeContext({});
    const { result } = await execute(ast, ctx);
    expect(result).toBe(false);
  });

  it('AC-2: `$valid.!code` returns #ok on a valid value', async () => {
    // `.!code` reads the status sidecar's atom; a valid value's code is
    // the `#ok` sentinel from the frozen empty-status singleton.
    const ast = parse('"hello".!code');
    const ctx = createRuntimeContext({});
    const { result } = await execute(ast, ctx);
    expect((result as RillAtomValue).atom).toBe(resolveAtom('ok'));
  });

  it('`.!message` reads sidecar message as a string (empty on valid)', async () => {
    // Valid values share the frozen empty-status singleton whose message
    // is the empty string. The probe bypasses the access-halt gate and
    // materialises the sidecar field directly.
    const ast = parse('"hello".!message');
    const ctx = createRuntimeContext({});
    const { result } = await execute(ast, ctx);
    expect(result).toBe('');
  });
});
