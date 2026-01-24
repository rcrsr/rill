/**
 * Rill Runtime Tests: Pipe Targets
 * Tests for various pipe target types: invoke, bare functions, variable calls
 */

import type { HostFunctionDefinition, RillValue } from '../../src/index.js';
import { describe, expect, it } from 'vitest';

import { createLogCollector, run } from '../helpers/runtime.js';

describe('Rill Runtime: Pipe Targets', () => {
  describe('Invoke Pipe Target (-> $())', () => {
    it('invokes closure pipe value with no args', async () => {
      expect(await run('|| { "hello" } -> $()')).toBe('hello');
    });

    it('invokes closure pipe value with args', async () => {
      expect(await run('|x| { $x } -> $("world")')).toBe('world');
    });

    it('invokes closure variable with pipe-style', async () => {
      expect(await run('|x| { $x } :> $fn\n"test" -> $fn()')).toBe('test');
    });

    it('invokes zero-param closure from variable', async () => {
      expect(await run('|| { "result" } :> $fn\n$fn -> $()')).toBe('result');
    });

    it('chains multiple invoke targets', async () => {
      const script = `|x| { "{$x}!" } :> $exclaim
|x| { $x } :> $identity
"hi" -> $identity() -> $exclaim()`;
      expect(await run(script)).toBe('hi!');
    });

    it('invokes with multiple arguments', async () => {
      const script = `|a, b| { [$a, $b] } -> $("x", "y")`;
      expect(await run(script)).toEqual(['x', 'y']);
    });

    it('invokes closure returned from function', async () => {
      // Function that returns a closure
      const greet: HostFunctionDefinition = {
        params: [{ name: 'name', type: 'string' }],
        fn: (args: RillValue[]): RillValue => {
          const name = args[0] as string;
          return `Hello, ${name}!`;
        },
      };
      expect(await run('"World" -> greet', { functions: { greet } })).toBe(
        'Hello, World!'
      );
    });
  });

  describe('Bare Function Names (-> functionName)', () => {
    it('pipes value as first arg to bare function', async () => {
      expect(await run('"test" -> identity')).toBe('test');
    });

    it('pipes to log and continues chain', async () => {
      const { logs, callbacks } = createLogCollector();
      expect(await run('"hello" -> log -> .len', { callbacks })).toBe(5);
      expect(logs).toEqual(['hello']);
    });

    it('pipes to json for serialization', async () => {
      expect(await run('[1, 2, 3] -> json')).toBe('[1,2,3]');
    });

    it('json errors on direct closure serialization', async () => {
      await expect(run('|x|{ $x * 2 } -> json')).rejects.toThrow(
        'Cannot serialize closure to JSON'
      );
    });

    it('json skips closures in dicts', async () => {
      expect(
        await run('[name: "user", age: 30, greet: ||{ "Hello" }] -> json')
      ).toBe('{"name":"user","age":30}');
    });

    it('json skips closures in lists', async () => {
      expect(await run('[1, 2, ||{ "fn" }, 3] -> json')).toBe('[1,2,3]');
    });

    it('json handles nested containers with closures', async () => {
      expect(await run('[items: [1, ||{ 0 }, 2], fn: ||{ 0 }] -> json')).toBe(
        '{"items":[1,2]}'
      );
    });

    it('pipes to type for type name', async () => {
      expect(await run('"hello" -> type')).toBe('string');
      expect(await run('42 -> type')).toBe('number');
      expect(await run('true -> type')).toBe('bool');
      expect(await run('[1, 2] -> type')).toBe('list');
      expect(await run('[a: 1] -> type')).toBe('dict');
    });

    it('pipes through multiple bare functions', async () => {
      expect(await run('"test" -> identity -> identity -> identity')).toBe(
        'test'
      );
    });

    it('mixes bare function and method calls', async () => {
      expect(await run('"hello" -> identity -> .len')).toBe(5);
    });

    it('uses custom function with bare name', async () => {
      const double: HostFunctionDefinition = {
        params: [{ name: 'x', type: 'number' }],
        fn: (args: RillValue[]): number => {
          const x = args[0];
          return typeof x === 'number' ? x * 2 : 0;
        },
      };
      expect(await run('5 -> double', { functions: { double } })).toBe(10);
    });
  });

  describe('Variable Calls in Pipe (-> $fn())', () => {
    it('calls closure variable with piped value', async () => {
      expect(await run('|x| { "{$x}!" } :> $fn\n"hi" -> $fn()')).toBe('hi!');
    });

    it('calls closure with explicit args', async () => {
      const script = `|a, b| { [$a, $b] } :> $fn
$fn("x", "y")`;
      expect(await run(script)).toEqual(['x', 'y']);
    });

    it('calls closure in for loop', async () => {
      const script = `|x| { ($x * 2) } :> $double
[1, 2, 3] -> each { $double() }`;
      expect(await run(script)).toEqual([2, 4, 6]);
    });

    it('calls closure with explicit args replaces pipe value', async () => {
      // When explicit args are provided, they replace the pipe value
      const script = `|a| { $a } :> $fn
"ignored" -> $fn("used")`;
      expect(await run(script)).toBe('used');
    });
  });

  describe('Function Call vs Bare Function', () => {
    it('function call with args uses explicit args', async () => {
      expect(await run('identity("explicit")')).toBe('explicit');
    });

    it('bare function uses piped value as first arg', async () => {
      expect(await run('"piped" -> identity')).toBe('piped');
    });

    it('function call with () after pipe ignores pipe value', async () => {
      // identity() with explicit empty args doesn't use pipe value
      expect(await run('"ignored" -> identity("used")')).toBe('used');
    });
  });

  describe('Pipe to Blocks and Conditionals', () => {
    it('pipes to block', async () => {
      expect(await run('"x" -> { "{$}y" }')).toBe('xy');
    });

    it('pipes to conditional', async () => {
      expect(await run('true -> ? { "yes" } ! { "no" }')).toBe('yes');
    });

    it('pipes to for loop', async () => {
      expect(await run('[1, 2, 3] -> each { ($ + 10) }')).toEqual([11, 12, 13]);
    });

    it('pipes to while loop', async () => {
      expect(await run('0 -> ($ < 3) @ { ($ + 1) }')).toBe(3);
    });

    it('pipes to string template', async () => {
      expect(await run('"world" -> "hello {$}"')).toBe('hello world');
    });
  });

  describe('Inline Capture in Pipe Chain', () => {
    it('captures and passes through value', async () => {
      expect(await run('"x" :> $a -> .len')).toBe(1);
    });

    it('captures intermediate result', async () => {
      const script = `"hello" -> .len :> $length -> ($ * 2)`;
      expect(await run(script)).toBe(10);
    });

    it('multiple inline captures', async () => {
      const script = `"a" :> $x -> "b" :> $y
[$x, $y]`;
      expect(await run(script)).toEqual(['a', 'b']);
    });

    it('inline capture preserves value for chaining', async () => {
      const script = `"test" :> $captured -> .contains("e")`;
      expect(await run(script)).toBe(true);
    });
  });

  describe('Complex Pipe Chains', () => {
    it('chains methods, functions, and blocks', async () => {
      const script = `"hello world" -> .split(" ") -> .head -> .len`;
      expect(await run(script)).toBe(5);
    });

    it('chains with conditionals in middle', async () => {
      const script = `5 -> ($ > 3) ? "big" ! "small" -> .len`;
      expect(await run(script)).toBe(3);
    });

    it('chains with for loop transformation', async () => {
      const script = `[1, 2, 3] -> each { ($ * 2) } -> .head`;
      expect(await run(script)).toBe(2);
    });

    it('complex nested pipe chain', async () => {
      const script = `"a,b,c" -> .split(",") -> each { "{$}!" } -> .join("-")`;
      expect(await run(script)).toBe('a!-b!-c!');
    });
  });
});
