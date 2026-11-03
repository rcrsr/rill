/**
 * Rill Runtime Tests: Dict Reserved Keys
 * Tests that all dict method names are reserved and cannot be used as dict keys.
 */

import { describe, expect, it } from 'vitest';

import { expectHalt } from '../helpers/halt.js';
import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Dict Reserved Keys', () => {
  describe('Reserved Method Names', () => {
    it.each(['len', 'first', 'empty', 'eq', 'ne', 'keys', 'values', 'entries'])(
      "halts with RILL-R002 for reserved method name '%s' as dict key",
      async (name) => {
        await expectHalt(() => run(`dict[${name}: 1]`), {
          code: 'RILL_R002',
          hostErrorId: 'RILL-R002',
          messagePattern: `Cannot use reserved method name '${name}' as dict key`,
        });
      }
    );

    it('still allows non-reserved comparison method names as dict keys', async () => {
      // lt/gt/le/ge belong to number methods, not dict methods, so they
      // remain usable as dict keys.
      const result = await run('dict[lt: 1, gt: 2, le: 3, ge: 4]');
      expect(result).toEqual({ lt: 1, gt: 2, le: 3, ge: 4 });
    });
  });
});
