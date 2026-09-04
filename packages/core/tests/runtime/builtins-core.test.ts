/**
 * Rill Runtime Tests: core built-ins (log)
 *
 * Covers the zero-argument guard on `log()` and confirms the excess-arg
 * tolerance `log` retains as an untyped built-in stays intact.
 */

import { describe, expect, it } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: log built-in', () => {
  it('halts with RILL-R044 when called with zero arguments', async () => {
    try {
      await run('log()');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeError);
      expect((err as RuntimeError).errorId).toBe('RILL-R044');
    }
  });

  it('succeeds with a single message argument', async () => {
    const result = await run('log("x")');
    expect(result).toBe('x');
  });

  it('tolerates excess arguments without halting', async () => {
    const result = await run('log("x", 99)');
    expect(result).toBe('x');
  });
});
