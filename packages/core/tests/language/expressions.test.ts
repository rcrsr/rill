/**
 * Rill Runtime Tests: Expressions
 * Tests for pipes, methods, and function calls
 */

import { describe, expect, it } from 'vitest';

import { createLogCollector, run } from '../helpers/runtime.js';

describe('Rill Runtime: Expressions', () => {
  describe('Pipe Chains', () => {
    it('evaluates single pipe', async () => {
      expect(await run('"x" -> identity')).toBe('x');
    });

    it('evaluates multiple pipes', async () => {
      expect(await run('"x" -> identity -> identity')).toBe('x');
    });

    it('pipes to block', async () => {
      expect(await run('"x" -> { $ }')).toBe('x');
    });

    it('pipes to conditional', async () => {
      expect(await run('true -> ? { "yes" } ! { "no" }')).toBe('yes');
    });

    it('chains pipes with transformations', async () => {
      expect(await run('"hello" -> { "world" } -> { $ }')).toBe('world');
    });

    it('preserves value through identity chain', async () => {
      expect(await run('"test" -> identity -> identity -> identity')).toBe(
        'test'
      );
    });
  });

  describe('Method Calls', () => {
    it('calls method on literal', async () => {
      expect(await run('"hello" -> .contains("ell")')).toBe(true);
    });

    it('calls method on variable', async () => {
      expect(await run('"hello" => $s\n$s -> .contains("x")')).toBe(false);
    });

    it('chains methods', async () => {
      // Chain log() (passthrough) with .contains
      const { logs, callbacks } = createLogCollector();
      expect(
        await run('"hello" -> log -> .contains("ell")', { callbacks })
      ).toBe(true);
      expect(logs).toEqual(['hello']);
    });

    it('uses method in pipe', async () => {
      expect(await run('"hello" -> .contains("o")')).toBe(true);
    });

    it('uses $ with method in block', async () => {
      // Note: .method at statement start requires explicit $ ->
      expect(await run('"hello" -> { $ -> .contains("o") }')).toBe(true);
    });

    it('calls method with no args', async () => {
      expect(await run('"" -> .empty')).toBe(true);
    });

    it('calls method with argument', async () => {
      expect(await run('"a-b-c" -> .contains("-")')).toBe(true);
    });
  });

  describe('Function Calls', () => {
    it('calls function with pipe as implicit arg', async () => {
      expect(await run('"x" -> identity')).toBe('x');
    });

    it('calls function with explicit arg', async () => {
      expect(await run('identity("x")')).toBe('x');
    });

    it('calls method with arg', async () => {
      expect(await run('["a", "b"] -> .join("-")')).toBe('a-b');
    });

    it('chains methods', async () => {
      expect(await run('123 -> .str -> .len')).toBe(3);
    });

    it('calls custom function', async () => {
      const double = {
        params: [{ name: 'n', type: 'number' }],
        fn: (args: unknown[]): number => {
          const n = args[0] as number;
          return n * 2;
        },
      };
      expect(await run('5 -> double', { functions: { double } })).toBe(10);
    });

    it('calls async custom function', async () => {
      const asyncFn = {
        params: [{ name: 'input', type: 'string' }],
        fn: async (args: unknown[]): Promise<string> => {
          await new Promise((r) => setTimeout(r, 10));
          return `async:${args[0]}`;
        },
      };
      expect(await run('"test" -> asyncFn', { functions: { asyncFn } })).toBe(
        'async:test'
      );
    });
  });

  describe('Complex Expressions', () => {
    it('combines pipes, methods, and functions', async () => {
      expect(await run('"hello world" -> .contains("world")')).toBe(true);
    });

    it('uses method result in method chain', async () => {
      expect(await run('["a", "b", "c"] -> .join(",") -> .contains("b")')).toBe(
        true
      );
    });

    it('pipes through multiple transformations', async () => {
      const { logs, callbacks } = createLogCollector();
      expect(
        await run('"hello" -> log -> { $ } -> .contains("ell")', { callbacks })
      ).toBe(true);
      expect(logs).toEqual(['hello']);
    });
  });
});
