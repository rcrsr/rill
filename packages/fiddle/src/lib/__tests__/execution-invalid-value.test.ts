/**
 * Tests for executeRill invalid-value detection and FiddleError shape
 *
 * AC-FDL-6 : executeRill routes an invalid final value to status === 'error'
 *            with statusCode, statusMessage, statusProvider, statusTrace.
 * AC-FDL-8 : statusTrace carries N >= 1 frames; each frame has kind, site, fn.
 */

import { describe, it, expect } from 'vitest';
import { executeRill } from '../execution.js';

describe('executeRill invalid-value detection', () => {
  // ============================================================
  // AC-FDL-6: invalid final value routes to error status
  // ============================================================

  describe('AC-FDL-6: invalid final value', () => {
    it('guard-caught invalid produces status error (not success)', async () => {
      // guard catches the type-assertion halt and returns an invalid value
      // as the script's final result. executeRill must detect isInvalid and
      // route to the error path.
      const state = await executeRill('guard { "hello" -> :number }');

      expect(state.status).toBe('error');
      expect(state.result).toBe(null);
      expect(state.error).not.toBe(null);
    });

    it('statusCode carries the bare atom name (no # sigil)', async () => {
      const state = await executeRill('guard { "hello" -> :number }');

      expect(state.error?.statusCode).toBe('TYPE_MISMATCH');
    });

    it('statusMessage carries the halt message text', async () => {
      const state = await executeRill('guard { "hello" -> :number }');

      expect(state.error?.statusMessage).toBeTruthy();
      expect(typeof state.error?.statusMessage).toBe('string');
    });

    it('statusProvider carries the provider string', async () => {
      const state = await executeRill('guard { "hello" -> :number }');

      // provider is set to 'runtime' by the type-assertion mixin
      expect(typeof state.error?.statusProvider).toBe('string');
    });

    it('statusTrace is a non-null array with N >= 1 frames', async () => {
      const state = await executeRill('guard { "hello" -> :number }');

      expect(state.error?.statusTrace).not.toBe(null);
      expect(Array.isArray(state.error?.statusTrace)).toBe(true);
      expect((state.error?.statusTrace ?? []).length).toBeGreaterThanOrEqual(1);
    });

    it('category is runtime for invalid-value halts', async () => {
      const state = await executeRill('guard { "hello" -> :number }');

      expect(state.error?.category).toBe('runtime');
    });

    it('errorId is null for invalid-value halts (no RILL-R code applies)', async () => {
      const state = await executeRill('guard { "hello" -> :number }');

      expect(state.error?.errorId).toBe(null);
    });

    it('message equals formatHalt output (DEC-8)', async () => {
      // executeRill uses formatHalt internally; the message field must be
      // the same string that formatHalt produces for the same invalid value.
      const state = await executeRill('guard { "hello" -> :number }');

      expect(state.error?.message).toContain('#TYPE_MISMATCH');
      // formatHalt format: "#CODE: message\n  kind site/fn"
      expect(state.error?.message).toContain('guard-caught');
    });

    it('valid final value is NOT routed to the error path', async () => {
      // AC-FDL-B1: valid result must use the success renderer
      const state = await executeRill('42');

      expect(state.status).toBe('success');
      expect(state.error).toBe(null);
      expect(state.result).not.toBe(null);
    });
  });

  // ============================================================
  // AC-FDL-8: statusTrace frame shape
  // ============================================================

  describe('AC-FDL-8: statusTrace frame shape', () => {
    it('each trace frame has kind, site, and fn fields', async () => {
      const state = await executeRill('guard { "hello" -> :number }');

      const trace = state.error?.statusTrace;
      expect(trace).not.toBe(null);
      expect(trace).toBeDefined();

      for (const frame of trace!) {
        expect(typeof frame.kind).toBe('string');
        expect(frame.kind.length).toBeGreaterThan(0);
        expect(typeof frame.site).toBe('string');
        expect(typeof frame.fn).toBe('string');
      }
    });

    it('guard-caught frame has kind === "guard-caught"', async () => {
      const state = await executeRill('guard { "hello" -> :number }');

      const trace = state.error?.statusTrace ?? [];
      const guardFrame = trace.find((f) => f.kind === 'guard-caught');
      expect(guardFrame).toBeDefined();
      expect(guardFrame?.fn).toBe('guard');
    });

    it('retry<3> exhausted trace has exactly 3 guard-caught frames', async () => {
      const state = await executeRill('retry<3> { "x" -> :number }');

      const trace = state.error?.statusTrace ?? [];
      const guardCaught = trace.filter((f) => f.kind === 'guard-caught');
      expect(guardCaught).toHaveLength(3);
      for (const frame of guardCaught) {
        expect(frame.fn).toBe('retry');
      }
    });

    it('trace with N >= 1 frames (N frames from single guard)', async () => {
      // Single guard produces at least 1 frame (the guard-caught frame)
      // plus any inner frames from the halting expression.
      const state = await executeRill('guard { "hello" -> :number }');

      const trace = state.error?.statusTrace ?? [];
      expect(trace.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================
  // Thrown errors must NOT be confused with invalid-value halts
  // ============================================================

  describe('convertError vs convertInvalidValue routing', () => {
    it('error "msg" keyword produces statusCode === null (thrown, not invalid)', async () => {
      const state = await executeRill('error "boom"');

      expect(state.status).toBe('error');
      expect(state.error).not.toBe(null);
      // Thrown error: convertError path, not convertInvalidValue
      expect(state.error?.statusCode).toBe(null);
      expect(state.error?.statusTrace).toBe(null);
    });

    it('runtime type error (unguarded) produces statusCode === null', async () => {
      // Unguarded type assertion throws RuntimeError, not RuntimeHaltSignal
      const state = await executeRill('"string" + 5');

      expect(state.status).toBe('error');
      expect(state.error?.statusCode).toBe(null);
      expect(state.error?.category).toBe('runtime');
    });

    it('invalid final value produces statusCode !== null (invalid-value path)', async () => {
      // Guard catches and returns invalid — convertInvalidValue path
      const state = await executeRill('guard { "hello" -> :number }');

      expect(state.error?.statusCode).not.toBe(null);
    });
  });
});
