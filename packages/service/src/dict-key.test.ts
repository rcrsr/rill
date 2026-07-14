import { describe, expect, it } from 'vitest';
import type { DictEntryNode, SourceSpan } from '@rcrsr/rill';
import { dictKeyName, dictKeySpan } from './dict-key.js';

const span: SourceSpan = {
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 1, column: 2, offset: 1 },
};

describe('dictKeyName', () => {
  it('returns the string as-is for a string key', () => {
    expect(dictKeyName('name')).toBe('name');
  });

  it('stringifies a number key', () => {
    expect(dictKeyName(42)).toBe('42');
  });

  it('stringifies a boolean key', () => {
    expect(dictKeyName(true)).toBe('true');
  });

  it('returns the variable name for a variable key', () => {
    const key: DictEntryNode['key'] = {
      kind: 'variable',
      variableName: 'id',
      span,
    };
    expect(dictKeyName(key)).toBe('id');
  });

  it('returns null for a computed key', () => {
    const key: DictEntryNode['key'] = {
      kind: 'computed',
      expression: { type: 'AtomLiteral', name: 'X', span } as never,
      span,
    };
    expect(dictKeyName(key)).toBeNull();
  });

  it('returns null for a list-literal key', () => {
    const key: DictEntryNode['key'] = {
      type: 'ListLiteral',
      elements: [],
      defaultValue: null,
      span,
    } as never;
    expect(dictKeyName(key)).toBeNull();
  });
});

describe('dictKeySpan', () => {
  it('returns undefined for a string key', () => {
    expect(dictKeySpan('name')).toBeUndefined();
  });

  it('returns undefined for a number key', () => {
    expect(dictKeySpan(42)).toBeUndefined();
  });

  it('returns undefined for a boolean key', () => {
    expect(dictKeySpan(true)).toBeUndefined();
  });

  it('returns the span for a variable key', () => {
    const key: DictEntryNode['key'] = {
      kind: 'variable',
      variableName: 'id',
      span,
    };
    expect(dictKeySpan(key)).toBe(span);
  });

  it('returns the span for a computed key', () => {
    const key: DictEntryNode['key'] = {
      kind: 'computed',
      expression: { type: 'AtomLiteral', name: 'X', span } as never,
      span,
    };
    expect(dictKeySpan(key)).toBe(span);
  });

  it('returns undefined for a list-literal key', () => {
    const key: DictEntryNode['key'] = {
      type: 'ListLiteral',
      elements: [],
      defaultValue: null,
      span,
    } as never;
    expect(dictKeySpan(key)).toBeUndefined();
  });
});
