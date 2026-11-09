/**
 * Regression tests for datetime named-component error clarity and ISO
 * offset validity (triage follow-ups from #431 items (b) and (c)).
 *
 * (b) `datetime(...dict[year: 2024])` omits `month`, and the named-component
 * validation previously reported this as `Invalid datetime component month:
 * type(null)`, which reads as if a literal null had been passed rather than
 * the component simply being missing. The halt message now distinguishes
 * "not provided" from "provided with the wrong type".
 *
 * (c) `.iso(offset)` (and `.local_iso` via a host-set `ctx.timezone`) built
 * the `+HH:MM`/`-HH:MM` suffix without checking that the offset magnitude
 * fits within a 2-digit hour field. An offset of 30 hours silently produced
 * an invalid ISO 8601 string like `...+30:00` instead of halting.
 */

import { describe, expect, it } from 'vitest';
import { run } from '../helpers/runtime.js';

describe('datetime named-component missing-vs-wrong-type messages (#431b)', () => {
  it('missing month reports it as not provided, not as a null value', async () => {
    await expect(
      run('guard { datetime(...dict[year: 2024]) } => $r\n$r.!message')
    ).resolves.toContain('month');
    await expect(
      run('guard { datetime(...dict[year: 2024]) } => $r\n$r.!message')
    ).resolves.not.toContain('type(null)');
  });

  it('missing day reports it as not provided, not as a null value', async () => {
    const message = await run(
      'guard { datetime(...dict[year: 2024, month: 3]) } => $r\n$r.!message'
    );
    expect(message).toContain('day');
    expect(message).not.toContain('type(null)');
  });

  it('a wrong-typed month still reports the offending value', async () => {
    const message = await run(
      'guard { datetime(...dict[year: 2024, month: "march", day: 1]) } => $r\n$r.!message'
    );
    expect(message).toContain('month');
  });

  it('a fully-specified named-component datetime still constructs normally', async () => {
    const result = await run(
      'datetime(...dict[year: 2024, month: 3, day: 15]) => $d\n"{$d}"'
    );
    expect(result).toBe('2024-03-15T00:00:00.000Z');
  });
});

describe('.iso()/.local_iso offset validity (#431c)', () => {
  it('.iso(30) halts instead of returning an invalid offset suffix', async () => {
    const result = await run('guard { now() -> .iso(30) } => $r\n$r.!');
    expect(result).toBe(true);
  });

  it('.iso(30) does not escape guard as a raw, malformed ISO string', async () => {
    const message = await run(
      'guard { datetime(...dict[unix: 0]) -> .iso(30) } => $r\n$r.!message'
    );
    expect(message).toContain('offset');
  });

  it('.iso(-30) also halts (negative magnitude out of range)', async () => {
    const result = await run('guard { now() -> .iso(-30) } => $r\n$r.!');
    expect(result).toBe(true);
  });

  it('.iso() with an in-range offset still formats correctly', async () => {
    const result = await run('datetime(...dict[unix: 0]) -> .iso(5)');
    expect(result).toBe('1970-01-01T05:00:00+05:00');
  });

  it('.local_iso halts when the host timezone offset is out of range', async () => {
    const result = await run('guard { now() -> .local_iso } => $r\n$r.!', {
      timezone: 30,
    });
    expect(result).toBe(true);
  });
});

describe('duration/datetime argument type halts', () => {
  const cases: [string, string, string][] = [
    ['duration("x")', 'TYPE_MISMATCH', 'duration'],
    [
      'datetime(1.5)',
      'TYPE_MISMATCH',
      'datetime input must be a string, got number',
    ],
    [
      'datetime(...dict[year: 2024, month: 1, day: 1, hour: "x"])',
      'TYPE_MISMATCH',
      'Invalid datetime component hour: x',
    ],
    ['duration(-1)', 'INVALID_INPUT', 'duration'],
  ];

  for (const [expr, atom, text] of cases) {
    it(`halts ${expr} with #${atom} and guard recovers`, async () => {
      const result = await run(
        `guard { ${expr} } => $r\n($r.!code == #${atom})`
      );
      expect(result).toBe(true);
    });

    it(`reports the message for ${expr}`, async () => {
      const message = await run(`guard { ${expr} } => $r\n$r.!message`);
      expect(message).toContain(text);
    });
  }
});

describe('duration ordering compare recovery', () => {
  const expr = 'duration(1, 0, 0) < duration(0, 0, 1)';

  it('guard recovers a mixed-month duration compare with RILL_R002', async () => {
    const result = await run(
      `guard { ${expr} } => $r\n($r.!code == #RILL_R002)`
    );
    expect(result).toBe(true);
  });

  it('keeps the calendar-component message', async () => {
    const message = await run(`guard { ${expr} } => $r\n$r.!message`);
    expect(message).toBe(
      'Cannot order durations with different calendar components'
    );
  });
});
