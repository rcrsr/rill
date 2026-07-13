import { describe, expect, it } from 'vitest';
import type { TypeConstructorNode, TypeRef } from '@rcrsr/rill';
import {
  extractDescription,
  formatReturnTypeTarget,
  typeConstructorToString,
  typeRefToString,
} from './type-rendering.js';

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

describe('typeConstructorToString', () => {
  it('renders a stream constructor with chunk and resolution types', () => {
    const node: TypeConstructorNode = {
      type: 'TypeConstructor',
      constructorName: 'stream',
      args: [
        { value: { kind: 'static', typeName: 'number' } },
        { value: { kind: 'static', typeName: 'string' } },
      ],
      span: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 1, offset: 0 },
      },
    };
    expect(typeConstructorToString(node)).toBe('stream(number):string');
  });
});

describe('formatReturnTypeTarget', () => {
  it('returns undefined when no target is present', () => {
    expect(formatReturnTypeTarget(undefined)).toBeUndefined();
  });

  it('formats a plain TypeRef target', () => {
    const ref: TypeRef = { kind: 'static', typeName: 'bool' };
    expect(formatReturnTypeTarget(ref)).toBe('bool');
  });
});

describe('extractDescription', () => {
  it('returns undefined for an empty annotation list', () => {
    expect(extractDescription(undefined)).toBeUndefined();
    expect(extractDescription([])).toBeUndefined();
  });
});
