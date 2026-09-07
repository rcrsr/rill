/**
 * `checkType` short-circuits `any` (mirrors structureMatches' `kind === 'any'`
 * branch). Previously `:?any` compared `inferType(value) === 'any'`, which
 * is never true since `inferType` never returns the literal `'any'`, so the
 * probe always returned false regardless of operand.
 */

import { describe, it, expect } from 'vitest';
import { run } from '../helpers/runtime.js';

describe('checkType any short-circuit', () => {
  it('42 :? any is true', async () => {
    expect(await run('(42 :? any)')).toBe(true);
  });

  it('"x" :? any is true', async () => {
    expect(await run('("x" :? any)')).toBe(true);
  });

  it('42 :? number is true', async () => {
    expect(await run('(42 :? number)')).toBe(true);
  });

  it('42 :? string is false', async () => {
    expect(await run('(42 :? string)')).toBe(false);
  });
});
