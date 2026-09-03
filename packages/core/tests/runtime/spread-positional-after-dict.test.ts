/**
 * Rill Runtime Tests: Positional argument after a dict spread (Bug #276)
 *
 * A positional argument that follows a dict spread must bind the next UNBOUND
 * parameter rather than silently rebinding a parameter the dict already bound.
 * The dict-spread branch of ArgumentsBinder now advances the positional cursor
 * past parameters it bound, and the positional path rejects an already-bound
 * parameter with a duplicate-binding error (RILL-R001).
 */

import { describe, expect, it } from 'vitest';
import { run } from '../helpers/runtime.js';

describe('Rill Runtime: positional argument after dict spread (#276)', () => {
  it('positional after a leading dict spread binds the next unbound parameter', async () => {
    const result = await run(
      '|a, b| ("a={$a} b={$b}") => $f\n$f(...dict[a: 1], 2)'
    );
    expect(result).toBe('a=1 b=2');
  });

  it('dict spread binding a non-leading param still leaves the leading one for a positional', async () => {
    const result = await run(
      '|a, b| ("a={$a} b={$b}") => $f\n$f(...dict[b: 2], 1)'
    );
    expect(result).toBe('a=1 b=2');
  });

  it('reverse order: positional then dict rebinding the same param is a duplicate error', async () => {
    try {
      await run('|a, b| ("a={$a} b={$b}") => $f\n$f(1, ...dict[a: 5])');
      expect.fail('Should have thrown a duplicate-binding error');
    } catch (err) {
      expect(err).toHaveProperty('errorId', 'RILL-R001');
    }
  });

  it('positional targeting a param already bound by a dict spread is a duplicate error', async () => {
    try {
      await run('|a, b| ("a={$a} b={$b}") => $f\n$f(...dict[b: 2], 1, 3)');
      expect.fail('Should have thrown a duplicate-binding error');
    } catch (err) {
      expect(err).toHaveProperty('errorId', 'RILL-R001');
    }
  });
});
