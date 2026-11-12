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
    expect(typeRefToString(ref)).toBe('union(string, number)');
  });

  it('renders literal members of a union', () => {
    const span = {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 2, offset: 1 },
    };
    const ref: TypeRef = {
      kind: 'union',
      members: [
        {
          kind: 'literal',
          value: {
            type: 'StringLiteral',
            parts: ['a'],
            isMultiline: false,
            span,
          },
        },
        { kind: 'literal', value: { type: 'NumberLiteral', value: 1, span } },
        { kind: 'literal', value: { type: 'AtomLiteral', name: 'ok', span } },
      ],
    };
    expect(typeRefToString(ref)).toBe('union("a", 1, #ok)');
  });
});
