import { describe, expect, it } from 'vitest';
import { runRules } from './run-rules.js';
import { declaredTypeProbe } from './declared-type-probe.js';
import { makeConfig, toParseResult } from './test-support.js';

function run(source: string) {
  return runRules(toParseResult(source), source, makeConfig(), [
    declaredTypeProbe,
  ]);
}

describe('DECLARED_TYPE_PROBE fires', () => {
  const cases: [string, string][] = [
    ['direct assertion', '1 -> :union(number, string) -> .^type\n'],
    ['direct expr:T postfix', '$x:union(number, string).^type\n'],
    ['declaration', 'union(number, string) 1 -> .^type\n'],
    ['declaration, name read', 'union(number, string) 1 -> .^type.name\n'],
    ['declared variable', '1 => $v:union(number, string)\n$v.^type\n'],
    [
      'declared variable, name',
      '1 => $v:union(number, string)\n$v.^type.name\n',
    ],
    [
      'declared variable, signature',
      '1 => $v:union(number, string)\n$v.^type.signature\n',
    ],
    [
      'declared variable through a pipe',
      '1 => $v:union(number, string)\n$v -> .^type\n',
    ],
    [
      'collection with union element',
      'list[1] => $v:list(union(number, string))\n$v.^type\n',
    ],
  ];
  it.each(cases)('reports %s', (_name, source) => {
    const result = run(source);
    expect(result).toHaveLength(1);
    expect(result[0]?.code).toBe('DECLARED_TYPE_PROBE');
    expect(result[0]?.severity).toBe('info');
    expect(result[0]?.message).toContain('declared ');
    expect(result[0]?.message).toContain('.^effective');
  });

  it('names the declared type in the message', () => {
    const [d] = run('1 => $v:union(number, string)\n$v.^type\n');
    expect(d?.message).toBe(
      "This value is declared union(number, string), so .^type reports that declared type, not the value's own type. Use .^effective for the value's own type."
    );
  });

  it('rewrites the key to effective', () => {
    const source = '1 => $v:union(number, string)\n$v.^type.name\n';
    const [d] = run(source);
    const fix = d?.fix;
    expect(fix?.applicable).toBe(true);
    expect(fix?.replacement).toBe('effective');
    expect(source.slice(fix?.range.start.offset, fix?.range.end.offset)).toBe(
      'type'
    );
  });

  it('rewrites the key of a pipe read', () => {
    const source = '1 => $v:union(number, string)\n$v -> .^type\n';
    const [d] = run(source);
    expect(
      source.slice(d?.fix?.range.start.offset, d?.fix?.range.end.offset)
    ).toBe('type');
  });

  it('places the fix range on the key line and column', () => {
    const source = '1 => $v:union(number, string)\n$v.^type.name\n';
    const range = run(source)[0]?.fix?.range;
    expect(range?.start).toMatchObject({ line: 2, column: 5 });
    expect(range?.end).toMatchObject({ line: 2, column: 9 });
  });
});

describe('DECLARED_TYPE_PROBE stays silent', () => {
  const cases: [string, string][] = [
    ['an undeclared value', '1 => $v\n$v.^type\n'],
    ['a plain declared scalar', '1 => $v:number\n$v.^type\n'],
    ['an any parameter', 'fn(x) { $x.^type } => $f\n'],
    ['an :any capture', '1 => $v:any\n$v.^type\n'],
    ['the effective key', '1 => $v:union(number, string)\n$v.^effective\n'],
    ['a computed result', '1 => $x:union(number, string)\n($x + 1).^type\n'],
    [
      'an element read',
      'list[1] => $v:list(union(number, string))\n$v[0].^type\n',
    ],
    ['a mixed literal declaration', 'list[1, "a"] -> .^type\n'],
    ['a bare collection declaration', 'list[1] => $l\n$l.^type\n'],
  ];
  it.each(cases)('stays silent on %s', (_name, source) => {
    expect(run(source)).toEqual([]);
  });
});
