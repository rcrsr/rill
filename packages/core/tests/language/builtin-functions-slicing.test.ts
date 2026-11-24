/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: slicing and time-domain built-in functions
 * Covers source kinds, result kinds, argument checks, and predicate call
 * counts for take, skip, cycle, batch, window, start_when, stop_when,
 * iterate, debounce, throttle, and sample, where no other test does.
 */

import { anyTypeValue, type RillValue } from '@rcrsr/rill';
import { describe, expect } from 'vitest';

import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';

const STREAM =
  'fn():stream(number) {\n  1 -> yield\n  2 -> yield\n  3 -> yield\n} => $g\n';

/** Host function `tick` that returns its argument and counts its calls. */
function counter() {
  const state = { calls: 0 };
  const functions = {
    tick: {
      params: [
        {
          name: 'v',
          type: { kind: 'any' as const },
          defaultValue: undefined,
          annotations: {},
        },
      ],
      returnType: anyTypeValue,
      fn: (args: Record<string, RillValue>): RillValue => {
        state.calls++;
        return args['v'] ?? '';
      },
    },
  };
  return { state, functions };
}

describe('Rill Language: slicing functions', () => {
  rule('slicing.sources').it(
    'reads a tuple, an ordered, a map, and a stream as sources',
    async () => {
      expect(await run('tuple[1, 2, 3] -> take(2)')).toEqual([1, 2]);
      expect(await run('tuple[1, 2, 3] -> skip(1)')).toEqual([2, 3]);
      expect(await run('tuple[1, 2, 3] -> batch(2)')).toEqual([[1, 2], [3]]);
      expect(await run('tuple[1, 2, 3] -> window(2)')).toEqual([[1, 2], [3]]);
      expect(await run('tuple[1, 2, 3] -> start_when({ $ > 1 })')).toEqual([
        2, 3,
      ]);
      expect(await run('tuple[1, 2, 3] -> stop_when({ $ > 1 })')).toEqual([
        1, 2,
      ]);
      expect(await run('tuple[1, 2] -> cycle -> take(3)')).toEqual([1, 2, 1]);
      expect(
        await run('ordered[b: 1, a: 2] -> take(1) -> seq({ $.key })')
      ).toEqual(['b']);
      expect(
        await run('map["b": 1, "a": 2] -> skip(1) -> seq({ $.key })')
      ).toEqual(['a']);
      expect(await run(`${STREAM}$g() -> take(2)`)).toEqual([1, 2]);
      expect(await run(`${STREAM}$g() -> window(2, 1)`)).toEqual([
        [1, 2],
        [2, 3],
        [3],
      ]);
      expect(await run(`${STREAM}$g() -> cycle -> take(4)`)).toEqual([
        1, 2, 3, 1,
      ]);
    }
  );

  rule('slicing.other-source').it(
    'halts RILL-R002 on a number source, and guard catches it',
    async () => {
      for (const call of [
        'take(1)',
        'skip(1)',
        'batch(1)',
        'window(1)',
        'start_when({ $ > 0 })',
        'stop_when({ $ > 0 })',
      ]) {
        await expectHalt(() => run(`5 -> ${call}`), {
          code: 'RILL_R002',
          hostErrorId: 'RILL-R002',
        });
        expect(await run(`guard { 5 -> ${call} } => $r\n$r.!code`)).toEqual(
          await run('#RILL_R002')
        );
      }
    }
  );

  rule('slicing.to-list').it(
    'yields a list from an iterator and a stream source',
    async () => {
      for (const call of [
        'take(2)',
        'skip(1)',
        'batch(2)',
        'window(2)',
        'start_when({ $ > 0 })',
        'stop_when({ $ > 5 })',
      ]) {
        expect(await run(`range(0, 3) -> ${call} -> :?list`)).toBe(true);
        expect(await run(`${STREAM}$g() -> ${call} -> :?list`)).toBe(true);
      }
    }
  );

  rule('slicing.integer').it(
    'halts #INVALID_INPUT for a fractional n or step, and accepts 2.0',
    async () => {
      for (const call of [
        'take(1.5)',
        'batch(1.5)',
        'window(1.5)',
        'window(2, 1.5)',
      ]) {
        await expectHalt(() => run(`list[1, 2, 3] -> ${call}`), {
          code: 'INVALID_INPUT',
        });
      }
      expect(await run('list[1, 2, 3] -> take(2.0)')).toEqual([1, 2]);
    }
  );

  rule('batch.options-kind').it(
    'halts #TYPE_MISMATCH for list and number options',
    async () => {
      await expectHalt(() => run('list[1, 2, 3] -> batch(2, list[])'), {
        code: 'TYPE_MISMATCH',
      });
      await expectHalt(() => run('list[1, 2, 3] -> batch(2, 5)'), {
        code: 'TYPE_MISMATCH',
      });
    }
  );

  rule('batch.unknown-option').it(
    'halts #INVALID_INPUT for an unknown option name',
    async () => {
      await expectHalt(() => run('list[1, 2, 3] -> batch(2, dict[foo: 1])'), {
        code: 'INVALID_INPUT',
      });
    }
  );

  rule('start-when.once').it(
    'does not call the predicate after the first match',
    async () => {
      const { state, functions } = counter();
      expect(
        await run('list[1, 2, 3, 4] -> start_when({ tick($) > 1 })', {
          functions,
        })
      ).toEqual([2, 3, 4]);
      expect(state.calls).toBe(2);
    }
  );

  rule('stop-when.once').it(
    'does not call the predicate after the first match',
    async () => {
      const { state, functions } = counter();
      expect(
        await run('list[1, 2, 3, 4] -> stop_when({ tick($) > 1 })', {
          functions,
        })
      ).toEqual([1, 2]);
      expect(state.calls).toBe(2);
    }
  );

  rule('stop-when.no-match').it(
    'yields every element when nothing matches',
    async () => {
      expect(await run('list[1, 2] -> stop_when({ $ > 5 })')).toEqual([1, 2]);
      expect(await run('list[] -> stop_when({ $ > 5 })')).toEqual([]);
    }
  );

  rule('iterate.lazy').it(
    'calls the body only for elements read past the seed',
    async () => {
      const { state, functions } = counter();
      await run('iterate(0, { tick($) + 1 }) => $it\n1', { functions });
      expect(state.calls).toBe(0);
      expect(
        await run('iterate(0, { tick($) + 1 }) -> take(3)', { functions })
      ).toEqual([0, 1, 2]);
      expect(state.calls).toBe(2);
      expect(await run('iterate(0, fn(x: string) { $x }) -> take(1)')).toEqual([
        0,
      ]);
    }
  );
});

describe('Rill Language: time-domain functions', () => {
  rule('time-domain.sources').it(
    'accepts an iterator and a stream and halts #INVALID_INPUT on others',
    async () => {
      for (const op of ['debounce', 'throttle', 'sample']) {
        for (const src of ['tuple[1, 2]', '"ab"', 'dict[a: 1]', '5']) {
          await expectHalt(() => run(`${src} -> ${op}(duration("1ms"))`), {
            code: 'INVALID_INPUT',
          });
        }
        expect(
          await run(`range(0, 2) -> ${op}(duration("1ms")) -> :?list`)
        ).toBe(true);
        expect(
          await run(`${STREAM}$g() -> ${op}(duration("1ms")) -> :?list`)
        ).toBe(true);
      }
    }
  );

  rule('time-domain.subsequence').it(
    'yields chunks of the source in source order',
    async () => {
      for (const op of ['debounce', 'throttle', 'sample']) {
        for (const ms of ['0ms', '10ms']) {
          const out = (await run(
            `${STREAM}$g() -> ${op}(duration("${ms}"))`
          )) as number[];
          expect(out.length).toBeGreaterThan(0);
          expect(out.every((v) => [1, 2, 3].includes(v))).toBe(true);
          expect([...out].sort((a, b) => a - b)).toEqual(out);
          expect(new Set(out).size).toBe(out.length);
        }
      }
    }
  );

  rule('debounce.zero').it(
    'debounce with a zero duration keeps every chunk',
    async () => {
      expect(await run(`${STREAM}$g() -> debounce(duration("0ms"))`)).toEqual([
        1, 2, 3,
      ]);
    }
  );

  rule('throttle.zero').it(
    'throttle with a zero duration keeps every chunk',
    async () => {
      expect(await run(`${STREAM}$g() -> throttle(duration("0ms"))`)).toEqual([
        1, 2, 3,
      ]);
    }
  );
});
