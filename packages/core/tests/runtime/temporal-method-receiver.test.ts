/**
 * Temporal method receiver narrowing: datetime and duration methods halt
 * with RILL-R003 when invoked on a receiver of the wrong type.
 */

import { describe, expect, it } from 'vitest';
import { BUILTIN_METHODS, createRuntimeContext } from '@rcrsr/rill';
import { expectHaltSync } from '../helpers/halt.js';

describe('temporal method receivers', () => {
  // zero and local_offset ignore the receiver. The ordering methods reach
  // orderedCompare, which halts RILL-R002 on a mismatched operand type.
  const RECEIVER_INDEPENDENT = new Set(['zero', 'local_offset']);
  const ORDERING = new Set(['lt', 'gt', 'le', 'ge']);

  describe.each([
    ['datetime', BUILTIN_METHODS.datetime],
    ['duration', BUILTIN_METHODS.duration],
  ] as const)('%s methods', (typeName, methods) => {
    const names = Object.keys(methods).filter(
      (name) => !RECEIVER_INDEPENDENT.has(name)
    );
    it.each(names)('halts %s on a wrong-typed receiver', (name) => {
      const ctx = createRuntimeContext({});
      const method = methods[name];
      expectHaltSync(
        () => method!.fn({ receiver: 5 }, ctx),
        ORDERING.has(name)
          ? { code: 'RILL_R002' }
          : {
              code: 'RILL_R003',
              messagePattern: new RegExp(
                `${name} requires ${typeName} receiver`
              ),
            }
      );
    });
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
