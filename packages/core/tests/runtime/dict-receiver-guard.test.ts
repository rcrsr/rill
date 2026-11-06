/**
 * Dict-only methods halt RILL-R003 for receivers that structurally resemble
 * a dict but are not one, such as a field descriptor.
 */

import { describe, expect, it } from 'vitest';
import {
  BUILTIN_METHODS,
  createRuntimeContext,
  type RillValue,
} from '@rcrsr/rill';
import { expectHalt, expectHaltSync } from '../helpers/halt.js';
import { run } from '../helpers/runtime.js';

const fieldDescriptor = { __rill_field_descriptor: true } as RillValue;

describe('dict receiver guard', () => {
  it.each(['keys', 'values', 'entries'] as const)(
    'halts %s with RILL-R003 for a field-descriptor receiver',
    (name) => {
      const ctx = createRuntimeContext({});
      expectHaltSync(
        () =>
          BUILTIN_METHODS.dict[name]!.fn({ receiver: fieldDescriptor }, ctx),
        { code: 'RILL_R003', messagePattern: /requires dict receiver/ }
      );
    }
  );

  it('halts first with RILL-R003 for a field-descriptor receiver', async () => {
    const ctx = createRuntimeContext({});
    await expectHalt(
      async () =>
        await BUILTIN_METHODS.dict['first']!.fn(
          { receiver: fieldDescriptor },
          ctx
        ),
      { code: 'RILL_R003', messagePattern: /first requires list, string/ }
    );
  });

  it('still lists the keys of a plain dict', () => {
    const ctx = createRuntimeContext({});
    expect(
      BUILTIN_METHODS.dict['keys']!.fn({ receiver: { b: 1, a: 2 } }, ctx)
    ).toEqual(['a', 'b']);
  });

  it.each(['keys', 'values', 'entries'] as const)(
    'halts %s with RILL-R003 for a stream receiver',
    async (name) => {
      await expectHalt(
        () =>
          run(
            `|| ("a" -> yield) :stream(string) => $gen\n$gen() => $s\n$s -> .${name}`
          ),
        { code: 'RILL_R003', messagePattern: /requires dict receiver/ }
      );
    }
  );

  it.each([
    ['keys', ['a', 'b']],
    ['values', [1, 2]],
    [
      'entries',
      [
        ['a', 1],
        ['b', 2],
      ],
    ],
  ] as const)('lists %s of an ordered receiver', async (name, expected) => {
    expect(await run(`ordered[a: 1, b: 2] -> .${name}`)).toEqual(expected);
  });

  it('halts first with RILL-R003 for an ordered receiver', async () => {
    await expectHalt(() => run('ordered[a: 1] -> .first'), {
      code: 'RILL_R003',
      messagePattern: /first requires list, string/,
    });
  });
});
