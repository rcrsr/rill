/**
 * Rill Runtime Tests: reserved dict method parity
 *
 * `RESERVED_DICT_METHODS` in runtime/core/values.ts is a literal array
 * (core/ must not import ext/), so it can silently drift from
 * `DICT_METHODS` in runtime/ext/builtins/methods/tables.ts. This test
 * imports both and asserts their key sets match, catching future drift
 * without introducing a core -> ext import.
 */

import { describe, expect, it } from 'vitest';

import { RESERVED_DICT_METHODS } from '../../src/runtime/core/values.js';
import { DICT_METHODS } from '../../src/runtime/ext/builtins/methods/tables.js';

describe('RESERVED_DICT_METHODS parity', () => {
  it('matches the key set of DICT_METHODS exactly', () => {
    const reserved = [...RESERVED_DICT_METHODS].sort();
    const dictMethodNames = Object.keys(DICT_METHODS).sort();
    expect(reserved).toEqual(dictMethodNames);
  });
});
