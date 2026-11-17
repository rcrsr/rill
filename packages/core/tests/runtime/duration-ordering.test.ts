/**
 * Duration ordering: same-shape durations order by magnitude, equality and
 * compare-zero agree, sort orders a list, and mixed calendar components halt
 * with a catchable ordering error.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('duration ordering', () => {
  it('orders month durations', async () => {
    expect(await run('duration("1y") < duration("2y")')).toBe(true);
  });

  it('orders month durations with a day component', async () => {
    expect(await run('duration("1mo") < duration("1mo1d")')).toBe(true);
  });

  it('orders day durations', async () => {
    expect(await run('duration("1d") < duration("2d")')).toBe(true);
  });

  it('keeps equality and compare-zero consistent for equal durations', async () => {
    expect(await run('duration("1y") == duration("12mo")')).toBe(true);
    expect(await run('duration("1y") < duration("12mo")')).toBe(false);
    expect(await run('duration("12mo") < duration("1y")')).toBe(false);
  });

  it('sorts a list of durations ascending', async () => {
    const months = await run(
      'list[duration("2y"), duration("1y")] -> sort -> seq({ $.months })'
    );
    expect(months).toEqual([12, 24]);
  });

  it('halts ordering across calendar components with a recoverable atom', async () => {
    const code = await run(
      'guard { duration("1mo") < duration("30d") } => $r\n"{$r.!code}"'
    );
    const message = await run(
      'guard { duration("1mo") < duration("30d") } => $r\n"{$r.!message}"'
    );
    expect(code).toBe('#RILL_R002');
    expect(message).toBe(
      'Cannot order durations with different calendar components'
    );
  });
});
