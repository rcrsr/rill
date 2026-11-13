/**
 * Rill Runtime Tests: union member selection
 *
 * A union hydrates with the narrowest member the value matches, independent of
 * written order. Incomparable matches resolve to the first member in canonical
 * print order. Reduction keeps a member whose defaults another member would
 * lose.
 */

import { describe, expect, it } from 'vitest';
import {
  createRuntimeContext,
  execute,
  generateManifest,
  getFunctions,
  parse,
  type RillValue,
} from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

const NARROW = 'dict(a: number, b: number = 9)';
const WIDE = 'dict(a: number)';

function callWith(union: string, arg: string): Promise<RillValue> {
  return run(`|x: ${union}| { $x } => $f\n${arg} -> $f()`);
}

function signatureOf(union: string): Promise<RillValue> {
  return run(`${union}.signature`);
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [
      item,
      ...rest,
    ])
  );
}

function hostCtx(union: string) {
  return createRuntimeContext({
    functions: {
      f: { signature: `|x: ${union}|`, fn: (args): RillValue => args['x']! },
    },
  });
}

function hostType(union: string): string | undefined {
  return getFunctions(hostCtx(union)).find((fn) => fn.name === 'f')?.params[0]
    ?.type;
}

describe('union member selection', () => {
  describe('narrowest member wins regardless of written order', () => {
    const forward = `union(${NARROW}, ${WIDE})`;
    const reversed = `union(${WIDE}, ${NARROW})`;

    it.each([forward, reversed])('fills the default for %s', async (union) => {
      expect(await callWith(union, 'dict[a: 1]')).toEqual({ a: 1, b: 9 });
    });

    it('prints both orders as the same canonical signature', async () => {
      const a = await signatureOf(forward);
      const b = await signatureOf(reversed);
      expect(a).toBe(b);
      expect(a).toBe(`union(${WIDE}, ${NARROW})`);
    });
  });

  describe('host signature round trip', () => {
    it.each([`union(${NARROW}, ${WIDE})`, `union(${WIDE}, ${NARROW})`])(
      'registers, reprints canonically, and re-registers %s',
      async (union) => {
        const printed = hostType(union);
        expect(printed).toBe(`union(${WIDE}, ${NARROW})`);
        const fresh = hostCtx(printed ?? '');
        const { result } = await execute(parse('f(dict[a: 1])'), fresh);
        expect(result).toEqual({ a: 1, b: 9 });
        expect(hostType(printed ?? '')).toBe(printed);
      }
    );
  });

  describe('incomparable matches', () => {
    const first = 'dict(a: number, b: number = 1)';
    const second = 'dict(a: number, x: number = 2, y: number = 3)';
    const third = 'dict(a: number, c: number = 2)';

    it.each([
      `union(${first}, ${second})`,
      `union(${second}, ${first})`,
      `union(${first}, ${third})`,
      `union(${third}, ${first})`,
    ])('resolves to the canonical-first member for %s', async (union) => {
      expect(await callWith(union, 'dict[a: 1]')).toEqual({ a: 1, b: 1 });
    });
  });

  describe('three-member chain', () => {
    const chain = [
      'dict(a: number)',
      'dict(a: number, b: number = 1)',
      'dict(a: number, b: number = 1, c: number = 2)',
    ];

    it.each(permutations(chain).map((p) => [p.join(' | '), p]))(
      'hydrates with the narrowest member for order %s',
      async (_label, order) => {
        const union = `union(${order.join(', ')})`;
        expect(await callWith(union, 'dict[a: 1]')).toEqual({
          a: 1,
          b: 1,
          c: 2,
        });
        const printed = await signatureOf(union);
        for (const member of chain) {
          expect(printed).toContain(member);
        }
      }
    );
  });

  describe('nested positions', () => {
    const forward = `union(${NARROW}, ${WIDE})`;
    const reversed = `union(${WIDE}, ${NARROW})`;

    it.each([forward, reversed])('hydrates a dict field for %s', async (u) => {
      expect(await callWith(`dict(q: ${u})`, 'dict[q: dict[a: 1]]')).toEqual({
        q: { a: 1, b: 9 },
      });
    });

    it.each([forward, reversed])(
      'hydrates a tuple element for %s',
      async (u) => {
        expect(
          await callWith(`tuple(${u}, number)`, 'tuple[dict[a: 1], 2]')
        ).toEqual(expect.objectContaining({ entries: [{ a: 1, b: 9 }, 2] }));
      }
    );

    it.each([forward, reversed])(
      'hydrates an ordered field for %s',
      async (u) => {
        const result = await callWith(
          `ordered(q: ${u})`,
          'ordered[q: dict[a: 1]]'
        );
        expect(result).toEqual(
          expect.objectContaining({ entries: [['q', { a: 1, b: 9 }]] })
        );
      }
    );

    it.each([forward, reversed])(
      'converts a dict to dict(q: %s)',
      async (u) => {
        expect(await run(`dict[q: dict[a: 1]] -> dict(q: ${u})`)).toEqual({
          q: { a: 1, b: 9 },
        });
      }
    );

    it.each([forward, reversed])(
      'leaves list(%s) elements unchanged',
      async (u) => {
        expect(await callWith(`list(${u})`, 'list[dict[a: 1]]')).toEqual([
          { a: 1 },
        ]);
      }
    );
  });

  describe('literals and bare members', () => {
    it('keeps a literal member and hydrates the dict member', async () => {
      const union = 'union("auto", dict(n: number = 1))';
      expect(await callWith(union, '"auto"')).toBe('auto');
      expect(await callWith(union, 'dict[]')).toEqual({ n: 1 });
    });

    it('collapses a literal into its covering type', async () => {
      expect(await run('union(string, "a").signature')).toBe('string');
    });
  });

  describe('manifest', () => {
    it('prints members in canonical order and parses back', () => {
      const ctx = createRuntimeContext({
        functions: {
          f: {
            signature: '|x: union(string, number)|',
            fn: (): RillValue => 1,
          },
          g: {
            signature: `|x: union(${NARROW}, ${WIDE})|`,
            fn: (): RillValue => 1,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('union(number, string)');
      expect(manifest).toContain(
        'union(dict(a: number), dict(a: number, b: number))'
      );
      expect(() => parse(manifest)).not.toThrow();
    });
  });

  describe('reduction keeps members that would lose a default', () => {
    it('keeps both when the wider member lacks the default', async () => {
      const union = 'union(dict(a: string, b: string = "x"), dict)';
      expect(await callWith(union, 'dict[a: "q"]')).toEqual({
        a: 'q',
        b: 'x',
      });
      expect(await signatureOf(union)).toContain('dict(a: string');
      expect(await signatureOf(union)).toContain('union(dict,');
    });

    it('keeps both members whose defaults differ', async () => {
      const a = 'dict(a: number, b: number = 1)';
      const b = 'dict(a: number, b: number = 2)';
      for (const union of [`union(${a}, ${b})`, `union(${b}, ${a})`]) {
        expect(await callWith(union, 'dict[a: 1]')).toEqual({ a: 1, b: 1 });
        const printed = await signatureOf(union);
        expect(printed).toContain('b: number = 1');
        expect(printed).toContain('b: number = 2');
      }
    });

    // Mutual acceptance needs equal key sets and equal default presence, so
    // two distinct member structures that accept each other cannot be written
    // through the public surface; the reduction tie branch is unreachable
    // there. This checks the observable guarantee: a wider member that loses
    // no default is dropped, and written order does not change the result.
    it('drops the wider member identically in both written orders', async () => {
      const a = 'dict(a: number)';
      const b = 'dict(a: number, b: number = 1)';
      const forward = await signatureOf(`union(${a}, ${b})`);
      expect(forward).toBe(await signatureOf(`union(${b}, ${a})`));
      expect(forward).toBe(`union(${a}, ${b})`);
    });
  });

  // Soundness is checked indirectly: every sample matching the narrow member
  // must pass `:narrow -> :wide`, and a value matching only the wide member must
  // fail the narrow assertion (the reverse direction is rejected).
  describe('soundness of the dict acceptance rule', () => {
    const pairs: Array<{ wide: string; narrow: string; samples: string[] }> = [
      {
        wide: 'dict(a: number)',
        narrow: 'dict(a: number, b: number = 1)',
        samples: ['dict[a: 1]', 'dict[a: 1, b: 5]'],
      },
      {
        wide: 'dict(a: number, b: number = 1)',
        narrow: 'dict(a: number, b: number = 1, c: number = 2)',
        samples: ['dict[a: 1]', 'dict[a: 1, c: 7]'],
      },
      {
        wide: 'dict(a: union(number, string))',
        narrow: 'dict(a: number)',
        samples: ['dict[a: 1]', 'dict[a: 1, z: "q"]'],
      },
    ];

    it.each(pairs)(
      'a value matching $narrow also matches $wide',
      async ({ wide, narrow, samples }) => {
        for (const sample of samples) {
          const ok = await run(
            `${sample} => $v\n$v -> :${narrow} -> :${wide} -> .^type.signature`
          ).catch((e: unknown) => e);
          expect(ok).not.toBeInstanceOf(Error);
        }
      }
    );

    it('rejects a value that matches the wide member but not the narrow one', async () => {
      const result = await run(
        'dict[a: 1] => $v\n$v -> :dict(a: number, b: number) -> .^type.signature'
      ).catch((e: unknown) => e);
      expect(result).toBeInstanceOf(Error);
    });
  });
});
