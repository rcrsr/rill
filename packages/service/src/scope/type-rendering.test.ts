import { describe, expect, it } from 'vitest';
import type { TypeRef } from '@rcrsr/rill';
import { typeRefToString } from './type-rendering.js';

describe('typeRefToString', () => {
  it('renders "any" for a null ref', () => {
    expect(typeRefToString(null)).toBe('any');
  });

  it('renders a bare static type name', () => {
    const ref: TypeRef = { kind: 'static', typeName: 'string' };
    expect(typeRefToString(ref)).toBe('string');
  });

  it('renders a parameterized static type with named args', () => {
    const ref: TypeRef = {
      kind: 'static',
      typeName: 'list',
      args: [{ value: { kind: 'static', typeName: 'number' } }],
    };
    expect(typeRefToString(ref)).toBe('list(number)');
  });

  it('renders a field default after its type', () => {
    const ref: TypeRef = {
      kind: 'static',
      typeName: 'dict',
      args: [
        { name: 'a', value: { kind: 'static', typeName: 'number' } },
        {
          name: 'b',
          value: { kind: 'static', typeName: 'number' },
          defaultValue: {
            type: 'NumberLiteral',
            value: 0,
            span: {
              start: { line: 1, column: 1, offset: 0 },
              end: { line: 1, column: 2, offset: 1 },
            },
          },
        },
      ],
    };
    expect(typeRefToString(ref)).toBe('dict(a: number, b: number = 0)');
  });

  it('renders a union of members', () => {
    const ref: TypeRef = {
      kind: 'union',
      members: [
        { kind: 'static', typeName: 'string' },
        { kind: 'static', typeName: 'number' },
      ],
    };
    expect(typeRefToString(ref)).toBe('string | number');
  });

  it('renders a union of string literals quoted', () => {
    const ref: TypeRef = {
      kind: 'union',
      members: [
        { kind: 'literal', value: 'wired' },
        { kind: 'literal', value: 'wireless' },
      ],
    };
    expect(typeRefToString(ref)).toBe('"wired" | "wireless"');
  });

  it('renders number and bool literals bare', () => {
    const ref: TypeRef = {
      kind: 'union',
      members: [
        { kind: 'literal', value: -1 },
        { kind: 'literal', value: 2.5 },
        { kind: 'literal', value: true },
        { kind: 'static', typeName: 'string' },
      ],
    };
    expect(typeRefToString(ref)).toBe('-1 | 2.5 | true | string');
  });
});
