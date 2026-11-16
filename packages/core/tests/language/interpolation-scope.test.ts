/**
 * Rill Language Tests: Interpolation scope
 *
 * Each `{...}` part of an interpolated string runs in its own child scope:
 * captures made inside a part are not visible after it, while reads of
 * enclosing variables and of the enclosing `$` still work.
 */

import { describe, expect, it } from 'vitest';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

describe('Interpolation scope', () => {
  it('halts RILL-R005 when a capture made inside a part is read after the string', async () => {
    await expectHalt(() => run('"{5 => $q}" => $s\n$q'), {
      code: 'RILL_R005',
      hostErrorId: 'RILL-R005',
    });
  });

  it('halts RILL-R005 when a later part reads a capture made in an earlier part', async () => {
    await expectHalt(() => run('"{1 => $a}{$a}"'), {
      code: 'RILL_R005',
      hostErrorId: 'RILL-R005',
    });
  });

  it('reads the enclosing $ inside a part', async () => {
    expect(await run('5 -> "{$}"')).toBe('5');
  });

  it('reads outer variables inside a part', async () => {
    expect(await run('1 => $o\n"{$o}"')).toBe('1');
  });
});
