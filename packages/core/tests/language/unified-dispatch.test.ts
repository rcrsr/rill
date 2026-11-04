/**
 * Rill Runtime Tests: Unified Dispatch
 * Tests for list literal dispatch and variable dispatch to dicts and lists
 */

import { describe, expect, it } from 'vitest';

import { expectHalt } from '../helpers/halt.js';
import { run } from '../helpers/runtime.js';

describe('Unified Dispatch', () => {
  describe('Dict Variable Dispatch', () => {
    it('returns value for string key piped to dict variable (AC-4)', async () => {
      // AC-4: String key "x" returns value 1 from dict
      const result = await run(`
        dict[x: 1, y: 2] => $dict
        "x" -> $dict
      `);
      expect(result).toBe(1);
    });
  });

  describe('List Variable Dispatch', () => {
    it('returns first element when piped 0 to list variable (AC-5)', async () => {
      // AC-5: Index 0 returns first element from list variable
      const result = await run(`
        list["a", "b", "c"] => $list
        0 -> $list
      `);
      expect(result).toBe('a');
    });

    it('returns last element when piped -1 to list variable (AC-6)', async () => {
      // AC-6: Negative index -1 returns last element from list variable
      const result = await run(`
        list["a", "b", "c"] => $list
        -1 -> $list
      `);
      expect(result).toBe('c');
    });
  });

  describe('Closure Auto-Invocation', () => {
    it('auto-invokes closure value in dict dispatch (AC-9)', async () => {
      // AC-9: Closure value is auto-invoked when dispatched
      // Zero-param closure invoked with args=[], pipeValue="fn", returns "result"
      const result = await run(`
        dict[fn: ||{ "result" }] => $dict
        "fn" -> $dict
      `);
      expect(result).toBe('result');
    });

    it('auto-invokes closure value in list dispatch (AC-10)', async () => {
      // AC-10: Closure value is auto-invoked when indexed
      // Zero-param closure invoked with args=[], pipeValue=0
      const result = await run(`
        list[||{ "first" }] => $list
        0 -> $list
      `);
      expect(result).toBe('first');
    });
  });

  describe('Chaining After Dispatch', () => {
    it('chains method call after list literal dispatch', async () => {
      const result = await run('0 -> list["hello", "world"] -> .upper');
      expect(result).toBe('HELLO');
    });

    it('chains method call after dict variable dispatch', async () => {
      const result = await run(`
        dict[x: "test"] => $dict
        "x" -> $dict -> .upper
      `);
      expect(result).toBe('TEST');
    });

    it('chains method call after list variable dispatch', async () => {
      const result = await run(`
        list["hello", "world"] => $list
        1 -> $list -> .upper
      `);
      expect(result).toBe('WORLD');
    });
  });

  describe('Variable Context', () => {
    it('uses variable as dispatch index for list literal', async () => {
      const result = await run(`
        1 => $idx
        $idx -> list["a", "b", "c"]
      `);
      expect(result).toBe('b');
    });

    it('uses variable as dispatch key for dict', async () => {
      const result = await run(`
        dict[x: 10, y: 20] => $dict
        "y" => $key
        $key -> $dict
      `);
      expect(result).toBe(20);
    });

    it('captures dispatch result from list literal', async () => {
      const result = await run(`
        0 -> list["test"] => $val
        $val -> .len
      `);
      expect(result).toBe(4);
    });

    it('captures dispatch result from dict', async () => {
      const result = await run(`
        "x" -> dict[x: 42] => $val
        $val + 10
      `);
      expect(result).toBe(52);
    });
  });

  describe('Error Cases', () => {
    describe('List Dispatch Type Errors', () => {
      it('throws RILL-R002 when string piped to list variable (AC-11, EC-7)', async () => {
        // AC-11: String input to list dispatch throws RILL-R002
        // EC-7: List dispatch requires number index, got {type}
        await expectHalt(
          () =>
            run(`
            list["a", "b", "c"] => $list
            "invalid" -> $list
          `),
          {
            code: 'RILL_R002',
            hostErrorId: 'RILL-R002',
            messagePattern: /List dispatch requires number index/i,
          }
        );
      });

      it('includes actual type in error message (EC-1, EC-7)', async () => {
        // EC-1/EC-7: Error message includes actual type received
        await expectHalt(
          () =>
            run(`
            list["a", "b"] => $list
            "test" -> $list
          `),
          {
            code: 'RILL_R002',
            hostErrorId: 'RILL-R002',
            messagePattern: /got string/i,
          }
        );
      });
    });

    describe('List Dispatch Bounds Errors', () => {
      it('throws RILL-R009 for out of bounds index (AC-12, EC-2)', async () => {
        // AC-12: Out of bounds index throws RILL-R009
        // EC-2: List dispatch: index '{index}' not found
        await expectHalt(
          () =>
            run(`
            list["a", "b"] => $list
            99 -> $list
          `),
          {
            code: 'RILL_R009',
            hostErrorId: 'RILL-R009',
            messagePattern: /List dispatch.*index.*not found/i,
          }
        );
      });

      it('throws RILL-R009 for empty list (AC-14, EC-2)', async () => {
        // AC-14: Empty list dispatch throws RILL-R009
        // EC-2/EC-8: Index out of bounds, no default
        await expectHalt(
          () =>
            run(`
            list[] => $list
            0 -> $list
          `),
          {
            code: 'RILL_R009',
            hostErrorId: 'RILL-R009',
            messagePattern: /List dispatch.*index.*not found/i,
          }
        );
      });

      it('includes index value in error message (EC-2, EC-8)', async () => {
        // EC-2/EC-8: Error message includes the index that was not found
        await expectHalt(
          () =>
            run(`
            list["x"] => $list
            5 -> $list
          `),
          {
            code: 'RILL_R009',
            hostErrorId: 'RILL-R009',
            messagePattern: /5/,
          }
        );
      });

      it('handles negative out of bounds index (EC-5, EC-8)', async () => {
        // EC-5/EC-8: Negative index out of bounds via variable
        await expectHalt(
          () =>
            run(`
            list["a"] => $list
            -5 -> $list
          `),
          {
            code: 'RILL_R009',
            hostErrorId: 'RILL-R009',
            messagePattern: /List dispatch.*index.*not found/i,
          }
        );
      });
    });

    describe('Dict Dispatch Errors', () => {
      it('throws RILL-R009 for missing dict key (AC-13, EC-4)', async () => {
        // AC-13: Missing dict key throws RILL-R009
        // EC-4: Dict dispatch: key '{key}' not found
        await expectHalt(
          () =>
            run(`
            dict[a: 1, b: 2] => $dict
            "missing" -> $dict
          `),
          {
            code: 'RILL_R009',
            hostErrorId: 'RILL-R009',
            messagePattern: /Dict dispatch.*key.*not found/i,
          }
        );
      });

      it('includes key name in error message (EC-4, EC-6)', async () => {
        // EC-4/EC-6: Error message includes the key that was not found
        await expectHalt(
          () =>
            run(`
            dict[x: 1] => $dict
            "notfound" -> $dict
          `),
          {
            code: 'RILL_R009',
            hostErrorId: 'RILL-R009',
            messagePattern: /notfound/i,
          }
        );
      });
    });

    describe('Non-Collection Dispatch Errors', () => {
      it('throws RILL-R002 for dispatch to string (AC-15, EC-3)', async () => {
        // AC-15: Dispatch to non-collection throws RILL-R002
        // EC-3: Cannot dispatch to {type}
        await expectHalt(
          () =>
            run(`
            "text" => $val
            "key" -> $val
          `),
          {
            code: 'RILL_R002',
            hostErrorId: 'RILL-R002',
            messagePattern: /Cannot dispatch to/i,
          }
        );
      });

      it('throws RILL-R002 for dispatch to number (AC-15, EC-3)', async () => {
        // AC-15: Dispatch to non-collection throws RILL-R002
        // EC-3: Cannot dispatch to {type}
        await expectHalt(
          () =>
            run(`
            42 => $val
            0 -> $val
          `),
          {
            code: 'RILL_R002',
            hostErrorId: 'RILL-R002',
            messagePattern: /Cannot dispatch to/i,
          }
        );
      });

      it('throws RILL-R002 for dispatch to boolean (AC-15, EC-3)', async () => {
        // AC-15: Dispatch to non-collection throws RILL-R002
        // EC-3: Cannot dispatch to {type}
        await expectHalt(
          () =>
            run(`
            true => $val
            "key" -> $val
          `),
          {
            code: 'RILL_R002',
            hostErrorId: 'RILL-R002',
            messagePattern: /Cannot dispatch to/i,
          }
        );
      });

      it('includes actual type in non-collection error (EC-3)', async () => {
        // EC-3: Error message includes actual type
        await expectHalt(
          () =>
            run(`
            123 => $num
            "x" -> $num
          `),
          {
            code: 'RILL_R002',
            hostErrorId: 'RILL-R002',
            messagePattern: /number/i,
          }
        );
      });
    });
  });

  describe('Boundary Conditions', () => {
    it('zero-param closure with pipeValue during dispatch (AC-16)', async () => {
      // AC-16: Zero-param closure auto-invoked with args=[], pipeValue=input
      // Zero-param closure invoked with args=[], pipeValue=5, returns 10
      const result = await run(`
        list[||{ $ * 2 }] => $list
        5 -> $list[0]
      `);
      expect(result).toBe(10);
    });

    it('block-closure with args during dispatch (AC-17)', async () => {
      // AC-17: Block-closure (params.length > 0) receives piped value as first argument
      // Dispatch with index 5 retrieves closure, auto-invokes with args=[5]
      // Block-closure { $ + 1 } receives args=[5], returns 6
      const result = await run(`
        list[{ $ + 1 }, { $ + 1 }, { $ + 1 }, { $ + 1 }, { $ + 1 }, { $ + 1 }] => $list
        5 -> $list
      `);
      expect(result).toBe(6);
    });

    it('negative index wraps correctly in list dispatch (AC-18)', async () => {
      // AC-18: Negative index -3 wraps to index 0 in 3-element list
      const result = await run(`
        list["a", "b", "c"] => $list
        -3 -> $list
      `);
      expect(result).toBe('a');
    });

    it('empty list with default returns default (AC-19)', async () => {
      // AC-19: Empty list dispatch with default returns default value
      const result = await run(`
        list[] => $empty
        0 -> $empty ?? "default"
      `);
      expect(result).toBe('default');
    });

    it('match takes precedence over default in dict dispatch (AC-20)', async () => {
      // AC-20: When key matches, return value (not default)
      const result = await run(`
        dict[x: 1] => $d
        "x" -> $d ?? 0
      `);
      expect(result).toBe(1);
    });

    it('propagates closure body runtime error during dispatch (EC-9)', async () => {
      // EC-9: Closure body runtime error should propagate with original error code
      // Zero-param closures receive $ binding and execute their body correctly
      await expectHalt(
        () =>
          run(`
          list[||{ $undefined }] => $list
          0 -> $list
        `),
        {
          code: 'RILL_R005',
          hostErrorId: 'RILL-R005',
          messagePattern: /undefined/i,
        }
      );
    });

    it('propagates closure body runtime error during dispatch with block-closure (EC-9)', async () => {
      // EC-9: Closure body runtime error propagates with original error code
      // Uses block-closure (params.length > 0) which works with current dispatch
      await expectHalt(
        () =>
          run(`
          list[|x|{ $undefined }] => $list
          0 -> $list
        `),
        {
          code: 'RILL_R005',
          hostErrorId: 'RILL-R005',
          messagePattern: /undefined/i,
        }
      );
    });
  });
});
