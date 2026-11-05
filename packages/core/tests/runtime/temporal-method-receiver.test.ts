/**
 * Temporal method receiver narrowing: datetime and duration methods halt
 * with RILL-R003 when invoked on a receiver of the wrong type.
 */

import { describe, expect, it } from 'vitest';
import { BUILTIN_METHODS, createRuntimeContext } from '@rcrsr/rill';
import { expectHaltSync } from '../helpers/halt.js';

describe('temporal method receivers', () => {
  it('halts datetime.year on a non-datetime receiver', () => {
    const ctx = createRuntimeContext({});
    expectHaltSync(
      () => BUILTIN_METHODS.datetime['year']!.fn({ receiver: 5 }, ctx),
      {
        code: 'RILL_R003',
        messagePattern: /year requires datetime receiver/,
      }
    );
  });

  it('halts duration.days on a non-duration receiver', () => {
    const ctx = createRuntimeContext({});
    expectHaltSync(
      () => BUILTIN_METHODS.duration['days']!.fn({ receiver: 5 }, ctx),
      {
        code: 'RILL_R003',
        messagePattern: /days requires duration receiver/,
      }
    );
  });

  it('returns the field value for a valid datetime receiver', () => {
    const ctx = createRuntimeContext({});
    const receiver = { __rill_datetime: true as const, unix: 0 };
    expect(BUILTIN_METHODS.datetime['year']!.fn({ receiver }, ctx)).toBe(1970);
  });

  it('returns the field value for a valid duration receiver', () => {
    const ctx = createRuntimeContext({});
    const receiver = {
      __rill_duration: true as const,
      months: 0,
      ms: 2 * 86_400_000,
    };
    expect(BUILTIN_METHODS.duration['days']!.fn({ receiver }, ctx)).toBe(2);
  });
});
