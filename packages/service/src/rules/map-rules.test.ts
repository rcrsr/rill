import { describe, expect, it } from 'vitest';
import { mapMissingKey } from './map-missing-key.js';
import { mapNegativeIndex } from './map-negative-index.js';
import { runRules } from './run-rules.js';
import { makeConfig, toParseResult } from './test-support.js';
import type { Rule } from './types.js';

function run(source: string, rule: Rule): ReturnType<typeof runRules> {
  return runRules(toParseResult(source), source, makeConfig(), [rule]);
}

const TYPE = 'map(union(#a, #b), number)';

describe('MAP_MISSING_KEY', () => {
  const FIRES: ReadonlyArray<readonly [string, string]> = [
    ['declaration', `${TYPE}[#a: 1]\n`],
    ['declaration capture', `${TYPE}[#a: 1] => $m\n`],
    ['pipe assertion', `map[#a: 1] -> :${TYPE}\n`],
    ['postfix assertion', `map[#a: 1]:${TYPE}\n`],
    ['typed capture', `map[#a: 1] => $m:${TYPE}\n`],
    ['captured variable', `map[#a: 1] => $m\n$m -> :${TYPE}\n`],
    ['empty literal', `${TYPE}[]\n`],
  ];

  it.each(FIRES)('flags a missing member: %s', (_name, source) => {
    const diagnostics = run(source, mapMissingKey);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe('MAP_MISSING_KEY');
    expect(diagnostics[0]?.severity).toBe('info');
  });

  it('names every missing member', () => {
    const [diagnostic] = run(
      'map(union(#a, #b, #c), number)[#a: 1]\n',
      mapMissingKey
    );
    expect(diagnostic?.message).toContain('#b, #c');
  });

  const SILENT: ReadonlyArray<readonly [string, string]> = [
    ['all members present', `${TYPE}[#a: 1, #b: 2]\n`],
    ['multi-key entry covers members', `${TYPE}[[#a, #b]: 1]\n`],
    ['open key type', 'map(atom, number)[#a: 1]\n'],
    ['any key type', 'map(any, number)[#a: 1]\n'],
    ['computed key', `$k => $key\n${TYPE}[$key: 1]\n`],
    ['no key type', 'map[#a: 1]\n'],
  ];

  it.each(SILENT)('stays silent: %s', (_name, source) => {
    expect(run(source, mapMissingKey)).toEqual([]);
  });
});

describe('MAP_NEGATIVE_INDEX', () => {
  const FIRES: ReadonlyArray<readonly [string, string]> = [
    ['map literal capture', 'map[1: "x"] => $m\n$m[-1]\n'],
    ['declared map capture', 'map[1: "x"] => $m:map(number, string)\n$m[-1]\n'],
    ['other negative key held', 'map[-2: "x", 1: "y"] => $m\n$m[-1]\n'],
  ];

  it.each(FIRES)('flags a negative index: %s', (_name, source) => {
    const diagnostics = run(source, mapNegativeIndex);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe('MAP_NEGATIVE_INDEX');
    expect(diagnostics[0]?.severity).toBe('info');
  });

  const SILENT: ReadonlyArray<readonly [string, string]> = [
    ['list receiver', 'list[1, 2] => $l\n$l[-1]\n'],
    ['unknown receiver', '$x[-1]\n'],
    ['positive index on a map', 'map[1: "x"] => $m\n$m[1]\n'],
    ['computed index on a map', 'map[1: "x"] => $m\n$m[0 - 1]\n'],
    ['negative key held', 'map[-1: "x", 1: "y"] => $m\n$m[-1]\n'],
    ['negative key in a multi-key entry', 'map[[-1, 2]: "x"] => $m\n$m[-1]\n'],
    [
      'negative key held with a declared type',
      'map(number, string)[-1: "x"] => $m\n$m[-1]\n',
    ],
    ['computed key', '3 => $k\nmap[$k: "x"] => $m\n$m[-1]\n'],
    ['declaration capture', 'map(number, string)[1: "x"] => $m\n$m[-2]\n'],
    ['declared type only', 'map(number, string)[] => $m\n$m[-1]\n'],
    ['values read', 'map[1: "x"] => $m\n$m.values[-1]\n'],
  ];

  it.each(SILENT)('stays silent: %s', (_name, source) => {
    expect(run(source, mapNegativeIndex)).toEqual([]);
  });
});
