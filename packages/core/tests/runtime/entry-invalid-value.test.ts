/**
 * Rill Runtime Tests: invalid values in collection literal entries
 */

import { describe, it } from 'vitest';
import { run } from '../helpers/runtime.js';
import { expectHaltMessage } from '../helpers/halt.js';

describe('Rill Runtime: Invalid value in literal entries', () => {
  it('halts when a tuple entry holds an invalid value', async () => {
    await expectHaltMessage(
      () => run('guard { error "boom" } => $r\ntuple[1, $r]'),
      /boom|invalid|halt/i
    );
  });

  it('halts when an ordered entry holds an invalid value', async () => {
    await expectHaltMessage(
      () => run('guard { error "boom" } => $r\nordered[a: $r]'),
      /boom|invalid|halt/i
    );
  });
});
