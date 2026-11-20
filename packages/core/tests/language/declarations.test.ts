/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: declarations
 *
 * A written type followed by a literal on the same line forms one literal and
 * sets the declared type. Covers spacing, atoms, evaluation, spellings, leaf
 * and scalar forms, and the declared pipe target.
 */

import { describe, expect } from 'vitest';
import { parse, ParseError, tokenize, TOKEN_TYPES } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';

function stripSpans(node: unknown): unknown {
  return JSON.parse(
    JSON.stringify(node, (key, value) => (key === 'span' ? undefined : value))
  );
}

async function expectParseError(
  source: string,
  errorId: string,
  messagePattern?: RegExp
): Promise<void> {
  let err: unknown;
  try {
    parse(source);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(ParseError);
  expect(err).toHaveProperty('errorId', errorId);
  if (messagePattern !== undefined) {
    expect((err as Error).message).toMatch(messagePattern);
  }
}

describe('Rill Language: declarations', () => {
  describe('form and spacing', () => {
    const spaced: Array<[string, string]> = [
      ['list [1, 2]', 'list[1, 2]'],
      ['dict [a: 1]', 'dict[a: 1]'],
      ['tuple [1]', 'tuple[1]'],
      ['ordered [a: 1]', 'ordered[a: 1]'],
    ];

    for (const [spacedSource, adjacentSource] of spaced) {
      rule('declaration.spacing').it(
        `parses ${spacedSource} to the same AST as ${adjacentSource}`,
        () => {
          expect(stripSpans(parse(spacedSource).statements)).toEqual(
            stripSpans(parse(adjacentSource).statements)
          );
        }
      );

      rule('declaration.spacing').it(
        `evaluates ${spacedSource} to the same value as ${adjacentSource}`,
        async () => {
          expect(await run(spacedSource)).toEqual(await run(adjacentSource));
        }
      );
    }

    rule('declaration.spacing').it(
      'tokenizes list [1] with one LIST_LBRACKET token',
      () => {
        const tokens = tokenize('list [1]');
        const brackets = tokens.filter(
          (t) => t.type === TOKEN_TYPES.LIST_LBRACKET
        );
        expect(brackets).toHaveLength(1);
        expect(brackets[0]!.value).toBe('list[');
        expect(tokens.filter((t) => t.type === TOKEN_TYPES.LBRACKET)).toEqual(
          []
        );
      }
    );

    rule('declaration.spacing').it(
      'keeps use <ext:x> a RILL-P007 error',
      async () => {
        await expectParseError('use <ext:x>', 'RILL-P007');
      }
    );

    rule('declaration.spacing').it(
      'accepts a spaced list as a guard on selector',
      async () => {
        expect(
          await run(
            'guard<on: list [#TYPE_MISMATCH]> { "a" -> :number } ?? "caught"'
          )
        ).toBe('caught');
      }
    );

    rule('declaration.spacing').it(
      'accepts a spaced list as a multi-key dict key',
      async () => {
        expect(await run('dict[list ["a", "b"]: 1]')).toEqual({ a: 1, b: 1 });
      }
    );

    rule('declaration.form').it(
      'forms one literal from list(number) and [1, 2]',
      async () => {
        expect(await run('list(number)[1, 2] == [1, 2]')).toBe(true);
      }
    );

    rule('declaration.form').it(
      'parses list(number) then a newline then [1] as two statements',
      () => {
        expect(parse('list(number)\n[1]').statements).toHaveLength(2);
      }
    );
  });

  describe('atom', () => {
    rule('declaration.atom').it(
      'halts string #note with the comment hint',
      async () => {
        await expectHalt(() => run('string #note'), {
          code: 'TYPE_MISMATCH',
          messagePattern: "a comment needs a space after '#'",
        });
      }
    );

    rule('declaration.atom').it(
      'halts union(#a, #b) #c without the comment hint',
      async () => {
        let message = '';
        try {
          await run('union(#a, #b) #c');
        } catch (e) {
          message = e instanceof Error ? e.message : String(e);
        }
        expect(message).not.toBe('');
        expect(message).not.toContain('a comment needs a space');
      }
    );

    rule('declaration.atom').it(
      'halts list(number) #ids with the comment hint',
      async () => {
        await expectHalt(() => run('list(number) #ids'), {
          code: 'TYPE_MISMATCH',
          messagePattern: "a comment needs a space after '#'",
        });
      }
    );

    rule('declaration.atom').it('runs atom #wired', async () => {
      const atom = await run('atom #wired');
      expect(atom).toMatchObject({ atom: { name: 'wired' } });
      expect(await run('atom #wired -> .^type.signature')).toBe('atom');
    });

    rule('declaration.atom').it('runs union(#a, #b) #a', async () => {
      expect(await run('union(#a, #b) #a')).toMatchObject({
        atom: { name: 'a' },
      });
      expect(await run('union(#a, #b) #a -> .^type.signature')).toBe(
        'union(#a, #b)'
      );
    });
  });

  describe('evaluation', () => {
    rule('declaration.sets-type', 'declaration.spellings').it(
      'reports the declared type signature and the effective type',
      async () => {
        const src = 'list(union(number, string))[1] => $x\n';
        expect(await run(`${src}$x.^type.signature`)).toBe(
          'list(union(number, string))'
        );
        expect(await run(`${src}$x.^effective.signature`)).toBe('list(number)');
      }
    );

    rule('declaration.scalar', 'declaration.sets-type').it(
      'declares a string into a closed union',
      async () => {
        expect(await run('union("a", "b") "a" => $x\n$x.^type.signature')).toBe(
          'union("a", "b")'
        );
      }
    );

    rule('declaration.unspecified').it(
      'infers list(number) from list()[1]',
      async () => {
        expect(await run('list()[1].^type.signature')).toBe('list(number)');
      }
    );

    rule('declaration.unspecified').it(
      'infers list(number) from list(any)[1]',
      async () => {
        expect(await run('list(any)[1].^type.signature')).toBe('list(number)');
      }
    );

    rule('declaration.leaf').it(
      'reads string() "a" as string "a"',
      async () => {
        expect(await run('string() "a" == string "a"')).toBe(true);
      }
    );

    rule('declaration.spellings').it(
      'declares tuple(number)[1] a tuple',
      async () => {
        expect(await run('tuple(number)[1]')).toEqual({
          __rill_tuple: true,
          entries: [1],
        });
      }
    );

    rule('declaration.mismatch').it(
      'halts #TYPE_MISMATCH for list(number)["a"]',
      async () => {
        await expectHalt(() => run('list(number)["a"]'), {
          code: 'TYPE_MISMATCH',
        });
      }
    );

    rule('declaration.mismatch').it(
      'recovers list(number)["a"] through guard',
      async () => {
        expect(await run('guard { list(number)["a"] } ?? "recovered"')).toBe(
          'recovered'
        );
      }
    );

    rule('declaration.sets-type', 'declaration.spellings').it(
      'checks each element against the declared element type',
      async () => {
        expect(
          await run('list(union(number, string))[1, "a"] -> seq({ $ == "a" })')
        ).toEqual([false, true]);
      }
    );
  });

  describe('declared pipe target', () => {
    rule('declaration.pipe-target').it(
      'indexes a declared list target',
      async () => {
        expect(await run('1 -> list(number)[10, 20]')).toBe(20);
      }
    );

    rule('declaration.pipe-target').it(
      'selects from a declared dict target and keeps the declared type',
      async () => {
        expect(await run('"a" -> dict(a: number)[a: 1]')).toBe(1);
        expect(
          await run('"a" -> dict(a: number)[a: 1] => $v\n$v.^type')
        ).toEqual(await run('number'));
      }
    );

    rule('declaration.pipe-target').it(
      'treats a declared string target as the bare string target',
      async () => {
        expect(await run('5 -> string "v{$}"')).toBe('v5');
      }
    );

    rule('declaration.pipe-target').it(
      'rejects a declared atom target over an atom union without the comment hint',
      () => {
        let message = '';
        try {
          parse('1 -> union(#a, #b) #c');
        } catch (e) {
          message = e instanceof ParseError ? e.message : '';
        }
        expect(message).toContain('declared AtomLiteral value');
        expect(message).not.toContain('a comment needs a space');
      }
    );

    rule('declaration.pipe-target').it(
      'rejects a string literal that ignores the value with RILL-P031',
      async () => {
        await expectParseError('1 -> string "x"', 'RILL-P031');
      }
    );

    rule('declaration.pipe-target').it(
      'rejects a list literal that reads $ with RILL-P030',
      async () => {
        await expectParseError('1 -> list(number)[$]', 'RILL-P030');
      }
    );

    rule('declaration.pipe-target').it(
      'rejects a declared number target with RILL-P001',
      async () => {
        await expectParseError('1 -> number 5', 'RILL-P001', /pipe target/i);
      }
    );

    rule('declaration.pipe-target').it(
      'rejects a declared atom target with RILL-P001 and the comment hint',
      async () => {
        await expectParseError(
          '1 -> string #n',
          'RILL-P001',
          /a comment needs a space after '#'/
        );
      }
    );
  });
});
