/**
 * Regression tests for two dead-code removals, plus a follow-up fix to
 * isClosureSigLiteralStart's lookahead:
 *
 * - parseFieldArgList no longer performs a trailing "closing ')' present"
 *   check after its loop, because the loop only exits when the current
 *   token is RPAREN. Malformed lists must still error, either via the
 *   in-loop separator check or via the type-ref parser hitting EOF.
 * - isClosureSigLiteralStart no longer bails out at the first PIPE_BAR
 *   it finds; a PIPE_BAR not immediately followed by COLON may be a
 *   union-type separator inside a param type ref (e.g.
 *   `|x: string | number|: bool`), so the scan continues past it when
 *   the following token starts a type. This must not change sig-literal
 *   vs. typed-closure disambiguation on any existing input, and must
 *   correctly route union-typed param signatures to the sig-literal
 *   parse path — even though that path cannot yet fully parse a union
 *   type in the param position (a separate, unrelated limitation of
 *   parseClosureSigLiteral's param-type parser).
 */

import { describe, expect, it } from 'vitest';
import { parse, ParseError } from '@rcrsr/rill';

describe('parseFieldArgList unterminated list', () => {
  it('errors on an unterminated stream() type argument list', () => {
    expect(() => parse('|| ("hello" -> yield) :stream(string')).toThrow();
  });

  it('errors when a trailing comma is followed by EOF instead of a type', () => {
    expect(() => parse('|| ("hello" -> yield) :stream(string,')).toThrow();
  });

  it('errors when neither comma nor closing paren follows an argument', () => {
    expect(() =>
      parse('|| ("hello" -> yield) :stream(string string)')
    ).toThrow();
  });

  it('still parses a well-formed stream() type argument list', () => {
    expect(() => parse('|| ("hello" -> yield) :stream(string)')).not.toThrow();
  });

  it('still parses a well-formed stream() type with resolution type', () => {
    expect(() =>
      parse('|| ("hello" -> yield) :stream(string):number')
    ).not.toThrow();
  });
});

describe('isClosureSigLiteralStart disambiguation', () => {
  it('recognizes a closure sig literal (| name: type |: returnType)', () => {
    const ast = parse('|x: string|: number');
    const stmt = ast.statements[0]!;
    expect(stmt.expression.head.primary.type).toBe('ClosureSigLiteral');
  });

  it('recognizes a closure sig literal with multiple params', () => {
    const ast = parse('|x: string, y: number|: number');
    const stmt = ast.statements[0]!;
    expect(stmt.expression.head.primary.type).toBe('ClosureSigLiteral');
  });

  it('does not misidentify a typed closure with a brace body', () => {
    const ast = parse('|x: string| { $x }');
    const stmt = ast.statements[0]!;
    expect(stmt.expression.head.primary.type).not.toBe('ClosureSigLiteral');
    expect(stmt.expression.head.primary.type).toBe('Closure');
  });

  it('does not misidentify a typed closure with a parenthesized body', () => {
    const ast = parse('|x: number| ($x)');
    const stmt = ast.statements[0]!;
    expect(stmt.expression.head.primary.type).not.toBe('ClosureSigLiteral');
    expect(stmt.expression.head.primary.type).toBe('Closure');
  });

  it('does not misidentify an untyped closure with no params', () => {
    const ast = parse('|| { 1 }');
    const stmt = ast.statements[0]!;
    expect(stmt.expression.head.primary.type).not.toBe('ClosureSigLiteral');
    expect(stmt.expression.head.primary.type).toBe('Closure');
  });

  it('routes a union-typed param signature to the sig-literal path instead of misclassifying it as a closure', () => {
    // The scan must not bail out at the first PIPE_BAR (the union
    // separator between `string` and `number`); it correctly continues
    // to the closing `|` followed by `:` and enters parseClosureSigLiteral.
    // That function's param-type parser has no union-type support, so
    // this still throws -- but with the sig-literal parser's own error,
    // not the old first-pipe misclassification failure.
    let caught: unknown;
    try {
      parse('|x: string | number|: bool');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ParseError);
    expect((caught as ParseError).errorId).toBe('RILL-P001');
    expect((caught as ParseError).message).toContain(
      'Expected : before return type in closure sig literal'
    );
  });
});
