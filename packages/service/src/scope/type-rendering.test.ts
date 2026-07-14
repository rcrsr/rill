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
});
