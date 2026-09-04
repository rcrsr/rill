/**
 * Rill Runtime Tests
 *
 * Covers two behavioral guarantees:
 *
 * 1. Dynamic field access (`$d.$k`, `$d.(expr)`) on a missing key, and field
 *    access on a non-dict, HALT when there is no `??` default and no `.?`
 *    existence check — matching literal field access (`$d.zz`). They must
 *    never surface a raw null, which would violate the no-null principle.
 *    A `??` default still coalesces, and `.?` still returns a bool.
 *
 * 2. Re-capturing a variable declared in the SAME block with the same type is
 *    allowed and yields the new value. Reassigning a genuinely outer variable
 *    from a child scope still halts, and a different-type re-capture still
 *    halts (type lock).
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Dynamic access halts on missing key / non-dict', () => {
  it('halts on a missing variable key, like literal access', async () => {
    const code = `
      dict[a: 1] => $d
      "zz" => $k
      $d.$k
    `;
    await expect(run(code)).rejects.toMatchObject({
      errorId: 'RILL-R009',
    });
  });

  it('literal access on the same missing key halts identically', async () => {
    const code = `
      dict[a: 1] => $d
      $d.zz
    `;
    await expect(run(code)).rejects.toMatchObject({
      errorId: 'RILL-R009',
    });
  });

  it('coalesces a missing variable key with ?? default', async () => {
    const code = `
      dict[a: 1] => $d
      "zz" => $k
      $d.$k ?? "x"
    `;
    expect(await run(code)).toBe('x');
  });

  it('existence check on a missing variable key returns false', async () => {
    const code = `
      dict[a: 1] => $d
      "zz" => $k
      $d.?$k
    `;
    expect(await run(code)).toBe(false);
  });

  it('existence check on a present variable key returns true', async () => {
    const code = `
      dict[a: 1] => $d
      "a" => $k
      $d.?$k
    `;
    expect(await run(code)).toBe(true);
  });

  it('halts on a missing computed key', async () => {
    const code = `
      dict[a: 1] => $d
      $d.("zz")
    `;
    await expect(run(code)).rejects.toMatchObject({
      errorId: 'RILL-R009',
    });
  });

  it('coalesces a missing computed key with ?? default', async () => {
    const code = `
      dict[a: 1] => $d
      $d.("zz") ?? "x"
    `;
    expect(await run(code)).toBe('x');
  });

  it('halts on literal field access on a non-dict (number)', async () => {
    const code = `
      5 => $n
      $n.foo
    `;
    await expect(run(code)).rejects.toMatchObject({
      errorId: 'RILL-R003',
    });
  });

  it('coalesces literal field access on a non-dict with ?? default', async () => {
    const code = `
      5 => $n
      $n.foo ?? "x"
    `;
    expect(await run(code)).toBe('x');
  });

  it('halts on a variable-key field access on a non-dict (number)', async () => {
    const code = `
      5 => $n
      "foo" => $k
      $n.$k
    `;
    await expect(run(code)).rejects.toMatchObject({
      errorId: 'RILL-R003',
    });
  });

  it('halts on an out-of-bounds variable list index', async () => {
    const code = `
      list["a", "b"] => $l
      10 => $i
      $l.$i
    `;
    await expect(run(code)).rejects.toMatchObject({
      errorId: 'RILL-R009',
    });
  });

  it('coalesces an out-of-bounds variable list index with ?? default', async () => {
    const code = `
      list["a", "b"] => $l
      10 => $i
      $l.$i ?? "oob"
    `;
    expect(await run(code)).toBe('oob');
  });
});

describe('Same-block same-type reassignment', () => {
  it('allows re-capturing a same-block variable of the same type', async () => {
    const code = `
      "" -> {
        1 => $x
        2 => $x
        $x
      }
    `;
    expect(await run(code)).toBe(2);
  });

  it('re-capture reflects the latest value to later siblings', async () => {
    const code = `
      "" -> {
        1 => $x
        2 => $x
        3 => $x
        $x + 10
      }
    `;
    expect(await run(code)).toBe(13);
  });

  it('still halts when reassigning a genuinely outer variable from a child scope', async () => {
    const code = `
      "outer" => $x
      list[1, 2, 3] -> seq({ "inner" => $x })
    `;
    await expect(run(code)).rejects.toThrow(/Cannot reassign outer variable/);
  });

  it('still halts on a different-type same-block re-capture (type lock)', async () => {
    const code = `
      "" -> {
        1 => $x
        "two" => $x
        $x
      }
    `;
    await expect(run(code)).rejects.toThrow(/Type mismatch/);
  });
});
