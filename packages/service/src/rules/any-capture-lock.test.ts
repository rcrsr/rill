import { describe, expect, it } from 'vitest';
import { runRules } from './run-rules.js';
import { anyCaptureLock } from './any-capture-lock.js';
import { makeConfig, toParseResult } from './test-support.js';

function run(source: string) {
  return runRules(toParseResult(source), source, makeConfig(), [
    anyCaptureLock,
  ]);
}

describe('ANY_CAPTURE_LOCK fires', () => {
  it('reports a re-capture of a different type in the same scope', () => {
    const result = run('1 => $x:any\n"a" => $x\n');
    expect(result).toHaveLength(1);
    expect(result[0]?.code).toBe('ANY_CAPTURE_LOCK');
    expect(result[0]?.severity).toBe('error');
    expect(result[0]?.location.line).toBe(2);
    expect(result[0]?.message).toContain('RILL-R001');
    expect(result[0]?.message).toContain('union(');
    expect(result[0]?.message).toContain(':any');
  });

  it('reports a re-capture inside a closure of a parent-scope variable', () => {
    const result = run('1 => $x:any\nfn { "a" => $x } => $f\n');
    expect(result).toHaveLength(1);
    expect(result[0]?.code).toBe('ANY_CAPTURE_LOCK');
  });
});

describe('ANY_CAPTURE_LOCK stays silent', () => {
  const cases: [string, string][] = [
    ['same type', '1 => $x:any\n2 => $x\n'],
    ['unknown second type', '1 => $x:any\n$y => $x\n'],
    ['unknown first type', '$y => $x:any\n"a" => $x\n'],
    ['no :any annotation', '1 => $x\n"a" => $x\n'],
    [
      'union-declared first value that admits the second',
      '1 => $u:union(number, string)\n$u => $x:any\n"a" => $x\n',
    ],
    ['source declared any', 'fn(v: any) { 1 => $x:any\n$v => $x }\n'],
    [
      'lock captured in another closure',
      'fn { 1 => $x:any } => $f\n"a" => $x\n"b" => $x\n',
    ],
    [
      'literal-union value admits a member',
      'union("a", "b") "a" => $x:any\n"b" => $x\n',
    ],
    ['sibling scopes', 'fn { 1 => $x:any } => $f\nfn { "a" => $x } => $g\n'],
  ];
  it.each(cases)('stays silent for %s', (_name, source) => {
    expect(run(source)).toEqual([]);
  });
});
