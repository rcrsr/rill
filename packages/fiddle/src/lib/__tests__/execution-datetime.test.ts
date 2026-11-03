/**
 * Tests for datetime and duration values crossing the executeRill boundary
 *
 * Verifies the result envelope serializes datetime and duration values and
 * that runtime failures from their constructors convert to FiddleError.
 */

import { describe, expect, it } from 'vitest';
import { executeRill } from '../execution.js';

// Fixed reference instant for deterministic datetime tests
const REF_ISO = '2026-03-13T08:00:00Z';

describe('executeRill datetime/duration envelope', () => {
  it('serializes a datetime with its rillTypeName, unix, and iso fields', async () => {
    const result = await executeRill(`datetime("${REF_ISO}")`);

    expect(result.status).toBe('success');
    expect(result.error).toBe(null);

    const parsed = JSON.parse(result.result!);
    expect(parsed.rillTypeName).toBe('datetime');
    // 2026-03-13T08:00:00Z = 1773388800000 ms since epoch
    expect(parsed.value.unix).toBe(1773388800000);
    expect(parsed.value.iso).toBe('2026-03-13T08:00:00.000Z');
  });

  it('serializes a duration with its rillTypeName, months, and ms fields', async () => {
    // duration(0, 0, 0, 2) = 2 hours = 7200000 ms
    const result = await executeRill('duration(0, 0, 0, 2)');

    expect(result.status).toBe('success');
    expect(result.error).toBe(null);

    const parsed = JSON.parse(result.result!);
    expect(parsed.rillTypeName).toBe('duration');
    expect(parsed.value.months).toBe(0);
    expect(parsed.value.ms).toBe(7_200_000);
  });

  it('converts an invalid datetime component to a runtime FiddleError', async () => {
    const result = await executeRill(
      'datetime(...dict[year: 2026, month: 13, day: 1])'
    );

    expect(result.status).toBe('error');
    expect(result.result).toBe(null);
    expect(result.error).not.toBe(null);
    expect(result.error?.category).toBe('runtime');
    expect(result.error?.message).toContain('month');
  });
});
