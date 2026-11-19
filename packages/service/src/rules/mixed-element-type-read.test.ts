import { describe, expect, it } from 'vitest';
import { parse } from '@rcrsr/rill';
import type { ASTNode } from '@rcrsr/rill';
import { runRules } from './run-rules.js';
import { mixedElementTypeRead } from './mixed-element-type-read.js';
import {
  isMixedCompoundList,
  isMixedValueDict,
  literalShape,
  unwrapBareLiteral,
} from './literal-shape.js';
import { makeConfig, toParseResult } from './test-support.js';

const LIST_MESSAGE = (key: string): string =>
  `The elements of this collection differ in type, so .^${key} reports a union element type, not one shared type. Use a type check such as :?list(list) when only the kind matters.`;
const DICT_MESSAGE = (key: string): string =>
  `The values of this dict differ in type, so iterating it yields a union element type, and .^${key} reports it. Use a type check such as :?list(dict) when only the kind matters.`;

function run(source: string, config = makeConfig()) {
  return runRules(toParseResult(source), source, config, [
    mixedElementTypeRead,
  ]);
}

describe('MIXED_ELEMENT_TYPE_READ fires', () => {
  const listCases: [string, string][] = [
    ['list[list[1], list["a"]].^type\n', 'type'],
    ['list[list[1], list["a"]] -> .^type -> .signature\n', 'type'],
    ['list[dict[a: 1], dict[b: 2]].^type.name\n', 'type'],
    ['list[ordered[a: 1], ordered[b: 2]].^effective\n', 'effective'],
    ['list[list[1], list["a"]] => $l\n$l.^type\n', 'type'],
  ];
  it.each(listCases)('reports a list read for %j', (source, key) => {
    const result = run(source);
    expect(result).toHaveLength(1);
    expect(result[0]?.code).toBe('MIXED_ELEMENT_TYPE_READ');
    expect(result[0]?.severity).toBe('info');
    expect(result[0]?.message).toBe(LIST_MESSAGE(key));
  });

  const dictCases: string[] = [
    'dict[a: 1, b: "x"] -> seq({ $ }) -> .^type\n',
    'dict[a: 1, b: "x"] -> .values -> .^type\n',
    'dict[a: 1, b: "x"] => $d\n$d -> fan({ $.value }) -> .^type\n',
    'dict[a: 1, b: "x"] => $d\n$d.values.^type\n',
    'dict[a: 1, b: "x"].values.^type\n',
    'dict[a: 1, b: "x"] -> .entries -> .^effective\n',
    'dict[a: 1, b: "x"] -> filter({ true }) -> .^type\n',
    'dict[a: 1, b: "x"] -> acc(0, { $@ }) -> .^type\n',
    'dict[a: 1, b: "x"] => $d\n$d -> .values.^type\n',
  ];
  it.each(dictCases)('reports a dict iteration read for %j', (source) => {
    const result = run(source);
    const key = source.includes('.^effective') ? 'effective' : 'type';
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe('info');
    expect(result[0]?.message).toBe(DICT_MESSAGE(key));
  });

  it('locates a Variable-form diagnostic at the variable start', () => {
    const result = run('list[list[1], list["a"]] => $l\n$l.^type\n');
    expect(result[0]?.location.line).toBe(2);
    expect(result[0]?.location.column).toBe(1);
  });

  it('locates the diagnostic at the annotation access', () => {
    const result = run('list[list[1], list["a"]].^type\n');
    expect(result[0]?.location.column).toBe(25);
  });
});

describe('MIXED_ELEMENT_TYPE_READ is silent', () => {
  const silent: string[] = [
    'list[list[1], list[2]].^type\n',
    'list[list[], list[1]].^type\n',
    'list[dict[a: 1], dict[a: 2]].^type\n',
    'list[1, "a"].^type\n',
    'list[list[1], list["a"]] -> :?list(list)\n',
    'dict[a: 1, b: 2] -> seq({ $ }) -> .^type\n',
    'list[list[1], $x].^type\n',
    'list[list[1], list["a"]] => $l\n$l[0].^type\n',
    'list[list[1], list["a"]] => $l\n$l.^other\n',
    'list[list[1], list["a"]] => $l\n5 => $l\n$l.^type\n',
    'dict[a: 1, b: "x"] => $d\n5 => $d\n$d.values.^type\n',
    'dict[a: 1, b: 2] -> .values -> .^type\n',
    'dict[a: 1, b: 2] => $d\n$d.values.^type\n',
    'list[list[1], ...$s].^type\n',
    'list[list[1], list["a"]] => $l\nlist[1, 2] -> destruct<$l, $m>\n$l.^type\n',
  ];
  it.each(silent)('reports nothing for %j', (source) => {
    expect(run(source)).toHaveLength(0);
  });

  it('is silent for a dict parameter sharing the captured name', () => {
    const source =
      'dict[a: 1, b: "x"] => $d\nfn(d: dict) { $d.values.^type } => $f\n';
    expect(run(source)).toHaveLength(0);
  });

  it('is silent for a fn parameter sharing the captured name', () => {
    const source =
      'list[list[1], list["a"]] => $l\nfn(l: list) { $l.^type } => $f\n';
    expect(run(source)).toHaveLength(0);
  });
});

describe('MIXED_ELEMENT_TYPE_READ configuration', () => {
  it('is silenced by config off', () => {
    const config = makeConfig({
      rules: { MIXED_ELEMENT_TYPE_READ: 'off' },
    });
    expect(run('list[list[1], list["a"]].^type\n', config)).toHaveLength(0);
  });
});

function expressionOf(source: string): ASTNode {
  const statement = parse(source).statements[0];
  if (statement?.type !== 'Statement') throw new Error('expected a statement');
  return statement.expression;
}

describe('literalShape', () => {
  const shapeCases: [string, string | null][] = [
    ['1', 'number'],
    ['"a"', 'string'],
    ['true', 'bool'],
    ['#ok', 'atom'],
    ['list[]', 'EMPTY'],
    ['dict[]', 'EMPTY'],
    ['tuple[]', 'EMPTY'],
    ['ordered[]', 'EMPTY'],
    ['list[2, 1, 3, "a"]', 'list(number,string)'],
    ['list[list[], list[1]]', 'list(list(number))'],
    ['dict[b: 1, a: "x"]', 'dict{a:string,b:number}'],
    ['tuple["a", 1]', 'tuple(string,number)'],
    ['ordered[b: 1, a: "x"]', 'ordered{b:number,a:string}'],
    ['$x', null],
    ['list[1, $x]', null],
    ['dict[a: $x]', null],
    ['1 -> .str', null],
  ];
  it.each(shapeCases)('maps %j to its shape', (source, expected) => {
    expect(literalShape(expressionOf(source))).toBe(expected);
  });
});

describe('isMixedCompoundList and isMixedValueDict', () => {
  const listCases: [string, boolean][] = [
    ['list[list[1], list["a"]]', true],
    ['list[list[1], dict[a: 1]]', true],
    ['list[list[1], list[2]]', false],
    ['list[1, "a"]', false],
    ['list[list[1], list[]]', false],
    ['list[list[1], $x]', false],
    ['dict[a: 1]', false],
  ];
  it.each(listCases)('classifies list %j as %s', (source, expected) => {
    const node = unwrapBareLiteral(expressionOf(source));
    expect(isMixedCompoundList(node)).toBe(expected);
  });

  const dictCases: [string, boolean][] = [
    ['dict[a: 1, b: "x"]', true],
    ['dict[a: 1, b: 2]', false],
    ['dict[a: 1, b: dict[]]', false],
    ['dict[a: 1, b: $x]', false],
    ['list[1, "a"]', false],
  ];
  it.each(dictCases)('classifies dict %j as %s', (source, expected) => {
    const node = unwrapBareLiteral(expressionOf(source));
    expect(isMixedValueDict(node)).toBe(expected);
  });
});
