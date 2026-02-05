/**
 * Rill Runtime Tests: Namespaced Functions
 * Tests for namespace::function syntax
 */

import type { HostFunctionDefinition } from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Namespaced Functions', () => {
  describe('Basic namespace::func() syntax', () => {
    it('calls single-level namespaced function', async () => {
      const result = await run('math::double(21)', {
        functions: {
          'math::double': {
            params: [{ name: 'x', type: 'number' }],
            fn: (args) => (args[0] as number) * 2,
          },
        },
      });
      expect(result).toBe(42);
    });

    it('calls two-level namespaced function', async () => {
      const result = await run('std::math::add(1, 2)', {
        functions: {
          'std::math::add': {
            params: [
              { name: 'a', type: 'number' },
              { name: 'b', type: 'number' },
            ],
            fn: (args) => (args[0] as number) + (args[1] as number),
          },
        },
      });
      expect(result).toBe(3);
    });

    it('calls three-level namespaced function', async () => {
      const result = await run('org::pkg::mod::func("test")', {
        functions: {
          'org::pkg::mod::func': {
            params: [{ name: 'input', type: 'string' }],
            fn: (args) => `called:${args[0]}`,
          },
        },
      });
      expect(result).toBe('called:test');
    });
  });

  describe('Bare namespace::func as pipe target', () => {
    it('pipes to namespaced function without parens', async () => {
      const result = await run('"hello" -> str::upper', {
        functions: {
          'str::upper': {
            params: [{ name: 'input', type: 'string' }],
            fn: (args) => String(args[0]).toUpperCase(),
          },
        },
      });
      expect(result).toBe('HELLO');
    });

    it('pipes to two-level namespace without parens', async () => {
      const result = await run('10 -> math::ops::square', {
        functions: {
          'math::ops::square': {
            params: [{ name: 'x', type: 'number' }],
            fn: (args) => (args[0] as number) ** 2,
          },
        },
      });
      expect(result).toBe(100);
    });
  });

  describe('Mixed syntax', () => {
    it('mixes regular and namespaced functions', async () => {
      const result = await run('math::add(1, 2) -> double', {
        functions: {
          'math::add': {
            params: [
              { name: 'a', type: 'number' },
              { name: 'b', type: 'number' },
            ],
            fn: (args) => (args[0] as number) + (args[1] as number),
          },
          double: {
            params: [{ name: 'x', type: 'number' }],
            fn: (args) => (args[0] as number) * 2,
          },
        },
      });
      expect(result).toBe(6);
    });

    it('chains namespaced functions', async () => {
      const result = await run('5 -> math::double -> math::double', {
        functions: {
          'math::double': {
            params: [{ name: 'x', type: 'number' }],
            fn: (args) => (args[0] as number) * 2,
          },
        },
      });
      expect(result).toBe(20);
    });

    it('uses namespaced function in conditional', async () => {
      const result = await run('check::positive(5) ? "yes" ! "no"', {
        functions: {
          'check::positive': {
            params: [{ name: 'x', type: 'number' }],
            fn: (args) => (args[0] as number) > 0,
          },
        },
      });
      expect(result).toBe('yes');
    });
  });

  describe('With arguments', () => {
    it('passes multiple arguments to namespaced function', async () => {
      const result = await run('str::join(", ", "a", "b", "c")', {
        functions: {
          'str::join': {
            params: [
              { name: 'sep', type: 'string' },
              { name: 'a', type: 'string' },
              { name: 'b', type: 'string' },
              { name: 'c', type: 'string' },
            ],
            fn: (args) => {
              const sep = String(args[0]);
              const items = args.slice(1).map(String);
              return items.join(sep);
            },
          },
        },
      });
      expect(result).toBe('a, b, c');
    });

    it('passes pipe value via context', async () => {
      // Pipe value is available via ctx.pipeValue, not prepended to args
      const result = await run('"hello" -> str::pad(10, "-")', {
        functions: {
          'str::pad': {
            params: [
              { name: 'len', type: 'number' },
              { name: 'char', type: 'string' },
            ],
            fn: (args, ctx) => {
              const str = String(ctx.pipeValue);
              const len = args[0] as number;
              const char = String(args[1] ?? ' ');
              return str.padEnd(len, char);
            },
          },
        },
      });
      expect(result).toBe('hello-----');
    });
  });

  describe('Context and async', () => {
    it('namespaced function receives context', async () => {
      const result = await run('ctx::getVar("name")', {
        variables: { name: 'Alice' },
        functions: {
          'ctx::getVar': {
            params: [{ name: 'varName', type: 'string' }],
            fn: (args, ctx) => ctx.variables.get(String(args[0])) ?? '',
          },
        },
      });
      expect(result).toBe('Alice');
    });

    it('namespaced function can be async', async () => {
      const result = await run('io::delay(10)', {
        functions: {
          'io::delay': {
            params: [{ name: 'ms', type: 'number' }],
            fn: async (args) => {
              await new Promise((r) => setTimeout(r, args[0] as number));
              return 'done';
            },
          },
        },
      });
      expect(result).toBe('done');
    });
  });
});
