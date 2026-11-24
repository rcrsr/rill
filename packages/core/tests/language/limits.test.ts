/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language: limits.
 *
 * Call depth, calls in flight, slicing results, parser nesting depth, the
 * host timeout on host function calls, string length, and the datetime range.
 */

import { describe, expect } from 'vitest';
import {
  anyTypeValue,
  parse,
  ParseError,
  type RillFunction,
} from '@rcrsr/rill';
import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';

const RECURSE = 'fn(n: number) { ($n == 0) ? 0 ! ($f($n - 1) + 1) } => $f\n';

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from }, (_, i) => from + i);

/** A host function that never settles on its own. */
const hang: RillFunction = {
  params: [],
  returnType: anyTypeValue,
  fn: () => new Promise<never>(() => {}),
};

/** A host function that returns after `ms` milliseconds. */
const after = (ms: number): RillFunction => ({
  params: [],
  returnType: anyTypeValue,
  fn: () =>
    new Promise((resolve) => {
      setTimeout(() => resolve('done'), ms);
    }),
});

describe('limits', () => {
  describe('call depth', () => {
    rule('call-depth.nesting').it(
      'completes 1,000 nested calls and halts RILL-R010 past them, uncatchably',
      async () => {
        expect(await run(`${RECURSE}999 -> $f`)).toBe(999);
        await expect(run(`${RECURSE}1000 -> $f`)).rejects.toMatchObject({
          errorId: 'RILL-R010',
          message: expect.stringContaining('Call depth exceeded 1000'),
        });
        await expect(
          run(`${RECURSE}guard { 1000 -> $f } ?? "recovered"`)
        ).rejects.toMatchObject({ errorId: 'RILL-R010' });
      }
    );

    rule('call-depth.host-setting').it(
      'replaces 1,000 with the host depth limit in both ceilings',
      async () => {
        const opts = { maxCallDepth: 10 };
        expect(await run(`${RECURSE}9 -> $f`, opts)).toBe(9);
        await expect(run(`${RECURSE}10 -> $f`, opts)).rejects.toMatchObject({
          errorId: 'RILL-R010',
          message: expect.stringContaining('Call depth exceeded 10'),
        });
        await expect(
          run(`${RECURSE}range(0, 2000) -> fan({ $f(9 + $ * 0) })`, opts)
        ).rejects.toMatchObject({
          errorId: 'RILL-R010',
          message: expect.stringContaining('Calls in flight exceeded 10010'),
        });
      }
    );

    rule('call-depth.in-flight').it(
      'halts RILL-R010 past 11,000 calls in flight, uncatchably',
      async () => {
        const src =
          'fn { $ } => $g\nguard { range(0, 10000) -> fan({ $g($) }) } ?? "recovered"';
        await expect(run(src)).rejects.toMatchObject({
          errorId: 'RILL-R010',
          message: expect.stringContaining('Calls in flight exceeded 11000'),
        });
        expect(
          await run('fn { $ } => $g\nrange(0, 3) -> fan({ $g($) })')
        ).toEqual([0, 1, 2]);
      }
    );
  });

  describe('slicing results', () => {
    const big = { variables: { big: range(0, 10001), huge: range(0, 20000) } };

    rule('slicing-limit.output').it(
      'halts RILL-R010 for a result past 10,000 elements and returns 10,000',
      async () => {
        for (const src of [
          '$big -> take(10001)',
          '$big -> batch(1)',
          '$big -> window(1, 1)',
          '$big -> start_when({ $ >= 0 })',
          '$big -> stop_when({ $ < 0 })',
        ]) {
          await expect(run(src, big)).rejects.toMatchObject({
            errorId: 'RILL-R010',
          });
        }
        expect(await run('$huge -> batch(2) -> .len', big)).toBe(10000);
        expect(await run('$huge -> window(2, 2) -> .len', big)).toBe(10000);
        expect(await run('$big -> take(10000) -> .len', big)).toBe(10000);
      }
    );

    rule('slicing-limit.step-walk').it(
      'halts take and skip after 10,000 iterator steps unless the source ends first',
      async () => {
        await expect(
          run('range(0, 20000) -> take(10001)')
        ).rejects.toMatchObject({
          errorId: 'RILL-R010',
          message: expect.stringContaining('10000 step limit'),
        });
        await expect(
          run('range(0, 20000) -> skip(10001)')
        ).rejects.toMatchObject({ errorId: 'RILL-R010' });
        expect(await run('range(0, 5) -> take(10001) -> .len')).toBe(5);
        expect(await run('range(0, 3) -> skip(15000)')).toEqual([]);
        expect(await run('range(0, 20000) -> skip(10000) -> take(2)')).toEqual([
          10000, 10001,
        ]);
      }
    );

    rule('slicing-limit.list-source').it(
      'does not halt a slicing function for a list source past 10,000',
      async () => {
        expect(await run('$huge -> skip(19998)', big)).toEqual([19998, 19999]);
        expect(await run('$big -> skip(10001) -> .len', big)).toBe(0);
        expect(await run('$big -> start_when({ $ >= 1 }) -> .len', big)).toBe(
          10000
        );
        expect(await run('$huge -> take(3)', big)).toEqual([0, 1, 2]);
      }
    );
  });

  describe('nesting depth', () => {
    const nest = (open: string, close: string, n: number): string =>
      `${open.repeat(n)}1${close.repeat(n)}`;

    rule('nesting-depth.reject').it(
      'rejects deep nesting with RILL-P015 before evaluation',
      () => {
        for (const src of [
          nest('(', ')', 200),
          nest('list[', ']', 200),
          nest('{ ', ' }', 200),
        ]) {
          let err: unknown;
          try {
            parse(src);
          } catch (e) {
            err = e;
          }
          expect(err).toBeInstanceOf(ParseError);
          expect(err).toHaveProperty('errorId', 'RILL-P015');
        }
      }
    );

    rule('nesting-depth.shallow').it(
      'parses and evaluates forty levels of each form',
      async () => {
        expect(await run(nest('(', ')', 40))).toBe(1);
        expect(await run(nest('{ ', ' }', 40))).toBe(1);
        let value: unknown = await run(nest('list[', ']', 40));
        for (let i = 0; i < 40; i++) {
          expect(value).toHaveLength(1);
          value = (value as unknown[])[0];
        }
        expect(value).toBe(1);
      }
    );
  });

  describe('host timeout', () => {
    rule('host-timeout.expiry').it(
      'halts RILL-R012 without waiting for the host call, catchably',
      async () => {
        const opts = { functions: { hang }, timeout: 20 };
        await expect(run('hang()', opts)).rejects.toMatchObject({
          errorId: 'RILL-R012',
        });
        expect(await run('guard { hang() } ?? "recovered"', opts)).toBe(
          'recovered'
        );
      }
    );

    rule('host-timeout.within').it(
      'yields the result of a host call that returns in time',
      async () => {
        expect(
          await run('quick()', {
            functions: { quick: after(0) },
            timeout: 1000,
          })
        ).toBe('done');
      }
    );

    rule('host-timeout.unset').it(
      'lets a host call run until it returns when no timeout is set',
      async () => {
        expect(await run('slow()', { functions: { slow: after(50) } })).toBe(
          'done'
        );
      }
    );

    rule('host-timeout.script-function').it(
      'does not bound a script function call',
      async () => {
        const src =
          'fn(n: number) { 0 -> while ($ < $n) do { $ + 1 } } => $count\n$count(9000)';
        expect(await run(src, { timeout: 1 })).toBe(9000);
      }
    );
  });

  describe('value size', () => {
    rule('value-size.string').it(
      'yields "" for an empty receiver repeated any number of times',
      async () => {
        expect(await run('"" -> .repeat(1000000000)')).toBe('');
      }
    );

    rule('value-size.datetime').it(
      'accepts both bounds and halts #INVALID_INPUT past them',
      async () => {
        expect(await run('datetime("+275760-09-13T00:00:00Z") -> .unix')).toBe(
          8640000000000000
        );
        expect(await run('datetime("-271821-04-20T00:00:00Z") -> .unix')).toBe(
          -8640000000000000
        );
        for (const src of [
          'datetime("+275760-09-14T00:00:00Z")',
          'datetime("-271821-04-19T23:59:59Z")',
          'datetime(...dict[year: 275761, month: 1, day: 1])',
          'datetime(...dict[year: -271821, month: 4, day: 19])',
          'datetime(...dict[unix: 8640000000000000]) -> .add(duration(...dict[ms: 1]))',
        ]) {
          expect(
            await run(`guard { ${src} } => $r\n$r.!code == #INVALID_INPUT`)
          ).toBe(true);
        }
      }
    );
  });
});
