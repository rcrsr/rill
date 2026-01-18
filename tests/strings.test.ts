/**
 * Rill Runtime Tests: Strings (Extended)
 * Tests for heredocs, comments, escape sequences, and interpolation edge cases
 */

import { describe, expect, it } from 'vitest';

import { run } from './helpers/runtime.js';

describe('Rill Runtime: Strings (Extended)', () => {
  describe('Heredoc Strings', () => {
    it('parses single-line heredoc', async () => {
      const script = `<<EOF
hello world
EOF`;
      // Heredocs include trailing newline from content
      expect(await run(script)).toBe('hello world\n');
    });

    it('parses multi-line heredoc', async () => {
      const script = `<<END
line one
line two
line three
END`;
      expect(await run(script)).toBe('line one\nline two\nline three\n');
    });

    it('preserves whitespace in heredoc', async () => {
      const script = `<<DOC
  indented
    more indent
DOC`;
      expect(await run(script)).toBe('  indented\n    more indent\n');
    });

    it('allows quotes in heredoc without escaping', async () => {
      const script = `<<TEXT
She said "hello" and 'goodbye'
TEXT`;
      expect(await run(script)).toBe(`She said "hello" and 'goodbye'\n`);
    });

    it('allows backslashes in heredoc without escaping', async () => {
      const script = `<<PATH
C:\\Users\\test\\file.txt
PATH`;
      expect(await run(script)).toBe('C:\\Users\\test\\file.txt\n');
    });

    it('allows escaped braces in heredoc', async () => {
      const script = `<<CODE
function|| {{ return {{a: 1}}; }}
CODE`;
      expect(await run(script)).toBe('function|| { return {a: 1}; }\n');
    });

    it('uses custom delimiter', async () => {
      const script = `<<MYDELIM
content here
MYDELIM`;
      expect(await run(script)).toBe('content here\n');
    });

    it('handles empty heredoc', async () => {
      const script = `<<EMPTY
EMPTY`;
      expect(await run(script)).toBe('');
    });

    it('captures heredoc in variable via block', async () => {
      // Heredocs can't be directly piped; wrap in block to chain
      const script = `{
<<MSG
Hello
MSG
} -> $greeting
$greeting -> .trim`;
      expect(await run(script)).toBe('Hello');
    });

    it('uses heredoc result with method via block', async () => {
      // Wrap heredoc in block to enable piping
      const script = `{
<<TXT
hi
TXT
} -> .trim -> .len`;
      expect(await run(script)).toBe(2);
    });
  });

  describe('Comments', () => {
    it('ignores single-line comment', async () => {
      const script = `# This is a comment
"hello"`;
      expect(await run(script)).toBe('hello');
    });

    it('ignores comment at end of line', async () => {
      const script = `"hello" -> $x # capture greeting
$x`;
      expect(await run(script)).toBe('hello');
    });

    it('ignores multiple comments', async () => {
      const script = `# First comment
"a" -> $a
# Second comment
"b" -> $b
# Third comment
[$a, $b]`;
      expect(await run(script)).toEqual(['a', 'b']);
    });

    it('does not treat # inside string as comment', async () => {
      expect(await run('"hello # world"')).toBe('hello # world');
    });

    it('handles comment-only lines', async () => {
      const script = `# comment 1
# comment 2
# comment 3
42`;
      expect(await run(script)).toBe(42);
    });

    it('handles inline comment after pipe', async () => {
      const script = `"test" -> .len # get length`;
      expect(await run(script)).toBe(4);
    });

    it('handles comment after block', async () => {
      const script = `true -> ? { "yes" } # conditional result`;
      expect(await run(script)).toBe('yes');
    });
  });

  describe('Escape Sequences', () => {
    it('handles carriage return escape', async () => {
      expect(await run('"a\\rb"')).toBe('a\rb');
    });

    it('handles escaped braces with {{ }}', async () => {
      expect(await run('"value: {{not interpolated}}"')).toBe(
        'value: {not interpolated}'
      );
    });

    it('combines multiple escape types', async () => {
      expect(await run('"line1\\nline2\\ttab\\\\backslash"')).toBe(
        'line1\nline2\ttab\\backslash'
      );
    });

    it('handles escape before interpolation', async () => {
      expect(await run('"x" -> $v\n"\\n{$v}"')).toBe('\nx');
    });

    it('handles CRLF in string', async () => {
      expect(await run('"line1\\r\\nline2"')).toBe('line1\r\nline2');
    });
  });

  describe('String Interpolation Edge Cases', () => {
    it('interpolates variable', async () => {
      expect(await run('"hello" -> $v\n"say: {$v}"')).toBe('say: hello');
    });

    it('interpolates field access', async () => {
      expect(await run('[a: 1] -> $d\n"val: {$d.a}"')).toBe('val: 1');
    });

    it('interpolates tuple element via .at', async () => {
      expect(await run('[1, 2, 3] -> $t\n$t.at(1) -> $v\n"second: {$v}"')).toBe(
        'second: 2'
      );
    });

    it('interpolates multiple values', async () => {
      const script = `"a" -> $x
"b" -> $y
"{$x}-{$y}"`;
      expect(await run(script)).toBe('a-b');
    });

    it('interpolates closure call', async () => {
      const script = `|x| { $x } -> $fn
"result: {$fn("test")}"`;
      expect(await run(script)).toBe('result: test');
    });

    it('interpolates $ in block', async () => {
      expect(await run('"x" -> { "val: {$}" }')).toBe('val: x');
    });

    it('interpolates nested dict via intermediate variable', async () => {
      // Nested access in interpolation may need intermediate variable
      const script = `[x: [y: "deep"]] -> $d
$d.x.y -> $val
"found: {$val}"`;
      expect(await run(script)).toBe('found: deep');
    });
  });

  describe('Expression Interpolation', () => {
    it('interpolates arithmetic expressions', async () => {
      const script = `3 -> $a
5 -> $b
"sum: {$a + $b}"`;
      expect(await run(script)).toBe('sum: 8');
    });

    it('interpolates comparison expressions', async () => {
      const script = `5 -> $count
"valid: {$count > 0}"`;
      expect(await run(script)).toBe('valid: true');
    });

    it('interpolates conditional expressions', async () => {
      const script = `true -> $ok
"status: {$ok ? \\"yes\\" ! \\"no\\"}"`;
      expect(await run(script)).toBe('status: yes');
    });

    it('interpolates method chains', async () => {
      const script = `"hello" -> $name
"upper: {$name -> .upper}"`;
      expect(await run(script)).toBe('upper: HELLO');
    });

    it('interpolates nested function calls', async () => {
      const script = `|x| ($x * 2) -> $double
|x| ($x + 1) -> $inc
"result: {$double($inc(5))}"`;
      expect(await run(script)).toBe('result: 12');
    });

    it('interpolates deep property access', async () => {
      const script = `[users: [[name: "alice"], [name: "bob"]]] -> $data
"first: {$data.users[0].name}"`;
      expect(await run(script)).toBe('first: alice');
    });

    it('interpolates list length', async () => {
      const script = `[1, 2, 3] -> $list
"count: {$list -> .len}"`;
      expect(await run(script)).toBe('count: 3');
    });

    it('preserves pipeValue across multiple interpolations', async () => {
      const script = `[name: "x", count: 3] -> { "{$.name}: {$.count} items" }`;
      expect(await run(script)).toBe('x: 3 items');
    });

    it('handles escaped braces with {{ }}', async () => {
      expect(await run('"{{not interpolated}}"')).toBe('{not interpolated}');
    });

    it('mixes interpolation and escaped braces', async () => {
      const script = `42 -> $x
"{$x} and {{literal}}"`;
      expect(await run(script)).toBe('42 and {literal}');
    });

    it('handles escaped braces in heredoc', async () => {
      const script = `<<EOF
{{literal braces}}
EOF`;
      expect(await run(script)).toBe('{literal braces}\n');
    });

    it('interpolates in heredoc', async () => {
      const script = `"world" -> $name
<<EOF
Hello, {$name}!
EOF`;
      expect(await run(script)).toBe('Hello, world!\n');
    });

    it('handles complex JSON-like escaped content', async () => {
      const result = await run('"{{\\\"key\\\": \\\"value\\\"}}"');
      expect(result).toBe('{"key": "value"}');
    });
  });
});
