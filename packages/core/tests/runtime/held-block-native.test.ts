/**
 * Host conversion of a held block: toNative reports the entry as the same
 * fn type that .^type reports, and never halts.
 */

import { describe, expect, it } from 'vitest';
import { toNative } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

describe('toNative of a held block', () => {
  it('reports a held dict entry as the signature .^type reports', async () => {
    const native = toNative(await run('dict[a: { 1 }]'));
    const reflected = await run('dict[a: { 1 }].^type -> string');

    expect(native.value).toEqual({ a: { signature: 'fn():any' } });
    expect(native.rillTypeSignature).toBe(reflected);
  });

  it('reports a held list entry without halting', async () => {
    const native = toNative(await run('list[{ 1 }]'));

    expect(native.value).toEqual([{ signature: 'fn():any' }]);
    expect(native.rillTypeSignature).toBe('list(fn():any)');
  });
});
