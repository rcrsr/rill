/**
 * Type methods validate arity through marshalArgs on every dispatch path.
 * Counts in arity messages exclude the implicit receiver and use singular
 * "argument" for exactly one.
 */

import { describe, expect, it } from 'vitest';
import { BUILTIN_METHODS, createRuntimeContext } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import {
  expectHalt,
  expectHaltSync,
  expectRuntimeError,
} from '../helpers/halt.js';

describe('type method arity errors', () => {
  it.each([
    ['"x" -> .upper(1)', /Function expects 0 arguments, got 1/],
    ['"x" -> .contains("a", "b")', /Function expects 1 argument, got 2/],
    ['list[1] -> .has(1, 2)', /Function expects 1 argument, got 2/],
  ] as const)(
    'halts %s with RILL-R045 excluding the receiver',
    async (src, pattern) => {
      await expectRuntimeError(() => run(src), {
        code: 'RILL-R045',
        messagePattern: pattern,
      });
    }
  );

  it.each([
    ['5 -> .keys(1)', /Function expects 0 arguments, got 1/],
    ['5 -> .values(1, 2)', /Function expects 0 arguments, got 2/],
  ] as const)(
    'halts %s with RILL-R045 on the receiver-validating-methods fallback path',
    async (src, pattern) => {
      await expectRuntimeError(() => run(src), {
        code: 'RILL-R045',
        messagePattern: pattern,
      });
    }
  );
});

describe('unvalidated-receiver fallback path', () => {
  it('halts RILL-R044 when a required argument is missing', async () => {
    await expectRuntimeError(() => run('5 -> .add()'), {
      code: 'RILL-R044',
      messagePattern: /Missing argument for parameter 'dur'/,
    });
  });

  it('applies a parameter default before the receiver check', async () => {
    // .iso has default offset = 0, so no missing-argument halt; the receiver
    // check then halts with RILL-R003.
    await expectHalt(() => run('5 -> .iso()'), { code: 'RILL_R003' });
  });

  it('applies the parameter type check', async () => {
    await expectRuntimeError(() => run('5 -> .iso("x")'), {
      code: 'RILL-R001',
      messagePattern: /offset/,
    });
  });
});

describe('zero receiver validation', () => {
  const ctx = createRuntimeContext({});
  const dt = { __rill_datetime: true, unix: 5 } as const;
  const dur = {
    __rill_duration: true,
    months: 0,
    ms: 5,
  } as const;

  it('returns the epoch datetime for a datetime receiver', () => {
    const result = BUILTIN_METHODS.datetime['zero']!.fn({ receiver: dt }, ctx);
    expect(result).toEqual({ __rill_datetime: true, unix: 0 });
  });

  it('returns a zero duration for a duration receiver', () => {
    const result = BUILTIN_METHODS.duration['zero']!.fn({ receiver: dur }, ctx);
    expect(result).toMatchObject({ __rill_duration: true, months: 0, ms: 0 });
  });

  it.each([
    ['datetime', 5, /zero requires datetime or duration receiver/],
    ['datetime', dur, /zero requires datetime receiver/],
    ['duration', 'x', /zero requires datetime or duration receiver/],
    ['duration', dt, /zero requires duration receiver/],
  ] as const)(
    'halts %s zero on a wrong receiver with RILL-R003',
    (type, receiver, pattern) => {
      expectHaltSync(
        () => BUILTIN_METHODS[type]['zero']!.fn({ receiver }, ctx),
        {
          code: 'RILL_R003',
          messagePattern: pattern,
        }
      );
    }
  );
});
