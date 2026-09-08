/**
 * Rill Runtime Tests: assert statement with unbound $
 *
 * A bare `assert` statement (no pipe target) that passes its condition
 * returns the current pipe value unchanged. When that pipe value is
 * unbound (e.g. inside a parameterless closure body where `$` was never
 * set), the statement must halt with RILL-R005 rather than silently
 * returning a raw null. Mirrors the unbound-$ guards already present on
 * `pass` and on else-less `if`.
 */

import { describe, expect, it } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

describe('Rill Runtime: assert with unbound $', () => {
  it('bare assert inside a parameterless closure halts with RILL-R005', async () => {
    const err = await run('|| { assert true } => $f\n$f()').catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(RuntimeError);
    expect((err as RuntimeError).errorId).toBe('RILL-R005');
  });

  it('pipe-target assert returns the piped value unchanged', async () => {
    const result = await run('true -> assert true');
    expect(result).toBe(true);
  });

  it('a failing bound assert still halts with RILL-R015', async () => {
    const err = await run('true -> assert false').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RuntimeError);
    expect((err as RuntimeError).errorId).toBe('RILL-R015');
  });
});
