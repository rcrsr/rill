/**
 * Rill Runtime Tests: declared types at the host boundary
 *
 * A declared type travels beside the value inside a script. The host sees
 * the plain value and its own type.
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  createRuntimeContext,
  execute,
  inferStructure,
  parse,
  toNative,
  type RillValue,
} from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

describe('Rill Runtime: declared types at the host boundary', () => {
  it('reports the own type for a host variable', async () => {
    expect(await run('$h.^type == number', { variables: { h: 1 } })).toBe(true);
  });

  it('hands a host function the plain value of a declared variable', async () => {
    const received: RillValue[] = [];
    const kinds: string[] = [];
    await run('1 => $x:union(number, string)\nsee($x)', {
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
            kinds.push(inferStructure(args['v'] ?? null).kind);
            return '';
          },
        },
      },
    });
    expect(received).toEqual([1]);
    expect(kinds).toEqual(['number']);
  });

  it('converts a declared value to its plain native form', async () => {
    const ctx = createRuntimeContext({});
    const { result } = await execute(
      parse('1 => $x:union(number, string)\n$x'),
      ctx
    );
    expect(toNative(result)).toMatchObject({ rillTypeName: 'number' });
  });

  it('converts a declared list element to its own native type', async () => {
    const ctx = createRuntimeContext({});
    const { result } = await execute(
      parse('list[1, 2] => $l:list(union(number, string))\n$l[0]'),
      ctx
    );
    expect(toNative(result)).toMatchObject({ rillTypeName: 'number' });
  });
});
