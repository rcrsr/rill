/**
 * Datetime ordering operators, comparison methods, and offset-aware
 * `.date` / `.time` rendering across midnight.
 */

import { describe, expect, it } from 'vitest';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

const EARLIER = 'datetime("2026-03-13T08:00:00Z")';
const LATER = 'datetime("2026-03-13T09:00:00Z")';
// Same instant as EARLIER, built from unix ms.
const EARLIER_FROM_MS = 'datetime(...dict[unix: 1773388800000])';

describe('Rill Runtime: datetime comparison operators', () => {
  it.each([
    ['<', EARLIER, LATER, true],
    ['<', LATER, EARLIER, false],
    ['<', EARLIER, EARLIER_FROM_MS, false],
    ['>', LATER, EARLIER, true],
    ['>', EARLIER, LATER, false],
    ['>', EARLIER, EARLIER_FROM_MS, false],
    ['<=', EARLIER, LATER, true],
    ['<=', LATER, EARLIER, false],
    ['<=', EARLIER, EARLIER_FROM_MS, true],
    ['>=', LATER, EARLIER, true],
    ['>=', EARLIER, LATER, false],
    ['>=', EARLIER, EARLIER_FROM_MS, true],
    ['!=', EARLIER, LATER, true],
    ['!=', EARLIER, EARLIER_FROM_MS, false],
    ['==', EARLIER, EARLIER_FROM_MS, true],
  ] as const)('%s on %s and %s gives %s', async (op, left, right, expected) => {
    expect(await run(`(${left} ${op} ${right})`)).toBe(expected);
  });

  it('halts RILL-R002 when comparing a datetime with a number', async () => {
    await expectHalt(() => run(`(${EARLIER} < 5)`), {
      code: 'RILL_R002',
      messagePattern: /Cannot compare/,
      hostErrorId: 'RILL-R002',
    });
  });
});

describe('Rill Runtime: datetime comparison methods', () => {
  it.each([
    ['lt', EARLIER, LATER, true],
    ['lt', LATER, EARLIER, false],
    ['lt', EARLIER, EARLIER_FROM_MS, false],
    ['gt', LATER, EARLIER, true],
    ['gt', EARLIER, LATER, false],
    ['gt', EARLIER, EARLIER_FROM_MS, false],
    ['le', EARLIER, LATER, true],
    ['le', LATER, EARLIER, false],
    ['le', EARLIER, EARLIER_FROM_MS, true],
    ['ge', LATER, EARLIER, true],
    ['ge', EARLIER, LATER, false],
    ['ge', EARLIER, EARLIER_FROM_MS, true],
    ['eq', EARLIER, EARLIER_FROM_MS, true],
    ['eq', EARLIER, LATER, false],
    ['ne', EARLIER, LATER, true],
    ['ne', EARLIER, EARLIER_FROM_MS, false],
  ] as const)(
    '.%s on %s with %s gives %s',
    async (method, recv, arg, expected) => {
      expect(await run(`${recv} -> .${method}(${arg})`)).toBe(expected);
    }
  );
});

describe('Rill Runtime: datetime .date and .time offsets', () => {
  it('rolls the date forward and wraps the time past midnight for a positive offset', async () => {
    expect(await run('datetime("2026-03-13T23:30:00Z") -> .date(1)')).toBe(
      '2026-03-14'
    );
    expect(await run('datetime("2026-03-13T23:30:00Z") -> .time(1)')).toBe(
      '00:30:00'
    );
  });

  it('rolls the date back and wraps the time before midnight for a negative offset', async () => {
    expect(await run('datetime("2026-03-13T00:30:00Z") -> .date(-1)')).toBe(
      '2026-03-12'
    );
    expect(await run('datetime("2026-03-13T00:30:00Z") -> .time(-1)')).toBe(
      '23:30:00'
    );
  });

  it('keeps the UTC date and time when no offset is given', async () => {
    expect(await run('datetime("2026-03-13T23:30:00Z") -> .date')).toBe(
      '2026-03-13'
    );
    expect(await run('datetime("2026-03-13T23:30:00Z") -> .time')).toBe(
      '23:30:00'
    );
  });
});
