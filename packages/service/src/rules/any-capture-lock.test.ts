import {
  createRuntimeContext,
  execute,
  parse,
  RuntimeError,
  RuntimeHaltSignal,
} from '@rcrsr/rill';
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

const COLLECTION_FIRES: [string, string][] = [
  ['list element type', 'list[1] => $x:any\nlist["a"] => $x\n'],
  ['dict value type', 'dict[a: 1] => $x:any\ndict[a: "x"] => $x\n'],
  ['tuple element type', 'tuple[1] => $x:any\ntuple["a"] => $x\n'],
  ['ordered value type', 'ordered[a: 1] => $x:any\nordered[a: "x"] => $x\n'],
  ['list widened to a mixed list', 'list[1] => $x:any\nlist[1, "a"] => $x\n'],
];

const COLLECTION_SILENT: [string, string][] = [
  ['same element type', 'list[1] => $x:any\nlist[2, 3] => $x\n'],
  [
    'mixed lists in either order',
    'list[1, "a"] => $x:any\nlist["a", 1] => $x\n',
  ],
  ['empty first list', 'list[] => $x:any\nlist["a"] => $x\n'],
  ['nested empty list', 'list[list[1]] => $x:any\nlist[list[]] => $x\n'],
  ['atom element', 'list[#a] => $x:any\nlist["a"] => $x\n'],
];

describe('ANY_CAPTURE_LOCK on collection literals', () => {
  it.each(COLLECTION_FIRES)('reports a different %s', (_name, source) => {
    const result = run(source);
    expect(result).toHaveLength(1);
    expect(result[0]?.code).toBe('ANY_CAPTURE_LOCK');
    expect(result[0]?.location.line).toBe(2);
  });

  it('names the locked collection type and the halt code', () => {
    const result = run('list[1] => $x:any\nlist["a"] => $x\n');
    expect(result[0]?.message).toContain('list(number)');
    expect(result[0]?.message).toContain('RILL-R001');
  });

  it.each(COLLECTION_SILENT)('stays silent for %s', (_name, source) => {
    expect(run(source)).toEqual([]);
  });
});

async function haltsWithR001(source: string): Promise<boolean> {
  try {
    await execute(parse(source), createRuntimeContext());
  } catch (error) {
    if (error instanceof RuntimeError || error instanceof RuntimeHaltSignal) {
      return error.errorId === 'RILL-R001';
    }
    throw error;
  }
  return false;
}

// An atom has no static value, so the rule stays silent even though the
// runtime halts; every other source agrees with the runtime exactly.
const RULE_BLIND_SPOTS: ReadonlySet<string> = new Set(['atom element']);

describe('ANY_CAPTURE_LOCK agrees with the runtime', () => {
  const rows: [string, string, boolean][] = [
    ...COLLECTION_FIRES.map(([name, source]): [string, string, boolean] => [
      name,
      source,
      true,
    ]),
    ...COLLECTION_SILENT.map(([name, source]): [string, string, boolean] => [
      name,
      source,
      false,
    ]),
  ];
  it.each(rows)(
    'halts RILL-R001 exactly when the rule fires for %s',
    async (name, source, fires) => {
      expect(run(source).length > 0).toBe(fires);
      const halts = await haltsWithR001(source);
      expect(halts).toBe(fires || RULE_BLIND_SPOTS.has(name));
    }
  );
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
