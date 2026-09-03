/**
 * Rill Runtime Tests: stream invocation and dict-callable dispatch fixes.
 *
 * Covers three defects:
 *  - `$stream()` invocation must propagate non-catchable halts (error/assert)
 *    and control/abort signals from the stream body instead of swallowing them.
 *  - The `??` default must observe the outer `$`, not a stale intermediate
 *    pipe value leaked when a nested argument pipe chain halts.
 *  - A plain zero-param application callable stored in a dict must be invoked
 *    with zero args; only property/receiver-style callables receive the bound
 *    dict.
 */

import {
  anyTypeValue,
  toCallable,
  type ApplicationCallable,
  type RillValue,
} from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('$stream() invocation propagates halts', () => {
  it('propagates an `error` halt from the stream body', async () => {
    const src = `|| { "x" -> yield
error "boom" } :stream() => $gen
$gen() => $s
$s()`;
    await expect(run(src)).rejects.toThrow('boom');
  });

  it('propagates an `assert` halt from the stream body', async () => {
    const src = `|| { "x" -> yield
assert false "nope" } :stream() => $gen
$gen() => $s
$s()`;
    await expect(run(src)).rejects.toThrow('nope');
  });

  it('matches the `$s -> seq({ $ })` drain behavior for the same body', async () => {
    const src = `|| { "x" -> yield
error "boom" } :stream() => $gen
$gen() => $s
$s -> seq({ $ })`;
    await expect(run(src)).rejects.toThrow('boom');
  });

  it('a stream body that completes normally still resolves via $s()', async () => {
    const src = `|| { "x" -> yield } :stream() => $gen
$gen() => $s
$s()`;
    // No error in the body: draining to completion must not throw.
    await expect(run(src)).resolves.toBeDefined();
  });
});

describe('?? default sees the outer $ after a nested-arg halt', () => {
  it('restores $ when a nested argument pipe chain halts', async () => {
    // The inner `"q" -> .nomethod()` halts while evaluating the argument to
    // `.join(...)`. The `??` default must observe the block input (10), not
    // the leaked intermediate pipe value ("q").
    const result = await run(
      '10 -> { list["a"].join("q" -> .nomethod()) ?? $ }'
    );
    expect(result).toBe(10);
  });

  it('keeps working when the inner chain succeeds', async () => {
    const result = await run('10 -> { "s".nomethod("q" -> .upper) ?? $ }');
    expect(result).toBe(10);
  });
});

describe('zero-param dict-stored callables invoke with zero args', () => {
  it('a plain params:[] application callable in a dict is called with no args', async () => {
    const fn = toCallable({
      params: [],
      returnType: anyTypeValue,
      fn: () => 'hi',
    }) as ApplicationCallable;

    const result = await run('$d.fn()', {
      variables: { d: { fn: fn as unknown as RillValue } },
    });
    expect(result).toBe('hi');
  });

  it('a property/receiver callable in a dict still receives the bound dict', async () => {
    let receivedName: RillValue = null;

    const result = await run('$person.greet()', {
      variables: {
        person: {
          name: 'alice',
          greet: {
            __type: 'callable' as const,
            kind: 'application' as const,
            isProperty: true,
            params: [
              {
                name: 'self',
                type: { kind: 'any' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            returnType: anyTypeValue,
            annotations: {},
            fn: (args: Record<string, RillValue>) => {
              const self = args['self'] as Record<string, RillValue>;
              receivedName = self['name'] ?? null;
              return `Hello, I am ${self['name']}`;
            },
          } as ApplicationCallable,
        },
      },
    });

    expect(result).toBe('Hello, I am alice');
    expect(receivedName).toBe('alice');
  });
});
