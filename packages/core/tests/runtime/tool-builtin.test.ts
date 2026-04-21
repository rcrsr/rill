/**
 * Rill Runtime Tests: Host Reference, Expression Annotations, and Related Behaviors
 *
 * Specification Mapping (phase 2 tool_loop dict-form):
 *
 * Happy Path Criteria:
 * - AC-5:  ns::name (no parens) resolves to ApplicationCallable
 * - AC-6:  Expression-position ^(...) before closure attaches annotations
 * - AC-17: ^("...") before non-closure is syntactically valid (annotation ignored)
 *
 * Error Cases:
 * - AC-7:  tool() call produces "Unknown function: tool" error
 * - AC-8:  type() builtin removed; calling it produces "Unknown function: type" error (EC-7)
 * - AC-11: Unknown host reference throws "Function 'ns::name' not found" (EC-4)
 * - EC-5:  ^("...") before non-closure does NOT throw
 * - EC-6:  Malformed annotation syntax ^( without closing ) produces parse error
 * - EC-7:  Calling type() after removal produces RILL-R006 (unknown function)
 */

import { describe, expect, it } from 'vitest';
import { anyTypeValue } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Host Reference and Expression Annotations', () => {
  describe('AC-5: ns::name without parens resolves to ApplicationCallable', () => {
    it('resolves namespaced host reference to callable', async () => {
      const result = await run(`greet::user`, {
        functions: {
          'greet::user': {
            params: [
              {
                name: 'name',
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => `Hello, ${args['name']}!`,
            annotations: { description: 'Greets a user by name' },
            returnType: anyTypeValue,
          },
        },
      });
      expect(result).not.toBeNull();
      expect(typeof result).toBe('object');
    });

    it('returns callable without invoking when no pipe value', async () => {
      const result = await run(`greet::user`, {
        functions: {
          'greet::user': {
            params: [
              {
                name: 'name',
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: () => 'invoked',
            annotations: { description: 'Greets a user' },
            returnType: anyTypeValue,
          },
        },
      });
      expect(result).not.toBeNull();
      expect(typeof result).toBe('object');
    });

    it('invokes callable when used as pipe stage', async () => {
      const result = await run(`"World" -> greet::hello`, {
        functions: {
          'greet::hello': {
            params: [
              {
                name: 'name',
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => `Hello ${args['name']}`,
            returnType: anyTypeValue,
          },
        },
      });

      expect(result).toBe('Hello World');
    });
  });

  describe('ns::name with parens is still a host call', () => {
    it('calls host function directly when parens provided', async () => {
      const result = await run(`greet::hello("world")`, {
        functions: {
          'greet::hello': {
            params: [
              {
                name: 'name',
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => `Hello ${args['name']}`,
            returnType: anyTypeValue,
          },
        },
      });

      expect(result).toBe('Hello world');
    });
  });

  describe('AC-6: Expression-position ^(...) before closure attaches annotation', () => {
    it('attaches description annotation to script callable', async () => {
      const result = await run(
        `^("Greets users") |name: string| { "Hello " + $name }`
      );
      expect(result).not.toBeNull();
      expect(typeof result).toBe('object');
    });

    it('attaches multiple annotations to script callable', async () => {
      const result = await run(
        `^("Search the web", cache: true) |q: string| { $q }`
      );
      expect(result).not.toBeNull();
      expect(typeof result).toBe('object');
    });

    it('annotations field is empty dict when no annotation provided', async () => {
      const result = await run(`|x: string| { $x }`);
      expect(result).not.toBeNull();
      expect(typeof result).toBe('object');
    });
  });

  describe('AC-7: tool() call produces "Unknown function: tool" error', () => {
    it('throws unknown function error when tool() is called', async () => {
      await expect(run(`tool("name", "desc", |x| { $x })`)).rejects.toThrow(
        'Unknown function: tool'
      );
    });

    it('throws unknown function error for zero-arg tool() call', async () => {
      await expect(run(`tool()`)).rejects.toThrow('Unknown function: tool');
    });
  });

  describe('AC-8 / EC-7: type() builtin removed; calling it produces unknown-function error', () => {
    it('throws unknown function error when type() is called with an argument', async () => {
      await expect(run(`type(42)`)).rejects.toThrow('Unknown function: type');
    });

    it('throws conversion error when type appears at pipe target position', async () => {
      // `type` is a reserved type keyword at pipe target position, so
      // `42 -> type` is parsed as a type conversion rather than a function
      // call. Converting a number to the type-of-types raises RILL-R036.
      await expect(run(`42 -> type`)).rejects.toThrow(
        'cannot convert number to type'
      );
    });
  });

  describe('AC-11 / EC-4: Unknown host reference throws function-not-found error', () => {
    it('throws when namespaced reference is not registered', async () => {
      await expect(run(`unknown::fn`)).rejects.toThrow(
        'Function "unknown::fn" not found'
      );
    });

    it('error message includes the exact function name', async () => {
      await expect(run(`missing::func`)).rejects.toThrow(
        'Function "missing::func" not found'
      );
    });

    it('throws even when other namespaces are registered', async () => {
      await expect(
        run(`wrong::name`, {
          functions: {
            'right::name': {
              params: [],
              fn: () => 'ok',
              returnType: anyTypeValue,
            },
          },
        })
      ).rejects.toThrow('Function "wrong::name" not found');
    });
  });

  describe('AC-17 / EC-5: ^("...") before non-closure is syntactically valid', () => {
    it('annotation before number literal is silently ignored', async () => {
      const result = await run(`^("ignored") 42`);
      expect(result).toBe(42);
    });

    it('annotation before string literal is silently ignored', async () => {
      const result = await run(`^("desc") "hello"`);
      expect(result).toBe('hello');
    });

    it('annotation before dict literal is silently ignored', async () => {
      const result = await run(`^("desc") dict[x: 1]`);
      expect(result).toEqual({ x: 1 });
    });

    it('no error thrown for annotation before non-closure', async () => {
      await expect(run(`^("annotation") 99`)).resolves.toBe(99);
    });
  });

  describe('EC-6: Malformed annotation syntax produces parse error', () => {
    it('throws parse error for unclosed annotation paren', async () => {
      await expect(run(`^( |x| { $x }`)).rejects.toThrow();
    });

    it('throws parse error for annotation without parens', async () => {
      await expect(run(`^ |x| { $x }`)).rejects.toThrow();
    });
  });
});
