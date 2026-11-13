/**
 * Mixed-collection inference: inferStructure never halts on mixed lists and
 * reports a union element type; the strict list sites still halt.
 */

import { describe, expect, it } from 'vitest';
import {
  atomName,
  commonType,
  getStatus,
  inferStructure,
  toNative,
  type RillValue,
  type TypeStructure,
} from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

const NUMBER_STRING = 'list(union(number, string))';
const mixed = (): RillValue => [1, 'a'];
const num: TypeStructure = { kind: 'number' };
const str: TypeStructure = { kind: 'string' };
const bool: TypeStructure = { kind: 'bool' };
const union = (...members: TypeStructure[]): TypeStructure => ({
  kind: 'union',
  members,
});

describe('Mixed-collection inference: union inner', () => {
  it('returns the member list from .inner and nests it in a list literal', async () => {
    const result = await run('union(1, "a") => $t\n$t.inner => $u\nlist[$u]');
    expect(result).toEqual([[1, 'a']]);
  });

  it('infers a union element type for the reversed inner list', async () => {
    const result = await run(
      'union(1, "a") => $t\n$t.inner -> .reverse => $r\n$r.^type.signature'
    );
    expect(result).toBe(NUMBER_STRING);
  });

  it('infers a union element type for the method-call form of inner', async () => {
    const result = await run(
      'union(1, "a") => $t\n$t -> .inner => $u\n$u.^type.signature'
    );
    expect(result).toBe(NUMBER_STRING);
  });

  it('accepts the inner list as a list literal element', async () => {
    const result = await run('union(1, "a") => $t\nlist[$t.inner]');
    expect(result).toEqual([[1, 'a']]);
  });

  it('compares inner lists across equal unions', async () => {
    const result = await run(
      'union(1, "a") => $t\n$t.inner == union("a", 1).inner'
    );
    expect(result).toBe(true);
  });
});

describe('Mixed-collection inference: host-injected mixed list', () => {
  const variables = (): Record<string, RillValue> => ({ m: mixed() });

  it('reports the union element type for .^type and .^effective', async () => {
    expect(await run('$m.^type.signature', { variables: variables() })).toBe(
      NUMBER_STRING
    );
    expect(
      await run('$m.^effective.signature', { variables: variables() })
    ).toBe(NUMBER_STRING);
  });

  it('accepts the list twice in a list literal', async () => {
    const result = await run('list[$m, $m]', { variables: variables() });
    expect(result).toEqual([
      [1, 'a'],
      [1, 'a'],
    ]);
  });

  it('recovers a list literal mixing the list with a string as #RILL_R002', async () => {
    const result = await run('guard { list[$m, "x"] }', {
      variables: variables(),
    });
    expect(atomName(getStatus(result).code)).toBe('RILL_R002');
  });

  it('halts TYPE_MISMATCH, not R002, on a narrower list assertion', async () => {
    await expectHalt(
      () => run('$m -> :list(number)', { variables: variables() }),
      { code: 'TYPE_MISMATCH' }
    );
  });

  it('passes a list assertion naming the union element', async () => {
    const result = await run('$m -> :list(union(number, string))', {
      variables: variables(),
    });
    expect(result).toEqual([1, 'a']);
  });

  it('reports the union element inside a dict field type', async () => {
    const result = await run('dict[x: $m].^type.signature', {
      variables: variables(),
    });
    expect(result).toBe(`dict(x: ${NUMBER_STRING})`);
  });
});

describe('Mixed-collection inference: inferred element types', () => {
  it('reports a union for a seq result mixing kinds', async () => {
    const result = await run(
      'list[1, 2] -> seq({ ($ == 1) ? "a" ! 2 }) => $r\n$r.^type.signature'
    );
    expect(result).toBe(NUMBER_STRING);
  });

  it('infers a union element for a mixed list', () => {
    expect(inferStructure([1, 'a'])).toEqual({
      kind: 'list',
      element: union(num, str),
    });
  });

  it('falls back to a bare list element for nested lists with different elements', () => {
    const type = inferStructure([[1, 'a'], [true]]);
    expect(type).toMatchObject({ kind: 'list', element: { kind: 'list' } });
    expect(type).toEqual({ kind: 'list', element: { kind: 'list' } });
  });

  it('merges two unions only when structurally equal', () => {
    expect(commonType(union(num, str), union(str, num))).toMatchObject({
      kind: 'union',
    });
    expect(commonType(union(num, str), union(num, bool))).toBeNull();
  });

  it('reports the union signature through toNative', () => {
    expect(toNative(mixed()).rillTypeSignature).toBe(NUMBER_STRING);
  });
});

describe('Mixed-collection inference: strict sites still halt', () => {
  it('halts a mixed list literal', async () => {
    await expectHalt(() => run('list[1, "a"]'), { code: 'RILL_R002' });
  });

  it('halts spreading a mixed list into a list literal', async () => {
    await expectHalt(() => run('list[...$m]', { variables: { m: mixed() } }), {
      code: 'RILL_R002',
    });
  });

  it('halts tuple-to-list conversion of mixed elements', async () => {
    await expectHalt(() => run('tuple[1, "a"] -> list'), {
      code: 'RILL_R002',
    });
  });

  it('halts comparing an inner list with a mixed list literal', async () => {
    await expectHalt(
      () => run('union(1, "a") => $t\n$t.inner == list[1, "a"]'),
      { code: 'RILL_R002' }
    );
  });
});
