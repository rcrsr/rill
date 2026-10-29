/**
 * Rill Runtime Tests: Host Reference and Expression Annotations
 *
 * Covers:
 * - ns::name (no parens) resolves to an ApplicationCallable
 * - Expression-position ^(...) before a closure attaches annotations
 * - ^("...") before a non-closure is syntactically valid and ignored
 * - Unknown host reference halts with a function-not-found error
 * - Malformed annotation syntax produces a parse error
 * - `42 -> type` is a type conversion, not a function call
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  isApplicationCallable,
  isScriptCallable,
  ParseError,
} from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { expectHalt, expectThrowMessage } from '../helpers/halt.js';

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
      expect(isApplicationCallable(result)).toBe(true);
      if (!isApplicationCallable(result)) return;
      expect(result.annotations['description']).toBe('Greets a user by name');
    });

    it('returns callable without invoking when no pipe value', async () => {
      let invocations = 0;
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
            fn: () => {
              invocations += 1;
              return 'invoked';
            },
            annotations: { description: 'Greets a user' },
            returnType: anyTypeValue,
          },
        },
      });
      expect(isApplicationCallable(result)).toBe(true);
      if (!isApplicationCallable(result)) return;
      expect(result.annotations['description']).toBe('Greets a user');
      expect(invocations).toBe(0);
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
      expect(isScriptCallable(result)).toBe(true);
      if (!isScriptCallable(result)) return;
      expect(result.annotations).toEqual({ description: 'Greets users' });
    });

    it('attaches multiple annotations to script callable', async () => {
      const result = await run(
        `^("Search the web", cache: true) |q: string| { $q }`
      );
      expect(isScriptCallable(result)).toBe(true);
      if (!isScriptCallable(result)) return;
      expect(result.annotations).toEqual({
        description: 'Search the web',
        cache: true,
      });
    });

    it('annotations field is empty dict when no annotation provided', async () => {
      const result = await run(`|x: string| { $x }`);
      expect(isScriptCallable(result)).toBe(true);
      if (!isScriptCallable(result)) return;
      expect(result.annotations).toEqual({});
    });
  });

  describe('type keyword at pipe target position', () => {
    it('throws conversion error when type appears at pipe target position', async () => {
      // `type` is a reserved type keyword at pipe target position, so
      // `42 -> type` is parsed as a type conversion rather than a function
      // call. Converting a number to the type-of-types raises RILL-R036.
      await expectHalt(() => run(`42 -> type`), {
        code: 'RILL_R036',
        hostErrorId: 'RILL-R036',
        messagePattern: 'cannot convert number to type',
      });
    });
  });

  describe('AC-11 / EC-4: Unknown host reference throws function-not-found error', () => {
    it('throws when namespaced reference is not registered', async () => {
      await expectHalt(() => run(`unknown::fn`), {
        code: 'RILL_R006',
        hostErrorId: 'RILL-R006',
        messagePattern: 'Function "unknown::fn" not found',
      });
    });

    it('error message includes the exact function name', async () => {
      await expectHalt(() => run(`missing::func`), {
        code: 'RILL_R006',
        hostErrorId: 'RILL-R006',
        messagePattern: 'Function "missing::func" not found',
      });
    });

    it('throws even when other namespaces are registered', async () => {
      await expectHalt(
        () =>
          run(`wrong::name`, {
            functions: {
              'right::name': {
                params: [],
                fn: () => 'ok',
                returnType: anyTypeValue,
              },
            },
          }),
        {
          code: 'RILL_R006',
          hostErrorId: 'RILL-R006',
          messagePattern: 'Function "wrong::name" not found',
        }
      );
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
      await expectThrowMessage(
        () => run(`^( |x| { $x }`),
        'Expected annotation name',
        ParseError
      );
    });

    it('throws parse error for annotation without parens', async () => {
      await expectThrowMessage(
        () => run(`^ |x| { $x }`),
        'Expected (',
        ParseError
      );
    });
  });
});
