import {
  createRuntimeContext,
  execute,
  parse,
  RuntimeError,
  RuntimeHaltSignal,
} from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';
import {
  dispatchMissingMember,
  dispatchSelectorNotString,
} from './dispatch.js';
import { runRules } from './run-rules.js';
import { makeConfig, toParseResult } from './test-support.js';

function check(source: string) {
  return runRules(toParseResult(source), source, makeConfig(), [
    dispatchSelectorNotString,
    dispatchMissingMember,
  ]);
}

async function haltIds(source: string): Promise<string> {
  try {
    await execute(parse(source), createRuntimeContext());
  } catch (error) {
    if (error instanceof RuntimeError || error instanceof RuntimeHaltSignal) {
      return `${error.errorId} ${error.message}`;
    }
    throw error;
  }
  throw new Error('expected the script to halt');
}

const ATOMS = '#b -> :union(#a, #b)';

const MISSING = 'RILL-R009';
const MISMATCH = '#TYPE_MISMATCH';

/** [name, source, code, message fragment, runtime halt id]. */
const FIRES: ReadonlyArray<readonly [string, string, string, string, string]> =
  [
    [
      'an atom union piped with -> string into a table missing a member',
      `${ATOMS} -> string -> dict[a: 1]\n`,
      'DISPATCH_MISSING_MEMBER',
      'no key for b',
      MISSING,
    ],
    [
      'a direct string-literal union',
      '"b" -> :union("a", "b") -> dict[a: 1]\n',
      'DISPATCH_MISSING_MEMBER',
      'no key for b',
      MISSING,
    ],
    [
      'a variable table',
      'dict[a: 1] => $t\n"b" -> :union("a", "b") -> $t\n',
      'DISPATCH_MISSING_MEMBER',
      'no key for b',
      MISSING,
    ],
    [
      'a multi-key entry that leaves a member out',
      '"c" -> :union("a", "b", "c") -> dict[list["a", "b"]: 1]\n',
      'DISPATCH_MISSING_MEMBER',
      'no key for c',
      MISSING,
    ],
    [
      'a quoted member name',
      '"a b" -> :union("a b", "a") -> dict[a: 1]\n',
      'DISPATCH_MISSING_MEMBER',
      'no key for "a b"',
      MISSING,
    ],
    [
      'an atom union piped without -> string',
      `${ATOMS} -> dict[a: 1, b: 2]\n`,
      'DISPATCH_SELECTOR_NOT_STRING',
      'halts #TYPE_MISMATCH',
      MISMATCH,
    ],
    [
      'a :union(number, bool) selector',
      '1 -> :union(number, bool) -> dict["1": 1]\n',
      'DISPATCH_SELECTOR_NOT_STRING',
      'halts #TYPE_MISMATCH',
      MISMATCH,
    ],
    [
      'a number head',
      '1 -> dict["1": 1]\n',
      'DISPATCH_SELECTOR_NOT_STRING',
      'halts #TYPE_MISMATCH',
      MISMATCH,
    ],
    [
      'a variable table',
      'dict["1": 1] => $t\n1 -> $t\n',
      'DISPATCH_SELECTOR_NOT_STRING',
      'halts #TYPE_MISMATCH',
      MISMATCH,
    ],
    [
      'a table with a default',
      '1 -> dict["1": 1] ?? 0\n',
      'DISPATCH_SELECTOR_NOT_STRING',
      'even with a ?? default',
      MISMATCH,
    ],
    [
      'a declared param selector',
      '|k: number| { $k -> dict["1": 1] } => $f\n$f(1)\n',
      'DISPATCH_SELECTOR_NOT_STRING',
      'halts #TYPE_MISMATCH',
      MISMATCH,
    ],
  ];

describe('DISPATCH rules', () => {
  it.each(FIRES)('fires on %s', (_name, source, code, fragment) => {
    const result = check(source);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ code, severity: 'warning', fix: null });
    expect(result[0]?.message).toContain(fragment);
  });

  it.each(FIRES)(
    'halts at runtime on %s',
    async (_name, source, _code, _fragment, id) => {
      await expect(haltIds(source)).resolves.toContain(id);
    }
  );

  it('reports every missing member in written union order', () => {
    const result = check('"c" -> :union("c", "a", "b") -> dict[a: 1]\n');

    expect(result).toHaveLength(1);
    expect(result[0]?.message).toContain('no key for c, b,');
  });

  it.each([
    ['an unknown selector', 'use<ext:app> => $app\n$app.get() -> dict[a: 1]\n'],
    [
      'a union that includes string',
      '1 -> :union(string, number) -> dict["1": 1]\n',
    ],
    [
      'a list selector into nested tables',
      'list["a", "b"] -> dict[a: dict[b: 1]]\n',
    ],
    ['an ordered table', 'ordered[a: 1] => $o\n0 -> $o\n'],
    ['a table with a default', '"b" -> :union("a", "b") -> dict[a: 1] ?? 0\n'],
    [
      'a variable table with a default',
      'dict[a: 1] => $t\n"b" -> :union("a", "b") -> $t ?? 0\n',
    ],
    ['full coverage', '"b" -> :union("a", "b") -> dict[a: 1, b: 2]\n'],
    [
      'a dynamic key',
      '"x" => $k\n"b" -> :union("a", "b") -> dict[$k: 1, a: 2]\n',
    ],
    [
      'a multi-key entry covering every member',
      '"b" -> :union("a", "b") -> dict[list["a", "b"]: 1]\n',
    ],
    ['a bare literal head', '"a" -> dict[a: 1]\n'],
  ])('stays silent on %s', (_name, source) => {
    expect(check(source)).toEqual([]);
  });

  it('stays silent when an atom union has every name present', () => {
    expect(check(`${ATOMS} -> string -> dict[a: 1, b: 2]\n`)).toEqual([]);
  });

  it('fires only the selector rule on an atom union piped without -> string', () => {
    const result = check(`${ATOMS} -> dict[a: 1]\n`);

    expect(result.map((d) => d.code)).toEqual(['DISPATCH_SELECTOR_NOT_STRING']);
  });
});
