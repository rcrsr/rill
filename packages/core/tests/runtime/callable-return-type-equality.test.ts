/**
 * Rill Runtime Tests: Closure equality includes declared return type
 *
 * Bug #277: callableEquals compared params, body AST, defining scope, and
 * annotations, but ignored the declared return type (`:T` suffix). Two closures
 * that differ only in their return-type annotation compared equal.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Bug #277: closure equality accounts for return type', () => {
  it('closures differing only in return type are not equal', async () => {
    const result = await run(`
      |x: number| ($x) :number => $a
      |x: number| ($x) :string => $b
      $a == $b
    `);
    expect(result).toBe(false);
  });

  it('closures with identical return types remain equal', async () => {
    const result = await run(`
      |x: number| ($x) :number => $a
      |x: number| ($x) :number => $b
      $a == $b
    `);
    expect(result).toBe(true);
  });

  it('closures with no return-type annotation on both sides remain equal', async () => {
    const result = await run(`
      |x: number| ($x) => $a
      |x: number| ($x) => $b
      $a == $b
    `);
    expect(result).toBe(true);
  });

  it('an annotated return type differs from an absent one', async () => {
    const result = await run(`
      |x: number| ($x) :number => $a
      |x: number| ($x) => $b
      $a == $b
    `);
    expect(result).toBe(false);
  });
});
