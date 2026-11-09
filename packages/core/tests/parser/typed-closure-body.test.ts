/**
 * Rill Parser Tests: typed closure parameter followed by a closure body
 *
 * The closing `|` of a typed parameter list must not be read as a union
 * separator when the body starts with `$name` or a host call, while declared
 * unions keep working.
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
  if (found === undefined) throw new Error('no closure found');
  return found;
}

const closureOf = (src: string): ClosureShape => findClosure(parse(src));

function bodyType(c: ClosureShape): unknown {
  const body = c.body as Record<string, unknown>;
  return body['type'];
}

describe('typed closure parameter followed by a body', () => {
  it.each([
    ['|x: number| $x', 'number'],
    ['|x: number|$x', 'number'],
    ['|x: dict| $x.name', 'dict'],
  ])('parses %s with a static param type and a variable body', (src, t) => {
    const c = closureOf(src);
    expect(c.params).toHaveLength(1);
    expect(c.params[0]?.typeRef).toEqual({ kind: 'static', typeName: t });
    const primary = (c.body as { primary: { type: string; name: string } })
      .primary;
    expect(primary.type).toBe('Variable');
    expect(primary.name).toBe('x');
  });

  it('parses a host call body after a typed parameter', () => {
    const c = closureOf('|x: number| log($x)');
    expect(c.params[0]?.typeRef).toEqual({
      kind: 'static',
      typeName: 'number',
    });
    const primary = (c.body as { primary: { type: string; name: string } })
      .primary;
    expect(primary.type).toBe('HostCall');
    expect(primary.name).toBe('log');
  });

  it('parses an anonymous typed closure with a variable body', () => {
    const c = closureOf('|number| $x');
    expect(c.params[0]?.typeRef).toEqual({
      kind: 'static',
      typeName: 'number',
    });
    expect(bodyType(c)).toBe('PostfixExpr');
    const primary = (c.body as { primary: { type: string; name: string } })
      .primary;
    expect(primary.type).toBe('Variable');
    expect(primary.name).toBe('x');
  });

  it('returns the argument from a typed closure at runtime', async () => {
    const result = await run('5 -> |x: number| $x');
    expect(result).toBe(5);
  });

  it('raises RILL-R001 for a wrong-typed argument', async () => {
    await expectRuntimeError(() => run('"a" -> |x: number| $x'), {
      code: 'RILL-R001',
    });
  });
});

describe('declared unions in closure parameters are preserved', () => {
  it('parses a static union', () => {
    const c = closureOf('|a: number|string| $a');
    expect(c.params[0]?.typeRef).toEqual({
      kind: 'union',
      members: [
        { kind: 'static', typeName: 'number' },
        { kind: 'static', typeName: 'string' },
      ],
    });
  });

  it('parses a union with a dynamic member', () => {
    const c = closureOf('|a: number|$T| $a');
    expect(c.params[0]?.typeRef).toEqual({
      kind: 'union',
      members: [
        { kind: 'static', typeName: 'number' },
        { kind: 'dynamic', varName: 'T' },
      ],
    });
  });

  it('parses a union followed by a second parameter', () => {
    const c = closureOf('|a: number|$T, b: string| $a');
    expect(c.params).toHaveLength(2);
    expect(c.params[0]?.typeRef).toMatchObject({ kind: 'union' });
    expect(c.params[1]?.typeRef).toEqual({
      kind: 'static',
      typeName: 'string',
    });
  });

  it('parses a union followed by a default value', () => {
    const c = closureOf('|a: number|$T = 1| $a');
    expect(c.params[0]?.typeRef).toMatchObject({
      kind: 'union',
      members: [
        { kind: 'static', typeName: 'number' },
        { kind: 'dynamic', varName: 'T' },
      ],
    });
    expect(c.params[0]?.defaultValue).toBeDefined();
  });

  it('parses a two-type anonymous closure with a dynamic first-type union', () => {
    const c = closureOf('|number|$T, string| $');
    expect(c.params).toHaveLength(2);
    expect(c.params[0]?.typeRef).toMatchObject({ kind: 'union' });
    expect(c.params[1]?.typeRef).toEqual({
      kind: 'static',
      typeName: 'string',
    });
  });
});

describe('non-closure contexts are unchanged', () => {
  it('still throws RILL-P011 for a dangling pipe before an unknown identifier', () => {
    let caught: unknown;
    try {
      parse('"x" => $v:string|badident');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ParseError);
    expect((caught as ParseError).errorId).toBe('RILL-P011');
  });
});
