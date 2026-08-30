/**
 * Tests for parser state token navigation on empty token streams
 */

import { describe, expect, it } from 'vitest';
import { ParseError } from '../../src/types.ts';
import { createParserState, current, peek } from '../../src/parser/state.ts';
import { parseTypeRef } from '../../src/parser/parser-types.ts';

describe('parser state on empty tokens', () => {
  it('current throws ParseError on empty tokens', () => {
    const state = createParserState([]);

    expect(() => current(state)).toThrow(ParseError);
  });

  it('peek throws ParseError on empty tokens', () => {
    const state = createParserState([]);

    expect(() => peek(state)).toThrow(ParseError);
  });

  it('parseTypeRef throws ParseError on empty tokens', () => {
    const state = createParserState([]);

    expect(() => parseTypeRef(state)).toThrow(ParseError);
  });
});
