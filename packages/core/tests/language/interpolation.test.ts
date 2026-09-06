import { describe, it, expect } from 'vitest';
import { parse, ParseError } from '@rcrsr/rill';

describe('String interpolation error location with escapes', () => {
  it('reports the correct column for an interpolation error after a single escape', () => {
    // Source: "\t{$x +}"
    // Columns: 1=" 2=\ 3=t 4={ 5=$ 6=x 7=(space) 8=+ 9=} 10="
    // "$x +" is an incomplete expression, so the parser reports the error at
    // the position right after it — the closing "}" at column 9. The lexer
    // decodes \t into one character, so an uncorrected index into the
    // decoded string undercounts that column by one per preceding escape.
    const source = '"\\t{$x +}"';

    try {
      parse(source);
      expect.fail('Should have thrown ParseError');
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      const parseErr = err as ParseError;

      expect(parseErr.location?.line).toBe(1);
      expect(parseErr.location?.column).toBe(9);
    }
  });

  it('reports the correct column for an interpolation error after multiple escapes', () => {
    // Source: "\t\t{$x +}"
    // Columns: 1=" 2=\ 3=t 4=\ 5=t 6={ 7=$ 8=x 9=(space) 10=+ 11=} 12="
    // Two escapes precede the interpolation, so the drift compounds to two
    // columns if left uncorrected; the error lands at the closing "}" (11).
    const source = '"\\t\\t{$x +}"';

    try {
      parse(source);
      expect.fail('Should have thrown ParseError');
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      const parseErr = err as ParseError;

      expect(parseErr.location?.line).toBe(1);
      expect(parseErr.location?.column).toBe(11);
    }
  });

  it('reports the correct column when literal text and an escape both precede the interpolation', () => {
    // Source: "ab\t{$x +}"
    // Columns: 1=" 2=a 3=b 4=\ 5=t 6={ 7=$ 8=x 9=(space) 10=+ 11=} 12="
    const source = '"ab\\t{$x +}"';

    try {
      parse(source);
      expect.fail('Should have thrown ParseError');
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      const parseErr = err as ParseError;

      expect(parseErr.location?.line).toBe(1);
      expect(parseErr.location?.column).toBe(11);
    }
  });
});
