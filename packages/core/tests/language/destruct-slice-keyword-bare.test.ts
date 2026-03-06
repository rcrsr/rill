/**
 * Rill Language Tests: destruct<> and slice<> Keyword Forms
 * Tests for the keyword-prefixed destructure and slice pipe targets.
 *
 * Feature: Phase 1 keyword extraction operators (task 1.2)
 * Covers: AC-7, AC-8, AC-9, AC-10, AC-41, AC-42, AC-43, EC-6, EC-7, EC-8, EC-9
 *
 * IMPLEMENTATION NOTE on destruct<>:
 * The destruct<> keyword form parses correctly to a DestructNode
 * but the evaluatePipeTarget() switch in core.ts is missing the
 * 'Destruct' case. The evaluateDestruct() method exists in
 * ExtractionMixin but is not wired up.
 *
 * destruct<> tests are skipped pending that wire-up and are
 * documented as a known bug (BUG-1 in Implementation Notes).
 *
 * slice<> is fully functional and tested below.
 */

import { describe, expect, it } from 'vitest';
import { parse, ParseError } from '@rcrsr/rill';

import { run, runWithContext } from '../helpers/runtime.js';

describe('Rill Language: destruct<> and slice<> Keyword Forms', () => {
  // ============================================================
  // slice<> - FULLY IMPLEMENTED
  // ============================================================

  describe('slice<start:stop> keyword form (AC-8)', () => {
    it('returns elements at indices 1, 2, 3 for slice<1:4>', async () => {
      const result = await run(
        '[1, 2, 3, 4, 5] => $data\n$data -> slice<1:4>'
      );
      expect(result).toEqual([2, 3, 4]);
    });

    it('slices from beginning with :stop', async () => {
      const result = await run(
        '[1, 2, 3, 4, 5] => $data\n$data -> slice<:3>'
      );
      expect(result).toEqual([1, 2, 3]);
    });

    it('slices to end with start:', async () => {
      const result = await run(
        '[1, 2, 3, 4, 5] => $data\n$data -> slice<2:>'
      );
      expect(result).toEqual([3, 4, 5]);
    });
  });

  describe('slice<-1:> returns last element (AC-9)', () => {
    it('slice<-1:> returns the last element as a list', async () => {
      const result = await run(
        '[1, 2, 3, 4, 5] => $data\n$data -> slice<-1:>'
      );
      expect(result).toEqual([5]);
    });

    it('slice<-2:> returns last two elements', async () => {
      const result = await run(
        '[1, 2, 3, 4, 5] => $data\n$data -> slice<-2:>'
      );
      expect(result).toEqual([4, 5]);
    });
  });

  describe('slice<:> full range is valid (AC-41)', () => {
    it('slice<:> returns a copy of the full list', async () => {
      const result = await run('[1, 2, 3] => $data\n$data -> slice<:>');
      expect(result).toEqual([1, 2, 3]);
    });

    it('slice<:> on empty list returns empty', async () => {
      const result = await run('[] => $data\n$data -> slice<:>');
      expect(result).toEqual([]);
    });
  });

  describe('slice<0:0> returns empty collection (AC-42)', () => {
    it('slice<0:0> produces empty list', async () => {
      const result = await run('[1, 2, 3] => $data\n$data -> slice<0:0>');
      expect(result).toEqual([]);
    });
  });

  describe('slice parse errors', () => {
    it('throws ParseError for slice<> with no colon (EC-8)', () => {
      expect(() => parse('[1,2,3] => $d\n$d -> slice<1>')).toThrow(
        ParseError
      );
    });

    it('throws ParseError for unclosed slice< (EC-9)', () => {
      expect(() => parse('[1,2,3] => $d\n$d -> slice<1:')).toThrow(
        ParseError
      );
    });
  });

  // ============================================================
  // destruct<> - PARSE VERIFIED, EVALUATION SKIPPED (BUG-1)
  // ============================================================

  describe('destruct<> parse validation', () => {
    it('destruct<$a, $b, $c> parses without error', () => {
      // Verify the keyword form parses correctly even though
      // evaluation is not yet wired up.
      expect(() =>
        parse('[1, 2, 3] => $data\n$data -> destruct<$a, $b, $c>')
      ).not.toThrow();
    });

    it('destruct<$a, _, $c> parses without error', () => {
      expect(() =>
        parse('[1, 2, 3] => $data\n$data -> destruct<$a, _, $c>')
      ).not.toThrow();
    });

    it('destruct<_> with only skip target parses (AC-43)', () => {
      expect(() =>
        parse('[1] => $data\n$data -> destruct<_>')
      ).not.toThrow();
    });

    it('throws ParseError for unclosed destruct< (EC-6)', () => {
      expect(() => parse('[1, 2] => $d\n$d -> destruct<$a')).toThrow(
        ParseError
      );
    });

    it('throws ParseError for expression in destruct (EC-7, AC-31)', () => {
      // destruct<$a + 1> is not valid — only variable names and _ allowed
      expect(() => parse('[1, 2] => $d\n$d -> destruct<$a + 1>')).toThrow(
        ParseError
      );
    });
  });

  describe('destruct<> evaluation', () => {
    it('destruct<$a, $b> binds first two elements (AC-7)', async () => {
      const { context } = await runWithContext(
        '[10, 20, 30] => $data\n$data -> destruct<$a, $b, $c>'
      );
      expect(context.variables.get('a')).toBe(10);
      expect(context.variables.get('b')).toBe(20);
      expect(context.variables.get('c')).toBe(30);
    });

    it('destruct<$a, _, $c> skips the second element (AC-10)', async () => {
      const { context } = await runWithContext(
        '[10, 20, 30] => $data\n$data -> destruct<$a, _, $c>'
      );
      expect(context.variables.get('a')).toBe(10);
      expect(context.variables.get('c')).toBe(30);
      expect(context.variables.has('_')).toBe(false);
    });

    it('destruct returns original input unchanged', async () => {
      const result = await run(
        '[1, 2, 3] => $data\n$data -> destruct<$a, $b, $c>'
      );
      expect(result).toEqual([1, 2, 3]);
    });

    it('destruct<_> with only skip target is valid (AC-43)', async () => {
      const result = await run('[42] => $data\n$data -> destruct<_>');
      expect(result).toEqual([42]);
    });
  });
});
