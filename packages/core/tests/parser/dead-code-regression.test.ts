/**
 * Regression tests for a dead-code removal:
 *
 * - parseFieldArgList no longer performs a trailing "closing ')' present"
 *   check after its loop, because the loop only exits when the current
 *   token is RPAREN. Malformed lists must still error, either via the
 *   in-loop separator check or via the type-ref parser hitting EOF.
 */

import { describe, expect, it } from 'vitest';
import { parse } from '@rcrsr/rill';

describe('parseFieldArgList unterminated list', () => {
  it('errors on an unterminated stream() type argument list', () => {
    expect(() => parse('fn():stream(string')).toThrow();
  });

  it('errors when a trailing comma is followed by EOF instead of a type', () => {
    expect(() => parse('fn():stream(string,')).toThrow();
  });

  it('errors when neither comma nor closing paren follows an argument', () => {
    expect(() => parse('fn():stream(string string)')).toThrow();
  });

  it('still parses a well-formed stream() type argument list', () => {
    expect(() =>
      parse('fn():stream(string) { "hello" -> yield }')
    ).not.toThrow();
  });

  it('still parses a well-formed stream() type with resolution type', () => {
    expect(() =>
      parse('fn():stream(string):number { "hello" -> yield }')
    ).not.toThrow();
  });
});
