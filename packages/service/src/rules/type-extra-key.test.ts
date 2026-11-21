import { createRuntimeContext, execute, parse } from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';
import { runRules } from './run-rules.js';
import { typeExtraKey } from './type-extra-key.js';
import { makeConfig, toParseResult } from './test-support.js';

function run(
  source: string,
  config = makeConfig()
): ReturnType<typeof runRules> {
  return runRules(toParseResult(source), source, config, [typeExtraKey]);
}

async function runtime(source: string): Promise<unknown> {
  const result = await execute(parse(source), createRuntimeContext());
  return result.result;
}

const FIRES: ReadonlyArray<readonly [string, string, string]> = [
  [
    'pipe assertion',
    'dict[a: 1, b: 2] -> :dict(a: number)\n',
    'This dict has key b that dict(a: number) does not name, so the check halts #TYPE_MISMATCH; name the key in the type, or convert first with -> dict(a: number).',
  ],
  [
    'postfix assertion',
    'dict[a: 1, b: 2]:dict(a: number)\n',
    'This dict has key b that dict(a: number) does not name, so the check halts #TYPE_MISMATCH; name the key in the type, or convert first with -> dict(a: number).',
  ],
  [
    'typed capture',
    'dict[a: 1, b: 2] => $x:dict(a: number)\n',
    'This dict has key b that dict(a: number) does not name, so the capture halts #TYPE_MISMATCH; name the key in the type, or convert first with -> dict(a: number).',
  ],
  [
    'bare bracket literal',
    '[a: 1, b: 2] -> :dict(a: number)\n',
    'This dict has key b that dict(a: number) does not name, so the check halts #TYPE_MISMATCH; name the key in the type, or convert first with -> dict(a: number).',
  ],
  [
    'variable source',
    'dict[a: 1, b: 2] => $d\n$d -> :dict(a: number)\n',
    'This dict has key b that dict(a: number) does not name, so the check halts #TYPE_MISMATCH; name the key in the type, or convert first with -> dict(a: number).',
  ],
  [
    'inline fn target',
    'dict[a: 1, b: 2] -> fn(p: dict(a: number)) { $p }\n',
    'This dict has key b that dict(a: number) does not name, so the parameter halts RILL-R001; name the key in the type, or convert first with -> dict(a: number).',
  ],
  [
    'ordered assertion',
    'ordered[a: 1, b: 2] -> :ordered(a: number)\n',
    'This ordered has key b that ordered(a: number) does not name, so the check halts #TYPE_MISMATCH; name the key in the type.',
  ],
  [
    'nested path',
    'dict[a: dict[x: 1, y: 2]] -> :dict(a: dict(x: number))\n',
    'This dict has key a.y that dict(a: dict(x: number)) does not name, so the check halts #TYPE_MISMATCH; name the key in the type, or convert first with -> dict(a: dict(x: number)).',
  ],
  [
    'number and quoted keys',
    'dict["a b": 1, 1: 2] -> :dict(x: number)\n',
    'This dict has key "a b", "1" that dict(x: number) does not name, so the check halts #TYPE_MISMATCH; name the key in the type, or convert first with -> dict(x: number).',
  ],
];

describe('TYPE_EXTRA_KEY', () => {
  it.each(FIRES)('fires on %s', (_name, source, message) => {
    const result = run(source);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'TYPE_EXTRA_KEY',
      severity: 'warning',
      message,
      fix: null,
    });
  });

  it.each(FIRES.filter(([name]) => name !== 'number and quoted keys'))(
    'halts at runtime where it fires on %s',
    async (_name, source) => {
      await expect(runtime(source)).rejects.toThrow();
    }
  );

  it('fires on a typed parameter default and the call halts when the argument is omitted', async () => {
    const source =
      'fn(p: dict(a: number) = dict[a: 1, b: 2]) { $p } => $f\n$f()\n';
    const result = run(source);

    expect(result).toHaveLength(1);
    expect(result[0]?.message).toBe(
      'This dict has key b that dict(a: number) does not name, so the parameter halts RILL-R001 when the argument is omitted; name the key in the type, or convert first with -> dict(a: number).'
    );
    await expect(runtime(source)).rejects.toThrow();
  });

  it('reports the probe as false', async () => {
    const source = 'dict[a: 1, b: 2] -> :?dict(a: number)\n';
    const result = run(source);

    expect(result).toHaveLength(1);
    expect(result[0]?.message).toBe(
      'This dict has key b that dict(a: number) does not name, so :?dict(a: number) is false.'
    );
    expect(await runtime(source)).toBe(false);
  });

  it('reports a postfix probe once', () => {
    expect(run('dict[a: 1, b: 2]:?dict(a: number)\n')).toHaveLength(1);
  });

  it('reports only the capture after a pass-through assertion', () => {
    const result = run(
      'dict[a: 1, b: 2] -> :dict(a: number, b: number) => $y:dict(a: number)\n'
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.message).toContain('the capture halts');
  });

  it('reports a location at the checking node', () => {
    const result = run('dict[a: 1, b: 2] -> :dict(a: number)\n');

    expect(result[0]?.location.line).toBe(1);
    expect(result[0]?.location.column).toBe(21);
  });

  it.each([
    ['bare dict', 'dict[a: 1, b: 2] -> :dict\n'],
    ['empty dict args', 'dict[a: 1, b: 2] -> :dict()\n'],
    ['exact keys', 'dict[a: 1, b: 2] -> :dict(a: number, b: number)\n'],
    [
      'defaulted absent field',
      'dict[a: 1] -> :dict(a: number, b: number = 2)\n',
    ],
    ['spread key', 'dict[a: 1] => $s\ndict[...$s, b: 2] -> :dict(a: number)\n'],
    ['computed key', '"b" => $k\ndict[a: 1, ($k): 2] -> :dict(a: number)\n'],
    [
      'variable captured twice',
      'dict[a: 1, b: 2] => $d\ndict[a: 1, b: 2] => $d\n$d -> :dict(a: number)\n',
    ],
    [
      'host call source',
      'use<ext:app> => $app\n$app.get() -> :dict(a: number)\n',
    ],
    ['dynamic type', 'dict[a: 1, b: 2] -> :$t\n'],
    ['dict into ordered', 'dict[a: 1, b: 2] -> :ordered(a: number)\n'],
    ['union', 'dict[a: 1, b: 2] -> :union(dict(a: number), string)\n'],
    ['list element', 'list[dict[a: 1, b: 2]] -> :list(dict(a: number))\n'],
    [
      'after a non-pass-through pipe',
      'dict[a: 1, b: 2] -> .keys -> :dict(a: number)\n',
    ],
  ])('stays silent on %s', (_name, source) => {
    expect(run(source)).toEqual([]);
  });

  it('stays silent when the rule is off', () => {
    const source = 'dict[a: 1, b: 2] -> :dict(a: number)\n';

    expect(
      run(source, makeConfig({ rules: { TYPE_EXTRA_KEY: 'off' } }))
    ).toEqual([]);
  });

  it('succeeds at runtime on exact keys and a defaulted absent field', async () => {
    await expect(
      runtime('dict[a: 1, b: 2] -> :dict(a: number, b: number)\n')
    ).resolves.toBeDefined();
    await expect(
      runtime('dict[a: 1] -> :dict(a: number, b: number = 2)\n')
    ).resolves.toBeDefined();
  });
});
