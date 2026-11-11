/**
 * Rill Parser Tests: literal members in type unions
 *
 * A string, number, or bool literal is a type only as a member of a union of
 * two or more members. These tests cover the TypeRef produced for each type
 * position, the closure-delimiter lookahead, and the rejected forms.
 */

import { describe, expect, it } from 'vitest';
import { parse, ParseError } from '@rcrsr/rill';

const lit = (value: string | number | boolean) => ({ kind: 'literal', value });

/** First object in the AST (depth-first) whose kind is 'union'. */
function findUnion(node: unknown): unknown {
  if (node === null || typeof node !== 'object') return undefined;
  const rec = node as Record<string, unknown>;
  if (rec['kind'] === 'union') return rec;
  for (const v of Object.values(rec)) {
    const hit = Array.isArray(v)
      ? v.map(findUnion).find((x) => x !== undefined)
      : findUnion(v);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function unionOf(src: string): unknown {
  return findUnion(parse(src));
}

function parseError(src: string): ParseError {
  try {
    parse(src);
  } catch (e) {
    if (e instanceof ParseError) return e;
    throw e;
  }
  throw new Error(`expected a ParseError for: ${src}`);
}

const AB = { kind: 'union', members: [lit('a'), lit('b')] };

describe('literal union type refs', () => {
  it.each([
    ['assertion', '"a" :"a"|"b"', AB],
    ['check', '"a" :?"a"|"b"', AB],
    ['capture', '"a" => $x:"a"|"b"', AB],
    [
      'destructure',
      'dict[a: "x"] -> destruct<$a:"x"|"y">',
      {
        kind: 'union',
        members: [lit('x'), lit('y')],
      },
    ],
    ['has-field check', '$d -> .?f&"a"|"b"', AB],
    [
      'negative numbers',
      '1 :-1|0|1',
      {
        kind: 'union',
        members: [lit(-1), lit(0), lit(1)],
      },
    ],
    [
      'bools',
      'true :true|false',
      {
        kind: 'union',
        members: [lit(true), lit(false)],
      },
    ],
    [
      'list argument',
      'list(1|2)',
      { kind: 'union', members: [lit(1), lit(2)] },
    ],
    ['stream argument', '$s :stream("a"|"b")', AB],
    ['return type', '|x| { "a" }:"a"|"b"', AB],
  ])('produces a literal union for %s', (_name, src, expected) => {
    expect(unionOf(src)).toEqual(expected);
  });

  it('produces a literal union for a defaulted closure parameter', () => {
    expect(unionOf('|kind: "a"|"b" = "a"| { $kind }')).toEqual(AB);
  });

  it('continues a union across a newline before "=" in a parameter list', () => {
    expect(unionOf('|k: string|"b"\n= "a"| { $k }')).toEqual({
      kind: 'union',
      members: [{ kind: 'static', typeName: 'string' }, lit('b')],
    });
  });

  it('starts a new parameter after a comma when a literal union follows the name', () => {
    const xy = { kind: 'union', members: [lit('x'), lit('y')] };
    expect(unionOf('|a: "x"|"y", b: number| { $a }')).toEqual(xy);
    expect(unionOf('|a: number, b: "x"|"y"| { $a }')).toEqual(xy);
  });

  it.each([
    ['negative number', '|-1|0| { $ }', [lit(-1), lit(0)]],
    ['number', '|1|2| { $ }', [lit(1), lit(2)]],
  ])(
    'produces a literal union for a %s-led anonymous closure',
    (_n, src, m) => {
      expect(unionOf(src)).toEqual({ kind: 'union', members: m });
    }
  );

  it('produces a literal union for an anonymous typed closure', () => {
    expect(unionOf('|"a"|"b"| { $ }')).toEqual(AB);
  });

  it('produces a mixed union for an anonymous closure led by a type name', () => {
    expect(unionOf('|string|"b"| { $ }')).toEqual({
      kind: 'union',
      members: [{ kind: 'static', typeName: 'string' }, lit('b')],
    });
  });

  it('produces a literal union for a dict field type with a default', () => {
    expect(unionOf('|d: dict(kind: "a"|"b" = "a")| { $d }')).toEqual(AB);
  });

  it('counts a dynamic member toward the union', () => {
    expect(unionOf('"a" :"a"|$t')).toEqual({
      kind: 'union',
      members: [lit('a'), { kind: 'dynamic', varName: 't' }],
    });
  });

  it('keeps duplicate literal members', () => {
    expect(unionOf('"a" :"a"|"a"')).toEqual({
      kind: 'union',
      members: [lit('a'), lit('a')],
    });
  });

  it('reads a triple-quoted string as a literal member', () => {
    expect(unionOf('"a" :"""a"""|"b"')).toEqual(AB);
  });
});

describe('closure forms that parse as before', () => {
  it.each([
    '|x: number| "a"',
    '|name: string, age: number| "Name: {$name}" => $fn',
    'dict[f: |x: number| "a", g: 1]',
    '5 |number| { $ }',
    '"a" |x| { $x }',
  ])('leaves no union in %s', (src) => {
    expect(unionOf(src)).toBeUndefined();
  });

  it('does not read a literal body followed by an argument as a union', () => {
    // "y: 1" is not a parameter, so the "|" closes the parameter list. The
    // trailing "y: 1" is a type assertion with a lone literal and still fails
    // at the "Expected type name" check, as it did before.
    const err = parseError('fn(|x: number| "a", y: 1)');
    expect(err.message).toContain('Expected type name');
  });

  it('keeps the string body after a typed parameter', () => {
    const ast = parse('|x: number| "a"');
    expect(ast.statements[0]).toMatchObject({
      expression: {
        head: {
          primary: {
            type: 'Closure',
            params: [
              { name: 'x', typeRef: { kind: 'static', typeName: 'number' } },
            ],
            body: { primary: { type: 'StringLiteral', parts: ['a'] } },
          },
        },
      },
    });
  });

  it('keeps a comma-separated string after a closure body as a list element', () => {
    const ast = parse('list[|x: number| "a", "b"]');
    expect(findUnion(ast)).toBeUndefined();
    expect(JSON.stringify(ast)).toContain('"parts":["b"]');
  });

  it('reads |true| as a parameter name, not a literal type', () => {
    const ast = parse('|true| { $ }');
    expect(findUnion(ast)).toBeUndefined();
    expect(ast.statements[0]).toMatchObject({
      expression: {
        head: {
          primary: {
            type: 'Closure',
            params: [{ name: 'true', typeRef: null }],
          },
        },
      },
    });
  });
});

describe('rejected literal types', () => {
  it.each(['"a" :"a"', '1 :1', '"a" :?true', 'list("a")', '|x: "a"| { $x }'])(
    'rejects the lone literal in %s with RILL-P001',
    (src) => {
      const err = parseError(src);
      expect(err.errorId).toBe('RILL-P001');
      expect(err.message).toContain('Expected type name');
    }
  );

  it('rejects an interpolated string member with RILL-P003', () => {
    expect(parseError('"a" :"{$x}"|"a"').errorId).toBe('RILL-P003');
  });

  it('keeps RILL-P001 for a list literal in a type position', () => {
    expect(parseError('"a" :list[1]').errorId).toBe('RILL-P001');
  });
});
