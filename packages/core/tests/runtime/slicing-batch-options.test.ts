/**
 * Tests for batch()'s options-dict validation: unknown keys must halt
 * instead of being silently ignored.
 */

import { describe, it, expect } from 'vitest';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

describe('batch: options dict validation', () => {
  it('halts #INVALID_INPUT on an unknown option key', async () => {
    await expectHalt(
      () => run('range(0, 5) -> batch(2, dict[batch_size: 2])'),
      {
        code: 'INVALID_INPUT',
        messagePattern:
          /batch: unknown option 'batch_size'; recognized options are 'drop_partial' and 'idle_flush'/,
      }
    );
  });

  it('still accepts the recognized drop_partial option', async () => {
    const result = await run(
      'range(0, 5) -> batch(2, dict[drop_partial: true])'
    );
    expect(result).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });
});
