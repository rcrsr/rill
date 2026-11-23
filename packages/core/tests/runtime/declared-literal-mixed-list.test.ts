/**
 * Rill Runtime Tests: a declared list literal with mixed elements
 *
 * An undeclared `list[1, "a"]` infers `list(union(number, string))`. A written
 * element type declares the literal instead, so a mixed list under
 * `list(number)` halts at the literal, before any later typed use reads it.
 */

import { describe, expect, it } from 'vitest';
import { anyTypeValue, type RillValue } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

describe('Rill Runtime: declared list literal with mixed elements', () => {
  it('halts #TYPE_MISMATCH for list(number)[1, "a"]', async () => {
    await expectHalt(() => run('list(number)[1, "a"]'), {
      code: 'TYPE_MISMATCH',
      messagePattern: 'expected list(number), got list(union(number, string))',
    });
  });

  it('halts at the literal, before the value reaches its pipe target', async () => {
    const received: RillValue[] = [];
    await expectHalt(
      () =>
        run('list(number)[1, "a"] -> see', {
          functions: {
            see: {
              params: [
                {
                  name: 'v',
                  type: undefined,
                  defaultValue: undefined,
                  annotations: {},
                },
              ],
              returnType: anyTypeValue,
              fn: (args: Record<string, RillValue>): RillValue => {
                received.push(args['v'] ?? null);
                return '';
              },
            },
          },
        }),
      { code: 'TYPE_MISMATCH' }
    );
    expect(received).toEqual([]);
  });

  it('recovers through guard with code #TYPE_MISMATCH', async () => {
    expect(
      await run(
        'guard { list(number)[1, "a"] } => $r\n$r.!code == #TYPE_MISMATCH'
      )
    ).toBe(true);
  });

  it('accepts the same elements under a union element type', async () => {
    expect(await run('list(union(number, string))[1, "a"] -> .len')).toBe(2);
  });
});
