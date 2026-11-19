import { execute, createRuntimeContext, parse } from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';
import { runRules } from './run-rules.js';
import { dictKeySpelling } from './key-spelling.js';
import { makeConfig, toParseResult } from './test-support.js';

function run(source: string): ReturnType<typeof runRules> {
  return runRules(toParseResult(source), source, makeConfig(), [
    dictKeySpelling,
  ]);
}

describe('DICT_KEY_SPELLING', () => {
  it('reports the key and its quoted form at info severity', () => {
    const result = run('dict[1: "n"]\n');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'DICT_KEY_SPELLING',
      severity: 'info',
      message:
        'Key 1 is stored as the string "1". Quote it to write that spelling directly.',
      fix: null,
    });
  });

  it.each([
    ['number key', 'dict[1: "n"]\n', '1'],
    ['bool key', 'dict[true: "t"]\n', 'true'],
    ['ordered key', 'ordered[1: "n"]\n', '1'],
    ['dispatch table', '1 -> dict[1: "one", 2: "two"]\n', '1'],
  ])('fires on %s', (_name, source, key) => {
    const result = run(source);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]?.message.startsWith(`Key ${key} `)).toBe(true);
  });

  it.each([
    ['identifier key', 'dict[name: "n"]\n'],
    ['quoted key', 'dict["1": "n"]\n'],
    ['computed key', '"a" => $k\ndict[[$k]: 1]\n'],
  ])('is silent on %s', (_name, source) => {
    expect(run(source)).toEqual([]);
  });

  it('treats a number key as equal to its quoted spelling at runtime', async () => {
    const source = 'dict[1: "n"] == dict["1": "n"]';

    const result = await execute(parse(source), createRuntimeContext({}));

    expect(result.result).toBe(true);
  });
});
