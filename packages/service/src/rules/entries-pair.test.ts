import {
  RuntimeError,
  RuntimeHaltSignal,
  createRuntimeContext,
  execute,
  parse,
} from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';
import { entriesPairAsList } from './entries-pair.js';
import { runRules } from './run-rules.js';
import { makeConfig, toParseResult } from './test-support.js';

function run(
  source: string,
  config = makeConfig()
): ReturnType<typeof runRules> {
  return runRules(toParseResult(source), source, config, [entriesPairAsList]);
}

async function runtime(source: string): Promise<unknown> {
  const result = await execute(parse(source), createRuntimeContext());
  return result.result;
}

/** The error id and message of the halt a script raises. */
async function haltOf(source: string): Promise<string> {
  try {
    await runtime(source);
  } catch (error) {
    if (error instanceof RuntimeHaltSignal || error instanceof RuntimeError) {
      return `${error.errorId ?? ''} ${error.message}`;
    }
    throw error;
  }
  throw new Error('expected the script to halt');
}

const SETUP = 'dict[a: 1] => $d\n';
const LISTS = 'dict[a: list["x"]] => $d\n';

const LIST_ONLY_METHODS: readonly string[] = [
  'first',
  'has',
  'has_all',
  'has_any',
  'head',
  'join',
  'reverse',
  'tail',
];

const METHOD_ARGS: Readonly<Record<string, string>> = {
  at: '0',
  join: '","',
  has: '1',
  has_any: 'list[1]',
  has_all: 'list[1]',
};

const CHECK_TAIL = 'list(tuple(string, any)) instead.';

function listOnly(name: string): string {
  return `This .entries element is a tuple, and .${name} is a list-only method, so it halts; use $pair -> list, or $pair[0] and $pair[1].`;
}

const DICT_MESSAGE =
  'This .entries element is a tuple, and -> dict cannot convert it, so it halts; use $pair[0] and $pair[1].';

// [name, source, message, line, column, runtime halt token]
const FIRES: ReadonlyArray<
  readonly [string, string, string, number, number, string]
> = [
  [
    'pipe assertion',
    `${SETUP}$d.entries -> :list(list)\n`,
    `This .entries result is a list of tuples, so the check against list(list) halts #TYPE_MISMATCH; check ${CHECK_TAIL}`,
    2,
    15,
    '#TYPE_MISMATCH',
  ],
  [
    'postfix assertion',
    `${SETUP}$d.entries:list(list)\n`,
    `This .entries result is a list of tuples, so the check against list(list) halts #TYPE_MISMATCH; check ${CHECK_TAIL}`,
    2,
    1,
    '#TYPE_MISMATCH',
  ],
  [
    'typed capture',
    `${SETUP}$d.entries => $e:list(list)\n`,
    `This .entries result is a list of tuples, so the capture against list(list) halts #TYPE_MISMATCH; check ${CHECK_TAIL}`,
    2,
    15,
    '#TYPE_MISMATCH',
  ],
  [
    'inner element type',
    `${SETUP}$d.entries -> :list(list(number))\n`,
    'This .entries result is a list of tuples, so the check against list(list(number)) halts #TYPE_MISMATCH; check list(tuple(string, number)) instead.',
    2,
    15,
    '#TYPE_MISMATCH',
  ],
  [
    'variable captured from entries',
    `${SETUP}$d.entries => $e\n$e -> :list(list)\n`,
    `This .entries result is a list of tuples, so the check against list(list) halts #TYPE_MISMATCH; check ${CHECK_TAIL}`,
    3,
    7,
    '#TYPE_MISMATCH',
  ],
  [
    'entries stage',
    `${SETUP}$d -> .entries -> :list(list)\n`,
    `This .entries result is a list of tuples, so the check against list(list) halts #TYPE_MISMATCH; check ${CHECK_TAIL}`,
    2,
    19,
    '#TYPE_MISMATCH',
  ],
  [
    'after a pass-through assertion',
    `${SETUP}$d.entries -> :list(tuple(string, number)) -> :list(list)\n`,
    `This .entries result is a list of tuples, so the check against list(list) halts #TYPE_MISMATCH; check ${CHECK_TAIL}`,
    2,
    47,
    '#TYPE_MISMATCH',
  ],
  [
    'method on bare dollar',
    `${SETUP}$d.entries -> seq({ $.head() })\n`,
    listOnly('head'),
    2,
    21,
    'head',
  ],
  [
    'field read on bare dollar',
    `${SETUP}$d.entries -> seq({ $.head })\n`,
    listOnly('head'),
    2,
    21,
    'RILL-R003',
  ],
  [
    'pipe method on bare dollar',
    `${SETUP}$d.entries -> seq({ $ -> .tail })\n`,
    listOnly('tail'),
    2,
    26,
    'tail',
  ],
  [
    'method on closure parameter',
    `${SETUP}$d.entries -> seq(|p| { $p.head() })\n`,
    listOnly('head'),
    2,
    25,
    'head',
  ],
  [
    'field read on closure parameter',
    `${SETUP}$d.entries -> seq(|p| { $p.head })\n`,
    listOnly('head'),
    2,
    25,
    'RILL-R003',
  ],
  [
    'pipe method on closure parameter',
    `${SETUP}$d.entries -> seq(|p| { $p -> .first })\n`,
    listOnly('first'),
    2,
    31,
    'first',
  ],
  [
    'method shorthand body',
    `${SETUP}$d.entries -> seq({ .head })\n`,
    listOnly('head'),
    2,
    15,
    'head',
  ],
  [
    'indexed entries method',
    `${SETUP}$d.entries[0].head()\n`,
    listOnly('head'),
    2,
    1,
    'head',
  ],
  [
    'indexed entries field read',
    `${SETUP}$d.entries[0].head\n`,
    listOnly('head'),
    2,
    1,
    'RILL-R003',
  ],
  [
    'dict conversion',
    `${SETUP}$d.entries -> seq({ $ -> dict })\n`,
    DICT_MESSAGE,
    2,
    26,
    'RILL-R036',
  ],
  [
    'body fed by a captured entries variable',
    `${SETUP}$d.entries => $e\n$e -> seq({ $.head() })\n`,
    listOnly('head'),
    3,
    13,
    'head',
  ],
];

describe('ENTRIES_PAIR_AS_LIST', () => {
  it.each(FIRES)('fires on %s', (_name, source, message, line, column) => {
    const result = run(source);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'ENTRIES_PAIR_AS_LIST',
      severity: 'warning',
      message,
      fix: null,
      location: { line, column },
    });
  });

  it.each(FIRES)(
    'halts at runtime where it fires on %s',
    async (_name, source, _message, _line, _column, token) => {
      expect(await haltOf(source)).toContain(token);
    }
  );

  it('reports the probe as false', async () => {
    const source = `${SETUP}$d.entries -> :?list(list)\n`;
    const result = run(source);

    expect(result).toHaveLength(1);
    expect(result[0]?.message).toBe(
      `This .entries result is a list of tuples, so :?list(list) is false; check ${CHECK_TAIL}`
    );
    expect(await runtime(source)).toBe(false);
  });

  it('reports a postfix probe once', async () => {
    const source = `${SETUP}$d.entries:?list(list(number))\n`;
    const result = run(source);

    expect(result).toHaveLength(1);
    expect(result[0]?.message).toBe(
      'This .entries result is a list of tuples, so :?list(list(number)) is false; check list(tuple(string, number)) instead.'
    );
    expect(await runtime(source)).toBe(false);
  });

  it.each(LIST_ONLY_METHODS)(
    'derives %s as list-only: it fires and halts on an entries element',
    async (name) => {
      const source = `${SETUP}$d.entries -> seq({ $.${name}(${METHOD_ARGS[name] ?? ''}) })\n`;
      const result = run(source);

      expect(result).toHaveLength(1);
      expect(result[0]?.message).toBe(listOnly(name));
      expect(await haltOf(source)).toContain('RILL-R003');
    }
  );

  it.each([
    ['.at on an element', `${SETUP}$d.entries -> seq({ $.at(0) })\n`],
    ['.len on an element', `${SETUP}$d.entries -> seq({ $.len })\n`],
    ['.len on an indexed pair', `${SETUP}$d.entries[0].len\n`],
  ])('stays silent on %s, which a tuple serves', async (_label, source) => {
    expect(run(source)).toEqual([]);
    await expect(runtime(source)).resolves.toBeDefined();
  });

  it.each([
    ['positional first read', `${SETUP}$d.entries -> seq({ $[0] })\n`],
    ['positional second read', `${SETUP}$d.entries -> seq({ $[1] })\n`],
    [
      'field read on a rebound pipe value',
      `${LISTS}$d.entries -> seq({ $[1] -> $.first })\n`,
    ],
    [
      'field read in a conditional branch',
      `${LISTS}$d.entries -> seq({ $[1] -> .empty ? "x" ! $.first })\n`,
    ],
    [
      'method in a step argument',
      `${LISTS}$d.entries -> seq({ $[1] -> .join($.head) })\n`,
    ],
    [
      'positional destructure',
      `${SETUP}$d.entries -> seq({ $ -> destruct<$k, $v> })\n`,
    ],
    ['plain seq', `${SETUP}$d.entries -> seq({ $ })\n`],
    ['len on the result', `${SETUP}$d.entries -> .len\n`],
    ['len field on the result', `${SETUP}$d.entries.len\n`],
    ['method on the result', `${SETUP}$d.entries.head()\n`],
    [
      'element converted to a list',
      `${SETUP}$d.entries -> seq({ $ -> list -> .head })\n`,
    ],
    ['empty on an element', `${SETUP}$d.entries -> seq({ $ -> .empty })\n`],
    ['eq on an element', `${SETUP}$d.entries -> seq({ $ -> .eq($) })\n`],
    ['indexed positional read', `${SETUP}$d.entries[0][0]\n`],
    [
      'list of lists not from entries',
      'list[list[1], list[2]] -> seq({ $.head() })\n',
    ],
    [
      'nested branch body',
      `${SETUP}$d.entries -> seq({ $ -> .empty ? { $.head() } ! { 0 } })\n`,
    ],
    [
      'host data',
      'dict[rows: list[list[1]]] => $data\n$data.rows -> seq({ $.head() })\n',
    ],
    [
      'tuple check on entries',
      `${SETUP}$d.entries -> :list(tuple(string, number))\n`,
    ],
    ['list conversion of entries', `${SETUP}$d.entries -> list(list)\n`],
    ['list of lists assertion elsewhere', 'list[list[1]] -> :list(list)\n'],
    ['bare list assertion on entries', `${SETUP}$d.entries -> :list\n`],
  ])('stays silent on %s and succeeds at runtime', async (_name, source) => {
    expect(run(source)).toEqual([]);
    await expect(runtime(source)).resolves.toBeDefined();
  });

  it('stays silent when the rule is off', () => {
    const source = `${SETUP}$d.entries -> :list(list)\n`;

    expect(
      run(source, makeConfig({ rules: { ENTRIES_PAIR_AS_LIST: 'off' } }))
    ).toEqual([]);
  });
});
