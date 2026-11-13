/**
 * Rill Language Tests: type value properties (inner, outer, defaults)
 *
 * A type value exposes what it holds through `.inner`, what it yields through
 * `.outer`, and field defaults through `.defaults`. Presence depends on the
 * kind of the type only; `.?p` is true exactly when `.p` does not halt, and
 * `??` recovers a missing property.
 */

import { describe, expect, it } from 'vitest';

import { expectHalt } from '../helpers/halt.js';
import { run } from '../helpers/runtime.js';

/** Assert that `source` evaluates to a value equal to `expected` (rill `==`). */
async function expectEqual(source: string, expected: string): Promise<void> {
  const cut = source.lastIndexOf('\n') + 1;
  const script = `${source.slice(0, cut)}(${source.slice(cut)}) == (${expected})`;
  expect(await run(script)).toBe(true);
}

const STREAM_TYPE =
  '|v: number| { $v }:stream(number):string => $f\n$f.^type.outer';

describe('type value inner', () => {
  describe('through a variable', () => {
    it('keeps name and signature unchanged', async () => {
      expect(await run('list(number) => $t\n$t.name')).toBe('list');
      expect(await run('list(number) => $t\n$t.signature')).toBe(
        'list(number)'
      );
    });

    it('returns the element type of list(number)', async () => {
      await expectEqual('list(number) => $t\n$t.inner', 'number');
    });

    it('returns the chunk type of a stream type', async () => {
      await expectEqual(`${STREAM_TYPE} => $t\n$t.inner`, 'number');
    });

    it('returns the resolution type of a stream type through outer', async () => {
      await expectEqual(`${STREAM_TYPE} => $t\n$t.outer`, 'string');
    });
  });

  describe('directly on a type', () => {
    it('returns the element type of list(string)', async () => {
      await expectEqual('list(string).inner', 'string');
    });

    it('returns the element type through a value type', async () => {
      await expectEqual('list["a", "b"].^type.inner', 'string');
    });

    it('returns the value type of a uniform dict', async () => {
      await expectEqual('dict(number).inner', 'number');
    });

    it('returns a dict of types for a dict with fields', async () => {
      await expectEqual(
        'dict(a: number, b: string).inner',
        'dict[a: number, b: string]'
      );
    });

    it('reads a field type from a dict inner', async () => {
      await expectEqual('dict(a: number).inner.a', 'number');
    });

    it('returns an ordered of types for an ordered with fields', async () => {
      await expectEqual(
        'ordered(a: string, b: string).inner',
        'ordered[a: string, b: string]'
      );
    });

    it('returns a tuple of types for a tuple', async () => {
      await expectEqual('tuple(string, number).inner', 'tuple[string, number]');
    });

    it('returns a tuple for a one-element tuple', async () => {
      await expectEqual('tuple(string).inner', 'tuple[string]');
    });

    it('returns any for a compound type written without an inner', async () => {
      await expectEqual('list.inner', 'any');
      await expectEqual('dict.inner', 'any');
      await expectEqual('tuple.inner', 'any');
      await expectEqual('ordered.inner', 'any');
      await expectEqual('stream.inner', 'any');
    });
  });

  describe('access-chain and postfix forms agree', () => {
    const rows: [string, string, string][] = [
      ['list(number)', 'inner', 'number'],
      ['dict(number)', 'inner', 'number'],
      ['dict(a: number, b: string)', 'inner', 'dict[a: number, b: string]'],
      ['dict(a: number)', 'inner.a', 'number'],
      [
        'ordered(a: string, b: string)',
        'inner',
        'ordered[a: string, b: string]',
      ],
      ['tuple(string, number)', 'inner', 'tuple[string, number]'],
      ['tuple(string)', 'inner', 'tuple[string]'],
      ['list', 'inner', 'any'],
      ['dict', 'inner', 'any'],
      ['tuple', 'inner', 'any'],
      ['ordered', 'inner', 'any'],
      ['stream', 'inner', 'any'],
      [
        'dict(a: string = "x", b: number)',
        'inner',
        'dict[a: string, b: number]',
      ],
      ['dict(a: string = "x", b: number)', 'defaults', 'dict[a: "x"]'],
      ['dict(a: string)', 'defaults', 'dict[]'],
      ['union(#wired, #wireless)', 'inner', 'list[#wired, #wireless]'],
      ['union(#wired, #wireless)', 'inner.^type', 'list(atom)'],
      ['union("a", "b")', 'inner.^type', 'list(string)'],
    ];

    it.each(rows)('reads %s .%s through a variable', async (t, path, exp) => {
      await expectEqual(`${t} => $t\n$t.${path}`, exp);
    });

    it.each(rows)('reads %s .%s directly', async (t, path, exp) => {
      await expectEqual(`${t}.${path}`, exp);
    });

    it('reads len and has on a captured union inner', async () => {
      expect(await run('union(#wired, #wireless) => $t\n$t.inner.len')).toBe(2);
      expect(
        await run('union(#wired, #wireless) => $t\n$t.inner -> .has(#wired)')
      ).toBe(true);
    });

    it('reports the declared list type through a captured union inner', async () => {
      expect(
        await run(
          'union(#wired, #wireless) => $lan\n$lan.inner.^type == list(atom)'
        )
      ).toBe(true);
    });
  });

  describe('on a closure type', () => {
    it('returns an ordered of parameter types', async () => {
      await expectEqual(
        '|a: string, b: number| { $a } => $f\n$f.^type.inner',
        'ordered[a: string, b: number]'
      );
    });

    it('returns an empty ordered for a zero-parameter closure', async () => {
      await expectEqual('|| { 1 } => $f\n$f.^type.inner', 'ordered[]');
    });

    it('returns the declared result as outer', async () => {
      await expectEqual(
        '|x: number| { "a" }:string => $f\n$f.^type.outer',
        'string'
      );
    });

    it('returns any as outer when no result is declared', async () => {
      await expectEqual('|x: number| { $x } => $f\n$f.^type.outer', 'any');
    });
  });

  describe('on a bare closure type', () => {
    it('returns any for inner and outer and probes inner', async () => {
      await expectEqual('closure.inner', 'any');
      await expectEqual('closure.outer', 'any');
      expect(await run('closure.?inner')).toBe(true);
    });
  });

  describe('on a union type', () => {
    it('returns the members as a list', async () => {
      await expectEqual('union("a", "b").inner', 'list["a", "b"]');
    });

    it('returns the members of a captured union', async () => {
      await expectEqual(
        'union(#wired, #wireless) => $lan\n$lan.inner',
        'list[#wired, #wireless]'
      );
    });

    it('returns a list with its length', async () => {
      expect(await run('union(#wired, #wireless).inner.len')).toBe(2);
    });

    it('declares list(atom) for atom members', async () => {
      await expectEqual('union(#wired, #wireless).inner.^type', 'list(atom)');
    });

    it('declares list(string) for string members', async () => {
      await expectEqual('union("a", "b").inner.^type', 'list(string)');
    });

    it('lists a type member and an atom member together', async () => {
      const items = (await run('union(string, #none).inner')) as unknown[];
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({ __rill_type: true, typeName: 'string' });
      expect(items[1]).toMatchObject({ __rill_atom: true });
      expect((items[1] as { atom: { name: string } }).atom.name).toBe('none');
    });

    it('declares list(union(type, atom)) for mixed members', async () => {
      await expectEqual(
        'union(string, #none).inner.^type',
        'list(union(type, atom))'
      );
    });

    it('supports membership tests on the list', async () => {
      expect(await run('union(#wired, #wireless).inner -> .has(#wired)')).toBe(
        true
      );
    });

    it('lists type members first, then literals by kind and value', async () => {
      const members = await run('union("x", list, #a, 1, true).inner');
      expect(Array.isArray(members)).toBe(true);
      const items = members as unknown[];
      expect(items).toHaveLength(5);
      expect(items[0]).toMatchObject({ __rill_type: true, typeName: 'list' });
      expect(items[1]).toMatchObject({ __rill_atom: true });
      expect((items[1] as { atom: { name: string } }).atom.name).toBe('a');
      expect(items[2]).toBe(true);
      expect(items[3]).toBe(1);
      expect(items[4]).toBe('x');
    });

    it('returns equal lists however the union was written', async () => {
      expect(await run('union("b", "a").inner == union("a", "b").inner')).toBe(
        true
      );
    });

    it('prints members in canonical order', async () => {
      expect(await run('union("f", "c").signature')).toBe('union("c", "f")');
      expect(await run('union(string, number).signature')).toBe(
        'union(number, string)'
      );
    });

    it('orders inner like signature for every literal kind plus types', async () => {
      const signature = (await run(
        'union("x", list, #a, 1, true).signature'
      )) as string;
      expect(signature).toBe('union(list, #a, true, 1, "x")');
      const items = (await run(
        'union("x", list, #a, 1, true).inner'
      )) as unknown[];
      const formatted = items.map((item) => {
        if (typeof item === 'string') return JSON.stringify(item);
        if (typeof item === 'number' || typeof item === 'boolean')
          return String(item);
        const node = item as {
          __rill_type?: true;
          typeName?: string;
          atom?: { name: string };
        };
        return node.__rill_type === true
          ? node.typeName
          : `#${node.atom?.name}`;
      });
      expect(`union(${formatted.join(', ')})`).toBe(signature);
    });

    it('lists the error codes of error_code sorted by name', async () => {
      const codes = (await run('error_code.inner')) as {
        atom: { name: string };
      }[];
      const names = codes.map((c) => c.atom.name);
      expect(names.length).toBeGreaterThan(1);
      expect(names).toEqual([...names].sort());
      expect(await run('error_code.inner.^type == list(atom)')).toBe(true);
    });
  });

  describe('defaults', () => {
    it('keeps defaulted fields out of inner', async () => {
      await expectEqual(
        'dict(a: string = "x", b: number).inner',
        'dict[a: string, b: number]'
      );
    });

    it('lists only fields that have a default', async () => {
      await expectEqual(
        'dict(a: string = "x", b: number).defaults',
        'dict[a: "x"]'
      );
    });

    it('returns an empty dict when no field has a default', async () => {
      await expectEqual('dict(a: string).defaults', 'dict[]');
    });

    it('lists defaults of an ordered type', async () => {
      await expectEqual('ordered(a: string = "x").defaults', 'dict[a: "x"]');
    });

    it('lists closure parameter defaults', async () => {
      await expectEqual(
        '|a: string = "x", b: number| { $a } => $f\n$f.^type.defaults',
        'dict[a: "x"]'
      );
    });
  });

  describe('missing properties', () => {
    it.each([
      'vector',
      'datetime',
      'duration',
      'type',
      'any',
      'string',
      'number',
      'bool',
      'atom',
    ])('halts RILL-R003 for inner on leaf type %s', async (leaf) => {
      await expectHalt(() => run(`${leaf}.inner`), {
        code: 'RILL_R003',
        messagePattern: 'inner',
      });
    });

    it('halts RILL-R003 through a variable for inner on a leaf type', async () => {
      await expectHalt(() => run('string => $t\n$t.inner'), {
        code: 'RILL_R003',
      });
    });

    it('halts RILL-R003 for defaults on a tuple type', async () => {
      await expectHalt(() => run('tuple(string).defaults'), {
        code: 'RILL_R003',
      });
    });

    it.each(['element', 'fields', 'args'])(
      'halts RILL-R003 for .%s on a dict type',
      async (name) => {
        await expectHalt(() => run(`dict(a: number) => $t\n$t.${name}`), {
          code: 'RILL_R003',
        });
      }
    );

    it('halts RILL-R003 for outer on a type without outer', async () => {
      await expectHalt(() => run('list(number) => $t\n$t.outer'), {
        code: 'RILL_R003',
      });
      await expectHalt(() => run('number => $t\n$t.outer'), {
        code: 'RILL_R003',
      });
    });

    it('names the type signature in the message', async () => {
      await expectHalt(() => run('list(number) => $t\n$t.outer'), {
        code: 'RILL_R003',
        messagePattern: 'list(number)',
      });
    });

    it('recovers a missing property with ??', async () => {
      expect(await run('string => $t\n$t.missing ?? "none"')).toBe('none');
      await expectEqual('string => $t\n$t.inner ?? any', 'any');
    });

    it('recovers a missing property with ?? on the postfix form', async () => {
      expect(await run('string.missing ?? "none"')).toBe('none');
    });

    it('does not recover an unrelated RILL-R003 halt with ??', async () => {
      await expectHalt(() => run('42.upper ?? "none"'), {
        code: 'RILL_R003',
      });
    });

    it('recovers a missing dict field with ??', async () => {
      expect(await run('dict[a: 1].missing ?? "none"')).toBe('none');
    });

    it('lets guard catch the missing property', async () => {
      await expectEqual(
        'string => $t\nguard { $t.missing } => $r\n$r.!code',
        '#RILL_R003'
      );
    });
  });

  describe('presence probe', () => {
    it('reports presence of name and signature', async () => {
      expect(await run('string.?name')).toBe(true);
      expect(await run('string => $t\n$t.?name')).toBe(true);
      expect(await run('list(number).?signature')).toBe(true);
    });

    it('reports absence of inner on a leaf and of an unknown property', async () => {
      expect(await run('string.?inner')).toBe(false);
      expect(await run('string.?missing')).toBe(false);
    });

    it('reports presence of inner on a compound and a union', async () => {
      expect(await run('list(number).?inner')).toBe(true);
      expect(await run('union(string, #none).?inner')).toBe(true);
    });

    const kinds: readonly (readonly [string, string])[] = [
      ['string', 'string'],
      ['number', 'number'],
      ['bool', 'bool'],
      ['atom', 'atom'],
      ['vector', 'vector'],
      ['datetime', 'datetime'],
      ['duration', 'duration'],
      ['type', 'type'],
      ['any', 'any'],
      ['list', 'list(number)'],
      ['dict', 'dict(a: number = 1)'],
      ['ordered', 'ordered(a: number)'],
      ['tuple', 'tuple(number)'],
      ['union', 'union("a", "b")'],
      ['stream', `${STREAM_TYPE}`],
    ];
    const properties = ['name', 'signature', 'inner', 'outer', 'defaults'];

    it.each(
      kinds.flatMap(([kind, source]) =>
        properties.map((property) => [kind, source, property] as const)
      )
    )(
      'probes %s %s .%s true iff the read does not halt',
      async (_k, src, p) => {
        const present = await run(`${src} => $t\n$t.?${p}`);
        let reads = true;
        try {
          await run(`${src} => $t\n$t.${p}`);
        } catch {
          reads = false;
        }
        expect(present).toBe(reads);
      }
    );

    it('probes a closure type the same way', async () => {
      for (const p of ['inner', 'outer', 'defaults', 'missing']) {
        const present = await run(
          `|x: number| { $x } => $f\n$f.^type => $t\n$t.?${p}`
        );
        let reads = true;
        try {
          await run(`|x: number| { $x } => $f\n$f.^type => $t\n$t.${p}`);
        } catch {
          reads = false;
        }
        expect(present).toBe(reads);
      }
    });
  });
});

describe('type value properties read directly on an expression', () => {
  it('reads inner, outer, and defaults of a closure without a variable', async () => {
    await expectEqual('(|x: number| { "a" }:string).^type.outer', 'string');
    await expectEqual(
      '(|a: string, b: number| { $a }).^type.inner',
      'ordered[a: string, b: number]'
    );
    await expectEqual('(|x: number| { $x }).^type.outer', 'any');
    await expectEqual(
      '(|a: string = "x", b: number| { $a }).^type.defaults',
      'dict[a: "x"]'
    );
  });

  it('reads the chunk and resolution types of a stream type without a variable', async () => {
    await expectEqual(
      '(|v: number| { $v }:stream(number):string).^type.outer.inner',
      'number'
    );
    await expectEqual(
      '(|v: number| { $v }:stream(number):string).^type.outer.outer',
      'string'
    );
  });

  it('halts RILL-R003 for outer on a type without outer', async () => {
    await expectHalt(() => run('list(number).outer'), { code: 'RILL_R003' });
    await expectHalt(() => run('number.outer'), { code: 'RILL_R003' });
  });

  it('recovers a missing inner or outer with ??', async () => {
    await expectEqual('string.inner ?? any', 'any');
    expect(await run('list(number).outer ?? "d"')).toBe('d');
  });

  describe('retired reflection probes', () => {
    it('halts RILL-R008 for input on a callable and names the replacement', async () => {
      await expectHalt(() => run('|a| { $a } => $f\n$f.^input'), {
        code: 'RILL_R008',
        messagePattern: '$f.^type.inner',
      });
    });

    it('halts RILL-R008 for output on a callable and names the replacement', async () => {
      await expectHalt(() => run('|a| { $a } => $f\n$f.^output'), {
        code: 'RILL_R008',
        messagePattern: '$f.^type.outer',
      });
    });

    it('halts RILL-R003 for chunk and output on a stream and names the replacement', async () => {
      const stream = '|v: number| { $v }:stream(number):string => $f\n';
      await expectHalt(() => run(`${stream}$f(1) => $s\n$s.^chunk`), {
        code: 'RILL_R003',
        messagePattern: '$s.^type.inner',
      });
      await expectHalt(() => run(`${stream}$f(1) => $s\n$s.^output`), {
        code: 'RILL_R003',
        messagePattern: '$s.^type.outer',
      });
    });

    it('reads input as an ordinary annotation key', async () => {
      expect(await run('^(input: "x") |a| { $a } => $f\n$f.^input')).toBe('x');
    });
  });
});

describe('stream type written as an expression', () => {
  it('reads the chunk type through inner', async () => {
    await expectEqual('stream(number):string => $t\n$t.inner', 'number');
  });

  it('reads the resolution type through outer', async () => {
    await expectEqual('stream(number):string => $t\n$t.outer', 'string');
  });

  it('equals the stream type a closure declares', async () => {
    await expectEqual(STREAM_TYPE, 'stream(number):string');
  });

  it('prints its resolution type in the signature', async () => {
    expect(await run('stream(number):string.signature')).toBe(
      'stream(number):string'
    );
    expect(await run('stream():string => $t\n$t.signature')).toBe(
      'stream(any):string'
    );
  });

  it('keeps stream(T) without a resolution type unchanged', async () => {
    expect(await run('stream(number) => $t\n$t.signature')).toBe(
      'stream(number)'
    );
  });
});
