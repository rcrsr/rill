/**
 * Rill Parser Tests: recursion-depth guard
 *
 * parsePrimary recurses once per nested primary expression (e.g. one level
 * per parenthesized group). Without a depth guard, thousands of nested
 * parens overflow the native call stack and surface a raw RangeError from
 * both parse() and parseWithRecovery() instead of a diagnosable parse
 * error. These tests assert the guard converts that failure into a
 * ParseError with a real source location for both entry points.
 */

import { describe, expect, it } from 'vitest';
import { parse, parseWithRecovery, ParseError } from '@rcrsr/rill';

function deeplyNested(depth: number): string {
  return '('.repeat(depth) + '1' + ')'.repeat(depth);
}

describe('parsePrimary recursion-depth guard', () => {
  it('parse() throws ParseError with id RILL-P015 on deeply nested input, not RangeError', () => {
    const source = deeplyNested(5000);

    let caught: unknown;
    try {
      parse(source);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ParseError);
    expect(caught).not.toBeInstanceOf(RangeError);
    expect((caught as ParseError).errorId).toBe('RILL-P015');
    expect((caught as ParseError).location).toBeDefined();
    expect((caught as ParseError).location.offset).toBeGreaterThan(0);
  });

  it('parseWithRecovery() returns success:false with RILL-P015 and does not throw', () => {
    const source = deeplyNested(5000);

    let result: ReturnType<typeof parseWithRecovery>;
    expect(() => {
      result = parseWithRecovery(source);
    }).not.toThrow();

    expect(result!.success).toBe(false);
    expect(result!.errors.length).toBeGreaterThanOrEqual(1);
    expect(result!.errors.some((e) => e.errorId === 'RILL-P015')).toBe(true);
  });

  it('leaves shallow nesting unaffected', () => {
    const source = deeplyNested(20);

    expect(() => parse(source)).not.toThrow();
  });
});

describe('parseUnary recursion-depth guard', () => {
  it('throws ParseError with id RILL-P015 on deeply nested unary operators, not RangeError', () => {
    const source = '!'.repeat(20000) + 'true';

    let caught: unknown;
    try {
      parse(source);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ParseError);
    expect(caught).not.toBeInstanceOf(RangeError);
    expect((caught as ParseError).errorId).toBe('RILL-P015');
  });

  it('leaves shallow unary nesting unaffected', () => {
    const source = '!'.repeat(5) + 'true';

    expect(() => parse(source)).not.toThrow();
  });
});

describe('parseTypeRef recursion-depth guard', () => {
  it('throws ParseError with id RILL-P015 on deeply nested parameterized types, not RangeError', () => {
    const source =
      '|x: ' + 'list('.repeat(5000) + 'string' + ')'.repeat(5000) + '|: bool';

    let caught: unknown;
    try {
      parse(source);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ParseError);
    expect(caught).not.toBeInstanceOf(RangeError);
    expect((caught as ParseError).errorId).toBe('RILL-P015');
  });

  it('leaves shallow parameterized-type nesting unaffected', () => {
    const source =
      '|x: ' + 'list('.repeat(3) + 'string' + ')'.repeat(3) + '|: bool';

    expect(() => parse(source)).not.toThrow();
  });
});

describe('parseDestructPattern recursion-depth guard', () => {
  function deeplyNestedDestruct(depth: number): string {
    return 'list[1] -> ' + 'destruct<'.repeat(depth) + '$a' + '>'.repeat(depth);
  }

  it('throws ParseError with id RILL-P015 on deeply nested destruct<>, not RangeError', () => {
    const source = deeplyNestedDestruct(5000);

    let caught: unknown;
    try {
      parse(source);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ParseError);
    expect(caught).not.toBeInstanceOf(RangeError);
    expect((caught as ParseError).errorId).toBe('RILL-P015');
  });

  it('leaves shallow destruct<> nesting unaffected', () => {
    const source = deeplyNestedDestruct(2);

    expect(() => parse(source)).not.toThrow();
  });
});
