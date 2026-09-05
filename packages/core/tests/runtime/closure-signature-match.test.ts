/**
 * Closure and Stream Signature Structural Match Tests
 *
 * Closure signature literals (`|x: T| :R`) and stream type expressions
 * (`stream(T):R`) carry sub-fields (`params`/`ret` and `chunk`/`ret`
 * respectively) that require deep structural matching via
 * structureMatches, not a bare type-name comparison. These tests pin
 * that both `:type` (assertion) and `:?type` (check) dispatch into the
 * structural path for closure and stream shapes.
 */

import { describe, it, expect } from 'vitest';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

describe('closure signature structural match', () => {
  it('mismatched closure fails :? against a closure signature', async () => {
    const script = `
      |x: number| :number => $sig
      |a: string| ($a) => $g
      $g -> :?$sig
    `;
    expect(await run(script)).toBe(false);
  });

  it('mismatched closure halts #TYPE_MISMATCH on : against a closure signature', async () => {
    const script = `
      |x: number| :number => $sig
      |a: string| ($a) => $g
      $g -> :$sig
    `;
    await expectHalt(() => run(script), { code: 'TYPE_MISMATCH' });
  });

  it('matching closure passes :? against a closure signature (positive case)', async () => {
    const script = `
      |n: number| ($n * 2) => $double
      |n: number| :any => $sig
      $double -> :?$sig
    `;
    expect(await run(script)).toBe(true);
  });

  it('bare closure type check passes regardless of signature (fall-through guard)', async () => {
    const script = `
      |n: number| ($n * 2) => $double
      $double -> :?closure
    `;
    expect(await run(script)).toBe(true);
  });

  it('typed closure capture assertion still halts on param mismatch', async () => {
    const script = `
      |x: number| :number => $sig
      |a: string| ($a) => $g:$sig
      "unreachable"
    `;
    await expect(run(script)).rejects.toThrow(/Type mismatch/);
  });

  it('field-presence check on a dict still returns false for a missing field', async () => {
    const script = `
      |x: number| :number => $sig
      dict[] => $d
      $d.?f&$sig
    `;
    expect(await run(script)).toBe(false);
  });
});

describe('stream signature structural match', () => {
  it('stream with matching chunk type passes :? against stream(T)', async () => {
    const script = `
      |x| ($x -> yield) :stream(number) => $gen
      $gen(42) => $s
      $s -> :?stream(number)
    `;
    expect(await run(script)).toBe(true);
  });

  it('stream with mismatched chunk type fails :? against stream(T)', async () => {
    const script = `
      |x| ($x -> yield) :stream(number) => $gen
      $gen(42) => $s
      $s -> :?stream(string)
    `;
    expect(await run(script)).toBe(false);
  });

  it('stream with mismatched chunk type halts #TYPE_MISMATCH on : against stream(T)', async () => {
    const script = `
      |x| ($x -> yield) :stream(number) => $gen
      $gen(42) => $s
      $s -> :stream(string)
    `;
    await expectHalt(() => run(script), { code: 'TYPE_MISMATCH' });
  });
});
