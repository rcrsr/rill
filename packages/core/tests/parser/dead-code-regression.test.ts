/**
 * Regression tests for two dead-code removals:
 *
 * - parseFieldArgList no longer performs a trailing "closing ')' present"
 *   check after its loop, because the loop only exits when the current
 *   token is RPAREN. Malformed lists must still error, either via the
 *   in-loop separator check or via the type-ref parser hitting EOF.
 * - isClosureSigLiteralStart no longer tracks a nested-pipe-bar depth
 *   counter; it scans for the first PIPE_BAR and checks whether COLON
 *   follows. This must not change sig-literal vs. typed-closure
 *   disambiguation on any existing input.
 */

import { describe, expect, it } from 'vitest';
import { parse } from '@rcrsr/rill';

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
});
