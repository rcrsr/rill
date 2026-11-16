/**
 * Rill Language Tests: Using an invalid value
 *
 * Interpolating an invalid value into a string, or placing one in a
 * collection literal, halts with the code the invalid value holds. Probing
 * the value with `.!` or `.!code` does not halt. Closures and iterators have
 * no string form, so interpolating either halts RILL-R036.
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  createRuntimeContext,
  execute,
  parse,
  parseWithRecovery,
  type RillValue,
} from '@rcrsr/rill';
import { expectHalt } from '../helpers/halt.js';

const HELD = 'guard<on: list[#NOT_A_CODE]> { 1 } => $x\n';

/** Runs a script through parseWithRecovery + execute and returns its value. */
async function runRecovered(src: string): Promise<unknown> {
  const parsed = parseWithRecovery(src);
  const { result } = await execute(parsed.ast, createRuntimeContext({}));
  return result;
}

describe('Invalid value in string interpolation', () => {
  it('guard around an interpolation yields the held code of $x', async () => {
    const result = await runRecovered(
      `${HELD}guard { "{$x}" } => $r\n$r.!code == $x.!code`
    );
    expect(result).toBe(true);
  });

  it('halts when an interpolation is captured', async () => {
    await expectHalt(() => runRecovered(`${HELD}"{$x}" => $s`), {
      code: 'R001',
    });
  });

  it('does not halt on "{$x.!}"', async () => {
    expect(await runRecovered(`${HELD}"{$x.!}"`)).toBe('true');
  });

  it('does not halt on "{$x.!code}"', async () => {
    expect(await runRecovered(`${HELD}"{$x.!code}"`)).toBe('#R001');
  });

  it('halts RILL-R036 when a closure is interpolated', async () => {
    await expectHalt(() => runRecovered('|a|($a) => $fn\n"{$fn}"'), {
      code: 'RILL_R036',
      hostErrorId: 'RILL-R036',
      messagePattern: /cannot convert closure to string/,
    });
  });

  it('halts RILL-R036 when an iterator is interpolated', async () => {
    await expectHalt(() => runRecovered('range(0, 3) => $it\n"{$it}"'), {
      code: 'RILL_R036',
      hostErrorId: 'RILL-R036',
      messagePattern: /cannot convert iterator to string/,
    });
  });
});

describe('Invalid value in a collection literal', () => {
  it.each([
    ['list element', 'list[$x]'],
    ['tuple element', 'tuple[$x]'],
    ['dict value', 'dict[a: $x]'],
    ['ordered value', 'ordered[a: $x]'],
    ['multi-key dict value', 'dict[list["a", "b"]: $x]'],
  ])('halts with the held code for a %s', async (_name, literal) => {
    await expectHalt(() => runRecovered(`${HELD}${literal}`), {
      code: 'R001',
    });
  });

  // A literal holding an invalid value halts at construction, so a spread
  // source holding one must come from a host function.
  it.each([
    ['list spread', 'list[...nested_list()]'],
    ['dict spread', 'dict[...nested_dict()]'],
  ])('halts with the held code for a %s', async (_name, script) => {
    const ctx = createRuntimeContext({
      functions: {
        nested_list: {
          returnType: anyTypeValue,
          params: [],
          fn: () => [bad()],
        },
        nested_dict: {
          returnType: anyTypeValue,
          params: [],
          fn: () => ({ a: bad() }),
        },
      },
    });
    function bad(): RillValue {
      return ctx.invalidate(new Error('inner'), {
        code: 'CONFLICT',
        provider: 'test',
      });
    }
    await expectHalt(() => execute(parse(script), ctx), {
      code: 'CONFLICT',
    });
  });

  it('does not halt on list[$x.!]', async () => {
    expect(await runRecovered(`${HELD}list[$x.!]`)).toEqual([true]);
  });
});
