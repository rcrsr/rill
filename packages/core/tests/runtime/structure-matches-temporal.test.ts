import { describe, expect, it } from 'vitest';
import { structureMatches } from '@rcrsr/rill';

describe('structureMatches datetime', () => {
  const datetime = { __rill_datetime: true, unix: 1_700_000_000 };

  it('datetime value matches datetime type', () => {
    expect(structureMatches(datetime, { kind: 'datetime' })).toBe(true);
  });

  it('datetime does not match duration type', () => {
    expect(structureMatches(datetime, { kind: 'duration' })).toBe(false);
  });

  it('datetime does not match other types', () => {
    expect(structureMatches(datetime, { kind: 'string' })).toBe(false);
    expect(structureMatches(datetime, { kind: 'number' })).toBe(false);
    expect(structureMatches(datetime, { kind: 'bool' })).toBe(false);
  });

  it('non-datetime values do not match datetime type', () => {
    expect(structureMatches('2024-01-01', { kind: 'datetime' })).toBe(false);
    expect(structureMatches(1_700_000_000, { kind: 'datetime' })).toBe(false);
    expect(
      structureMatches({ unix: 1_700_000_000 }, { kind: 'datetime' })
    ).toBe(false);
  });
});

describe('structureMatches duration', () => {
  const duration = { __rill_duration: true, months: 0, ms: 3_600_000 };

  it('duration value matches duration type', () => {
    expect(structureMatches(duration, { kind: 'duration' })).toBe(true);
  });

  it('duration does not match datetime type', () => {
    expect(structureMatches(duration, { kind: 'datetime' })).toBe(false);
  });

  it('non-duration values do not match duration type', () => {
    expect(structureMatches('1h', { kind: 'duration' })).toBe(false);
    expect(structureMatches(3_600_000, { kind: 'duration' })).toBe(false);
    expect(
      structureMatches({ months: 0, ms: 3_600_000 }, { kind: 'duration' })
    ).toBe(false);
  });
});
