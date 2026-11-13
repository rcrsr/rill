/**
 * Rill Language Tests: union(...) types
 *
 * A union type is written union(...), a type constructor whose members are
 * types or scalar literals. It works in every type position and as an
 * expression that yields a type value.
 */

import { describe, expect, it } from 'vitest';

import { expectHalt } from '../helpers/halt.js';
import { createRuntimeContext, parse, ParseError } from '@rcrsr/rill';

import { run } from '../helpers/runtime.js';

async function expectParseMessage(
  source: string,
  errorId: string,
  message: string
): Promise<void> {
  try {
    parse(source);
  } catch (err) {
    expect(err).toBeInstanceOf(ParseError);
    expect((err as ParseError).errorId).toBe(errorId);
    expect((err as ParseError).message).toContain(message);
    return;
  }
  expect.fail(`Expected ${errorId} for: ${source}`);
}

async function expectParseError(
  source: string,
  errorId: string
): Promise<void> {
  try {
    parse(source);
  } catch (err) {
    expect(err).toBeInstanceOf(ParseError);
    expect((err as ParseError).errorId).toBe(errorId);
    return;
  }
  expect.fail(`Expected ${errorId} for: ${source}`);
}

describe('union(...) types', () => {
  describe('as a type value', () => {
    it('is a type value', async () => {
      expect(await run('union(string, number) => $t\n$t.^type.name')).toBe(
        'type'
      );
    });

    it('prints its members through signature', async () => {
      expect(await run('union(string, number).signature')).toBe(
        'union(number, string)'
      );
      expect(await run('union(number, string).signature')).toBe(
        'union(number, string)'
      );
    });

    it('prints string literals in code-unit order', async () => {
      expect(await run('union("f", "c").signature')).toBe('union("c", "f")');
    });

    it('prints type members before atoms, bools, numbers, and strings', async () => {
      expect(await run('union("x", list, #a, 1, true).signature')).toBe(
        'union(list, #a, true, 1, "x")'
      );
    });

    it('sorts the error_code word as a type member', async () => {
      expect(await run('union(#ok, error_code).signature')).toBe(
        'union(error_code, #ok)'
      );
    });

    it('names the canonical order in the assertion halt message', async () => {
      await expectHalt(() => run('"x" -> :union("f", "c")'), {
        code: 'TYPE_MISMATCH',
        messagePattern: 'expected union("c", "f")',
      });
    });

    it('still fills defaults for a union of dict shapes after printing order changes', async () => {
      expect(
        await run(
          '|v: union(dict(a: string, b: string = "x"), dict(a: string))| { $v.b }\n=> $f\n$f(dict[a: "q"])'
        )
      ).toBe('x');
    });

    it('has the name union', async () => {
      expect(await run('union(string, number).name')).toBe('union');
    });

    it('reduces a single type member to that type', async () => {
      expect(await run('union(string).signature')).toBe('string');
    });

    it('drops a type member that another member accepts', async () => {
      expect(await run('union(string, "a").signature')).toBe('string');
    });

    it('has type as its own type for literal members', async () => {
      expect(await run('union(#a, #b).^type.name')).toBe('type');
    });

    it('keeps dict[union: 1] working', async () => {
      expect(await run('dict[union: 1].union')).toBe(1);
    });
  });

  describe('assertion and check', () => {
    it('passes a member type through assertion', async () => {
      expect(await run('1 -> :union(string, number)')).toBe(1);
    });

    it('halts TYPE_MISMATCH naming the union for a non-member', async () => {
      await expectHalt(() => run('true -> :union(string, number)'), {
        code: 'TYPE_MISMATCH',
        messagePattern: 'union(number, string)',
      });
    });

    it('accepts a literal member', async () => {
      expect(await run('"c" -> :union("c", "f")')).toBe('c');
    });

    it('halts naming the union and the literal for a non-member literal', async () => {
      await expectHalt(() => run('"x" -> :union("c", "f")'), {
        code: 'TYPE_MISMATCH',
        messagePattern: 'expected union("c", "f"), got "x"',
      });
    });

    it('accepts the single literal of union("c")', async () => {
      expect(await run('"c" -> :union("c")')).toBe('c');
    });

    it('halts for a value outside union("c")', async () => {
      await expectHalt(() => run('"d" -> :union("c")'), {
        code: 'TYPE_MISMATCH',
      });
    });

    it('accepts a member through a named union', async () => {
      expect(await run('union(1, 2, 3) => $t\n2 -> :$t')).toBe(2);
    });

    it('checks membership with :?', async () => {
      expect(await run('"c" -> :?union("c", "f")')).toBe(true);
      expect(await run('"x" -> :?union("c", "f")')).toBe(false);
    });
  });

  describe('capture annotation', () => {
    it('accepts a member literal', async () => {
      expect(await run('"c" => $unit:union("c", "f")\n$unit')).toBe('c');
    });

    it('halts R001 for a non-member literal', async () => {
      await expectHalt(() => run('"x" => $unit:union("c", "f")'), {
        code: 'RILL_R001',
        hostErrorId: 'RILL-R001',
        messagePattern: 'Type mismatch',
      });
    });

    it('allows reassignment to another member type', async () => {
      expect(await run('1 => $x:union(number, string)\n"a" => $x\n$x')).toBe(
        'a'
      );
    });

    it('dispatches on a closed atom set through string conversion', async () => {
      const script = `
        #wired => $kind:union(#wired, #wireless)
        $kind -> string -> dict[wired: { "cable" }, wireless: { "radio" }]
      `;
      expect(await run(script)).toBe('cable');
    });
  });

  describe('closure parameter', () => {
    it('halts R001 for an atom outside the closed set', async () => {
      const script = `
        |kind: union(#wired, #wireless)| { $kind } => $f
        $f(#mesh)
      `;
      await expect(run(script)).rejects.toHaveProperty('errorId', 'RILL-R001');
    });

    it('accepts an atom inside the closed set', async () => {
      const script = `
        |kind: union(#wired, #wireless)| { "{$kind -> string}" } => $f
        $f(#wired)
      `;
      expect(await run(script)).toBe('wired');
    });

    it('keeps a single-literal union as the parameter type', async () => {
      const script = `
        |x: union("c")| { $x } => $f
        $f("x")
      `;
      await expect(run(script)).rejects.toHaveProperty('errorId', 'RILL-R001');
      expect(await run('|x: union("c")| { $x } => $f\n$f("c")')).toBe('c');
    });
  });

  describe('equality', () => {
    it('ignores member order', async () => {
      expect(await run('union(string, number) == union(number, string)')).toBe(
        true
      );
    });

    it('treats a one-type union as that type', async () => {
      expect(await run('union(string) == string')).toBe(true);
    });

    it('reduces a member that another member accepts', async () => {
      expect(
        await run(
          'union(list(union(string, number)), list(string)) == list(union(string, number))'
        )
      ).toBe(true);
    });
  });

  describe('member rules', () => {
    it('halts TYPE_MISMATCH when a variable member is not a type', async () => {
      await expectHalt(() => run('"c" => $v\nunion($v, "f")'), {
        code: 'TYPE_MISMATCH',
        messagePattern: 'not a valid type reference',
      });
    });

    it('halts INVALID_INPUT for a member listed twice', async () => {
      await expectHalt(() => run('union(string, string)'), {
        code: 'INVALID_INPUT',
      });
    });

    it('halts INVALID_INPUT for a member listed twice in an assertion', async () => {
      await expectHalt(() => run('1 -> :union(string, string)'), {
        code: 'INVALID_INPUT',
      });
    });

    it('halts INVALID_INPUT for an empty union', async () => {
      await expectHalt(() => run('union()'), { code: 'INVALID_INPUT' });
    });

    it('halts INVALID_INPUT for a compound literal member', async () => {
      await expectHalt(() => run('union(list[1, 2])'), {
        code: 'INVALID_INPUT',
      });
    });
  });

  describe('atom, scalar, and mixed members', () => {
    it('prints atom members as #name through signature', async () => {
      expect(await run('union(#a, #b).signature')).toBe('union(#a, #b)');
    });

    it('prints atom members as #name when converted to string', async () => {
      expect(await run('union(#a, #b) -> .signature')).toBe('union(#a, #b)');
    });

    it('names atom members in the assertion halt message', async () => {
      await expectHalt(() => run('#c -> :union(#a, #b)'), {
        code: 'TYPE_MISMATCH',
        messagePattern: 'expected union(#a, #b), got',
      });
    });

    it('accepts an atom member', async () => {
      expect(await run('#a -> :?union(#a, #b)')).toBe(true);
      expect(await run('#c -> :?union(#a, #b)')).toBe(false);
    });

    it('accepts and rejects number members', async () => {
      expect(await run('2 -> :?union(1, 2)')).toBe(true);
      expect(await run('3 -> :?union(1, 2)')).toBe(false);
    });

    it('accepts and rejects bool members', async () => {
      expect(await run('true -> :?union(true)')).toBe(true);
      expect(await run('false -> :?union(true)')).toBe(false);
    });

    it('accepts each member of a mixed union and rejects others', async () => {
      expect(await run('"s" -> :?union(string, #a, 1)')).toBe(true);
      expect(await run('#a -> :?union(string, #a, 1)')).toBe(true);
      expect(await run('1 -> :?union(string, #a, 1)')).toBe(true);
      expect(await run('2 -> :?union(string, #a, 1)')).toBe(false);
      expect(await run('#b -> :?union(string, #a, 1)')).toBe(false);
    });

    it('prints a mixed union through signature', async () => {
      expect(await run('union(string, #a, 1).signature')).toBe(
        'union(string, #a, 1)'
      );
    });
  });

  describe('merging', () => {
    it('merges a nested union into its parent', async () => {
      expect(await run('union(union(1, 2), 3).signature')).toBe(
        'union(1, 2, 3)'
      );
    });

    it('combines two named unions', async () => {
      expect(
        await run(
          'union("a", "b") => $lan\nunion("c") => $remote\nunion($lan, $remote).signature'
        )
      ).toBe('union("a", "b", "c")');
    });

    it('accepts a member of either combined union', async () => {
      expect(
        await run(
          'union("a") => $lan\nunion("c") => $remote\nunion($lan, $remote) => $both\n"c" -> :$both'
        )
      ).toBe('c');
    });
  });

  describe('literal member rejection', () => {
    it('halts INVALID_INPUT for a tuple literal member', async () => {
      await expectHalt(() => run('union(tuple[1, 2])'), {
        code: 'INVALID_INPUT',
      });
    });

    it('halts INVALID_INPUT for a dict literal member', async () => {
      await expectHalt(() => run('union(dict[a: 1])'), {
        code: 'INVALID_INPUT',
      });
    });
  });

  describe('property access', () => {
    it('halts for .len on a union', async () => {
      await expect(run('union(1, 2).len')).rejects.toMatchObject({
        errorId: 'RILL-R003',
      });
    });

    it('halts for .has on a union', async () => {
      await expect(run('union(1, 2).has(1)')).rejects.toMatchObject({
        errorId: 'RILL-R003',
      });
    });
  });

  describe('parse errors', () => {
    it('rejects a bare literal after a colon', async () => {
      expect(() => parse('"c" => $a:"c"')).toThrow(ParseError);
    });

    it('rejects an atom as a dict key', async () => {
      expect(() => parse('dict[#wired: 1]')).toThrow(ParseError);
    });

    it('raises RILL-P003 for a bare union expression', async () => {
      await expectParseError('union', 'RILL-P003');
    });

    it('raises RILL-P003 for union[...]', async () => {
      await expectParseError('union[#a]', 'RILL-P003');
    });

    it('raises RILL-P003 for a union parameter type without members', async () => {
      await expectParseError('|union| $', 'RILL-P003');
    });
  });

  describe('removed | separator', () => {
    it('raises RILL-P011 naming union(string, number) in a conversion type', async () => {
      await expectParseMessage(
        '1 -> :string|number',
        'RILL-P011',
        'union(string, number)'
      );
    });

    it('raises RILL-P011 naming union(number, string) in a capture annotation', async () => {
      await expectParseMessage(
        '1 => $x:number|string\n$x',
        'RILL-P011',
        'union(number, string)'
      );
    });

    it('raises RILL-P011 inside a parameterized type argument', async () => {
      await expectParseMessage(
        'list(string|number)',
        'RILL-P011',
        'union(string, number)'
      );
    });

    it('raises RILL-P011 inside a closure parameter list', async () => {
      await expectParseMessage(
        '|x: string|number| $x',
        'RILL-P011',
        'union(string, number)'
      );
    });

    it('raises RILL-P011 for a dynamic member inside a closure parameter list', async () => {
      await expectParseMessage(
        '|a: number|$T| $a',
        'RILL-P011',
        'union(number, $T)'
      );
    });

    it('raises RILL-P011 with the fallback message when no member follows the pipe', async () => {
      await expectParseMessage(
        '"x" => $v:string|badident',
        'RILL-P011',
        'write unions as union(...)'
      );
    });

    it('raises RILL-P011 naming the rewrite for a host signature', () => {
      expect(() =>
        createRuntimeContext({
          functions: { f: { signature: '|a: string|number|', fn: () => 1 } },
        })
      ).toThrow('union(string, number)');
    });
  });

  describe('conversion', () => {
    it('halts R036 for a conversion into a union', async () => {
      await expect(run('"x" -> union("c")')).rejects.toHaveProperty(
        'errorId',
        'RILL-R036'
      );
    });
  });
});
