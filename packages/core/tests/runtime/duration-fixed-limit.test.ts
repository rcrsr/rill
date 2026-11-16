/**
 * Rill Runtime Tests: fixed-length duration for time-bound options
 *
 * Every consumer that turns a duration into wall time (timeout limits and the
 * time-domain operators) halts #INVALID_INPUT, naming the option, when the
 * duration has a months part. A duration with only a milliseconds part works.
 */

import { describe, expect, it } from 'vitest';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

const MONTH_DURATIONS = ['duration("1mo")', 'duration("1y")'];

describe('timeout limits reject a months part', () => {
  it.each(MONTH_DURATIONS)('halts for total: %s', async (dur) => {
    await expectHalt(() => run(`timeout<total: ${dur}> { 1 }`), {
      code: 'INVALID_INPUT',
      messagePattern: /total/,
    });
  });

  it.each(MONTH_DURATIONS)('halts for idle: %s', async (dur) => {
    await expectHalt(() => run(`timeout<idle: ${dur}> { 1 }`), {
      code: 'INVALID_INPUT',
      messagePattern: /idle/,
    });
  });

  it('accepts a seconds duration', async () => {
    expect(await run('timeout<total: duration("1s")> { 1 }')).toBe(1);
  });
});

describe('time-domain operators reject a months part', () => {
  const OPERATORS = ['debounce', 'throttle', 'sample'];

  for (const op of OPERATORS) {
    it.each(MONTH_DURATIONS)(`halts ${op} for %s`, async (dur) => {
      await expectHalt(() => run(`range(0, 3) -> ${op}(${dur})`), {
        code: 'INVALID_INPUT',
        messagePattern: new RegExp(op),
      });
    });

    it(`${op} accepts a seconds duration`, async () => {
      const result = await run(`range(0, 3) -> ${op}(duration("1s"))`);
      expect(Array.isArray(result)).toBe(true);
    });
  }

  it.each(MONTH_DURATIONS)('halts batch idle_flush for %s', async (dur) => {
    await expectHalt(
      () =>
        run(
          `list[1, 2, 3] -> batch(2, dict[idle_flush: ${dur}]) -> seq({ $ })`
        ),
      { code: 'INVALID_INPUT', messagePattern: /idle_flush/ }
    );
  });

  it('batch idle_flush accepts a seconds duration', async () => {
    const result = await run(
      'list[1, 2, 3] -> batch(2, dict[idle_flush: duration("1s")]) -> seq({ $ }) -> .len'
    );
    expect(result).toBe(2);
  });
});
