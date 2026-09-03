/**
 * Type-system fixes for scalar/branded leaf kinds (#280, #282, #283, #285, #288).
 *
 * structureEquals, structureMatches, formatStructure, inferStructure and the
 * TypeNameExpr handler previously knew only number/string/bool/vector/type/any
 * (plus a partial datetime/duration set) as scalar kinds. datetime, duration,
 * atom and iterator fell through, so identical leaf types compared unequal,
 * `:?` checks against atom/iterator were false, reflection printed "any", and
 * union equality was order-sensitive. These tests lock the corrected behavior.
 */

import { describe, it, expect } from 'vitest';
import { run } from '../helpers/runtime.js';

describe('structureEquals leaf kinds (#280)', () => {
  it('list[now(), now()] no longer halts and has length 2', async () => {
    expect(await run('list[now(), now()] -> .len')).toBe(2);
  });

  it('list(datetime) == list(datetime) is true', async () => {
    expect(await run('(list(datetime) == list(datetime))')).toBe(true);
  });

  it('dict[a: now()].^type == dict(a: datetime) is true', async () => {
    expect(await run('(dict[a: now()].^type == dict(a: datetime))')).toBe(true);
  });

  it('type-value equality is reflexive for duration', async () => {
    expect(await run('(list(duration) == list(duration))')).toBe(true);
  });
});

describe('union structural equality is order-insensitive (#288)', () => {
  it('list(string|number) == list(number|string) is true', async () => {
    expect(await run('(list(string|number) == list(number|string))')).toBe(
      true
    );
  });

  it('same-order unions remain equal', async () => {
    expect(await run('(list(string|number) == list(string|number))')).toBe(
      true
    );
  });

  it('unions with different members remain unequal', async () => {
    expect(await run('(list(string|number) == list(string|bool))')).toBe(false);
  });
});

describe('structureMatches / reflection for atom and iterator (#282)', () => {
  it('#TIMEOUT :? atom|string is true', async () => {
    expect(await run('(#TIMEOUT :? atom|string)')).toBe(true);
  });

  it('#TIMEOUT -> :atom passes (does not halt)', async () => {
    // A passing assertion returns the value unchanged; reflect on the
    // result to confirm the pipeline ran without halting.
    expect(await run('#TIMEOUT -> :atom -> .^type.signature')).toBe('atom');
  });

  it('#TIMEOUT.^type.signature is "atom"', async () => {
    expect(await run('#TIMEOUT.^type.signature')).toBe('atom');
  });

  it('range(0,3) :? iterator|string is true', async () => {
    expect(await run('(range(0, 3) :? iterator|string)')).toBe(true);
  });

  it('range(0,3).^type.signature is "iterator"', async () => {
    expect(await run('range(0, 3).^type.signature')).toBe('iterator');
  });
});

describe('dict(T) rejects branded non-dict values (#283)', () => {
  it('now() :? dict(any) is false', async () => {
    expect(await run('(now() :? dict(any))')).toBe(false);
  });

  it('now() :? dict is false (consistent)', async () => {
    expect(await run('(now() :? dict)')).toBe(false);
  });

  it('#TIMEOUT :? dict(any) is false', async () => {
    expect(await run('(#TIMEOUT :? dict(any))')).toBe(false);
  });

  it('a real dict still matches dict(any)', async () => {
    expect(await run('(dict[a: 1] :? dict(any))')).toBe(true);
  });

  it('a real dict still matches a keyed dict shape', async () => {
    expect(await run('(dict[a: 1] :? dict(a: number))')).toBe(true);
  });
});

describe('TypeNameExpr maps branded kinds (#285)', () => {
  it('now().^type == datetime is true', async () => {
    expect(await run('(now().^type == datetime)')).toBe(true);
  });

  it('range(0,3).^type == iterator is true', async () => {
    expect(await run('(range(0, 3).^type == iterator)')).toBe(true);
  });

  it('#TIMEOUT.^type == atom is true', async () => {
    expect(await run('(#TIMEOUT.^type == atom)')).toBe(true);
  });
});
