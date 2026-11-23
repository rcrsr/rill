/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: Code Blocks
 * A code block is never a value; type suffixes on conditional branches and
 * pipe targets.
 */

import { describe, expect, it } from 'vitest';

import {
  anyTypeValue,
  createRuntimeContext,
  execute,
  isPipeChainNode,
  parse,
  toNative,
} from '../../src/index.js';
import type { ConditionalNode, PipeChainNode } from '../../src/index.js';
import { expectHalt } from '../helpers/halt.js';
import { hostFn, hostParam } from '../helpers/host.js';
import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';

// Parse helpers: statements[0] is a Statement whose expression is a PipeChain.
function firstChain(source: string): PipeChainNode {
  const statement = parse(source).statements[0];
  if (statement?.type !== 'Statement') throw new Error('expected a statement');
  const expression = statement.expression;
  if (!isPipeChainNode(expression)) throw new Error('expected a pipe chain');
  return expression;
}

function firstPrimary(source: string): unknown {
  const head = firstChain(source).head;
  return 'primary' in head ? head.primary : undefined;
}

function firstConditional(source: string): ConditionalNode {
  const primary = firstPrimary(source);
  if (
    typeof primary !== 'object' ||
    primary === null ||
    !('thenBranch' in primary)
  ) {
    throw new Error('expected a conditional');
  }
  return primary as ConditionalNode;
}

// PostfixExpr(primary: <kind>(operand: PostfixExpr(primary: Block)))
function typedBlock(kind: 'TypeAssertion' | 'TypeCheck'): object {
  return {
    type: 'PostfixExpr',
    primary: {
      type: kind,
      operand: { type: 'PostfixExpr', primary: { type: 'Block' } },
    },
  };
}

describe('Rill Language: Code Blocks', () => {
  describe('assert construct', () => {
    rule('code-block.assert-construct').it(
      'returns the running branch of a typed block conditional',
      async () => {
        expect(await run('true ? { 5 }:number ! { 6 }')).toBe(5);
      }
    );

    rule('code-block.assert-construct').it(
      'asserts only the running branch',
      async () => {
        expect(await run('true ? { 5 }:number ! { "x" }:number')).toBe(5);
      }
    );

    rule('code-block.assert-construct').it(
      'halts TYPE_MISMATCH when the running branch fails its assertion',
      async () => {
        await expectHalt(() => run('true ? { "a" }:number ! { 6 }'), {
          code: 'TYPE_MISMATCH',
        });
      }
    );

    rule('code-block.assert-construct').it(
      'parses a :T suffix on both branches as TypeAssertion over the block',
      () => {
        const conditional = firstConditional(
          'true ? { 5 }:number ! { 6 }:number'
        );
        expect(conditional.thenBranch).toMatchObject(
          typedBlock('TypeAssertion')
        );
        expect(conditional.elseBranch).toMatchObject(
          typedBlock('TypeAssertion')
        );
      }
    );

    rule('code-block.assert-construct').it(
      'parses a :?T suffix on a branch as TypeCheck over the block',
      () => {
        const conditional = firstConditional('true ? { 5 }:?number ! { 6 }');
        expect(conditional.thenBranch).toMatchObject(typedBlock('TypeCheck'));
        expect(conditional.elseBranch).toMatchObject({ type: 'Block' });
      }
    );

    rule('code-block.assert-construct').it(
      'parses the suffix on the else branch only',
      () => {
        const conditional = firstConditional('true ? { 5 } ! { 6 }:number');
        expect(conditional.thenBranch).toMatchObject({ type: 'Block' });
        expect(conditional.elseBranch).toMatchObject(
          typedBlock('TypeAssertion')
        );
      }
    );

    rule('code-block.assert-construct').it(
      'parses the suffix on a then branch with no else branch',
      () => {
        const conditional = firstConditional('true ? { 5 }:number');
        expect(conditional.thenBranch).toMatchObject(
          typedBlock('TypeAssertion')
        );
        expect(conditional.elseBranch).toBeNull();
      }
    );

    rule('code-block.assert-construct').it(
      'keeps a loop body a plain block and applies the suffix to the whole loop',
      () => {
        const primary = firstPrimary('while (true) do { 5 }:number');
        expect(primary).toMatchObject({
          type: 'TypeAssertion',
          operand: {
            type: 'PostfixExpr',
            primary: { type: 'WhileLoop', body: { type: 'Block' } },
          },
        });
      }
    );

    rule('code-block.assert-construct').it(
      'keeps a guard body a plain block and applies the suffix to the whole guard',
      () => {
        const primary = firstPrimary('guard { 5 }:number');
        expect(primary).toMatchObject({
          type: 'TypeAssertion',
          operand: {
            type: 'PostfixExpr',
            primary: { type: 'GuardBlock', body: { type: 'Block' } },
          },
        });
      }
    );

    rule('code-block.assert-construct').it(
      'keeps a retry body a plain block and applies the suffix to the whole retry',
      () => {
        const primary = firstPrimary('retry(attempts: 2) { 5 }:number');
        expect(primary).toMatchObject({
          type: 'TypeAssertion',
          operand: {
            type: 'PostfixExpr',
            primary: { type: 'RetryBlock', body: { type: 'Block' } },
          },
        });
      }
    );

    rule('code-block.assert-construct').it(
      'keeps a pass body a plain block and applies the suffix to the whole pass',
      () => {
        const pipes = firstChain('3 -> pass { 5 }:number').pipes;
        expect(pipes[0]).toMatchObject({
          type: 'PostfixExpr',
          primary: {
            type: 'TypeAssertion',
            operand: {
              type: 'PostfixExpr',
              primary: { type: 'PassBlock', body: { type: 'Block' } },
            },
          },
        });
      }
    );
  });

  describe('not a value', () => {
    rule('code-block.not-value').it(
      'binds the result of a head block',
      async () => {
        expect(await run('{ 5 } => $x\n$x')).toBe(5);
      }
    );

    rule('code-block.not-value').it(
      'leaves the capture not callable',
      async () => {
        await expect(run('{ 5 } => $x\n$x()')).rejects.toMatchObject({
          errorId: 'RILL-R002',
          message: expect.stringContaining('not callable'),
        });
      }
    );
  });

  describe('head and parentheses', () => {
    rule('code-block.head').it(
      'runs a head block once with the enclosing $',
      async () => {
        expect(await run('3 -> { $ => $n\n{ $ + $n } }')).toBe(6);
      }
    );

    rule('code-block.head').it(
      'halts RILL-R005 when no $ is bound',
      async () => {
        await expect(run('{ $ }')).rejects.toMatchObject({
          errorId: 'RILL-R005',
        });
      }
    );

    rule('code-block.head').it('runs a statement block', async () => {
      expect(await run('{ 1 }\n{ 2 }')).toBe(2);
    });

    rule('code-block.head').it(
      'keeps a head block capture out of the enclosing scope',
      async () => {
        await expect(run('{ 1 => $m }\n$m')).rejects.toMatchObject({
          errorId: 'RILL-R005',
        });
      }
    );

    rule('code-block.head').it(
      'drops an annotation on a head block',
      async () => {
        expect(await run('^("d") { 5 } => $x\n$x')).toBe(5);
      }
    );

    rule('code-block.head').it(
      'catches return inside a head block',
      async () => {
        expect(await run('{ "a" -> return\n"b" } => $x\n$x')).toBe('a');
      }
    );

    rule('code-block.pipe-target').it(
      'catches return inside a pipe target block',
      async () => {
        expect(
          await run(
            '3 -> { ($ > 2) ? { "big" -> return } ! "small"\n"end" } -> .lower'
          )
        ).toBe('big');
      }
    );

    rule('code-block.pipe-target').it(
      'lets break pass through a block to the enclosing loop',
      async () => {
        expect(
          await run('0 -> while ($ < 5) do { ($ == 2) ? { break } ! ($ + 1) }')
        ).toBe(2);
        expect(
          await run('list[1, 2, 3] -> seq({ ($ == 2) ? break ! $ })')
        ).toEqual([1]);
      }
    );

    rule('code-block.parens').it(
      'runs a block alone in parentheses',
      async () => {
        expect(await run('({ 5 }) => $x\n$x')).toBe(5);
      }
    );
  });

  describe('assertion and check', () => {
    rule('code-block.assert').it(
      'asserts a pipe target block result',
      async () => {
        expect(await run('3 -> { $ + 1 }:number')).toBe(4);
      }
    );

    rule('code-block.assert').it(
      'binds a typed head block result',
      async () => {
        expect(await run('{ 5 }:number => $x\n$x')).toBe(5);
      }
    );

    rule('code-block.assert').it('asserts a parenthesized block', async () => {
      expect(await run('({ 7 }:number)')).toBe(7);
      await expectHalt(() => run('({ "a" }:number)'), {
        code: 'TYPE_MISMATCH',
      });
    });

    rule('code-block.assert').it(
      'halts TYPE_MISMATCH when a typed head block fails',
      async () => {
        await expectHalt(() => run('{ "a" }:number => $x'), {
          code: 'TYPE_MISMATCH',
        });
      }
    );

    rule('code-block.assert-construct').it(
      'halts TYPE_MISMATCH when a running else branch fails its assertion',
      async () => {
        await expectHalt(() => run('false ? 1 ! { "a" }:number'), {
          code: 'TYPE_MISMATCH',
        });
      }
    );

    rule('code-block.assert-construct').it(
      'lets return inside a typed branch end the script',
      async () => {
        expect(await run('true ? { "a" -> return }:string ! 1\n"after"')).toBe(
          'a'
        );
      }
    );

    rule('code-block.assert').it(
      'halts TYPE_MISMATCH on a failed assertion',
      async () => {
        await expectHalt(() => run('3 -> { $ + 1 }:string'), {
          code: 'TYPE_MISMATCH',
        });
      }
    );

    rule('code-block.check').it(
      'yields true when the result has the type',
      async () => {
        expect(await run('3 -> { $ + 1 }:?number')).toBe(true);
      }
    );

    rule('code-block.check').it(
      'yields false when the result lacks the type',
      async () => {
        expect(await run('3 -> { $ + 1 }:?string')).toBe(false);
      }
    );

    rule('code-block.check').it(
      'checks a head block and a parenthesized block',
      async () => {
        expect(await run('{ 5 }:?string => $x\n$x')).toBe(false);
        expect(await run('({ 5 }:?string)')).toBe(false);
        expect(await run('({ 5 }:?number)')).toBe(true);
      }
    );

    rule('code-block.assert-scope').it(
      'runs a passing assertion before a following method reads the value',
      async () => {
        expect(await run('"abc" -> { $ }:string -> .len')).toBe(3);
      }
    );

    rule('code-block.assert-scope').it(
      'asserts before a following method reads the value',
      async () => {
        await expectHalt(() => run('"a" -> { $ }:number -> .len'), {
          code: 'TYPE_MISMATCH',
        });
      }
    );
  });

  describe('empty body', () => {
    // The parser rejects an empty block, so the empty body is built by hand.
    it('halts RILL-R043 when a block has no statements', async () => {
      const head = firstChain('{ 5 }').head;
      const primary = 'primary' in head ? head.primary : undefined;
      if (primary?.type !== 'Block') throw new Error('expected a block');
      const emptyBlock = { ...primary, statements: [] };
      const ast = parse('{ 5 }');
      const statement = ast.statements[0];
      if (statement?.type !== 'Statement')
        throw new Error('expected statement');
      const chain = firstChain('{ 5 }');
      const emptied = {
        ...ast,
        statements: [
          {
            ...statement,
            expression: {
              ...chain,
              head: { ...head, primary: emptyBlock },
            },
          },
        ],
      };
      await expect(
        execute(emptied as typeof ast, createRuntimeContext())
      ).rejects.toMatchObject({ errorId: 'RILL-R043' });
    });
  });

  describe('pipe target', () => {
    rule('pipe.uses-value').it(
      'halts RILL-P031 for a typed block target that ignores the piped value',
      async () => {
        await expect(run('3 -> { 5 }:number')).rejects.toMatchObject({
          errorId: 'RILL-P031',
        });
      }
    );

    rule('pipe.uses-value').it(
      'halts RILL-P031 for a :? block target that ignores the piped value',
      async () => {
        await expect(run('3 -> { 5 }:?number')).rejects.toMatchObject({
          errorId: 'RILL-P031',
        });
      }
    );

    rule('pipe.uses-value').it(
      'parses a typed block target that reads the piped value',
      () => {
        expect(() => parse('3 -> { $ }:number')).not.toThrow();
      }
    );
  });

  describe('call frames and depth', () => {
    rule('code-block.head').it(
      'carries a <function> frame in the call stack of a halt inside a block',
      async () => {
        let caught: unknown;
        try {
          await run('3 -> { $ + "a" }');
        } catch (e) {
          caught = e;
        }
        const context = (caught as { context?: Record<string, unknown> })
          .context;
        const stack = context?.['callStack'] as
          | { functionName: string }[]
          | undefined;
        expect(stack?.map((f) => f.functionName)).toContain('<function>');
      }
    );

    rule('code-block.head').it(
      'adds no call depth when blocks nest under a tight maxCallDepth',
      async () => {
        const result = await run(
          '1 -> { $ -> { $ -> { $ -> { $ -> { $ + 1 } } } } }',
          { maxCallDepth: 1 }
        );
        expect(result).toBe(2);
      }
    );
  });

  describe('held blocks', () => {
    const FN_ENTRY = { kind: 'fn', params: [] };

    rule('code-block.held').it('types a held block entry as fn()', async () => {
      expect(await run('dict[a: { 1 }].^type')).toMatchObject({
        typeName: 'dict',
        structure: { kind: 'dict', fields: { a: { type: FN_ENTRY } } },
      });
    });

    rule('code-block.held').it(
      'types a held block with an assertion as fn()',
      async () => {
        expect(await run('dict[a: { 1 }:number].^type')).toMatchObject({
          structure: { kind: 'dict', fields: { a: { type: FN_ENTRY } } },
        });
      }
    );

    rule('code-block.held').it(
      'types a held list, tuple and ordered entry as fn()',
      async () => {
        expect(await run('list[{ 1 }].^type')).toMatchObject({
          structure: { kind: 'list', element: FN_ENTRY },
        });
        expect(await run('tuple[{ 1 }].^type')).toMatchObject({
          structure: { kind: 'tuple', elements: [{ type: FN_ENTRY }] },
        });
        expect(await run('ordered[a: { 1 }].^type')).toMatchObject({
          structure: {
            kind: 'ordered',
            fields: [{ name: 'a', type: FN_ENTRY }],
          },
        });
      }
    );

    rule('code-block.held').it(
      'does not run a block entry when the collection is built',
      async () => {
        expect(await run('dict[a: { error "boom" }] => $d\n1')).toBe(1);
        expect(await run('list[{ error "boom" }].len')).toBe(1);
        expect(await run('tuple[{ error "boom" }] => $t\n1')).toBe(1);
        expect(await run('ordered[a: { error "boom" }] => $o\n1')).toBe(1);
      }
    );

    rule('code-block.held').it(
      'holds a block in a multi-key entry for every key',
      async () => {
        expect(await run('"b" -> dict[list["a", "b"]: { "got {$}" }]')).toBe(
          'got b'
        );
      }
    );
  });

  describe('access', () => {
    const wrap = (body: string): string => `7 -> {\n  $ => $n\n${body}\n}`;

    rule('code-block.access').it(
      'runs a held block named by .name with the enclosing $',
      async () => {
        expect(await run(wrap('  dict[a: { $ + 1 }] => $d\n  $d.a'))).toBe(8);
      }
    );

    rule('code-block.access').it(
      'runs a held block selected by .$k with the enclosing $',
      async () => {
        expect(
          await run(wrap('  dict[a: { $ + 1 }] => $d\n  "a" => $k\n  $d.$k'))
        ).toBe(8);
      }
    );

    rule('code-block.access').it(
      'runs a held block selected by [sel] with the enclosing $',
      async () => {
        expect(await run(wrap('  dict[a: { $ + 1 }] => $d\n  $d["a"]'))).toBe(
          8
        );
        expect(await run(wrap('  list[{ $ + 1 }] => $l\n  $l[0]'))).toBe(8);
      }
    );

    rule('code-block.access').it(
      'runs a held block held by a tuple or an ordered on access',
      async () => {
        expect(await run(wrap('  tuple[{ $ + 1 }] => $t\n  $t[0]'))).toBe(8);
        expect(await run(wrap('  ordered[a: { $ + 1 }] => $o\n  $o.a'))).toBe(
          8
        );
      }
    );

    rule('code-block.access').it(
      'runs a held block selected from a literal receiver',
      async () => {
        expect(await run(wrap('  dict[a: { $ + 1 }].a'))).toBe(8);
        expect(await run(wrap('  dict[a: { $ + 1 }]["a"]'))).toBe(8);
      }
    );

    rule('code-block.unbound').it(
      'halts RILL-R005 when the enclosing scope binds no $',
      async () => {
        await expect(run('dict[a: { $ }] => $d\n$d.a')).rejects.toMatchObject({
          errorId: 'RILL-R005',
        });
      }
    );

    rule('code-block.access').it(
      'selects and then calls the result of a held block with parens',
      async () => {
        expect(
          await run('dict[a: { fn(x: number) { $x * 2 } }] => $d\n$d.a(4)')
        ).toBe(8);
      }
    );

    rule('code-block.access').it(
      'halts RILL-R002 when the result of a held block is called and is not a function',
      async () => {
        await expect(run('dict[a: { 3 }] => $d\n$d.a()')).rejects.toMatchObject(
          { errorId: 'RILL-R002' }
        );
      }
    );
  });

  describe('access as a pipe target', () => {
    const TABLE = 'dict[n: 2, double: { $.n * 2 }] => $d\n';

    rule('code-block.access-target').it(
      'binds $ to the piped value for a named field',
      async () => {
        expect(await run(`${TABLE}$d -> $d.double`)).toBe(4);
      }
    );

    rule('code-block.access-target').it(
      'binds $ to the piped value for a variable selector',
      async () => {
        expect(await run(`${TABLE}"double" => $k\n$d -> $d.$k`)).toBe(4);
      }
    );

    rule('code-block.access-target').it(
      'binds $ to the piped value for a bracket selector',
      async () => {
        expect(await run(`${TABLE}$d -> $d["double"]`)).toBe(4);
      }
    );

    rule('code-block.access-target').it(
      'continues the chain with the result of the held block',
      async () => {
        expect(await run(`${TABLE}$d -> $d.double -> { $ + 1 }`)).toBe(5);
      }
    );
  });

  describe('each selection', () => {
    rule('code-block.each-time').it(
      'runs a held block again on every selection',
      async () => {
        let count = 0;
        const result = await run(
          'dict[a: { tick() }] => $d\nlist[$d.a, $d["a"], "a" -> $d]',
          {
            functions: {
              tick: {
                params: [],
                returnType: anyTypeValue,
                fn: () => ++count,
              },
            },
          }
        );
        expect(result).toEqual([1, 2, 3]);
        expect(count).toBe(3);
      }
    );

    rule('code-block.each-time').it(
      'binds the $ of each selection to its own selector',
      async () => {
        expect(
          await run('dict[a: { "got {$}" }] => $d\nlist["a" -> $d, "a" -> $d]')
        ).toEqual(['got a', 'got a']);
      }
    );

    describe('held block scope and annotations', () => {
      rule('code-block.held').it(
        'reads the enclosing $@ lexically inside a held block run in a fold body',
        async () => {
          expect(
            await run(
              'list[1, 2, 3] -> fold(10, { dict[a: { $@ + $ }] => $d\n $@ + $d.a })'
            )
          ).toBe(91);
        }
      );

      rule('code-block.held').it(
        'attaches entry annotations to the held block',
        async () => {
          const dictResult = await run('dict[a: ^(note: "d") { 1 }]');
          const listResult = await run('list[^(note: "d") { 1 }]');
          expect(dictResult).toMatchObject({
            a: { annotations: { note: 'd' } },
          });
          expect(listResult).toMatchObject([{ annotations: { note: 'd' } }]);
        }
      );
    });

    describe('non-selecting reads', () => {
      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it iterates a dict holding a block',
        async () => {
          await expectHalt(() => run('dict[a: { 1 }] -> seq({ $ })'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /'a'/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it iterates a list holding a block',
        async () => {
          await expectHalt(() => run('list[{ 1 }] -> seq({ $ })'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /index 0/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it reads .values of a dict holding a block',
        async () => {
          await expectHalt(() => run('dict[a: { 1 }] -> .values'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /'a'/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it reads .entries of a dict holding a block',
        async () => {
          await expectHalt(() => run('dict[a: { 1 }] -> .entries'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /'a'/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it reads .first of a dict holding a block',
        async () => {
          await expectHalt(() => run('dict[a: { 1 }] -> .first()'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /'a'/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it reads .first of a list holding a block',
        async () => {
          await expectHalt(() => run('list[{ 1 }] -> .first()'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /index 0/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it spreads a dict holding a block into a call',
        async () => {
          await expectHalt(
            () =>
              run('fn(a: any) { $a } => $f\ndict[a: { 1 }] => $d\n$f(...$d)'),
            { code: 'TYPE_MISMATCH', messagePattern: /'a'/ }
          );
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it spreads a list holding a block into a call',
        async () => {
          await expectHalt(
            () => run('fn(a: any) { $a } => $f\nlist[{ 1 }] => $l\n$f(...$l)'),
            { code: 'TYPE_MISMATCH', messagePattern: /index 0/ }
          );
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it compares a dict holding a block with !=',
        async () => {
          await expectHalt(() => run('dict[a: { 1 }] => $d\n$d != $d'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /'a'/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it spreads a list holding a block',
        async () => {
          await expectHalt(() => run('list[{ 1 }] => $l\nlist[...$l]'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /index 0/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it spreads a dict holding a block',
        async () => {
          await expectHalt(() => run('dict[a: { 1 }] => $d\ndict[...$d]'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /'a'/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it compares a dict holding a block',
        async () => {
          await expectHalt(() => run('dict[a: { 1 }] => $d\n$d == $d'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /'a'/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it compares a nested block entry',
        async () => {
          await expectHalt(() => run('dict[a: list[{ 1 }]] => $d\n$d == $d'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /index 0/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it interpolates a dict holding a block',
        async () => {
          await expectHalt(() => run('dict[a: { 1 }] => $d\n"{$d}"'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /'a'/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it slices a list holding a block',
        async () => {
          await expectHalt(() => run('list[{ 1 }, 2] -> slice<0:1>'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /index 0/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it reverses a list holding a block',
        async () => {
          await expectHalt(() => run('list[{ 1 }, 2] -> .reverse'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /index 0/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it reads .head when the first entry is a block',
        async () => {
          await expectHalt(() => run('list[{ 1 }, 2] -> .head'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /index 0/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it reads .tail when the last entry is a block',
        async () => {
          await expectHalt(() => run('list[2, { 1 }] -> .tail'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /index 1/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it joins a list holding a block',
        async () => {
          await expectHalt(() => run('list[{ 1 }] -> .join(",")'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /index 0/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it tests membership in a list holding a block',
        async () => {
          await expectHalt(() => run('list[{ 1 }] -> .has(1)'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /index 0/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it passes a list holding a block to take',
        async () => {
          await expectHalt(() => run('list[{ 1 }, 2] -> take(1)'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /index 0/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it passes a list holding a block to skip',
        async () => {
          await expectHalt(() => run('list[{ 1 }, 2] -> skip(1)'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /index 0/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it passes a list holding a block to batch',
        async () => {
          await expectHalt(() => run('list[{ 1 }, 2] -> batch(1)'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /index 0/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it passes a list holding a block to window',
        async () => {
          await expectHalt(() => run('list[{ 1 }, 2] -> window(1)'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /index 0/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it passes a list holding a block to cycle',
        async () => {
          await expectHalt(() => run('list[{ 1 }, 2] -> cycle'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /index 0/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it passes a list holding a block to start_when',
        async () => {
          await expectHalt(
            () => run('list[{ 1 }, 2] -> start_when({ true })'),
            {
              code: 'TYPE_MISMATCH',
              messagePattern: /index 0/,
            }
          );
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it passes a list holding a block to stop_when',
        async () => {
          await expectHalt(() => run('list[{ 1 }, 2] -> stop_when({ true })'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /index 0/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it chains a list of transforms holding a block',
        async () => {
          await expectHalt(() => run('list[{ 1 }] => $fs\n5 -> chain($fs)'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /index 0/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it converts a list holding a block with list(any)',
        async () => {
          await expectHalt(() => run('list[{ 1 }] -> list(any)'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /index 0/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it converts a dict holding a block with map(string, any)',
        async () => {
          await expectHalt(() => run('dict[a: { 1 }] -> map(string, any)'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /'a'/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it converts a list holding a block with tuple(any)',
        async () => {
          await expectHalt(() => run('list[{ 1 }] -> tuple(any)'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /index 0/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it converts a list holding a nested block to string',
        async () => {
          await expectHalt(() => run('list[list[{ 1 }]] -> string'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /index 0/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'halts TYPE_MISMATCH naming the entry when it logs a list holding a block',
        async () => {
          await expectHalt(() => run('list[{ 1 }] -> log'), {
            code: 'TYPE_MISMATCH',
            messagePattern: /index 0/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'keeps the function message when it converts a list holding a function to string',
        async () => {
          await expectHalt(() => run('fn() { 1 } => $f\nlist[$f] -> string'), {
            code: 'RILL_R036',
            messagePattern: /contains fn/,
          });
        }
      );

      rule('code-block.non-selecting').it(
        'lets guard catch the conversion halt',
        async () => {
          expect(
            await run(
              'guard { list[{ 1 }] -> string } => $r\n$r.!code == #TYPE_MISMATCH'
            )
          ).toBe(true);
        }
      );

      rule('code-block.non-selecting').it(
        'lets guard catch the halt',
        async () => {
          const result = await run(
            'guard { dict[a: { 1 }] -> .values } => $r\n$r.!code == #TYPE_MISMATCH'
          );
          expect(result).toBe(true);
        }
      );
    });
  });
  describe('access by .at and destructure', () => {
    rule('code-block.access').it(
      'runs a held block selected by .at on a list with the enclosing $',
      async () => {
        expect(
          await run('7 -> {\n  list[{ $ + 1 }, 2] => $l\n  $l.at(0)\n}')
        ).toBe(8);
      }
    );

    rule('code-block.access').it(
      'runs a held block selected by .at on a tuple',
      async () => {
        expect(await run('tuple[{ 1 }, 2] => $t\n$t.at(0)')).toBe(1);
      }
    );

    rule('code-block.access').it(
      'runs a held block selected by .at with a negative index',
      async () => {
        expect(await run('list[2, { 3 }] => $l\n$l.at(-1)')).toBe(3);
      }
    );

    rule('code-block.access').it(
      'runs a held block selected by .at every time',
      async () => {
        expect(
          await run(
            'list[{ 1 }] => $l\n$l.at(0) => $a\n$l.at(0) => $b\n$a + $b'
          )
        ).toBe(2);
      }
    );

    rule('code-block.access').it(
      'binds the result of a held block in a list destructure position',
      async () => {
        expect(await run('list[{ 1 }, 2] -> destruct<$a, $b>\n$a + $b')).toBe(
          3
        );
      }
    );

    rule('code-block.access').it(
      'binds the result of a held block in a tuple destructure position',
      async () => {
        expect(await run('tuple[{ 1 }, 2] -> destruct<$a, $b>\n$a + $b')).toBe(
          3
        );
      }
    );

    rule('code-block.access').it(
      'binds the result of a held block in a dict key destructure',
      async () => {
        expect(
          await run('dict[a: { 1 }, b: 2] -> destruct<a: $x, b: $y>\n$x + $y')
        ).toBe(3);
      }
    );

    rule('code-block.access').it(
      'binds the result of a held block in an ordered key destructure',
      async () => {
        expect(
          await run(
            'ordered[a: { 1 }, b: 2] -> destruct<a: $x, b: $y>\n$x + $y'
          )
        ).toBe(3);
      }
    );
  });

  describe('check on a held entry', () => {
    rule('code-block.check').it(
      'yields true when the held block result has the type',
      async () => {
        expect(await run('"a" -> dict[a: { 5 }:?number]')).toBe(true);
      }
    );

    rule('code-block.check').it(
      'yields false when the held block result lacks the type',
      async () => {
        expect(await run('dict[a: { "x" }:?number] => $d\n$d.a')).toBe(false);
      }
    );
  });

  describe('pipe-variable access as a pipe target', () => {
    rule('code-block.access-target').it(
      'runs a held list element selected by $[i] with the piped value',
      async () => {
        expect(await run('list[{ $.len }] -> $[0]')).toBe(1);
      }
    );

    rule('code-block.access-target').it(
      'runs a held dict entry selected by $.name with the piped value',
      async () => {
        expect(await run('dict[a: { $.len }] -> $.a')).toBe(1);
      }
    );
  });

  describe('reads covered by the non-selecting gate', () => {
    for (const src of [
      'list[{ 1 }] -> .has_any(list[1])',
      'list[{ 1 }] -> .has_all(list[1])',
      'list[{ 1 }] -> ordered',
      'dict[a: { 1 }] -> ordered(a: any)',
    ]) {
      rule('code-block.non-selecting').it(
        `halts TYPE_MISMATCH for ${src}`,
        async () => {
          await expectHalt(() => run(src), { code: 'TYPE_MISMATCH' });
        }
      );
    }
  });

  describe('destructure runs a held block before its type assertion', () => {
    rule('code-block.access').it(
      'asserts the block result against the position type',
      async () => {
        expect(await run('list[{ "x" }] -> destruct<$a:string>\n$a')).toBe('x');
        await expectHalt(
          () => run('list[{ "x" }] -> destruct<$a:number>\n$a'),
          { code: 'TYPE_MISMATCH' }
        );
      }
    );

    rule('code-block.access').it(
      'leaves a fn entry uncalled when .at selects it',
      async () => {
        expect(await run('list[fn { 5 }] -> .at(0) => $f\n$f()')).toBe(5);
      }
    );
  });

  describe('host conversion', () => {
    rule('code-block.host').it(
      'reports a held entry as the signature of fn() without running it',
      async () => {
        const native = toNative(await run('dict[a: { 1 }]'));
        expect(native.value).toEqual({ a: { signature: 'fn():any' } });
        expect(native.rillTypeSignature).toBe('dict(a: fn():any)');
      }
    );
  });

  describe('host function arguments', () => {
    const sink = {
      functions: {
        sink: hostFn({
          params: [hostParam('value', { kind: 'any' })],
          fn: () => 'called',
        }),
      },
    };

    rule('code-block.host-argument').it(
      'halts #TYPE_MISMATCH when an argument holds a block at any depth',
      async () => {
        await expectHalt(() => run('sink(list[dict[a: { 1 }]])', sink), {
          code: 'TYPE_MISMATCH',
          messagePattern: "'a'",
        });
      }
    );

    rule('code-block.host-argument').it(
      'passes a whole-argument block and a fn entry',
      async () => {
        expect(await run('sink({ 1 })', sink)).toBe('called');
        expect(await run('sink(dict[a: fn { 1 }])', sink)).toBe('called');
      }
    );
  });

  describe('enumerate', () => {
    rule('code-block.non-selecting').it(
      'enumerate halts #TYPE_MISMATCH on a held entry',
      async () => {
        await expectHalt(() => run('enumerate(dict[a: { 1 }])'), {
          code: 'TYPE_MISMATCH',
          messagePattern: "'a'",
        });
      }
    );
  });

  describe('positions, constructs, and parameters', () => {
    const hasClosure = (source: string): boolean =>
      JSON.stringify(parse(source)).includes('"type":"Closure"');

    rule('code-block.positions').it(
      'parses a block outside a function literal or an argument as no function',
      () => {
        for (const source of [
          '{ 5 }',
          '({ 5 })',
          '1 -> { $ }',
          'list[{ 5 }]',
          'tuple[{ 5 }]',
          'dict[a: { 5 }]',
          'ordered[a: { 5 }]',
          'true ? { 5 } ! { 6 }',
          'guard { 5 }',
        ]) {
          expect(hasClosure(source)).toBe(false);
        }
        expect(hasClosure('fn { 5 }')).toBe(true);
      }
    );

    rule('code-block.construct').it(
      'runs a construct body as its construct directs',
      async () => {
        expect(await run('true ? { 5 } ! { 6 }')).toBe(5);
        expect(await run('false ? { 5 } ! { 6 }')).toBe(6);
        expect(await run('0 -> while ($ < 3) do { $ + 1 }')).toBe(3);
        expect(await run('guard { 5 }')).toBe(5);
        expect(await run('retry(attempts: 2) { 7 }')).toBe(7);
        expect(await run('5 -> pass { "a" }')).toBe(5);
      }
    );

    rule('code-block.no-params').it(
      'resolves $ and $@ lexically to the bindings around the block',
      async () => {
        expect(await run('7 -> { { $ + 1 } }')).toBe(8);
        expect(await run('list[1, 2] -> fold(0, { 1 -> { $@ + $ } })')).toBe(2);
      }
    );
  });

  describe('a call on an accessed held block', () => {
    const held = 'dict[a: { fn(x) { $x * 10 } }] => $d\n';

    rule('code-block.access-call').it(
      'runs the held block, then calls its result with the arguments',
      async () => {
        expect(await run(`${held}$d.a(3)`)).toBe(30);
        expect(await run(`${held}"a" => $k\n$d.$k(3)`)).toBe(30);
        expect(await run(`${held}$d["a"](3)`)).toBe(30);
        expect(await run('list[{ fn(x) { $x * 10 } }] => $l\n$l[0](3)')).toBe(
          30
        );
      }
    );

    rule('code-block.access-call').it(
      'runs the held block with the enclosing $',
      async () => {
        expect(
          await run(
            '4 -> {\n  dict[a: { $ => $n\n fn(x) { $x * $n } }] => $d\n  $d.a(3)\n}'
          )
        ).toBe(12);
      }
    );
  });

  describe('.len and .keys on held blocks', () => {
    rule('code-block.shape-reads').it(
      'counts and names held entries without running them',
      async () => {
        expect(
          await run('dict[a: { error "ran" }] => $d\nlist[$d.len, $d.keys]')
        ).toEqual([1, ['a']]);
        expect(
          await run('ordered[a: { error "ran" }] => $o\nlist[$o.len, $o.keys]')
        ).toEqual([1, ['a']]);
        expect(await run('list[{ error "ran" }, 2] => $l\n$l.len')).toBe(2);
        expect(await run('tuple[{ error "ran" }] => $t\n$t.len')).toBe(1);
      }
    );
  });
});
