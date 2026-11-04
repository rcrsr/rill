/**
 * Rill Language Tests: Pass Keyword Runtime Behavior
 * Tests for pass keyword evaluation in various contexts
 */

import { describe, expect, it } from 'vitest';

import { ParseError } from '@rcrsr/rill';
import { expectHalt } from '../helpers/halt.js';
import { run } from '../helpers/runtime.js';

describe('Rill Language: Pass Keyword', () => {
  describe('Pass in Dict Values', () => {
    it('pass as dict value in block context (AC-10)', async () => {
      const result = await run('"success" -> { dict["status": pass] }');
      expect(result).toEqual({ status: 'success' });
    });

    it('handles multiple independent pass values in block (AC-16)', async () => {
      const result = await run('"test" -> { dict[a: pass, b: pass] }');
      expect(result).toEqual({ a: 'test', b: 'test' });
    });

    it('pass in nested dict within block', async () => {
      const result = await run('42 -> { dict[result: dict[value: pass]] }');
      expect(result).toEqual({ result: { value: 42 } });
    });
  });

  describe('Pass in Conditionals', () => {
    it('returns piped value when pass in then branch (AC-11)', async () => {
      const result = await run(
        '"input" -> .contains("in") ? pass ! "fallback"'
      );
      expect(result).toBe('input');
    });

    it('returns piped value when pass in else branch', async () => {
      const result = await run(
        '"input" -> .contains("out") ? "primary" ! pass'
      );
      expect(result).toBe('input');
    });

    it('preserves piped value through conditional', async () => {
      const result = await run('"data" -> .contains("data") ? pass ! "error"');
      expect(result).toBe('data');
    });

    it('handles nested conditional with pass (AC-17)', async () => {
      const result = await run('5 -> ($ > 0) ? (($ < 10) ? pass ! 10) ! 0');
      expect(result).toBe(5);
    });

    it('handles nested conditional with pass in outer else', async () => {
      const result = await run('15 -> ($ > 0) ? (($ < 10) ? pass ! 10) ! 0');
      expect(result).toBe(10);
    });

    it('handles nested conditional falling through to outer else', async () => {
      const result = await run('-5 -> ($ > 0) ? (($ < 10) ? pass ! 10) ! 0');
      expect(result).toBe(0);
    });
  });

  describe('Pass in Collection Operators', () => {
    it('preserves matching items in map (AC-12)', async () => {
      const result = await run(
        'list[1, -2, 3, -4] -> fan({ ($ > 0) ? pass ! 0 })'
      );
      expect(result).toEqual([1, 0, 3, 0]);
    });

    it('preserves items in each', async () => {
      const result = await run('list[10, 20, 30] -> seq({ pass })');
      expect(result).toEqual([10, 20, 30]);
    });

    it('uses pass in a conditional inside seq', async () => {
      const result = await run('list[1, 2, 3] -> seq({ ($ > 1) ? pass ! 0 })');
      expect(result).toEqual([0, 2, 3]);
    });
  });

  describe('Pass as Dispatch Value', () => {
    it('returns piped value when pass as dispatch value (AC-18)', async () => {
      const result = await run(
        '"match" -> dict["match": pass, "other": "value"]'
      );
      expect(result).toBe('match');
    });

    it('returns piped value for different key', async () => {
      const result = await run(
        '"other" -> dict["match": "found", "other": pass]'
      );
      expect(result).toBe('other');
    });

    it('handles pass in dispatch with multiple keys', async () => {
      const result = await run(
        '"key2" -> dict["key1": "val1", "key2": pass, "key3": "val3"]'
      );
      expect(result).toBe('key2');
    });
  });

  describe('Pass Standalone', () => {
    it('throws error when pass used without pipe context', async () => {
      await expect(run('pass')).rejects.toThrow("Variable '$' not defined");
    });

    it('preserves piped value through pass in block', async () => {
      const result = await run('"hello" -> { pass }');
      expect(result).toBe('hello');
    });

    it('chains pass expressions in block', async () => {
      const result = await run('42 -> { pass }');
      expect(result).toBe(42);
    });
  });

  describe('Pass with Variables', () => {
    it('captures pass result from block', async () => {
      const result = await run('"test" -> { pass } => $x\n$x');
      expect(result).toBe('test');
    });

    it('uses pass in variable assignment chain with block', async () => {
      const result = await run(
        '"value" => $a\n$a -> { pass } => $b\nlist[$a, $b]'
      );
      expect(result).toEqual(['value', 'value']);
    });
  });

  describe('Pass in Blocks', () => {
    it('returns piped value from block', async () => {
      const result = await run('"data" -> { pass }');
      expect(result).toBe('data');
    });

    it('returns last pass in block', async () => {
      const result = await run('"value" -> { "ignored" => $x\npass }');
      expect(result).toBe('value');
    });

    it('uses pass in multi-statement block', async () => {
      const result = await run(
        '10 -> { $ => $original\n($ * 2) => $doubled\n($ > 5) ? pass ! $doubled }'
      );
      expect(result).toBe(10);
    });
  });

  describe('Error Cases', () => {
    // `-> pass` is rejected at parse time before any call, method or field
    // access on pass is reached: a piped `pass` requires a body block.
    it.each([
      ['"x" -> pass()', 8],
      ['"x" -> pass("arg")', 8],
      ['"x" -> pass.method', 8],
      ['"x" -> pass.field', 8],
      ['"value" -> pass -> .field', 12],
    ])('rejects %s with RILL-P004 at column %i', async (script, column) => {
      const err = await run(script).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ParseError);
      const e = err as ParseError;
      expect(e.errorId).toBe('RILL-P004');
      expect(e.location?.line).toBe(1);
      expect(e.location?.column).toBe(column);
    });

    it('throws error when using pass in arithmetic without pipe', async () => {
      await expectHalt(() => run('pass + 1'), {
        code: 'RILL_R005',
        hostErrorId: 'RILL-R005',
        messagePattern: "Variable '$' not defined",
      });
    });

    it('throws error when using pass in comparison without pipe', async () => {
      await expectHalt(() => run('pass == 1'), {
        code: 'RILL_R005',
        hostErrorId: 'RILL-R005',
        messagePattern: "Variable '$' not defined",
      });
    });

    it('throws error when pass used in dict without pipe context', async () => {
      await expect(run('dict["key": pass]')).rejects.toThrow("Variable '$'");
    });

    it('throws error when pass used in conditional without pipe', async () => {
      await expect(run('true ? pass ! "no"')).rejects.toThrow("Variable '$'");
    });
  });

  describe('Pass Edge Cases', () => {
    it('handles pass with empty string', async () => {
      const result = await run('"" -> { pass }');
      expect(result).toBe('');
    });

    it('handles pass with zero', async () => {
      const result = await run('0 -> { pass }');
      expect(result).toBe(0);
    });

    it('handles pass with false', async () => {
      const result = await run('false -> { pass }');
      expect(result).toBe(false);
    });

    it('handles pass with empty list', async () => {
      const result = await run('list[] => $list\n$list -> { pass }');
      expect(result).toEqual([]);
    });

    it('handles pass with empty dict', async () => {
      const result = await run('dict[] -> { pass }');
      expect(result).toEqual({});
    });

    it('handles pass in nested dicts within block', async () => {
      const result = await run('"val" -> { dict[outer: dict[inner: pass]] }');
      expect(result).toEqual({ outer: { inner: 'val' } });
    });

    it('handles pass in list within dict within block', async () => {
      const result = await run('"item" -> { dict[items: list[pass, pass]] }');
      expect(result).toEqual({ items: ['item', 'item'] });
    });
  });
});
