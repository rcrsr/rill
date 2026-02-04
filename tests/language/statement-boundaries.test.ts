/**
 * Rill Runtime Tests: Statement Boundaries
 * Tests for whitespace handling and statement continuation/termination
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Statement Boundaries', () => {
  describe('Single Line Continuations', () => {
    it('pipe and method on same line', async () => {
      expect(await run('"hello" -> .len')).toBe(5);
    });

    it('multiple pipes on same line', async () => {
      expect(await run('"hello" -> .len -> ($ * 2)')).toBe(10);
    });

    it('pipe to block on same line', async () => {
      expect(await run('"x" -> { "{$}y" }')).toBe('xy');
    });

    it('conditional with else on same line', async () => {
      expect(await run('false -> ? { "yes" } ! { "no" }')).toBe('no');
    });

    it('else-if chain on same line', async () => {
      expect(await run('"c" -> .eq("a") ? 1 ! .eq("b") ? 2 ! 3')).toBe(3);
    });

    it('pipe to capture on same line', async () => {
      expect(await run('"value" :> $x\n$x')).toBe('value');
    });
  });

  describe('Statement Boundaries at Newlines', () => {
    describe('Variable Start ($)', () => {
      it('variable starts new statement after newline', async () => {
        const script = `"a" :> $x
$x`;
        expect(await run(script)).toBe('a');
      });

      it('variable call starts new statement', async () => {
        const script = `|x| { $x } :> $fn
$fn("test")`;
        expect(await run(script)).toBe('test');
      });
    });

    describe('Literal Start', () => {
      it('string starts new statement', async () => {
        const script = `"first" :> $a
"second"`;
        expect(await run(script)).toBe('second');
      });

      it('number starts new statement', async () => {
        const script = `"ignored" :> $a
42`;
        expect(await run(script)).toBe(42);
      });

      it('bool starts new statement', async () => {
        const script = `"ignored" :> $a
true`;
        expect(await run(script)).toBe(true);
      });

      it('tuple starts new statement', async () => {
        const script = `"ignored" :> $a
[1, 2, 3]`;
        expect(await run(script)).toEqual([1, 2, 3]);
      });

      it('dict starts new statement', async () => {
        const script = `"ignored" :> $a
[x: 1]`;
        expect(await run(script)).toEqual({ x: 1 });
      });
    });

    describe('Control Flow Start', () => {
      it('block starts new statement', async () => {
        const script = `"ignored" :> $a
"" -> { "block result" }`;
        expect(await run(script)).toBe('block result');
      });
    });

    describe('Function Call Start', () => {
      it('function call starts new statement', async () => {
        const script = `"ignored" :> $a
identity("explicit")`;
        expect(await run(script)).toBe('explicit');
      });
    });
  });

  describe('Method Chaining', () => {
    it('method chain on single line', async () => {
      expect(await run('"hello".len')).toBe(5);
    });

    it('multiple methods chained', async () => {
      expect(await run('"  hello  ".trim.len')).toBe(5);
    });

    it('method with args', async () => {
      expect(await run('"hello world".split(" ").head')).toBe('hello');
    });
  });

  describe('Whitespace Handling', () => {
    it('ignores leading whitespace', async () => {
      const script = `    "hello"`;
      expect(await run(script)).toBe('hello');
    });

    it('ignores trailing whitespace', async () => {
      const script = `"hello"    `;
      expect(await run(script)).toBe('hello');
    });

    it('ignores blank lines between statements', async () => {
      const script = `"a" :> $x

$x`;
      expect(await run(script)).toBe('a');
    });

    it('ignores multiple blank lines', async () => {
      const script = `"a" :> $x



$x`;
      expect(await run(script)).toBe('a');
    });

    it('handles tabs and spaces in line', async () => {
      const script = `"hello"	-> 	.len`;
      expect(await run(script)).toBe(5);
    });
  });

  describe('Complex Multi-Statement Scripts', () => {
    it('multiple capture statements', async () => {
      const script = `"hello" :> $greeting
5 :> $count
[$greeting, $count]`;
      expect(await run(script)).toEqual(['hello', 5]);
    });

    it('capture then use in expression', async () => {
      const script = `"hello" -> .len :> $length
$length -> ($ * 2)`;
      expect(await run(script)).toBe(10);
    });

    it('for loop with block on same line', async () => {
      const script = `[1, 2, 3] -> each { ($ > 1) ? ($ * 10) ! $ }`;
      expect(await run(script)).toEqual([1, 20, 30]);
    });

    it('capture, transform, and loop', async () => {
      const script = `"a,b,c".split(",") :> $parts
$parts -> each { "{$}!" }`;
      expect(await run(script)).toEqual(['a!', 'b!', 'c!']);
    });

    it('nested control flow on single lines', async () => {
      const script = `[1, 2, 3] -> each { ($ > 1) ? "big" ! "small" }`;
      expect(await run(script)).toEqual(['small', 'big', 'big']);
    });
  });

  describe('Edge Cases', () => {
    it('empty script errors (implicit $ undefined)', async () => {
      await expect(run('')).rejects.toThrow('Undefined variable: $');
    });

    it('whitespace-only script errors (implicit $ undefined)', async () => {
      await expect(run('   \n\n   ')).rejects.toThrow('Undefined variable: $');
    });

    it('comment-only script errors (implicit $ undefined)', async () => {
      await expect(run('# just a comment')).rejects.toThrow(
        'Undefined variable: $'
      );
    });

    it('handles CRLF line endings', async () => {
      const script = '"a" :> $x\r\n"b" :> $y\r\n[$x, $y]';
      expect(await run(script)).toEqual(['a', 'b']);
    });

    it('statement after comment', async () => {
      const script = `# comment
"hello"`;
      expect(await run(script)).toBe('hello');
    });

    it('inline comment does not affect statement', async () => {
      expect(await run('"hello" -> .len # get length')).toBe(5);
    });
  });

  describe('Parser Behavior', () => {
    it('rejects pipe on newline (-> requires target on same line)', async () => {
      const script = `"hello" ->
.len`;
      await expect(run(script)).rejects.toThrow();
    });

    it('else on newline becomes separate statement (! starts new statement)', async () => {
      // With new syntax, ! at line start is negation, not else clause
      // So this parses as two statements: conditional (returns false) and negation of block
      const script = `false -> ? { "yes" }
! { "no" }`;
      // The block { "no" } is a closure, and ! tries to negate it
      // This throws because negation requires boolean operand
      await expect(run(script)).rejects.toThrow(
        'Negation operator (!) requires boolean operand, got closure'
      );
    });
  });
});
