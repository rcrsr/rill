/**
 * Fn and Stream Signature Structural Match Tests
 *
 * Fn type literals (`fn(x: T):R`) and stream type expressions
 * (`stream(T):R`) carry sub-fields (`params`/`ret` and `chunk`/`ret`
 * respectively) that require deep structural matching via
 * structureMatches, not a bare type-name comparison. These tests pin
 * that both `:type` (assertion) and `:?type` (check) dispatch into the
 * structural path for fn and stream shapes.
 */

import { describe, it, expect } from 'vitest';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

describe('fn signature structural match', () => {
  it('mismatched fn fails :? against a fn signature', async () => {
    const script = `
      fn(x: number):number => $sig
      fn(a: string) { $a } => $g
      $g -> :?$sig
    `;
    expect(await run(script)).toBe(false);
  });

  it('mismatched fn halts #TYPE_MISMATCH on : against a fn signature', async () => {
    const script = `
      fn(x: number):number => $sig
      fn(a: string) { $a } => $g
      $g -> :$sig
    `;
    await expectHalt(() => run(script), { code: 'TYPE_MISMATCH' });
  });

  it('matching fn passes :? against a fn signature (positive case)', async () => {
    const script = `
      fn(n: number) { $n * 2 } => $double
      fn(n: number):any => $sig
      $double -> :?$sig
    `;
    expect(await run(script)).toBe(true);
  });

  it('bare fn type check passes regardless of signature (fall-through guard)', async () => {
    const script = `
      fn(n: number) { $n * 2 } => $double
      $double -> :?fn
    `;
    expect(await run(script)).toBe(true);
  });

  it('typed fn capture assertion still halts on param mismatch', async () => {
    const script = `
      fn(x: number):number => $sig
      fn(a: string) { $a } => $g:$sig
      "unreachable"
    `;
    await expectHalt(() => run(script), {
      code: 'TYPE_MISMATCH',
      messagePattern: /Type assertion failed/,
    });
  });

  it('field-presence check on a dict still returns false for a missing field', async () => {
    const script = `
      fn(x: number):number => $sig
      dict[] => $d
      $d.?f&$sig
    `;
    expect(await run(script)).toBe(false);
  });
});

describe('stream signature structural match', () => {
  it('stream with matching chunk type passes :? against stream(T)', async () => {
    const script = `
      fn(x):stream(number) { $x -> yield } => $gen
      $gen(42) => $s
      $s -> :?stream(number)
    `;
    expect(await run(script)).toBe(true);
  });

  it('stream with mismatched chunk type fails :? against stream(T)', async () => {
    const script = `
      fn(x):stream(number) { $x -> yield } => $gen
      $gen(42) => $s
      $s -> :?stream(string)
    `;
    expect(await run(script)).toBe(false);
  });

  it('stream with mismatched chunk type halts #TYPE_MISMATCH on : against stream(T)', async () => {
    const script = `
      fn(x):stream(number) { $x -> yield } => $gen
      $gen(42) => $s
      $s -> :stream(string)
    `;
    await expectHalt(() => run(script), { code: 'TYPE_MISMATCH' });
  });
});
