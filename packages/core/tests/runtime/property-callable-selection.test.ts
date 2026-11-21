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

describe('call and method forms agree on dict and ordered receivers', () => {
  const RECEIVERS = [
    { kind: 'dict', missing: "Dict has no field 'z'" },
    { kind: 'ordered', missing: 'Undefined ordered key: z' },
  ] as const;

  function counting(counter: { calls: number }): ReturnType<typeof toCallable> {
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
          counter.calls += 1;
          const self = args['self'] as Record<string, unknown>;
          const entries = self['entries'];
          return Array.isArray(entries)
            ? entries.length
            : Object.keys(self).length;
        },
      },
      true
    );
  }

  function doubling(): ReturnType<typeof toCallable> {
    return toCallable(
      {
        params: [
          {
            name: 'n',
            type: { kind: 'any' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        returnType: anyTypeValue,
        fn: (args) => Number(args['n']) * 2,
      },
      true
    );
  }

  describe.each(RECEIVERS)('$kind receiver', ({ kind, missing }) => {
    const entries = 'count: $p, f: fn(x) { $x }, n: 7';
    const literal = `${kind}[${entries}]`;
    const setup = `${literal} => $c\n`;

    it.each([
      ['property call', '$c.count()'],
      ['pipe call', '$c -> .count()'],
      ['pipe name', '$c -> .count'],
      ['literal receiver', `${literal}.count()`],
      ['parenthesised receiver', '($c).count()'],
      ['nested receiver', `${kind}[x: $c].x.count()`],
      ['piped operand', '1 -> $c.count()'],
    ])('derives the value from self for a %s', async (_label, body) => {
      const counter = { calls: 0 };
      const result = await run(`${setup}${body}`, {
        variables: { p: counting(counter) },
      });
      expect(result).toBe(3);
      expect(counter.calls).toBe(1);
    });

    it.each([
      ['property call', '$c.f(2)'],
      ['pipe call', '$c -> .f(2)'],
      ['piped operand', '2 -> $c.f()'],
    ])('calls a script fn entry through a %s', async (_label, body) => {
      const result = await run(`${setup}${body}`, {
        variables: { p: counting({ calls: 0 }) },
      });
      expect(result).toBe(2);
    });

    it('passes call arguments to a property callable', async () => {
      const result = await run(`${kind}[count: $p] => $c\n$c.count(4)`, {
        variables: { p: doubling() },
      });
      expect(result).toBe(8);
    });

    it('runs a held block entry through a pipe name', async () => {
      const result = await run(`${kind}[h: { 5 }] => $c\n$c -> .h`);
      expect(result).toBe(5);
    });

    it.each([
      ['property call', '$c.z()'],
      ['pipe name', '$c -> .z'],
      ['piped operand', '1 -> $c.z()'],
    ])('halts a missing key for a %s', async (_label, body) => {
      await expectHalt(
        () =>
          run(`${setup}${body}`, { variables: { p: counting({ calls: 0 }) } }),
        { code: 'RILL_R009', messagePattern: missing }
      );
    });

    it('halts calling a non-callable field', async () => {
      await expectHalt(
        () =>
          run(`${setup}$c.n()`, { variables: { p: counting({ calls: 0 }) } }),
        {
          code: 'RILL_R007',
          messagePattern: `Unknown method: n on type ${kind}`,
        }
      );
    });

    it('recovers a missing pipe name with ??', async () => {
      const result = await run(`${setup}$c -> .z ?? 0`, {
        variables: { p: counting({ calls: 0 }) },
      });
      expect(result).toBe(0);
    });

    it('answers .? without invoking the property callable', async () => {
      const counter = { calls: 0 };
      const result = await run(`${setup}$c.?count`, {
        variables: { p: counting(counter) },
      });
      expect(result).toBe(true);
      expect(counter.calls).toBe(0);
    });
  });
});
