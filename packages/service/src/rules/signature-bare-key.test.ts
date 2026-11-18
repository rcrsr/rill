import { describe, expect, it } from 'vitest';
import { parse, createRuntimeContext, execute } from '@rcrsr/rill';
import { runRules } from './run-rules.js';
import { signatureBareKey } from './signature-bare-key.js';
import { makeConfig, toParseResult } from './test-support.js';

function run(
  source: string,
  config = makeConfig()
): ReturnType<typeof runRules> {
  return runRules(toParseResult(source), source, config, [signatureBareKey]);
}

describe('SIGNATURE_BARE_KEY', () => {
  it('reports the exact message at warning severity', () => {
    const result = run(
      'dict("a b": number).signature == "dict(a b: number)"\n'
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'SIGNATURE_BARE_KEY',
      severity: 'warning',
      message:
        '.signature prints the key a b as "a b", so this comparison is always false; quote the key in the string.',
      fix: null,
    });
  });

  it.each([
    ['equals', 'dict("a b": number).signature == "dict(a b: number)"\n'],
    [
      'literal on the left',
      '"dict(a b: number)" == dict("a b": number).signature\n',
    ],
    [
      'variable',
      'dict["a b": 1].^type => $t\n$t.signature == "dict(a b: number)"\n',
    ],
    ['type annotation read', '$x.^type.signature == "dict(a b: number)"\n'],
    ['numeric key', 'dict("1": number).signature == "dict(1: number)"\n'],
    ['true key', 'dict("true": number).signature == "dict(true: number)"\n'],
    ['ordered', 'ordered("a b": number).signature == "ordered(a b: number)"\n'],
    [
      'nested list',
      'list(dict("a b": number)).signature == "list(dict(a b: number))"\n',
    ],
    [
      'dict default',
      'dict(d: dict).signature == "dict(d: dict = dict[a b: 1])"\n',
    ],
  ])('fires on %s', (_name, source) => {
    expect(run(source)).toHaveLength(1);
  });

  it.each([
    ['.eq', '$t.signature.eq("dict(a b: number)")\n', 'false'],
    ['.ne', '$t.signature.ne("dict(a b: number)")\n', 'true'],
    ['!=', '$t.signature != "dict(a b: number)"\n', 'true'],
    ['pipe form', '$t.signature -> .eq("dict(a b: number)")\n', 'false'],
    ['pipe .ne', '$t.signature -> .ne("dict(a b: number)")\n', 'true'],
  ])('fires on %s with the matching verdict', (_name, source, verdict) => {
    const result = run(source);

    expect(result).toHaveLength(1);
    expect(result[0]?.message).toContain(`always ${verdict};`);
  });

  it.each([
    ['quoted spelling', '$t.signature == "dict(\\"a b\\": number)"\n'],
    ['identifier keys', '$t.signature == "dict(a: number, b_c: string)"\n'],
    ['interpolated string', '$t.signature == "dict(a b: {$n})"\n'],
    ['non-signature operand', '$t.name == "dict(a b: number)"\n'],
    ['non-literal operand', '$t.signature == $other\n'],
    [
      'quoted default colon',
      '$t.signature == "dict(a: string = \\"x y: z\\")"\n',
    ],
    ['stream return type', '$t.signature == "stream(any):number"\n'],
  ])('stays silent on %s', (_name, source) => {
    expect(run(source)).toEqual([]);
  });

  it('stays silent when the rule is off', () => {
    const source = '$t.signature == "dict(a b: number)"\n';

    expect(
      run(source, makeConfig({ rules: { SIGNATURE_BARE_KEY: 'off' } }))
    ).toEqual([]);
  });

  describe('runtime verdicts', () => {
    async function evaluate(source: string): Promise<unknown> {
      const ctx = createRuntimeContext({});
      const result = await execute(parse(source), ctx);
      return result.result;
    }

    it('evaluates the firing comparison to false', async () => {
      expect(
        await evaluate('dict["a b": 1].^type.signature == "dict(a b: number)"')
      ).toBe(false);
    });

    it('evaluates the firing != comparison to true', async () => {
      expect(
        await evaluate('dict["a b": 1].^type.signature != "dict(a b: number)"')
      ).toBe(true);
    });

    it('evaluates the quoted spelling to true', async () => {
      expect(
        await evaluate(
          'dict["a b": 1].^type.signature == "dict(\\"a b\\": number)"'
        )
      ).toBe(true);
    });
  });
});
