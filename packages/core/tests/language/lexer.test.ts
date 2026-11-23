/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Runtime Tests: Lexer
 * Tests for lexer-level source handling: byte-order-mark and control
 * characters that are not specific to any single construct, whitespace,
 * identifiers, keywords, and operator tokens.
 */

import { describe, expect, it } from 'vitest';

import { anyTypeValue, type RillFunctionDefinition } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { rule } from '../helpers/rule.js';

/** A zero-parameter host function that returns its own name. */
function hostNamed(name: string): Record<string, RillFunctionDefinition> {
  return {
    [name]: { params: [], returnType: anyTypeValue, fn: () => `host:${name}` },
  };
}

describe('Rill Runtime: Lexer', () => {
  describe('UTF-8 Byte-Order-Mark', () => {
    rule('source-text.bom').it(
      'skips a leading BOM at the very start of the source',
      async () => {
        const script = '﻿"hello"';
        expect(await run(script)).toBe('hello');
      }
    );

    rule('source-text.bom-elsewhere').it(
      'rejects a BOM anywhere other than position 0',
      async () => {
        const script = '"a" -> $﻿x';
        await expect(run(script)).rejects.toThrow('Unexpected character');
      }
    );

    rule('source-text.bom-elsewhere').it.each([
      ['a second leading BOM', '﻿﻿1'],
      ['a trailing BOM', '1﻿'],
      ['a BOM at the start of a later line', '1\n﻿2'],
    ])('rejects %s with RILL-L002', async (_name, source) => {
      await expect(run(source)).rejects.toMatchObject({ errorId: 'RILL-L002' });
    });
  });

  describe('Bare carriage return in single-line strings', () => {
    it('rejects a bare CR inside a single-line string literal', async () => {
      const script = '"hello\r world"';
      await expect(run(script)).rejects.toThrow('Unterminated string literal');
    });

    rule('source-text.line-end').it(
      'still accepts a CRLF pair as the line ending before a string',
      async () => {
        const script = '"before"\r\n"hello"';
        expect(await run(script)).toBe('hello');
      }
    );
  });

  describe('Character set', () => {
    rule('source-text.charset').it.each([
      ['a semicolon', '1 ; 2'],
      ['a single quote', "'a'"],
      ['a backtick', '`x`'],
      ['a tilde', '1 ~ 2'],
      ['a backslash', '\\'],
      ['a NUL character', '1\u0000'],
      ['a non-ASCII character', '1 é'],
    ])('rejects %s outside a string with RILL-L002', async (_name, source) => {
      await expect(run(source)).rejects.toMatchObject({ errorId: 'RILL-L002' });
    });

    rule('source-text.free-text').it(
      'accepts any character inside a string literal or a comment',
      async () => {
        expect(await run('"a\u0000b" -> .len')).toBe(3);
        expect(await run('"a﻿b" -> .len')).toBe(3);
        expect(await run('"; ~ \\\\ é"')).toBe('; ~ \\ é');
        expect(await run('1 # ; ~ ` é ﻿ \u0000\n2')).toBe(2);
      }
    );
  });

  describe('Whitespace', () => {
    rule('whitespace.blank').it(
      'reads any run of spaces and tabs as one separator',
      async () => {
        expect(await run('1\t+\t2')).toBe(3);
        expect(await run('1     +     2')).toBe(3);
        expect(await run('1 \t \t + 2')).toBe(3);
      }
    );

    rule('whitespace.optional').it(
      'reads adjacent tokens the same without whitespace',
      async () => {
        expect(await run('1+2')).toBe(3);
        expect(await run('1->{ $ + 1 }')).toBe(2);
        expect(await run('dict[a:1]=>$d\n$d.a')).toBe(1);
      }
    );

    rule('whitespace.member').it(
      'ignores whitespace on either side of a field-access dot',
      async () => {
        expect(await run('dict[a: 1] => $d\n$d. a')).toBe(1);
        expect(await run('dict[a: 1] => $d\n$d .a')).toBe(1);
      }
    );

    rule('whitespace.other').it.each([
      ['a no-break space', '1  + 2'],
      ['a vertical tab', '1\u000B+ 2'],
      ['a form feed', '1\u000C+ 2'],
      ['a line separator', '1 + 2'],
      ['an ideographic space', '1　+ 2'],
    ])('rejects %s with RILL-L002', async (_name, source) => {
      await expect(run(source)).rejects.toMatchObject({ errorId: 'RILL-L002' });
    });
  });

  describe('Comments', () => {
    rule('whitespace.comment').it(
      'discards a comment up to the line feed',
      async () => {
        expect(await run('1 # comment\n2')).toBe(2);
        expect(await run('# a whole line\n3')).toBe(3);
        expect(await run('4 # trailing comment')).toBe(4);
      }
    );

    rule('whitespace.comment-text').it(
      'opens no string, block, or capture inside a comment',
      async () => {
        expect(await run('1 # an open "quote\n2')).toBe(2);
        expect(await run('1 # an open { brace\n2')).toBe(2);
        expect(await run('1 # => $x\n2')).toBe(2);
      }
    );
  });

  describe('Identifiers', () => {
    rule('identifier.form').it(
      'accepts a letter or underscore, then letters, digits, and underscores',
      async () => {
        expect(await run('1 => $_\n$_')).toBe(1);
        expect(await run('2 => $__a1\n$__a1')).toBe(2);
        expect(await run('dict[a_b_c9: 3].a_b_c9')).toBe(3);
      }
    );

    rule('identifier.ascii').it.each([
      ['a variable name', '"a" => $é'],
      ['a dict key', 'dict[é: 1]'],
    ])(
      'rejects a non-ASCII letter in %s with RILL-L002',
      async (_name, source) => {
        await expect(run(source)).rejects.toMatchObject({
          errorId: 'RILL-L002',
        });
      }
    );

    rule('identifier.case').it(
      'treats names that differ in case as distinct',
      async () => {
        expect(await run('1 => $x\n2 => $X\n$x + $X')).toBe(3);
        expect(await run('dict[A: 1, a: 2] => $d\n$d.A')).toBe(1);
        await expect(run('1 => $X\n$x')).rejects.toThrow('Undefined variable');
      }
    );
  });

  describe('Keywords', () => {
    rule('keyword.reserved').it(
      'reads a reserved word as its construct even when the host registers that name',
      async () => {
        expect(await run('true', { functions: hostNamed('true') })).toBe(true);
        await expect(
          run('guard', { functions: hostNamed('guard') })
        ).rejects.toThrow('Expected { to start guard/retry body');
        await expect(
          run('while', { functions: hostNamed('while') })
        ).rejects.toThrow('requires `(condition)`');
      }
    );

    rule('keyword.lowercase').it(
      'reads a reserved word in another case as an identifier',
      async () => {
        expect(await run('While', { functions: hostNamed('While') })).toBe(
          'host:While'
        );
        expect(await run('Guard()', { functions: hostNamed('Guard') })).toBe(
          'host:Guard'
        );
      }
    );

    rule('keyword.other').it(
      'reads any other bare word as a function call',
      async () => {
        expect(await run('for', { functions: hostNamed('for') })).toBe(
          'host:for'
        );
        expect(await run('if()', { functions: hostNamed('if') })).toBe(
          'host:if'
        );
        for (const word of ['for', 'if', 'let', 'else', 'in']) {
          expect(
            await run(`guard { ${word} } => $r\n$r.!code == #RILL_R006`)
          ).toBe(true);
        }
      }
    );

    rule('keyword.name').it(
      'accepts a reserved word as a key, field, variable, and atom name',
      async () => {
        expect(await run('dict[while: 1].while')).toBe(1);
        expect(await run('dict[break: 1] => $d\n$d.break')).toBe(1);
        expect(await run('1 => $true\n$true')).toBe(1);
        expect(await run('#error == #error')).toBe(true);
      }
    );
  });

  describe('Operator tokens', () => {
    rule('token.longest').it.each([
      ['=== reads == then =', '1 === 1'],
      ['->> reads -> then >', '1 ->> 2'],
      ['<== reads <= then =', '1 <== 2'],
    ])('%s and is rejected with RILL-P001', async (_name, source) => {
      await expect(run(source)).rejects.toMatchObject({ errorId: 'RILL-P001' });
    });

    rule('token.longest').it(
      'reads each two-character operator as one token',
      async () => {
        expect(await run('1 != 2')).toBe(true);
        expect(await run('1 >= 2')).toBe(false);
        expect(await run('true && false || true')).toBe(true);
      }
    );

    rule('token.split').it.each([
      ['- >', '1 - > 2'],
      ['! =', '1 ! = 2'],
      ['= >', '1 = > $x'],
      ['> =', '1 > = 2'],
    ])(
      'splits %s into two tokens, rejected with RILL-P001',
      async (_name, source) => {
        await expect(run(source)).rejects.toMatchObject({
          errorId: 'RILL-P001',
        });
      }
    );

    rule('token.stray-closer').it.each([
      ['a parenthesis', '1 )'],
      ['a bracket', '1 ]'],
      ['a brace', '1 }'],
    ])('rejects a stray closing %s with RILL-P001', async (_name, source) => {
      await expect(run(source)).rejects.toMatchObject({ errorId: 'RILL-P001' });
    });

    rule('token.removed-sigil').it.each([
      ['*[', '*[1, 2]'],
      ['*<', '*<$a, $b>'],
      ['/<', '/<0:1>'],
    ])('rejects the removed %s form with RILL-P009', async (_name, source) => {
      await expect(run(source)).rejects.toMatchObject({ errorId: 'RILL-P009' });
    });
  });
});
