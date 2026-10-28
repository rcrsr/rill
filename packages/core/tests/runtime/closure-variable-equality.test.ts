/**
 * Rill Runtime Tests: Closure equality includes variable defaults and existence checks
 *
 * Bug #484: variableEquals compared the name and access chain of a variable
 * node but ignored its `??` default and its typed existence check. Closures
 * whose bodies differ only in those parts compared equal.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Bug #484: closure equality accounts for variable defaults and existence checks', () => {
  it('closures with different defaults on a variable are not equal', async () => {
    const result = await run(`
      |x|{ $x ?? 1 } => $a
      |x|{ $x ?? 2 } => $b
      $a == $b
    `);
    expect(result).toBe(false);
  });

  it('closures with different defaults on a field access are not equal', async () => {
    const result = await run(`
      |x|{ $x.a ?? 1 } => $a
      |x|{ $x.a ?? 2 } => $b
      $a == $b
    `);
    expect(result).toBe(false);
  });

  it('closures with different typed existence checks are not equal', async () => {
    const result = await run(`
      |x|{ $x.?a&string } => $a
      |x|{ $x.?a&number } => $b
      $a == $b
    `);
    expect(result).toBe(false);
  });

  it('closures with existence checks on different fields are not equal', async () => {
    const result = await run(`
      |x|{ $x.?a } => $a
      |x|{ $x.?b } => $b
      $a == $b
    `);
    expect(result).toBe(false);
  });

  it('a default differs from an absent default', async () => {
    const result = await run(`
      |x|{ $x ?? 1 } => $a
      |x|{ $x } => $b
      $a == $b
    `);
    expect(result).toBe(false);
  });

  it('an untyped existence check differs from a typed one', async () => {
    const result = await run(`
      |x|{ $x.?a } => $a
      |x|{ $x.?a&string } => $b
      $a == $b
    `);
    expect(result).toBe(false);
  });

  it('closures with identical defaults remain equal', async () => {
    const result = await run(`
      |x|{ $x ?? 1 } => $a
      |x|{ $x ?? 1 } => $b
      $a == $b
    `);
    expect(result).toBe(true);
  });

  it('closures with identical typed existence checks remain equal', async () => {
    const result = await run(`
      |x|{ $x.?a&string } => $a
      |x|{ $x.?a&string } => $b
      $a == $b
    `);
    expect(result).toBe(true);
  });

  it('closures with identical untyped existence checks remain equal', async () => {
    const result = await run(`
      |x|{ $x.?a } => $a
      |x|{ $x.?a } => $b
      $a == $b
    `);
    expect(result).toBe(true);
  });
});
