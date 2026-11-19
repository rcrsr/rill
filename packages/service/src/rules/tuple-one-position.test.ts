import { parse } from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';
import { runRules } from './run-rules.js';
import { tupleOnePosition } from './tuple-one-position.js';
import { makeConfig, toParseResult } from './test-support.js';

function run(
  source: string,
  config = makeConfig()
): ReturnType<typeof runRules> {
  return runRules(toParseResult(source), source, config, [tupleOnePosition]);
}

describe('TUPLE_ONE_POSITION', () => {
  it('reports the exact message at info severity', () => {
    const result = run('$x -> :tuple(number)\n');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'TUPLE_ONE_POSITION',
      severity: 'info',
      message:
        'tuple(number) names exactly one position. Write :tuple to accept a tuple of any length, or -> list(number) for a sequence; a type meant for one element needs no change.',
      fix: null,
    });
  });

  it.each([
    ['type assertion', '$x -> :tuple(number)\n'],
    ['optional type assertion', '$x -> :?tuple(number)\n'],
    ['capture annotation', 'tuple[1] => $t:tuple(number)\n'],
    ['closure parameter', '|t: tuple(number)| { $t }\n'],
    ['closure return type', '|x| { $x }:tuple(number)\n'],
    ['type constructor', '$x -> tuple(number)\n'],
    ['destructure pattern', 'tuple[1] -> destruct<$a:tuple(number)>\n'],
    ['existence check', '$d.?field&tuple(number) ? 1 ! 2\n'],
  ])('fires on %s', (_name, source) => {
    const result = run(source);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ code: 'TUPLE_ONE_POSITION' });
  });

  it.each([
    ['list argument', '$x -> :list(tuple(string))\n', ['tuple(string)']],
    ['dict field', '$x -> :dict(a: tuple(number))\n', ['tuple(number)']],
    [
      'union member',
      '$x -> :union(tuple(number), string)\n',
      ['tuple(number)'],
    ],
  ])('fires at depth in %s', (_name, source, elements) => {
    const result = run(source);

    expect(result.map((d) => d.message.split(' names')[0])).toEqual(elements);
  });

  it.each([
    ['use type', 'use<ext:app>:tuple(number)\n'],
    ['use closure annotation', 'use<ext:app>:|a: tuple(number)|\n'],
  ])('fires on %s', (_name, source) => {
    const result = run(source);

    expect(result).toHaveLength(1);
    expect(result[0]?.message).toContain('tuple(number) names exactly');
  });

  it('reports each hit at the owning node position', () => {
    const result = run('"a" => $s\n$x -> :tuple(tuple(number))\n');

    expect(result.map((d) => d.location.line)).toEqual([2, 2]);
    expect(result[0]?.location.column).toBe(result[1]?.location.column);
  });

  it('reports one hit for a multi-arg tuple holding a one-arg tuple', () => {
    const result = run('$x -> :tuple(tuple(number), string)\n');

    expect(result.map((d) => d.message.split(' names')[0])).toEqual([
      'tuple(number)',
    ]);
  });

  it('reports two hits for a doubly nested one-arg tuple', () => {
    const result = run('$x -> :tuple(tuple(number))\n');

    expect(result.map((d) => d.message.split(' names')[0])).toEqual([
      'tuple(tuple(number))',
      'tuple(number)',
    ]);
  });

  it.each([
    ['bare tuple', '$x -> :tuple\n'],
    ['empty tuple', '$x -> :tuple()\n'],
    ['two-position tuple', '$x -> :tuple(number, string)\n'],
    ['dynamic type', '$x -> :$t\n'],
  ])('is silent on %s', (_name, source) => {
    expect(run(source)).toEqual([]);
  });

  it('yields nothing when the rule is off', () => {
    const config = makeConfig({ rules: { TUPLE_ONE_POSITION: 'off' } });

    expect(run('$x -> :tuple(number)\n', config)).toEqual([]);
  });

  it.each([
    ['$x -> :tuple(dict("a b": number))\n', 'dict("a b": number)'],
    ['$x -> :tuple(stream(number):string)\n', 'stream(number):string'],
    ['$x -> :tuple(union("a{{b", "c"))\n', 'union("a{{b", "c")'],
  ])('suggests a list type that parses for %s', (source, element) => {
    const result = run(source);

    expect(result).toHaveLength(1);
    const message = result[0]?.message ?? '';
    expect(message).toContain(`tuple(${element}) names`);
    const match = /-> (list\(.*\)) for a sequence/.exec(message);
    expect(match).not.toBeNull();
    expect(() => parse(`$x -> :${match?.[1] ?? ''}`)).not.toThrow();
  });
});
