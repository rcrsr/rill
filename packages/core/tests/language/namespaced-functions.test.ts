/**
 * Rill Runtime Tests: Namespaced Functions
 * Tests for namespace::function syntax
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Namespaced Functions', () => {
  describe('Basic namespace::func() syntax', () => {
    it('calls single-level namespaced function', async () => {
      const result = await run('math::double(21)', {
        functions: {
          'math::double': {
            params: [
              {
                name: 'x',
                type: { kind: 'number' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => (args['x'] as number) * 2,
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
              {
                name: 'a',
                type: { kind: 'number' },
                defaultValue: undefined,
                annotations: {},
              },
              {
                name: 'b',
                type: { kind: 'number' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => (args['a'] as number) + (args['b'] as number),
          },
        },
      });
      expect(result).toBe(3);
    });

    it('calls three-level namespaced function', async () => {
      const result = await run('org::pkg::mod::func("test")', {
        functions: {
          'org::pkg::mod::func': {
            params: [
              {
                name: 'input',
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => `called:${args['input']}`,
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
            params: [
              {
                name: 'input',
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => String(args['input']).toUpperCase(),
          },
        },
      });
      expect(result).toBe('HELLO');
    });

    it('pipes to two-level namespace without parens', async () => {
      const result = await run('10 -> math::ops::square', {
        functions: {
          'math::ops::square': {
            params: [
              {
                name: 'x',
                type: { kind: 'number' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => (args['x'] as number) ** 2,
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
              {
                name: 'a',
                type: { kind: 'number' },
                defaultValue: undefined,
                annotations: {},
              },
              {
                name: 'b',
                type: { kind: 'number' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => (args['a'] as number) + (args['b'] as number),
          },
          double: {
            params: [
              {
                name: 'x',
                type: { kind: 'number' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => (args['x'] as number) * 2,
          },
        },
      });
      expect(result).toBe(6);
    });

    it('chains namespaced functions', async () => {
      const result = await run('5 -> math::double -> math::double', {
        functions: {
          'math::double': {
            params: [
              {
                name: 'x',
                type: { kind: 'number' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => (args['x'] as number) * 2,
          },
        },
      });
      expect(result).toBe(20);
    });

    it('uses namespaced function in conditional', async () => {
      const result = await run('check::positive(5) ? "yes" ! "no"', {
        functions: {
          'check::positive': {
            params: [
              {
                name: 'x',
                type: { kind: 'number' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => (args['x'] as number) > 0,
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
              {
                name: 'sep',
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
              {
                name: 'a',
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
              {
                name: 'b',
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
              {
                name: 'c',
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => {
              const sep = String(args['sep']);
              const items = [args['a'], args['b'], args['c']].map(String);
              return items.join(sep);
            },
          },
        },
      });
      expect(result).toBe('a, b, c');
    });

    it('auto-prepends pipe value as first arg', async () => {
      // IR-8: pipe value auto-prepends at position 0 when no bare $ is in args.
      // str::pad receives ("hello", 10, "-") matching (str, len, char).
      const result = await run('"hello" -> str::pad(10, "-")', {
        functions: {
          'str::pad': {
            params: [
              {
                name: 'str',
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
              {
                name: 'len',
                type: { kind: 'number' },
                defaultValue: undefined,
                annotations: {},
              },
              {
                name: 'char',
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => {
              const str = String(args['str']);
              const len = args['len'] as number;
              const char = String(args['char'] ?? ' ');
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
            params: [
              {
                name: 'varName',
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args, ctx) => ctx.variables.get(String(args['varName'])) ?? '',
          },
        },
      });
      expect(result).toBe('Alice');
    });

    it('namespaced function can be async', async () => {
      const result = await run('io::delay(10)', {
        functions: {
          'io::delay': {
            params: [
              {
                name: 'ms',
                type: { kind: 'number' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: async (args) => {
              await new Promise((r) => setTimeout(r, args['ms'] as number));
              return 'done';
            },
          },
        },
      });
      expect(result).toBe('done');
    });
  });
});
