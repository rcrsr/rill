/**
 * Host conversion of dict entries: .entries yields tuples, which toNative
 * represents as plain arrays.
 */

import { describe, expect, it } from 'vitest';
import { toNative } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

describe('toNative of dict entries', () => {
  it('converts the tuples from .entries to key-value arrays', async () => {
    const result = await run('dict[a: 1] -> .entries');

    const native = toNative(result);

    expect(native.value).toEqual([['a', 1]]);
  });
});
