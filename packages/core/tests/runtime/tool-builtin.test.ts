/**
 * Rill Runtime Tests: tool() Built-in
 * Tests for tool() built-in function that creates tool descriptors
 *
 * Specification Mapping (conduct/specifications/phase-1-core-type-system.md):
 *
 * Happy Path Criteria:
 * - AC-7: tool() creates tool descriptor from closure with name, description, params, fn
 * - AC-8: tool("host_fn::name") creates tool descriptor from host function metadata
 * - AC-30: Missing description on host function uses empty string
 * - AC-31: Missing params on host function uses empty dict
 *
 * Error Cases:
 * - EC-27: Host function not found -> RuntimeError RILL-R004: "function '{name}' not found"
 * - EC-28: Invalid argument combination -> RuntimeError RILL-R001: "tool() invalid arguments"
 */

import { describe, expect, it } from 'vitest';
import { run } from '../helpers/runtime.js';
import type { RillError } from '@rcrsr/rill';

describe('Rill Runtime: tool() Built-in', () => {
  describe('Happy Path Tests', () => {
    describe('AC-7: tool() creates tool descriptor from closure', () => {
      it('creates descriptor with all fields from closure', async () => {
        const result = await run(`
          tool("greet", "Greets user", [name: "string"], |name| { "Hello " + $name })
        `) as Record<string, unknown>;

        expect(result.name).toBe('greet');
        expect(result.description).toBe('Greets user');
        expect(result.params).toEqual({ name: 'string' });
        expect(result.fn).toBeDefined();
        expect(typeof result.fn).toBe('object');
      });

      it('creates descriptor with empty params dict', async () => {
        const result = await run(`
          tool("noop", "Does nothing", [:], || { "done" })
        `) as Record<string, unknown>;

        expect(result.name).toBe('noop');
        expect(result.description).toBe('Does nothing');
        expect(result.params).toEqual({});
        expect(result.fn).toBeDefined();
      });

      it('creates descriptor with multi-param closure', async () => {
        const result = await run(`
          tool("add", "Adds numbers", [a: "number", b: "number"], |a, b| { $a + $b })
        `) as Record<string, unknown>;

        expect(result.name).toBe('add');
        expect(result.description).toBe('Adds numbers');
        expect(result.params).toEqual({ a: 'number', b: 'number' });
        expect(result.fn).toBeDefined();
      });
    });

    describe('AC-8: tool() creates descriptor from host function metadata', () => {
      it('creates descriptor from host function with metadata', async () => {
        const result = await run(
          `tool("greet::user")`,
          {
            functions: {
              'greet::user': {
                params: [
                  { name: 'name', type: 'string', description: 'User name' },
                ],
                fn: (args) => `Hello, ${args[0]}!`,
                description: 'Greets a user by name',
              },
            },
          }
        ) as Record<string, unknown>;

        expect(result.name).toBe('greet::user');
        expect(result.description).toBe('Greets a user by name');
        expect(result.params).toEqual({
          name: {
            type: 'string',
            description: 'User name',
          },
        });
        expect(result.fn).toBeDefined();
      });

      it('creates descriptor from namespaced host function', async () => {
        const result = await run(
          `tool("math::add")`,
          {
            functions: {
              'math::add': {
                params: [
                  { name: 'a', type: 'number', description: 'First number' },
                  { name: 'b', type: 'number', description: 'Second number' },
                ],
                fn: (args) => (args[0] as number) + (args[1] as number),
                description: 'Adds two numbers',
              },
            },
          }
        ) as Record<string, unknown>;

        expect(result.name).toBe('math::add');
        expect(result.description).toBe('Adds two numbers');
        expect(result.params).toEqual({
          a: { type: 'number', description: 'First number' },
          b: { type: 'number', description: 'Second number' },
        });
        expect(result.fn).toBeDefined();
      });

      it('merges overrides into host function metadata', async () => {
        const result = await run(
          `tool("greet::user", [description: "Custom greeting"])`,
          {
            functions: {
              'greet::user': {
                params: [{ name: 'name', type: 'string' }],
                fn: (args) => `Hello, ${args[0]}!`,
                description: 'Original description',
              },
            },
          }
        ) as Record<string, unknown>;

        expect(result.name).toBe('greet::user');
        expect(result.description).toBe('Custom greeting'); // Override applied
      });

      it('merges params override into host function metadata', async () => {
        const result = await run(
          `tool("greet::user", [params: [custom: "any"]])`,
          {
            functions: {
              'greet::user': {
                params: [{ name: 'name', type: 'string' }],
                fn: (args) => `Hello, ${args[0]}!`,
                description: 'Greets user',
              },
            },
          }
        ) as Record<string, unknown>;

        expect(result.name).toBe('greet::user');
        expect(result.params).toEqual({ custom: 'any' }); // Override replaced params
      });
    });

    describe('AC-30: Missing description on host function uses empty string', () => {
      it('uses empty string when host function has no description', async () => {
        const result = await run(
          `tool("undocumented::fn")`,
          {
            functions: {
              'undocumented::fn': {
                params: [],
                fn: () => 'result',
                // No description provided
              },
            },
          }
        ) as Record<string, unknown>;

        expect(result.name).toBe('undocumented::fn');
        expect(result.description).toBe(''); // Empty string for missing description
      });
    });

    describe('AC-31: Missing params on host function uses empty dict', () => {
      it('uses empty dict when host function has no params', async () => {
        const result = await run(
          `tool("simple::fn")`,
          {
            functions: {
              'simple::fn': {
                params: [], // Empty array instead of undefined
                fn: () => 'result',
                description: 'A simple function',
              },
            },
          }
        ) as Record<string, unknown>;

        expect(result.name).toBe('simple::fn');
        expect(result.params).toEqual({}); // Empty dict for missing params
      });
    });
  });

  describe('Error Cases', () => {
    describe('EC-27: Host function not found', () => {
      it('throws RILL-R004 when host function does not exist', async () => {
        await expect(run(`tool("nonexistent::fn")`)).rejects.toThrow(
          "function 'nonexistent::fn' not found"
        );
      });

      it('throws RILL-R004 with correct error code', async () => {
        try {
          await run(`tool("missing::func")`);
          expect.fail('Should have thrown error');
        } catch (error: unknown) {
          expect((error as RillError).errorId).toBe('RILL-R004');
        }
      });
    });

    describe('EC-28: Invalid argument combination', () => {
      it('throws RILL-R001 when called with zero arguments', async () => {
        await expect(run(`tool()`)).rejects.toThrow('tool() invalid arguments');
      });

      it('throws RILL-R001 when called with 3 arguments', async () => {
        await expect(run(`tool("a", "b", "c")`)).rejects.toThrow(
          'tool() invalid arguments'
        );
      });

      it('throws RILL-R001 when 4th argument is not callable', async () => {
        await expect(
          run(`tool("name", "desc", [:], "not-a-closure")`)
        ).rejects.toThrow('tool() invalid arguments');
      });

      it('throws RILL-R001 when first arg is not namespaced string', async () => {
        await expect(run(`tool("no-separator")`)).rejects.toThrow(
          'tool() invalid arguments'
        );
      });

      it('throws RILL-R001 when overrides is not a dict', async () => {
        await expect(
          run(`tool("fn::name", "not-a-dict")`, {
            functions: {
              'fn::name': {
                params: [],
                fn: () => 'test',
              },
            },
          })
        ).rejects.toThrow('tool() invalid arguments');
      });

      it('throws RILL-R001 with correct error code', async () => {
        try {
          await run(`tool()`);
          expect.fail('Should have thrown error');
        } catch (error: unknown) {
          expect((error as RillError).errorId).toBe('RILL-R001');
        }
      });
    });
  });
});
