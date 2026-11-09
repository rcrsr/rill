/**
 * `guard{` is lexed as one compound token that already consumes the opening
 * brace. The parser must treat it the same as the spaced `guard {` form, and
 * the other keyword-brace forms with an option list must keep parsing.
 */

import { describe, expect, it } from 'vitest';
import { parse, ParseError } from '@rcrsr/rill';
import { getFirstPrimary } from '../helpers/ast.js';
import { run } from '../helpers/runtime.js';

function parseGuard(src: string) {
  const primary = getFirstPrimary(parse(src));
  if (primary.type !== 'GuardBlock') {
    throw new Error(`expected GuardBlock, got ${primary.type}`);
  }
  return primary;
}

function parseErrorId(src: string): string {
  let caught: unknown;
  try {
    parse(src);
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(ParseError);
  return (caught as ParseError).errorId;
}

describe('guard{ compound token', () => {
  it.each([['guard{ 1 }'], ['guard{1}'], ['guard{\n 1\n}'], ['guard { 1 }']])(
    'parses %j as a GuardBlock with one statement',
    (src) => {
      const node = parseGuard(src);
      expect(node.body.statements).toHaveLength(1);
      expect(node.body.span.start.offset).toBe(src.indexOf('{'));
    }
  );

  it('produces the same body statements as the spaced form', () => {
    const tight = parseGuard('guard{ 1 }');
    const spaced = parseGuard('guard { 1 }');
    expect(tight.body.statements).toHaveLength(spaced.body.statements.length);
    expect(tight.body.statements[0]?.type).toBe(
      spaced.body.statements[0]?.type
    );
  });

  it('rejects an empty body with RILL-P004 like the spaced form', () => {
    expect(parseErrorId('guard{}')).toBe('RILL-P004');
    expect(parseErrorId('guard {}')).toBe('RILL-P004');
  });

  it('rejects an unterminated body with RILL-P001 like the spaced form', () => {
    expect(parseErrorId('guard{ 1')).toBe('RILL-P001');
    expect(parseErrorId('guard { 1')).toBe('RILL-P001');
  });

  it('returns the body value at runtime', async () => {
    expect(await run('guard{ 1 }')).toBe(1);
  });

  it('recovers a catchable halt inside the body like the spaced form', async () => {
    const tight = await run('guard{ "5" + 1 } => $r\n$r.!');
    const spaced = await run('guard { "5" + 1 } => $r\n$r.!');
    expect(tight).toBe(true);
    expect(spaced).toBe(true);
  });
});

describe('keyword blocks with an option list and no space before {', () => {
  it.each([
    ['retry<limit: 2>{ 1 }'],
    ['guard<on: list[#RILL_R005]>{ 1 }'],
    ['pass<on_error: #IGNORE>{ 1 }'],
    ['timeout<total: duration(0,0,1)>{ 1 }'],
    ['do<limit: 3>{ 1 } while ($ < 0)'],
  ])('parses %j', (src) => {
    expect(() => parse(src)).not.toThrow();
  });
});
