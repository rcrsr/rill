/**
 * Regression tests for two dead-code removals, plus the
 * isClosureSigLiteralStart lookahead:
 *
 * - parseFieldArgList no longer performs a trailing "closing ')' present"
 *   check after its loop, because the loop only exits when the current
 *   token is RPAREN. Malformed lists must still error, either via the
 *   in-loop separator check or via the type-ref parser hitting EOF.
 * - isClosureSigLiteralStart treats the first `|` after the opener as the
 *   closing delimiter and reports a sig literal when `:` follows it.
 */

import { describe, expect, it } from 'vitest';
import { parse } from '@rcrsr/rill';
import { getFirstPrimary } from '../helpers/ast.js';

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
    expect(getFirstPrimary(ast).type).toBe('ClosureSigLiteral');
  });

  it('recognizes a closure sig literal with multiple params', () => {
    const ast = parse('|x: string, y: number|: number');
    expect(getFirstPrimary(ast).type).toBe('ClosureSigLiteral');
  });

  it('does not misidentify a typed closure with a brace body', () => {
    const ast = parse('|x: string| { $x }');
    expect(getFirstPrimary(ast).type).not.toBe('ClosureSigLiteral');
    expect(getFirstPrimary(ast).type).toBe('Closure');
  });

  it('does not misidentify a typed closure with a parenthesized body', () => {
    const ast = parse('|x: number| ($x)');
    expect(getFirstPrimary(ast).type).not.toBe('ClosureSigLiteral');
    expect(getFirstPrimary(ast).type).toBe('Closure');
  });

  it('does not misidentify an untyped closure with no params', () => {
    const ast = parse('|| { 1 }');
    expect(getFirstPrimary(ast).type).not.toBe('ClosureSigLiteral');
    expect(getFirstPrimary(ast).type).toBe('Closure');
  });

  it('routes a union(...) param signature to the sig-literal path', () => {
    const ast = parse('|x: union(string, number)|: bool');
    expect(getFirstPrimary(ast).type).toBe('ClosureSigLiteral');
  });
});
