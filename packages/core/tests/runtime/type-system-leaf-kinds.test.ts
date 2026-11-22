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
import { createRuntimeContext, execute, parse } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

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
  it('list(union(string, number)) == list(union(number, string)) is true', async () => {
    expect(
      await run('(list(union(string, number)) == list(union(number, string)))')
    ).toBe(true);
  });

  it('same-order unions remain equal', async () => {
    expect(
      await run('(list(union(string, number)) == list(union(string, number)))')
    ).toBe(true);
  });

  it('unions with different members remain unequal', async () => {
    expect(
      await run('(list(union(string, number)) == list(union(string, bool)))')
    ).toBe(false);
  });
});

describe('structureMatches / reflection for atom and iterator (#282)', () => {
  it('#TIMEOUT :? union(atom, string) is true', async () => {
    expect(await run('(#TIMEOUT :? union(atom, string))')).toBe(true);
  });

  it('#TIMEOUT -> :atom passes (does not halt)', async () => {
    // A passing assertion returns the value unchanged; reflect on the
    // result to confirm the pipeline ran without halting.
    expect(await run('#TIMEOUT -> :atom -> .^type.signature')).toBe('atom');
  });

  it('#TIMEOUT.^type.signature is "atom"', async () => {
    expect(await run('#TIMEOUT.^type.signature')).toBe('atom');
  });

  it('range(0,3) :? union(iterator, string) is true', async () => {
    expect(await run('(range(0, 3) :? union(iterator, string))')).toBe(true);
  });

  it('range(0,3).^type.signature is "iterator"', async () => {
    expect(await run('range(0, 3).^type.signature')).toBe('iterator');
  });
});

describe('dict rejects branded non-dict values (#283)', () => {
  it('now() :? dict is false', async () => {
    expect(await run('(now() :? dict)')).toBe(false);
  });

  it('#TIMEOUT :? dict is false', async () => {
    expect(await run('(#TIMEOUT :? dict)')).toBe(false);
  });

  it('a real dict still matches dict', async () => {
    expect(await run('(dict[a: 1] :? dict)')).toBe(true);
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

describe('hand-built dict and ordered type constructors', () => {
  it.each(['dict', 'ordered'])(
    'halts #INVALID_INPUT when %s carries a positional argument',
    async (name) => {
      const ast = parse(`${name}(a: number)`);
      const stmt = ast.statements[0];
      if (stmt?.type !== 'Statement') throw new Error('expected a statement');
      const primary = stmt.expression.head;
      if (primary.type !== 'PostfixExpr') throw new Error('expected postfix');
      const node = primary.primary;
      if (node.type !== 'TypeConstructor') throw new Error('expected type');
      const arg = node.args[0];
      if (arg === undefined) throw new Error('expected an argument');
      Object.assign(arg, { name: undefined });
      await expectHalt(() => execute(ast, createRuntimeContext()), {
        code: 'INVALID_INPUT',
        messagePattern: 'map(string, V)',
      });
    }
  );
});
