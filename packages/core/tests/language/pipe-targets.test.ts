/**
 * Rill Runtime Tests: Pipe Targets
 * Tests for various pipe target types: invoke, bare functions, variable calls
 */

import type { RillFunction, RillValue } from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

import { createLogCollector, run } from '../helpers/runtime.js';
import { expectHaltMessage } from '../helpers/halt.js';

describe('Rill Runtime: Pipe Targets', () => {
  describe('Invoke Pipe Target (-> $())', () => {
    it('invokes closure pipe value with no args', async () => {
      expect(await run('|| { "hello" } -> $()')).toBe('hello');
    });

    it('invokes closure pipe value with args', async () => {
      expect(await run('|x| { $x } -> $("world")')).toBe('world');
    });

    it('invokes closure variable with pipe-style', async () => {
      expect(await run('|x| { $x } => $fn\n"test" -> $fn()')).toBe('test');
    });

    it('invokes zero-param closure from variable', async () => {
      expect(await run('|| { "result" } => $fn\n$fn -> $()')).toBe('result');
    });

    it('chains multiple invoke targets', async () => {
      const script = `|x| { "{$x}!" } => $exclaim
|x| { $x } => $identity
"hi" -> $identity() -> $exclaim()`;
      expect(await run(script)).toBe('hi!');
    });

    it('invokes with multiple arguments', async () => {
      const script = `|a, b| { list[$a, $b] } -> $("x", "y")`;
      expect(await run(script)).toEqual(['x', 'y']);
    });

    it('invokes closure returned from function', async () => {
      // Function that returns a closure
      const greet: RillFunction = {
        params: [
          {
            name: 'name',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: (args: Record<string, RillValue>): RillValue => {
          const name = args['name'] as string;
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
      expect(await run('list[1, 2, 3] -> json')).toBe('[1,2,3]');
    });

    it('json errors on direct closure serialization', async () => {
      await expectHaltMessage(
        () => run('|x|{ $x * 2 } -> json'),
        'closures are not JSON-serializable'
      );
    });

    it('json throws on closures in dicts', async () => {
      await expectHaltMessage(
        () => run('dict[name: "user", age: 30, greet: ||{ "Hello" }] -> json'),
        'closures are not JSON-serializable'
      );
    });

    it('json throws on closures in lists', async () => {
      // Phase 2: [1, 2, ||{ "fn" }, 3] is a mixed-type list; RILL-R002 fires first.
      // The test intent (json rejects closures) remains valid; error is still thrown.
      await expect(run('list[1, 2, ||{ "fn" }, 3] -> json')).rejects.toThrow();
    });

    it('json throws on nested containers with closures', async () => {
      // Phase 2: [1, ||{ 0 }, 2] is a mixed-type list; RILL-R002 fires first.
      await expect(
        run('dict[items: list[1, ||{ 0 }, 2], fn: ||{ 0 }] -> json')
      ).rejects.toThrow();
    });

    it('pipes to .^type for type value', async () => {
      // .^type returns a RillTypeValue; typeName accessible via host API
      expect(((await run('"hello" => $v\n$v.^type')) as any).typeName).toBe(
        'string'
      );
      expect(((await run('42 => $v\n$v.^type')) as any).typeName).toBe(
        'number'
      );
      expect(((await run('true => $v\n$v.^type')) as any).typeName).toBe(
        'bool'
      );
      expect(((await run('list[1, 2] => $v\n$v.^type')) as any).typeName).toBe(
        'list'
      );
      expect(((await run('dict[a: 1] => $v\n$v.^type')) as any).typeName).toBe(
        'dict'
      );
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
      const double: RillFunction = {
        params: [
          {
            name: 'x',
            type: { kind: 'number' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: (args: Record<string, RillValue>): number => {
          const x = args['x'];
          return typeof x === 'number' ? x * 2 : 0;
        },
      };
      expect(await run('5 -> double', { functions: { double } })).toBe(10);
    });
  });

  describe('Variable Calls in Pipe (-> $fn())', () => {
    it('calls closure variable with piped value', async () => {
      expect(await run('|x| { "{$x}!" } => $fn\n"hi" -> $fn()')).toBe('hi!');
    });

    it('calls closure with explicit args', async () => {
      const script = `|a, b| { list[$a, $b] } => $fn
$fn("x", "y")`;
      expect(await run(script)).toEqual(['x', 'y']);
    });

    it('calls closure in for loop', async () => {
      const script = `|x| { ($x * 2) } => $double
list[1, 2, 3] -> seq({ $double() })`;
      expect(await run(script)).toEqual([2, 4, 6]);
    });

    it('calls closure with explicit args replaces pipe value', async () => {
      // When explicit args are provided, they replace the pipe value
      const script = `|a| { $a } => $fn
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

    it('auto-prepends piped value when no bare `$` is present', async () => {
      // IR-8: when no top-level $ appears in args, pipe value auto-prepends at position 0
      expect(await run('"ignored" -> identity()')).toBe('ignored');
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
      expect(await run('list[1, 2, 3] -> seq({ ($ + 10) })')).toEqual([
        11, 12, 13,
      ]);
    });

    it('pipes to while loop', async () => {
      expect(await run('0 -> while ($ < 3) do { ($ + 1) }')).toBe(3);
    });

    it('pipes to string template', async () => {
      expect(await run('"world" -> "hello {$}"')).toBe('hello world');
    });
  });

  describe('Inline Capture in Pipe Chain', () => {
    it('captures and passes through value', async () => {
      expect(await run('"x" => $a -> .len')).toBe(1);
    });

    it('captures intermediate result', async () => {
      const script = `"hello" -> .len => $length -> ($ * 2)`;
      expect(await run(script)).toBe(10);
    });

    it('multiple inline captures', async () => {
      const script = `"a" => $x -> "b" => $y
list[$x, $y]`;
      expect(await run(script)).toEqual(['a', 'b']);
    });

    it('inline capture preserves value for chaining', async () => {
      const script = `"test" => $captured -> .contains("e")`;
      expect(await run(script)).toBe(true);
    });
  });

  describe('Inline Closures as Pipe Targets', () => {
    it('pipes to inline closure with single param', async () => {
      expect(await run('5 -> |x| { $x + 1 }')).toBe(6);
    });

    it('pipes to inline closure with block body', async () => {
      expect(await run('"hello" -> |s| { $s -> .upper }')).toBe('HELLO');
    });

    it('pipes to inline closure with default param', async () => {
      expect(await run('5 -> |a, b = 10| { $a + $b }')).toBe(15);
    });

    it('chains multiple inline closures', async () => {
      expect(await run('5 -> |x| { $x * 2 } -> |y| { $y + 1 }')).toBe(11);
    });

    it('pipes to inline closure outside of dict context', async () => {
      const script = `"test" -> |r| { $r -> .upper }`;
      expect(await run(script)).toBe('TEST');
    });

    it('pipes to inline closure with multiple params uses defaults', async () => {
      expect(await run('3 -> |a, b = 10| { list[$a, $b] }')).toEqual([3, 10]);
    });

    it('inline closure with type annotations', async () => {
      expect(await run('42 -> |x: number| { $x * 2 }')).toBe(84);
    });

    it('inline closure mixed with method calls', async () => {
      expect(await run('"hello" -> |s| { $s -> .upper } -> .len')).toBe(5);
    });

    it('inline closure in each loop', async () => {
      expect(
        await run('list[1, 2, 3] -> seq({ $ -> |x| { $x * 2 } })')
      ).toEqual([2, 4, 6]);
    });

    it('inline closure with complex expression body', async () => {
      const script = `10 -> |n| {
  ($n > 5) ? "large" ! "small"
}`;
      expect(await run(script)).toBe('large');
    });

    it('inline closure preserves pipe value semantics', async () => {
      const script = `"test" => $val
$val -> |x| { $x -> .len }`;
      expect(await run(script)).toBe(4);
    });

    it('inline closure with zero params uses pipe value via $', async () => {
      expect(await run('7 -> || { $ * 3 }')).toBe(21);
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
      const script = `list[1, 2, 3] -> seq({ ($ * 2) }) -> .head`;
      expect(await run(script)).toBe(2);
    });

    it('complex nested pipe chain', async () => {
      const script = `"a,b,c" -> .split(",") -> seq({ "{$}!" }) -> .join("-")`;
      expect(await run(script)).toBe('a!-b!-c!');
    });
  });

  // ============================================================
  // PIPE BINDING RULE (IR-8)
  // ============================================================

  describe('Pipe Binding Rule (IR-8)', () => {
    // Helper: 3-param host function that returns its args as a list
    const makeCollect3: () => RillFunction = () => ({
      params: [
        {
          name: 'a',
          type: { kind: 'any' as const },
          defaultValue: undefined,
          annotations: {},
        },
        {
          name: 'b',
          type: { kind: 'any' as const },
          defaultValue: undefined,
          annotations: {},
        },
        {
          name: 'c',
          type: { kind: 'any' as const },
          defaultValue: undefined,
          annotations: {},
        },
      ],
      fn: (args: Record<string, RillValue>): RillValue[] =>
        [args['a'], args['b'], args['c']] as RillValue[],
    });

    // Helper: 2-param host function that returns its args as a list
    const makeCollect2: () => RillFunction = () => ({
      params: [
        {
          name: 'a',
          type: { kind: 'any' as const },
          defaultValue: undefined,
          annotations: {},
        },
        {
          name: 'b',
          type: { kind: 'any' as const },
          defaultValue: undefined,
          annotations: {},
        },
      ],
      fn: (args: Record<string, RillValue>): RillValue[] =>
        [args['a'], args['b']] as RillValue[],
    });

    // Helper: zero-param host function that returns a fixed value
    const makeZeroParam: () => RillFunction = () => ({
      params: [],
      fn: (): RillValue => 'zero-param-result',
    });

    it('AC-PIPE-1: no $ in args — auto-prepends pipe value as first arg (≥3-param fn)', async () => {
      // $val -> fn(1, 2) with no $ becomes fn($val, 1, 2)
      const collect3 = makeCollect3();
      const result = await run('"piped" -> collect3(1, 2)', {
        functions: { collect3 },
      });
      expect(result).toEqual(['piped', 1, 2]);
    });

    it('AC-PIPE-2: explicit $ as first arg — manual placement, no auto-prepend', async () => {
      // $val -> fn($, 1) becomes fn($val, 1)
      const collect2 = makeCollect2();
      const result = await run('"piped" -> collect2($, 1)', {
        functions: { collect2 },
      });
      expect(result).toEqual(['piped', 1]);
    });

    it('AC-PIPE-3: explicit $ in middle — placed at position 1, no auto-prepend', async () => {
      // $val -> fn(1, $, 0) becomes fn(1, $val, 0)
      const collect3 = makeCollect3();
      const result = await run('"piped" -> collect3(1, $, 0)', {
        functions: { collect3 },
      });
      expect(result).toEqual([1, 'piped', 0]);
    });

    it('AC-PIPE-4: multiple $ occurrences — all resolve to same piped value', async () => {
      // $val -> fn(1, $, $) becomes fn(1, $val, $val)
      const collect3 = makeCollect3();
      const result = await run('"piped" -> collect3(1, $, $)', {
        functions: { collect3 },
      });
      expect(result).toEqual([1, 'piped', 'piped']);
    });

    it('AC-PIPE-6: $ inside closure body is late-bound, not counted — auto-prepends pipe value', async () => {
      // $list -> filter({ $.active }) — $ inside { } is closure-bound, not top-level
      // so pipe value auto-prepends as the list arg to filter
      const script = `list[dict[active: true, name: "a"], dict[active: false, name: "b"]] -> filter({ $.active })`;
      const result = await run(script);
      expect(result).toEqual([{ active: true, name: 'a' }]);
    });

    it('AC-PIPE-7: nested closures — inner and outer $ both late-bound, not counted', async () => {
      // $matrix -> seq({ $ -> seq({ $ * 2 }) }) — both $ refs are inside closure bodies
      // so filter auto-prepends (no top-level $); inner $ also late-bound
      const result = await run(
        'list[list[1, 2], list[3, 4]] -> seq({ $ -> seq({ $ * 2 }) })'
      );
      expect(result).toEqual([
        [2, 4],
        [6, 8],
      ]);
    });

    it('AC-PIPE-8: zero-param callable — pipe value silently dropped, fn runs normally', async () => {
      // $val -> fn where fn takes 0 params runs fn(); no halt
      const zeroParam = makeZeroParam();
      const result = await run('"dropped" -> zeroParam', {
        functions: { zeroParam },
      });
      expect(result).toBe('zero-param-result');
    });

    it('AC-BOUND-4: zero-param callable with explicit $ — arity error (manual places 1 arg, fn accepts 0)', async () => {
      // $val -> fn($) — manual placement supplies 1 arg; callable accepts 0 → arity error
      const zeroParam = makeZeroParam();
      await expect(
        run('"val" -> zeroParam($)', { functions: { zeroParam } })
      ).rejects.toThrow(/expects 0 arguments, got 1/i);
    });

    it('AC-BOUND-5: 3-param fn with explicit $ — manual placement, no auto-prepend (exactly 3 args supplied)', async () => {
      // $val -> fn(1, $, 0) — explicit $ suppresses auto-prepend; fn gets (1, $val, 0)
      const collect3 = makeCollect3();
      const result = await run('42 -> collect3(1, $, 0)', {
        functions: { collect3 },
      });
      expect(result).toEqual([1, 42, 0]);
    });

    it('EC-7: arg-evaluation error during pipe propagates as halt', async () => {
      // Runtime error evaluating an arg inside a pipe target propagates outward
      const collect2 = makeCollect2();
      await expect(
        run('"val" -> collect2($undefinedVar, 1)', { functions: { collect2 } })
      ).rejects.toThrow();
    });
  });
});
