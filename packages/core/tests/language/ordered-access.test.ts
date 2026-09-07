/**
 * Rill Language Tests: ordered, tuple, and iterator access
 *
 * `isDict` returns true for both `RillOrdered` and any iterator-shaped dict
 * (it only excludes arrays, callables, and tuples). Bracket index, dot
 * access, existence checks, and the `.keys`/`.values`/`.entries`/`.len`
 * methods must dispatch on `isOrdered`/`isTuple`/`isIterator` before
 * falling through to the dict branch, or an ordered/tuple/iterator value
 * gets read as a plain dict of its internal JS-wrapper fields instead of
 * its logical entries.
 */

import { describe, expect, it } from 'vitest';
import { createRuntimeContext, execute, parse } from '@rcrsr/rill';

/** Executes a script and returns its result value. */
async function run(src: string): Promise<unknown> {
  const ctx = createRuntimeContext({});
  const { result } = await execute(parse(src), ctx);
  return result;
}

/** Executes a script, rejecting with the thrown error rather than the value. */
async function runOrThrow(src: string): Promise<unknown> {
  const ctx = createRuntimeContext({});
  const { result } = await execute(parse(src), ctx);
  return result;
}

describe('ordered value access', () => {
  const decl = 'ordered[a: 1, b: 2] => $o\n';

  it('$o["a"] evaluates to 1', async () => {
    expect(await run(`${decl}$o["a"]`)).toBe(1);
  });

  it('$o.a evaluates to 1', async () => {
    expect(await run(`${decl}$o.a`)).toBe(1);
  });

  it('$o[0] evaluates to 1 (positional index)', async () => {
    expect(await run(`${decl}$o[0]`)).toBe(1);
  });

  it('$o[-1] evaluates to 2 (negative index from end)', async () => {
    expect(await run(`${decl}$o[-1]`)).toBe(2);
  });

  it('$o["x"] halts with RILL-R009 (undefined ordered key)', async () => {
    await expect(runOrThrow(`${decl}$o["x"]`)).rejects.toHaveProperty(
      'errorId',
      'RILL-R009'
    );
  });

  it('$o.missing halts', async () => {
    await expect(runOrThrow(`${decl}$o.missing`)).rejects.toBeTruthy();
  });

  it('$o.keys evaluates to list["a", "b"]', async () => {
    expect(await run(`${decl}$o.keys`)).toEqual(['a', 'b']);
  });

  it('$o.values evaluates to list[1, 2]', async () => {
    expect(await run(`${decl}$o.values`)).toEqual([1, 2]);
  });

  it('$o.entries evaluates to list[["a", 1], ["b", 2]]', async () => {
    expect(await run(`${decl}$o.entries`)).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });

  it('$o.len evaluates to 2', async () => {
    expect(await run(`${decl}$o.len`)).toBe(2);
  });

  it('$o.empty evaluates to false', async () => {
    expect(await run(`${decl}$o.empty`)).toBe(false);
  });

  it('ordered[].empty evaluates to true (regression check, unchanged by this fix)', async () => {
    expect(await run('ordered[] -> .empty')).toBe(true);
  });

  it('$o.has(1) halts with RILL-R003 (requires list receiver, regression check)', async () => {
    await expect(runOrThrow(`${decl}$o -> .has(1)`)).rejects.toHaveProperty(
      'errorId',
      'RILL-R003'
    );
  });

  it('$o.?a evaluates to true', async () => {
    expect(await run(`${decl}$o.?a`)).toBe(true);
  });

  it('$o.?x evaluates to false', async () => {
    expect(await run(`${decl}$o.?x`)).toBe(false);
  });

  it('postfix ordered[a: 1, b: 2]["a"] evaluates to 1', async () => {
    expect(await run('ordered[a: 1, b: 2]["a"]')).toBe(1);
  });
});

describe('tuple value access', () => {
  const decl = 'tuple[1, "a"] => $t\n';

  it('$t[1] evaluates to "a"', async () => {
    expect(await run(`${decl}$t[1]`)).toBe('a');
  });

  it('$t[0] evaluates to 1', async () => {
    expect(await run(`${decl}$t[0]`)).toBe(1);
  });

  it('$t[-1] evaluates to "a" (negative index from end)', async () => {
    expect(await run(`${decl}$t[-1]`)).toBe('a');
  });

  it('$t[9] halts with RILL-R009 (out of bounds)', async () => {
    await expect(runOrThrow(`${decl}$t[9]`)).rejects.toHaveProperty(
      'errorId',
      'RILL-R009'
    );
  });

  it('$t -> .at(1) evaluates to "a"', async () => {
    expect(await run(`${decl}$t -> .at(1)`)).toBe('a');
  });

  it('postfix tuple[1, "a"][1] evaluates to "a"', async () => {
    expect(await run('tuple[1, "a"][1]')).toBe('a');
  });
});

describe('iterator value access', () => {
  it('range(0, 5)[2] halts with RILL-R002 (cannot index iterator)', async () => {
    await expect(runOrThrow('range(0, 5)[2]')).rejects.toHaveProperty(
      'errorId',
      'RILL-R002'
    );
  });

  it('$r[2] halts with RILL-R002 when $r is bound to an iterator', async () => {
    await expect(runOrThrow('range(0, 5) => $r\n$r[2]')).rejects.toHaveProperty(
      'errorId',
      'RILL-R002'
    );
  });
});
