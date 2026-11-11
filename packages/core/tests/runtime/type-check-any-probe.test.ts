/**
 * `checkType` short-circuits `any` (mirrors structureMatches' `kind === 'any'`
 * branch). Previously `:?any` compared `inferType(value) === 'any'`, which
 * is never true since `inferType` never returns the literal `'any'`, so the
 * probe always returned false regardless of operand.
 */

import { describe, it, expect } from 'vitest';
import { structureToTypeValue } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { expectHaltMessage } from '../helpers/halt.js';

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

describe('literal type value bound to a variable', () => {
  const vars = { T: structureToTypeValue({ kind: 'literal', value: 'a' }) };

  it('"b" :? $T is false', async () => {
    expect(await run('("b" :? $T)', { variables: vars })).toBe(false);
  });

  it('"a" :? $T is true', async () => {
    expect(await run('("a" :? $T)', { variables: vars })).toBe(true);
  });

  it('"b" :$T halts with a type mismatch', async () => {
    await expectHaltMessage(
      () => run('"b" :$T', { variables: vars }),
      /Type assertion failed: expected "a", got string "b"/
    );
  });
});
