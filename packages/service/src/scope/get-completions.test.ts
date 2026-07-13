import { describe, expect, it } from 'vitest';
import { parseWithRecovery } from '@rcrsr/rill';

import { getCompletions } from './get-completions.js';

describe('getCompletions', () => {
  it('returns only built-in and keyword completions for an empty document', () => {
    const parsed = parseWithRecovery('');
    const items = getCompletions(parsed, 0);

    expect(items.some((item) => item.kind === 'variable')).toBe(false);
    expect(items.some((item) => item.kind === 'function')).toBe(true);
    expect(items.some((item) => item.kind === 'keyword')).toBe(true);
  });

  it('returns only built-in and keyword completions for a whitespace-only document', () => {
    const parsed = parseWithRecovery('   \n  ');
    const items = getCompletions(parsed, 2);

    expect(items.some((item) => item.kind === 'variable')).toBe(false);
    expect(items.some((item) => item.kind === 'function')).toBe(true);
    expect(items.some((item) => item.kind === 'keyword')).toBe(true);
  });

  it('merges in-scope bindings with built-ins and keywords inside a populated scope', () => {
    const source = `1 => $outer
2 => $inner
$outer -> log
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const offset = source.indexOf('$outer -> log') + 1;
    const items = getCompletions(parsed, offset);
    const labels = items.map((item) => item.label);

    const outerBinding = items.find(
      (item) => item.label === 'outer' && item.kind === 'variable'
    );
    const innerBinding = items.find(
      (item) => item.label === 'inner' && item.kind === 'variable'
    );
    expect(outerBinding).toBeDefined();
    expect(innerBinding).toBeDefined();

    expect(labels).toContain('log');
    expect(items.find((item) => item.label === 'log')?.kind).toBe('function');

    expect(labels).toContain('guard');
    expect(items.find((item) => item.label === 'guard')?.kind).toBe('keyword');
  });

  it('returns surviving bindings plus all built-ins/keywords in a recovery region without throwing', () => {
    const source = `1 => $outer
$outer ->
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(false);

    const offset = source.length - 1;
    let items: ReturnType<typeof getCompletions> = [];
    expect(() => {
      items = getCompletions(parsed, offset);
    }).not.toThrow();

    expect(items.some((item) => item.kind === 'function')).toBe(true);
    expect(items.some((item) => item.kind === 'keyword')).toBe(true);
    expect(
      items.some((item) => item.label === 'outer' && item.kind === 'variable')
    ).toBe(true);
  });
});
