/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Runtime Tests: Pipe Targets
 * Tests for various pipe target types: invoke, bare functions, variable calls
 */

import type { RillFunction, RillValue } from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

import { createLogCollector, run } from '../helpers/runtime.js';
import { rule } from '../helpers/rule.js';
import {
  expectHalt,
  expectHaltMessage,
  expectRuntimeError,
} from '../helpers/halt.js';
import {
  anyTypeValue,
  parse,
  ParseError,
  parseWithRecovery,
} from '@rcrsr/rill';

describe('Rill Runtime: Pipe Targets', () => {
  describe('Invoke Pipe Target (-> $())', () => {
    rule('pipe-target.invoke').it(
      'invokes closure pipe value with no args',
      async () => {
        expect(await run('fn() { "hello" } -> $()')).toBe('hello');
      }
    );

    rule('pipe-target.invoke').it(
      'invokes closure pipe value with args',
      async () => {
        expect(await run('fn(x) { $x } -> $("world")')).toBe('world');
      }
    );

    it('invokes closure variable with pipe-style', async () => {
      expect(await run('fn(x) { $x } => $fn\n"test" -> $fn()')).toBe('test');
    });

    it('invokes zero-param closure from variable', async () => {
      expect(await run('fn() { "result" } => $fn\n$fn -> $()')).toBe('result');
    });

    it('chains multiple invoke targets', async () => {
      const script = `fn(x) { "{$x}!" } => $exclaim
fn(x) { $x } => $identity
"hi" -> $identity() -> $exclaim()`;
      expect(await run(script)).toBe('hi!');
    });

    it('invokes with multiple arguments', async () => {
      const script = `fn(a, b) { list[$a, $b] } -> $("x", "y")`;
      expect(await run(script)).toEqual(['x', 'y']);
    });

    it('invokes closure returned from function', async () => {
      // Function that returns a closure
      const greet: RillFunction = {
        returnType: anyTypeValue,
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
        () => run('fn(x) { $x * 2 } -> json'),
        'functions are not JSON-serializable'
      );
    });

    it('json throws on closures in dicts', async () => {
      await expectHaltMessage(
        () =>
          run('dict[name: "user", age: 30, greet: fn() { "Hello" }] -> json'),
        'functions are not JSON-serializable'
      );
    });

    it('json throws on closures in lists', async () => {
      // A list of only closures is homogeneous, so list construction succeeds
      // and json reaches the serialization check.
      await expectHalt(() => run('list[fn() { "fn" }] -> json'), {
        code: 'INVALID_INPUT',
        messagePattern: 'functions are not JSON-serializable',
      });
    });

    it('json throws on nested containers with closures', async () => {
      await expectHalt(
        () => run('dict[items: list[fn() { 0 }], fn: fn() { 0 }] -> json'),
        {
          code: 'INVALID_INPUT',
          messagePattern: 'functions are not JSON-serializable',
        }
      );
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
        returnType: anyTypeValue,
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
      expect(await run('fn(x) { "{$x}!" } => $fn\n"hi" -> $fn()')).toBe('hi!');
    });

    it('calls closure with explicit args', async () => {
      const script = `fn(a, b) { list[$a, $b] } => $fn
$fn("x", "y")`;
      expect(await run(script)).toEqual(['x', 'y']);
    });

    it('calls closure in for loop', async () => {
      const script = `fn(x) { ($x * 2) } => $double
list[1, 2, 3] -> seq({ $double($) })`;
      expect(await run(script)).toEqual([2, 4, 6]);
    });

    it('calls closure with explicit args receiving the piped value first', async () => {
      const script = `fn(a, b) { "{$a}-{$b}" } => $fn
"piped" -> $fn("used")`;
      expect(await run(script)).toBe('piped-used');
    });
  });

  describe('Function Call vs Bare Function', () => {
    it('function call with args uses explicit args', async () => {
      expect(await run('identity("explicit")')).toBe('explicit');
    });

    rule('pipe.call-operand').it(
      'bare function uses piped value as first arg',
      async () => {
        expect(await run('"piped" -> identity')).toBe('piped');
      }
    );

    rule('pipe.call-operand').it(
      'auto-prepends piped value when no bare `$` is present',
      async () => {
        // IR-8: when no top-level $ appears in args, pipe value auto-prepends at position 0
        expect(await run('"ignored" -> identity()')).toBe('ignored');
      }
    );
  });

  describe('Pipe to Blocks and Conditionals', () => {
    rule('pipe.block').it('pipes to block', async () => {
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

    rule('pipe.string').it('pipes to string template', async () => {
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
      const script = `"a" => $x -> .upper => $y
list[$x, $y]`;
      expect(await run(script)).toEqual(['a', 'A']);
    });

    it('inline capture preserves value for chaining', async () => {
      const script = `"test" => $captured -> .contains("e")`;
      expect(await run(script)).toBe(true);
    });
  });

  describe('Inline Closures as Pipe Targets', () => {
    it('pipes to inline closure with single param', async () => {
      expect(await run('5 -> fn(x) { $x + 1 }')).toBe(6);
    });

    it('pipes to inline closure with block body', async () => {
      expect(await run('"hello" -> fn(s) { $s -> .upper }')).toBe('HELLO');
    });

    it('pipes to inline closure with default param', async () => {
      expect(await run('5 -> fn(a, b = 10) { $a + $b }')).toBe(15);
    });

    it('chains multiple inline closures', async () => {
      expect(await run('5 -> fn(x) { $x * 2 } -> fn(y) { $y + 1 }')).toBe(11);
    });

    it('pipes to inline closure outside of dict context', async () => {
      const script = `"test" -> fn(r) { $r -> .upper }`;
      expect(await run(script)).toBe('TEST');
    });

    it('pipes to inline closure with multiple params uses defaults', async () => {
      expect(await run('3 -> fn(a, b = 10) { list[$a, $b] }')).toEqual([3, 10]);
    });

    it('inline closure with type annotations', async () => {
      expect(await run('42 -> fn(x: number) { $x * 2 }')).toBe(84);
    });

    it('inline closure mixed with method calls', async () => {
      expect(await run('"hello" -> fn(s) { $s -> .upper } -> .len')).toBe(5);
    });

    it('inline closure in each loop', async () => {
      expect(
        await run('list[1, 2, 3] -> seq({ $ -> fn(x) { $x * 2 } })')
      ).toEqual([2, 4, 6]);
    });

    it('inline closure with complex expression body', async () => {
      const script = `10 -> fn(n) {
  ($n > 5) ? "large" ! "small"
}`;
      expect(await run(script)).toBe('large');
    });

    it('inline closure preserves pipe value semantics', async () => {
      const script = `"test" => $val
$val -> fn(x) { $x -> .len }`;
      expect(await run(script)).toBe(4);
    });

    it('inline closure with zero params halts on the piped argument', async () => {
      await expectRuntimeError(() => run('7 -> fn() { 3 }'), {
        code: 'RILL-R045',
        messagePattern: /expects 0 arguments, got 1/,
      });
    });

    rule('pipe.zero-param').it(
      'zero-param closure variable as pipe target halts on the piped argument',
      async () => {
        await expectRuntimeError(() => run('fn() { 1 } => $f\n3 -> $f'), {
          code: 'RILL-R045',
          messagePattern: /expects 0 arguments, got 1/,
        });
      }
    );

    it('calling a zero-param closure with an argument halts with the same id', async () => {
      await expectRuntimeError(() => run('fn() { 1 } => $f\n$f(3)'), {
        code: 'RILL-R045',
        messagePattern: /expects 0 arguments, got 1/,
      });
    });

    rule('pipe.zero-param', 'pipe.function').it(
      'block closure variable as pipe target still receives the operand',
      async () => {
        expect(await run('fn { $ + 1 } => $f\n3 -> $f')).toBe(4);
      }
    );
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

  describe('Pipe Property Access ($.field)', () => {
    it('resolves a string method identically to a block form', async () => {
      expect(await run('"hello" -> $.upper')).toBe('HELLO');
      expect(await run('"hello" -> { $.upper }')).toBe('HELLO');
    });

    it('resolves a string property', async () => {
      expect(await run('"hello" -> $.len')).toBe(5);
    });

    it('resolves a list property', async () => {
      expect(await run('list[1, 2] -> $.len')).toBe(2);
    });

    it('invokes a method explicitly with call syntax', async () => {
      expect(await run('"hello" -> { $.upper() }')).toBe('HELLO');
    });

    it('resolves a dict field unchanged', async () => {
      expect(await run('dict[a: 1] -> $.a')).toBe(1);
    });

    it('returns a callable field un-invoked', async () => {
      const script = `dict[f: fn(x) { $x * 2 }] -> $.f => $fn
$fn(3)`;
      expect(await run(script)).toBe(6);
    });

    it('returns a callable field that can be invoked with pipe-invoke syntax', async () => {
      const script = `dict[f: fn(x) { $x * 2 }] -> $.f -> $(3)`;
      expect(await run(script)).toBe(6);
    });
  });

  // ============================================================
  // PIPE BINDING RULE (IR-8)
  // ============================================================

  describe('Piped Value as First Closure Argument', () => {
    rule('pipe.script-operand').it(
      'prepends the piped value before written arguments',
      async () => {
        const script = `fn(a, b) { list[$a, $b] } => $h
3 -> $h(4)`;
        expect(await run(script)).toEqual([3, 4]);
      }
    );

    rule('pipe.call-dollar').it(
      'leaves arguments unchanged when a top-level $ places the value',
      async () => {
        const script = `fn(a, b) { list[$a, $b] } => $h
3 -> $h($, 4)`;
        expect(await run(script)).toEqual([3, 4]);
      }
    );

    it('prepends when $ appears only inside a nested block argument', async () => {
      const script = `fn(a, f, c) { list[$a, $c] } => $h
3 -> $h({ $ + 1 }, 5)`;
      expect(await run(script)).toEqual([3, 5]);
    });

    it('prepends to a zero-param closure and halts on the excess argument', async () => {
      const script = `fn() { "none" } => $h
3 -> $h()`;
      await expectRuntimeError(() => run(script), {
        code: 'RILL-R045',
        messagePattern: /expects 0 arguments, got 1/,
      });
    });

    rule('pipe.call-operand').it(
      'uses only written arguments for a call in primary position',
      async () => {
        const script = `fn(a, b) { list[$a, $b] } => $h
5 -> { $
$h(1, 2) }`;
        expect(await run(script)).toEqual([1, 2]);
      }
    );
  });

  describe('Pipe Binding Rule (IR-8)', () => {
    // Helper: 3-param host function that returns its args as a list
    const makeCollect3: () => RillFunction = () => ({
      returnType: anyTypeValue,
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
      returnType: anyTypeValue,
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
      returnType: anyTypeValue,
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

    it('AC-PIPE-8: zero-param callable receives the pipe value and halts on the excess argument', async () => {
      const zeroParam = makeZeroParam();
      await expectRuntimeError(
        () => run('"dropped" -> zeroParam', { functions: { zeroParam } }),
        { code: 'RILL-R045', messagePattern: /expects 0 arguments, got 1/ }
      );
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
      await expectHalt(
        () =>
          run('"val" -> collect2($undefinedVar, 1)', {
            functions: { collect2 },
          }),
        {
          code: 'RILL_R005',
          hostErrorId: 'RILL-R005',
          messagePattern: 'Undefined variable: $undefinedVar',
        }
      );
    });
  });

  describe('Postfix Index After a Bare/Host-Call Pipe Target (-> fn[i])', () => {
    rule('pipe-target.postfix').it(
      'indexes the result of a bare builtin call',
      async () => {
        expect(await run('list[3,1,2] -> sort[0]')).toBe(1);
      }
    );

    rule('pipe-target.postfix').it(
      'indexes from the end of the result of a bare builtin call',
      async () => {
        expect(await run('list[3,1,2] -> sort[-1]')).toBe(3);
      }
    );

    it('indexes the result of an arg-bearing builtin call', async () => {
      // Explicit $ placement supplies the sole arg directly, avoiding the
      // pipe auto-prepend arity conflict a bare "identity(list[...])" would hit.
      expect(await run('list[3, 1, 2] -> identity($)[0]')).toBe(3);
    });

    it('indexes the result of an arg-bearing host-call target', async () => {
      const collect2: RillFunction = {
        returnType: anyTypeValue,
        params: [
          {
            name: 'a',
            type: { kind: 'any' },
            defaultValue: undefined,
            annotations: {},
          },
          {
            name: 'b',
            type: { kind: 'any' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: (args: Record<string, RillValue>): RillValue[] =>
          [args['a'], args['b']] as RillValue[],
      };
      const result = await run('"piped" -> collect2(1)[0]', {
        functions: { collect2 },
      });
      expect(result).toBe('piped');
    });
  });

  describe('Block and string targets must read the piped value', () => {
    it.each([
      ['a string with no interpolation', '5 -> "x"'],
      ['a string that interpolates another variable', '5 -> "x{$a}"'],
      ['a block that never reads $', '3 -> { 5 }'],
      [
        'a block whose only $ sits in a later pipe target',
        '3 -> { list[1] -> seq({ $ }) }',
      ],
      ['a block with a no-argument method call', '5 -> { "a".upper() }'],
      ['a block with a no-argument host call', '5 -> { f() }'],
      ['a block with a no-argument dict member call', '5 -> { $d.m() }'],
      ['a block with a no-argument closure call', '5 -> { $f() }'],
      ['a string with a no-argument call', '5 -> "x{f()}"'],
    ])('rejects %s with RILL-P031', async (_label, source) => {
      await expect(run(source)).rejects.toMatchObject({ errorId: 'RILL-P031' });
    });

    rule('pipe-target.method-head').it.each([
      ['a string interpolating $', '5 -> "x{$}"', 'x5'],
      ['a block reading $', '3 -> { $ + 1 }', 4],
      ['a block with a leading method', '"a" -> { .upper }', 'A'],
      ['a block with pass', '5 -> { pass }', 5],
      [
        'a block with a conditional reading $',
        '3 -> { true ? { $ } ! { 0 } }',
        3,
      ],
      ['a block with a guard reading $', '3 -> { guard { $ } }', 3],
      ['a block with a piped conditional', 'true -> { ? "a" ! "b" }', 'a'],
      [
        'a block with a while loop seeded from $',
        '5 -> { while (false) do { $ + 1 } }',
        5,
      ],
      [
        'a block with a do-while loop seeded from $',
        '5 -> { do { $ + 1 } while (false) }',
        6,
      ],
    ])('accepts %s', async (_label, source, expected) => {
      expect(await run(source)).toEqual(expected);
    });

    it('reports RILL-P031 through parseWithRecovery', () => {
      const result = parseWithRecovery('5 -> "x"');
      expect(result.errors.map((e) => e.errorId)).toContain('RILL-P031');
    });

    it('reports RILL-P031 for the block form through parseWithRecovery', () => {
      const result = parseWithRecovery('5 -> { f() }');
      expect(result.errors.map((e) => e.errorId)).toContain('RILL-P031');
    });

    it('rejects a block with a no-argument call at parse time, without executing', () => {
      let thrown: unknown;
      try {
        parse('5 -> { f() }');
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ParseError);
      expect(thrown).toMatchObject({ errorId: 'RILL-P031' });
    });

    it('never invokes the host function of a rejected block', async () => {
      let calls = 0;
      const f: RillFunction = {
        params: [],
        returnType: anyTypeValue,
        fn: (): RillValue => {
          calls++;
          return 0;
        },
      };
      await expect(
        run('5 -> { f() }', { functions: { f } })
      ).rejects.toMatchObject({ errorId: 'RILL-P031' });
      expect(calls).toBe(0);
    });
  });

  describe('List and dict literal targets cannot read $ at the top level', () => {
    rule('pipe.data-no-dollar').it(
      'rejects a list literal reading $ and names the block form',
      async () => {
        await expect(run('3 -> list[$, $]')).rejects.toMatchObject({
          errorId: 'RILL-P030',
          message: expect.stringContaining('3 -> { list[$, $] }'),
        });
      }
    );

    rule('pipe.data-no-dollar').it.each([
      ['an expression over $', '0 -> list[$ + 1, 9]'],
      ['a dict field', '"a" -> dict[a: $]'],
      ['a nested list', '3 -> list[list[$]]'],
    ])('rejects %s with RILL-P030', async (_label, source) => {
      await expect(run(source)).rejects.toMatchObject({ errorId: 'RILL-P030' });
    });

    it('accepts a $ wrapped in a block inside a dict field', async () => {
      expect(await run('"a" -> dict[a: { $ }]')).toBe('a');
    });

    it('does not walk the literal default', async () => {
      expect(await run('3 -> list[1, 2] ?? $')).toBe(3);
    });
  });

  describe('Operand placement in a call argument', () => {
    rule('pipe.call-dollar').it(
      'prepends the operand when $ sits only in a later pipe target',
      async () => {
        const script = `fn(a, b) { list[$a, $b] } => $f
fn(x) { $x * 10 } => $g
5 -> $f(2 -> $g($))`;
        expect(await run(script)).toEqual([5, 20]);
      }
    );

    rule('pipe.call-dollar').it(
      'does not prepend when $ sits in a conditional branch',
      async () => {
        const script = `fn(a) { $a } => $f
5 -> $f(true ? { $ } ! { 0 })`;
        expect(await run(script)).toBe(5);
      }
    );
  });
});
