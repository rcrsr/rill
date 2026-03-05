/**
 * Rill Language Tests: to_shape() Removal
 * Verifies that to_shape() is not available after migration (AC-19)
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Language: to_shape() Removal', () => {
  it('produces unknown function error when calling to_shape (AC-19)', async () => {
    await expect(run('to_shape([x: 1])')).rejects.toThrow(
      'Unknown function: to_shape'
    );
  });
});
