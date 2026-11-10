/**
 * Duration ordering: same-shape durations order by magnitude, equality and
 * compare-zero agree, sort orders a list, and mixed calendar components halt
 * with a catchable ordering error.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('duration ordering', () => {
  it('orders month durations', async () => {
    expect(await run('duration(1) < duration(2)')).toBe(true);
  });

  it('orders month durations with a day component', async () => {
    expect(await run('duration(0,1) < duration(0,1,1)')).toBe(true);
  });

  it('orders day durations', async () => {
    expect(await run('duration(0,0,1) < duration(0,0,2)')).toBe(true);
  });

  it('keeps equality and compare-zero consistent for equal durations', async () => {
    expect(await run('duration(1) == duration(0,12)')).toBe(true);
    expect(await run('duration(1) < duration(0,12)')).toBe(false);
    expect(await run('duration(0,12) < duration(1)')).toBe(false);
  });

  it('sorts a list of durations ascending', async () => {
    const months = await run(
      'list[duration(2), duration(1)] -> sort -> seq({ $.months })'
    );
    expect(months).toEqual([12, 24]);
  });

  it('halts ordering across calendar components with a recoverable atom', async () => {
    const code = await run(
      'guard { duration(0,1) < duration(0,0,30) } => $r\n"{$r.!code}"'
    );
    const message = await run(
      'guard { duration(0,1) < duration(0,0,30) } => $r\n"{$r.!message}"'
    );
    expect(code).toBe('#RILL_R002');
    expect(message).toBe(
      'Cannot order durations with different calendar components'
    );
  });
});
