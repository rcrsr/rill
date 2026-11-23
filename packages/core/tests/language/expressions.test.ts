/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Runtime Tests: Expressions
 * Tests for pipes, methods, and function calls
 */

import { anyTypeValue, type RillValue } from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

import { expectHalt } from '../helpers/halt.js';
import { createLogCollector, run } from '../helpers/runtime.js';
import { rule } from '../helpers/rule.js';

describe('Rill Runtime: Expressions', () => {
  describe('Pipe Chains', () => {
    it('evaluates single pipe', async () => {
      expect(await run('"x" -> identity')).toBe('x');
    });

    rule('pipe.left-to-right').it('evaluates multiple pipes', async () => {
      expect(await run('"x" -> identity -> identity')).toBe('x');
    });

    it('pipes to block', async () => {
      expect(await run('"x" -> { $ }')).toBe('x');
    });

    it('pipes to conditional', async () => {
      expect(await run('true -> ? { "yes" } ! { "no" }')).toBe('yes');
    });

    rule('pipe.left-to-right', 'pipe.method').it(
      'chains pipes with transformations',
      async () => {
        expect(await run('"hello" -> .upper -> { $ }')).toBe('HELLO');
      }
    );

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

    rule('pipe.method').it('uses method in pipe', async () => {
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
      expect(await run('list["a", "b"] -> .join("-")')).toBe('a-b');
    });

    it('chains methods', async () => {
      expect(await run('123 -> string -> .len')).toBe(3);
    });

    it('calls custom function', async () => {
      const double = {
        returnType: anyTypeValue,
        params: [
          {
            name: 'n',
            type: { kind: 'number' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: (args: Record<string, RillValue>): number => {
          const n = args['n'] as number;
          return n * 2;
        },
      };
      expect(await run('5 -> double', { functions: { double } })).toBe(10);
    });

    it('calls async custom function', async () => {
      const asyncFn = {
        returnType: anyTypeValue,
        params: [
          {
            name: 'input',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: async (args: Record<string, RillValue>): Promise<string> => {
          await Promise.resolve();
          return `async:${args['input']}`;
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
      expect(
        await run('list["a", "b", "c"] -> .join(",") -> .contains("b")')
      ).toBe(true);
    });

    it('pipes through multiple transformations', async () => {
      const { logs, callbacks } = createLogCollector();
      expect(
        await run('"hello" -> log -> { $ } -> .contains("ell")', { callbacks })
      ).toBe(true);
      expect(logs).toEqual(['hello']);
    });
  });

  // ============================================================
  // PIPE BINDING: SUB-EXPRESSION $ (IR-8, AC-PIPE-5)
  // ============================================================

  describe('Pipe Binding: sub-expression $ counted (AC-PIPE-5)', () => {
    it('$ inside nested function call arg counts as top-level — manual placement applies', async () => {
      // $val -> fn(g($)) — $ is inside g()'s args, not a closure body
      // The pipe-rule scanner descends into non-closure sub-expressions,
      // so g($) counts as having a top-level $; manual placement binds
      // $val to that $, making it fn(g($val))
      // Using identity(identity($)) to verify the inner $ receives pipe value
      const result = await run('"hello" -> identity(identity($))');
      expect(result).toBe('hello');
    });

    it('$ in sub-expression of method arg counts — manual placement applies', async () => {
      // "hello" -> .contains(identity($)) — $ inside identity() arg (non-closure sub-expr)
      // The scanner finds $, so manual placement: .contains(identity("hello"))
      const result = await run('"hello" -> .contains(identity($))');
      expect(result).toBe(true);
    });

    it('$ in sub-expression vs closure — only non-closure sub-exprs count', async () => {
      // "hello" -> identity("world") — no $ at all → auto-prepend → identity("hello", "world") arity error?
      // Instead test: $ in sub-expr is counted, so no auto-prepend occurs
      // identity($) = identity("hello") = "hello"; confirm result is "hello"
      const result = await run('"hello" -> identity($)');
      expect(result).toBe('hello');
    });
  });

  describe('Pipe target kinds', () => {
    rule('pipe.no-literal').it(
      'rejects a number, bool, or atom literal target with RILL-P001',
      async () => {
        for (const src of ['5 -> 3', '5 -> true', '5 -> #a']) {
          await expect(run(src)).rejects.toMatchObject({
            errorId: 'RILL-P001',
          });
        }
      }
    );

    rule('pipe.type').it('converts through a type target', async () => {
      expect(await run('"5" -> number')).toBe(5);
    });

    rule('pipe.data').it('selects through a data target', async () => {
      expect(await run('0 -> list["a", "b"]')).toBe('a');
      expect(await run('"b" -> dict[a: 1, b: 2]')).toBe(2);
    });

    rule('pipe.variable').it(
      'acts as the value a variable target holds, and halts when it is undefined',
      async () => {
        expect(await run('fn(x) { $x * 2 } => $d\n4 -> $d')).toBe(8);
        expect(await run('list[10, 20] => $l\n1 -> $l')).toBe(20);
        await expectHalt(() => run('5 -> $undef'), {
          code: 'RILL_R005',
          hostErrorId: 'RILL-R005',
        });
      }
    );

    rule('pipe.variable-kind').it(
      'halts naming the variable and the kind it holds',
      async () => {
        await expectHalt(() => run('3 => $n\n5 -> $n'), {
          code: 'RILL_R002',
          hostErrorId: 'RILL-R002',
          messagePattern: /cannot pipe into \$n: it holds a number/,
        });
        await expectHalt(() => run('dict[a: 3] => $d\n5 -> $d.a'), {
          code: 'RILL_R002',
          hostErrorId: 'RILL-R002',
          messagePattern:
            /cannot pipe into a value selected from \$d: it is a number/,
        });
      }
    );

    rule('pipe.call-dollar').it(
      'places the value at a written $ in a built-in call',
      async () => {
        expect(await run('3 -> range(0, $) -> seq({ $ })')).toEqual([0, 1, 2]);
      }
    );

    rule('pipe.script-operand').it(
      'does not prepend the value beside a spread argument',
      async () => {
        expect(
          await run('fn(a, b) { $a - $b } => $h\n99 -> $h(...tuple[10, 3])')
        ).toBe(7);
      }
    );

    rule('pipe-target.invoke').it(
      'halts $() on a value that is not a function',
      async () => {
        await expectHalt(() => run('5 -> $()'), {
          code: 'RILL_R002',
          hostErrorId: 'RILL-R002',
        });
      }
    );

    rule('pipe-target.no-minus').it(
      'rejects unary minus as a target and accepts negation',
      async () => {
        await expect(run('5 -> -$')).rejects.toMatchObject({
          errorId: 'RILL-P001',
        });
        await expect(run('5 -> -1')).rejects.toMatchObject({
          errorId: 'RILL-P001',
        });
        expect(await run('true -> !$')).toBe(false);
      }
    );
  });

  describe('Access forms', () => {
    rule('access.field-name').it(
      'rejects a dot with no name after it with RILL-P006',
      async () => {
        await expect(run('tuple[1] => $t\n$t.1')).rejects.toMatchObject({
          errorId: 'RILL-P006',
        });
        await expect(run('dict[a: 1] => $d\n$d.')).rejects.toMatchObject({
          errorId: 'RILL-P006',
        });
      }
    );

    rule('access.method-target').it(
      'rejects a method target that is not a name with RILL-P001',
      async () => {
        await expect(run('tuple[1] => $t\n$t -> .1')).rejects.toMatchObject({
          errorId: 'RILL-P001',
        });
      }
    );

    rule('access.any-receiver').it(
      'applies a bracket to a literal, a group, and a call result',
      async () => {
        expect(await run('list[1, 2][0]')).toBe(1);
        expect(await run('(list[1, 2])[1]')).toBe(2);
        expect(await run('"a,b".split(",")[1]')).toBe('b');
      }
    );

    rule('access.chain').it('applies access forms left to right', async () => {
      expect(await run('dict[a: dict[b: list[5, 6]]] => $d\n$d.a.b[1]')).toBe(
        6
      );
    });

    rule('access.ordered-key').it(
      'halts an ordered selector that is neither a string nor a number',
      async () => {
        for (const sel of ['true', 'list[1]']) {
          await expectHalt(() => run(`ordered[a: 1] => $o\n$o[${sel}]`), {
            code: 'RILL_R002',
            hostErrorId: 'RILL-R002',
            messagePattern: /Ordered index must be string or number/,
          });
        }
      }
    );
  });

  describe('Operators', () => {
    rule('operator.no-chain').it(
      'rejects a chained comparison with RILL-P001',
      async () => {
        for (const src of ['1 < 2 < 3', '1 == 1 == true', '1 < 2 == true']) {
          await expect(run(src)).rejects.toMatchObject({
            errorId: 'RILL-P001',
          });
        }
      }
    );

    rule('operator.group').it(
      'groups first and rejects empty parentheses',
      async () => {
        expect(await run('(1 + 2) * 3')).toBe(9);
        await expect(run('()')).rejects.toMatchObject({ errorId: 'RILL-P001' });
      }
    );

    rule('operator.before-pipe').it(
      'completes an operator expression before the pipe',
      async () => {
        expect(await run('1 + 2 -> { $ * 10 }')).toBe(30);
      }
    );

    rule('operator.precedence', 'operator.left').it(
      'binds by precedence and groups each level from the left',
      async () => {
        expect(await run('1 + 2 * 3 - 4 / 2')).toBe(5);
        expect(await run('true || false && false')).toBe(true);
        expect(await run('24 / 4 / 2')).toBe(3);
      }
    );

    rule('operator.ordering').it(
      'halts ordering a collection, a function, a type, or an iterator',
      async () => {
        for (const src of [
          'list[1] < list[2]',
          'dict[a: 1] < dict[a: 2]',
          'ordered[a: 1] < ordered[a: 2]',
          'map["a": 1] < map["a": 2]',
          'fn { 1 } => $f\n$f < $f',
          'number < string',
          'range(0, 1) < range(0, 2)',
        ]) {
          await expectHalt(() => run(src), {
            code: 'RILL_R002',
            hostErrorId: 'RILL-R002',
            messagePattern: /Cannot compare \w+ with \w+ using </,
          });
        }
      }
    );

    rule('arithmetic.modulo').it('keeps the sign of the dividend', async () => {
      expect(await run('list[7 % 3, -7 % 3, 7 % -3, 7.5 % 2]')).toEqual([
        1, -1, 1, 1.5,
      ]);
    });

    rule('arithmetic.basic', 'arithmetic.negate').it(
      'computes on numbers without truncating',
      async () => {
        expect(await run('list[10 / 4, -(2 + 3), --2]')).toEqual([2.5, -5, 2]);
      }
    );

    rule('arithmetic.number-only').it(
      'halts an operand that is not a number',
      async () => {
        for (const [src, kind] of [
          ['true + 1', 'bool'],
          ['list[1] + list[2]', 'list'],
          ['5 / list[1]', 'list'],
          ['dict[a: 1] * 2', 'dict'],
          ['number + 1', 'type'],
          ['range(0, 1) + 1', 'iterator'],
          ['-list[1]', 'list'],
          ['-true', 'bool'],
        ]) {
          await expectHalt(() => run(src!), {
            code: 'RILL_R002',
            hostErrorId: 'RILL-R002',
            messagePattern: new RegExp(
              `Arithmetic requires number, got ${kind}`
            ),
          });
        }
      }
    );

    rule('logical.not-operand').it(
      'rejects ! with no operand with RILL-P004',
      async () => {
        await expect(run('"x" -> !')).rejects.toMatchObject({
          errorId: 'RILL-P004',
        });
      }
    );

    rule('logical.short-circuit', 'logical.bool-operands').it(
      'skips the right operand that cannot change the result',
      async () => {
        expect(await run('false && 1')).toBe(false);
        expect(await run('true || 1')).toBe(true);
        await expectHalt(() => run('false || 1'), {
          code: 'RILL_R002',
          hostErrorId: 'RILL-R002',
        });
      }
    );
  });
});
