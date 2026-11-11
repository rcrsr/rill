import { describe, expect, it } from 'vitest';
import {
  formatStructure,
  inferStructure,
  structureEquals,
  structureMatches,
  type TypeStructure,
} from '@rcrsr/rill';

const lit = (value: string | number | boolean): TypeStructure => ({
  kind: 'literal',
  value,
});
const union = (...members: TypeStructure[]): TypeStructure => ({
  kind: 'union',
  members,
});

describe('literal union structures', () => {
  it('matches a literal member and rejects other values', () => {
    const t = union(lit('a'), lit('b'));
    expect(structureMatches('a', t)).toBe(true);
    expect(structureMatches('c', t)).toBe(false);
  });

  it('does not coerce a string literal to match a number', () => {
    expect(structureMatches(1, union(lit('1'), lit('2')))).toBe(false);
    expect(structureMatches('1', union(lit(1), lit(2)))).toBe(false);
    expect(structureMatches(1.0, union(lit(1), lit(2)))).toBe(true);
  });

  it('treats union equality as order-insensitive', () => {
    expect(
      structureEquals(union(lit('a'), lit('b')), union(lit('b'), lit('a')))
    ).toBe(true);
  });

  it('distinguishes literal 1 from literal "1"', () => {
    expect(structureEquals(lit(1), lit('1'))).toBe(false);
    expect(structureEquals(lit(1), lit(1))).toBe(true);
  });

  it('formats literal unions without spaces', () => {
    expect(formatStructure(union(lit('a'), lit('b')))).toBe('"a"|"b"');
    expect(formatStructure(union(lit(-1), lit(0), lit(true)))).toBe(
      '-1|0|true'
    );
    expect(formatStructure(union({ kind: 'number' }, lit('auto')))).toBe(
      'number|"auto"'
    );
  });

  it('infers a string literal value as plain string', () => {
    expect(inferStructure('a')).toEqual({ kind: 'string' });
  });
});
