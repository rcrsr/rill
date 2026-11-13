/**
 * Rill Runtime Tests: canonicalUnionMembers formats each member once
 */

import { describe, expect, it } from 'vitest';

import { canonicalUnionMembers } from '../../src/runtime/core/types/union-order.js';
import type { TypeStructure } from '../../src/runtime/core/types/structures.js';

describe('canonicalUnionMembers', () => {
  it('formats each non-literal member at most once', () => {
    const members = ['f', 'b', 'e', 'a', 'd', 'c'].map(
      (name): TypeStructure => ({
        kind: 'dict',
        fields: { [name]: { type: { kind: 'number' } } },
      })
    );
    const calls = new Map<TypeStructure, number>();
    const format = (m: TypeStructure): string => {
      calls.set(m, (calls.get(m) ?? 0) + 1);
      return Object.keys('fields' in m ? (m.fields ?? {}) : {}).join();
    };

    const ordered = canonicalUnionMembers(members, format);

    for (const member of members) {
      expect(calls.get(member)).toBeLessThanOrEqual(1);
    }
    expect(ordered.map(format)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
});
