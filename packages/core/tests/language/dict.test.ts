/**
 * Rill Runtime Tests: Dict Reserved Keys
 * Tests that all dict method names are reserved and cannot be used as dict keys.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Dict Reserved Keys', () => {
  describe('Reserved Method Names', () => {
    it("halts with RILL-R002 for reserved method name 'len' as dict key", async () => {
      await expect(run('dict[len: 1]')).rejects.toThrow(
        /Cannot use reserved method name 'len' as dict key/i
      );
    });

    it("halts with RILL-R002 for reserved method name 'first' as dict key", async () => {
      await expect(run('dict[first: 1]')).rejects.toThrow(
        /Cannot use reserved method name 'first' as dict key/i
      );
    });

    it("halts with RILL-R002 for reserved method name 'empty' as dict key", async () => {
      await expect(run('dict[empty: 1]')).rejects.toThrow(
        /Cannot use reserved method name 'empty' as dict key/i
      );
    });

    it("halts with RILL-R002 for reserved method name 'eq' as dict key", async () => {
      await expect(run('dict[eq: 1]')).rejects.toThrow(
        /Cannot use reserved method name 'eq' as dict key/i
      );
    });

    it("halts with RILL-R002 for reserved method name 'ne' as dict key", async () => {
      await expect(run('dict[ne: 1]')).rejects.toThrow(
        /Cannot use reserved method name 'ne' as dict key/i
      );
    });

    it('still allows non-reserved comparison method names as dict keys', async () => {
      // lt/gt/le/ge belong to number methods, not dict methods, so they
      // remain usable as dict keys.
      const result = await run('dict[lt: 1, gt: 2, le: 3, ge: 4]');
      expect(result).toEqual({ lt: 1, gt: 2, le: 3, ge: 4 });
    });
  });
});
