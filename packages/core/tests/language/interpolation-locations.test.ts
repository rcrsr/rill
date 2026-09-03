import { describe, it, expect } from 'vitest';
import { parse, ParseError, LexerError } from '@rcrsr/rill';

describe('String interpolation location tracking', () => {
  it('reports unterminated string literal for a source with no closing quote', () => {
    // The string never reaches a closing `"`, so the lexer reports it as
    // unterminated rather than reaching the parser as an interpolation error.
    const source = '"{$x +"';

    try {
      parse(source);
      expect.fail('Should have thrown LexerError');
    } catch (err) {
      expect(err).toBeInstanceOf(LexerError);
      const lexerErr = err as LexerError;

      expect(lexerErr.location?.line).toBe(1);
      expect(lexerErr.location?.column).toBe(1);
    }
  });

  it('reports correct location for multiline interpolation syntax error', () => {
    // Line 1: """
    // Line 2: Line 1
    // Line 3: {$x + }
    // Line 4: """
    const source = `"""
Line 1
{$x + }
"""`;

    try {
      parse(source);
      expect.fail('Should have thrown ParseError');
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      const parseErr = err as ParseError;

      // Error should be on line 3 where the interpolation is
      expect(parseErr.location?.line).toBe(3);
      expect(parseErr.location?.column).toBe(7);
    }
  });

  it('handles interpolation with valid nested expressions', () => {
    const source = '"{$x + ($y * 2)}"';
    const ast = parse(source);
    expect(ast.type).toBe('Script');
  });

  it('reports correct location for multiline string with text before interpolation', () => {
    // Line 1: """
    // Line 2: abc{$x +}
    // Line 3: """
    const source = `"""
abc{$x +}
"""`;

    try {
      parse(source);
      expect.fail('Should have thrown ParseError');
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      const parseErr = err as ParseError;

      // Error should be on line 2, column should account for "abc" prefix
      expect(parseErr.location?.line).toBe(2);
      expect(parseErr.location?.column).toBe(9);
    }
  });

  it('reports correct location for error after escape sequences', () => {
    // String: "\\n{$x +}"
    // The escape sequence \n becomes actual newline in parsed string
    const source = '"\\n{$x +}"';

    try {
      parse(source);
      expect.fail('Should have thrown ParseError');
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      const parseErr = err as ParseError;

      // Escape sequence \n becomes newline, so error reports line 2
      expect(parseErr.location?.line).toBe(2);
      expect(parseErr.location?.column).toBe(6);
    }
  });

  it('reports correct location for triple-quote with multiple interpolations', () => {
    // Line 1: """
    // Line 2: First: {$a}
    // Line 3: Second: {$b +}
    // Line 4: """
    const source = `"""
First: {$a}
Second: {$b +}
"""`;

    try {
      parse(source);
      expect.fail('Should have thrown ParseError');
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      const parseErr = err as ParseError;

      // Error should be on line 3 at the second interpolation
      expect(parseErr.location?.line).toBe(3);
      expect(parseErr.location?.column).toBe(14);
    }
  });

  it('reports correct location for triple-quote interpolation starting on the opening line', () => {
    // Line 1: """{$bad +}
    // Line 2: more
    // Line 3: """
    // The interpolation starts immediately after the """ delimiter on the
    // same line (no opening newline was skipped), so the location must use
    // a 3-character delimiter offset with no extra line/offset adjustment.
    const source = '"""{$bad +}\nmore\n"""';

    try {
      parse(source);
      expect.fail('Should have thrown ParseError');
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      const parseErr = err as ParseError;

      expect(parseErr.location).toEqual({ line: 1, column: 11, offset: 10 });
    }
  });

  it('handles triple-quote string with newlines before interpolation', () => {
    // Line 1: """
    // Line 2: (empty)
    // Line 3: (empty)
    // Line 4: Text {$x +}
    // Line 5: """
    const source = `"""


Text {$x +}
"""`;

    try {
      parse(source);
      expect.fail('Should have thrown ParseError');
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      const parseErr = err as ParseError;

      // Error should be on line 4 where the interpolation is
      expect(parseErr.location?.line).toBe(4);
      expect(parseErr.location?.column).toBe(11);
    }
  });
});
