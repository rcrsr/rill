/**
 * Rill Parser Tests: typed fn parameters followed by a fn body
 *
 * A typed parameter list closes with `)` and the body is a brace block, so a
 * body that starts with `$name` or a host call is never read as part of a
 * parameter type. Unions are written union(...); a `|` after a type raises
 * RILL-P011.
 */

import { describe, expect, it } from 'vitest';
import { parse, ParseError } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { expectRuntimeError } from '../helpers/halt.js';

interface ClosureShape {
  params: Array<{ name: string; typeRef?: unknown; defaultValue?: unknown }>;
  body: unknown;
}

function findClosure(node: unknown): ClosureShape {
  let found: ClosureShape | undefined;
  const visit = (n: unknown): void => {
    if (found !== undefined || n === null || typeof n !== 'object') return;
    const rec = n as Record<string, unknown>;
    if (rec['type'] === 'Closure') {
      found = rec as unknown as ClosureShape;
      return;
    }
    for (const v of Object.values(rec)) {
      if (Array.isArray(v)) v.forEach(visit);
      else visit(v);
    }
  };
  visit(node);
  if (found === undefined) throw new Error('no fn found');
  return found;
}

const closureOf = (src: string): ClosureShape => findClosure(parse(src));

function bodyType(c: ClosureShape): unknown {
  const body = c.body as Record<string, unknown>;
  return body['type'];
}

interface PrimaryShape {
  type: string;
  name: string;
}

/** The primary of the first statement of the fn body block. */
function bodyPrimary(c: ClosureShape): PrimaryShape {
  const block = c.body as {
    statements: Array<{
      expression: { head: { primary: PrimaryShape } };
    }>;
  };
  const first = block.statements[0];
  if (first === undefined) throw new Error('fn body is empty');
  return first.expression.head.primary;
}

describe('typed fn parameter followed by a body', () => {
  it.each([
    ['fn(x: number) { $x }', 'number'],
    ['fn(x: dict) { $x.name }', 'dict'],
  ])('parses %s with a static param type and a variable body', (src, t) => {
    const c = closureOf(src);
    expect(c.params).toHaveLength(1);
    expect(c.params[0]?.typeRef).toEqual({ kind: 'static', typeName: t });
    const primary = bodyPrimary(c);
    expect(primary.type).toBe('Variable');
    expect(primary.name).toBe('x');
  });

  it('parses a host call body after a typed parameter', () => {
    const c = closureOf('fn(x: number) { log($x) }');
    expect(c.params[0]?.typeRef).toEqual({
      kind: 'static',
      typeName: 'number',
    });
    const primary = bodyPrimary(c);
    expect(primary.type).toBe('HostCall');
    expect(primary.name).toBe('log');
  });

  it('parses an anonymous typed fn with a variable body', () => {
    const c = closureOf('fn(number) { $x }');
    expect(c.params[0]?.typeRef).toEqual({
      kind: 'static',
      typeName: 'number',
    });
    expect(bodyType(c)).toBe('Block');
    const primary = bodyPrimary(c);
    expect(primary.type).toBe('Variable');
    expect(primary.name).toBe('x');
  });

  it('returns the argument from a typed fn at runtime', async () => {
    const result = await run('5 -> fn(x: number) { $x }');
    expect(result).toBe(5);
  });

  it('raises RILL-R001 for a wrong-typed argument', async () => {
    await expectRuntimeError(() => run('"a" -> fn(x: number) { $x }'), {
      code: 'RILL-R001',
    });
  });
});

describe('union(...) in fn parameters', () => {
  it('parses a static union', () => {
    const c = closureOf('fn(a: union(number, string)) { $a }');
    expect(c.params[0]?.typeRef).toEqual({
      kind: 'union',
      members: [
        { kind: 'static', typeName: 'number' },
        { kind: 'static', typeName: 'string' },
      ],
    });
  });

  it('parses a union with a dynamic member', () => {
    const c = closureOf('fn(a: union(number, $T)) { $a }');
    expect(c.params[0]?.typeRef).toEqual({
      kind: 'union',
      members: [
        { kind: 'static', typeName: 'number' },
        { kind: 'dynamic', varName: 'T' },
      ],
    });
  });

  it('parses a union followed by a second parameter', () => {
    const c = closureOf('fn(a: union(number, $T), b: string) { $a }');
    expect(c.params).toHaveLength(2);
    expect(c.params[0]?.typeRef).toMatchObject({ kind: 'union' });
    expect(c.params[1]?.typeRef).toEqual({
      kind: 'static',
      typeName: 'string',
    });
  });

  it('parses a union followed by a default value', () => {
    const c = closureOf('fn(a: union(number, $T) = 1) { $a }');
    expect(c.params[0]?.typeRef).toMatchObject({ kind: 'union' });
    expect(c.params[0]?.defaultValue).toBeDefined();
  });

  it('parses a two-type anonymous fn with a union first type', () => {
    const c = closureOf('fn(union(number, $T), string) { $ }');
    expect(c.params).toHaveLength(2);
    expect(c.params[0]?.typeRef).toMatchObject({ kind: 'union' });
    expect(c.params[1]?.typeRef).toEqual({
      kind: 'static',
      typeName: 'string',
    });
  });
});

describe('the removed | separator', () => {
  function errorOf(src: string): ParseError {
    try {
      parse(src);
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      return err as ParseError;
    }
    throw new Error(`expected a parse error for: ${src}`);
  }

  it.each([
    ['"x" => $v:string|number', 'union(string, number)'],
    ['fn(a: number|string) { $a }', 'union(number, string)'],
    ['fn(a: number|$T) { $a }', 'union(number, $T)'],
    ['fn(a: number|$T = 1) { $a }', 'union(number, $T)'],
  ])('raises RILL-P011 for %j naming the rewrite', (src, rewrite) => {
    const err = errorOf(src);
    expect(err.errorId).toBe('RILL-P011');
    expect(err.message).toContain(rewrite);
  });

  it('raises RILL-P011 with the fallback message before an unknown identifier', () => {
    const err = errorOf('"x" => $v:string|badident');
    expect(err.errorId).toBe('RILL-P011');
    expect(err.message).toContain('write unions as union(...)');
  });

  it('raises a ParseError for a misspelled member after a pipe', () => {
    expect(() => parse('fn(x: number|strng) { $x }')).toThrow(ParseError);
  });

  it('raises a ParseError for an anonymous dynamic union followed by a comma', () => {
    expect(() => parse('fn(number|$T, string) { $ }')).toThrow(ParseError);
  });

  it('raises a ParseError for a dynamic-union parameter followed by a comma', () => {
    expect(() => parse('fn(a: number|$T, b: string) { $a }')).toThrow(
      ParseError
    );
  });
});

describe('consecutive fn statements on separate lines', () => {
  it('keeps two fn literals on separate lines as separate closures', () => {
    const ast = parse('fn(x: number) { $x }\nfn(y: number) { $y }');
    const closures: ClosureShape[] = [];
    const visit = (n: unknown): void => {
      if (n === null || typeof n !== 'object') return;
      const rec = n as Record<string, unknown>;
      if (rec['type'] === 'Closure') {
        closures.push(rec as unknown as ClosureShape);
        return;
      }
      for (const v of Object.values(rec)) {
        if (Array.isArray(v)) v.forEach(visit);
        else visit(v);
      }
    };
    visit(ast);
    expect(closures).toHaveLength(2);
    expect(closures[0]?.params[0]?.typeRef).toEqual({
      kind: 'static',
      typeName: 'number',
    });
  });
});

describe('typed fn with a variable body inside a comma-separated context', () => {
  it.each([
    ['fan(fn(x: number) { $x }, 2)'],
    ['list[fn(x: number) { $x }, 2]'],
    ['list[fn(x: number) { $x }, $y]'],
    ['list[fn(x: number) { $x }, fn(y: number) { $y }]'],
    ['list[\nfn(x: number) { $x },\n2\n]'],
    ['dict[f: fn(x: number) { $x }, g: 2]'],
    ['dict[f: fn(x: number) { $x }, g: fn() { 1 }]'],
    ['list[fn(x: number) { $x }, true, false]'],
    ['list[fn(x: number) { $x }, ^("d") fn(y) { $y }]'],
  ])('parses %j with a variable body named x', (src) => {
    const c = closureOf(src);
    expect(c.params).toHaveLength(1);
    expect(c.params[0]?.typeRef).toEqual({
      kind: 'static',
      typeName: 'number',
    });
    const primary = bodyPrimary(c);
    expect(primary.type).toBe('Variable');
    expect(primary.name).toBe('x');
  });

  it('parses an anonymous typed fn followed by a list entry', () => {
    const c = closureOf('list[fn(number) { $x }, 2]');
    expect(c.params).toHaveLength(1);
    expect(c.params[0]?.typeRef).toEqual({
      kind: 'static',
      typeName: 'number',
    });
    const primary = bodyPrimary(c);
    expect(primary.type).toBe('Variable');
    expect(primary.name).toBe('x');
  });

  it('runs a typed fn passed to fan with an options dict', async () => {
    const result = await run(
      'list[1, 2, 3] -> fan(fn(x: number) { $x }, dict[concurrency: 2])'
    );
    expect(result).toEqual([1, 2, 3]);
  });

  it('calls a typed fn stored in a dict', async () => {
    const result = await run(
      'dict[f: fn(x: number) { $x }, g: 2] => $d\n$d.f(5)'
    );
    expect(result).toBe(5);
  });
});

describe('formerly ambiguous dict entries', () => {
  it('parses a dict entry with a variable value after a typed fn', () => {
    expect(() => parse('dict[f: fn(x: number) { $x }, g: $y]')).not.toThrow();
  });

  it('parses a dict entry with a call value after a typed fn', () => {
    expect(() =>
      parse('dict[f: fn(x: number) { $x }, name: upper("a")]')
    ).not.toThrow();
  });
});
