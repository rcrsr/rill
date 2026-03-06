/**
 * Rill Language Tests: List Dispatch
 * Tests for list literal as index-based dispatch table when piped.
 *
 * Feature: Phase 1 list dispatch (task 1.3)
 * Covers: AC-19, AC-20, AC-21, AC-32, EC-15, EC-16
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Language: List Dispatch', () => {
  // ============================================================
  // BASIC INDEX DISPATCH - keyword [ form (AC-19)
  // ============================================================

  describe('basic index dispatch with [...] form (AC-19)', () => {
    it('index 0 returns first element', async () => {
      const result = await run('0 -> ["first", "second"]');
      expect(result).toBe('first');
    });

    it('index 1 returns second element', async () => {
      const result = await run('1 -> ["first", "second"]');
      expect(result).toBe('second');
    });

    it('dispatches numeric values', async () => {
      const result = await run('0 -> [10, 20, 30]');
      expect(result).toBe(10);
    });

    it('dispatches boolean values', async () => {
      const result = await run('1 -> [true, false]');
      expect(result).toBe(false);
    });
  });

  // ============================================================
  // NEGATIVE INDEX (AC-20)
  // ============================================================

  describe('negative index (AC-20)', () => {
    it('-1 returns last element ([ form)', async () => {
      const result = await run('-1 -> ["a", "b", "c"]');
      expect(result).toBe('c');
    });

    it('-2 returns second-to-last element ([ form)', async () => {
      const result = await run('-2 -> ["a", "b", "c"]');
      expect(result).toBe('b');
    });

    it('-1 with two elements returns second ([ form)', async () => {
      const result = await run('-1 -> ["x", "y"]');
      expect(result).toBe('y');
    });
  });

  // ============================================================
  // DEFAULT VALUE (AC-21) - [ form with ?? coalesce
  // ============================================================

  describe('default value with ?? (AC-21)', () => {
    it('out-of-bounds index with ?? returns default value', async () => {
      const result = await run('5 -> ["a", "b"] ?? "default"');
      expect(result).toBe('default');
    });

    it('in-bounds index ignores ?? default', async () => {
      const result = await run('0 -> ["found"] ?? "default"');
      expect(result).toBe('found');
    });

    it('negative out-of-bounds with ?? returns default', async () => {
      const result = await run('-5 -> ["a", "b"] ?? "fallback"');
      expect(result).toBe('fallback');
    });
  });

  // ============================================================
  // ERROR CONTRACTS
  // ============================================================

  describe('error contracts', () => {
    it('throws runtime error when index out of bounds without ?? (AC-32, EC-16)', async () => {
      await expect(run('2 -> ["a", "b"]')).rejects.toThrow(
        /index.*out of range/i
      );
    });

    it('throws runtime error when index is a float (EC-15)', async () => {
      await expect(run('1.5 -> ["a", "b"]')).rejects.toThrow(/integer/i);
    });

    it('throws runtime error when index is a string (EC-15)', async () => {
      await expect(run('"0" -> ["a", "b"]')).rejects.toThrow(/integer/i);
    });

    it('throws runtime error when index is a boolean (EC-15)', async () => {
      await expect(run('true -> ["a", "b"]')).rejects.toThrow(/integer/i);
    });
  });
});
