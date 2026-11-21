/**
 * Selecting a host property callable, and the removed `.params` property.
 *
 * A property callable runs when selected from a dict or ordered value, with
 * the collection as `self`. Selected from any other collection it stays a
 * stored value, as the bracket read leaves it.
 */

import { describe, expect, it } from 'vitest';
import { anyTypeValue, toCallable } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

function property(): ReturnType<typeof toCallable> {
  return toCallable(
    {
      params: [
        {
          name: 'self',
          type: { kind: 'any' },
          defaultValue: undefined,
          annotations: {},
        },
      ],
      returnType: anyTypeValue,
      fn: (args) => {
        const self = args['self'];
        return Array.isArray(self) ? 'list' : Object.keys(self ?? {}).join(',');
      },
    },
    true
  );
}

describe('property callable selection', () => {
  it('runs a property callable with the literal dict as self on literal dispatch', async () => {
    const result = await run('"p" -> dict[a: 1, p: $p]', {
      variables: { p: property() },
    });
    expect(result).toBe('a,p');
  });

  it('evaluates the matched entry once and passes that callable instance as self', async () => {
    let calls = 0;
    let other = 0;
    const prop = toCallable(
      {
        params: [
          {
            name: 'self',
            type: { kind: 'any' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        returnType: anyTypeValue,
        fn: (args) => {
          const self = args['self'] as Record<string, unknown>;
          return self['p'] === prop ? 'same' : 'different';
        },
      },
      true
    );
    const result = await run('"p" -> dict[a: other(), p: make()]', {
      functions: {
        make: {
          params: [],
          returnType: anyTypeValue,
          fn: () => {
            calls += 1;
            return prop;
          },
        },
        other: {
          params: [],
          returnType: anyTypeValue,
          fn: () => {
            other += 1;
            return 1;
          },
        },
      },
    });
    expect(calls).toBe(1);
    expect(other).toBe(1);
    expect(result).toBe('same');
  });

  it('keeps a property callable held in a list as stored on pipe selection', async () => {
    const result = await run('list[$p] => $l\n0 -> $l', {
      variables: { p: property() },
    });
    expect(typeof result).toBe('object');
  });
});

describe('removed .params property', () => {
  const message = '.^type.annotations';

  it.each([
    ['parenthesised receiver', 'fn(x) { $x } => $f\n($f).params'],
    ['method form', 'fn(x) { $x } => $f\n$f -> .params'],
  ])('halts RILL-R008 for %s', async (_label, script) => {
    await expectHalt(() => run(script), {
      code: 'RILL_R008',
      messagePattern: message,
    });
  });

  it('keeps the existence probe false', async () => {
    expect(await run('fn(x) { $x } => $f\n$f.?params')).toBe(false);
  });
});
