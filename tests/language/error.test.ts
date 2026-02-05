/**
 * Rill Language Tests: Error Statement
 * Tests for error statement syntax and behavior
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Language: Error Statement', () => {
  describe('Success Cases', () => {
    it('throws with direct error and string message (AC-1)', async () => {
      await expect(run('error "test"')).rejects.toThrow('test');
    });

    it('throws with RuntimeError code RILL-R016 (AC-1)', async () => {
      try {
        await run('error "test"');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.errorId).toBe('RILL-R016');
        // Note: Error message includes location " at 1:1"
        expect(err.message).toContain('test');
      }
    });

    it('evaluates string interpolation in message (AC-3)', async () => {
      await expect(run('error "Status: {404}"')).rejects.toThrow('Status: 404');
    });

    it('throws when in conditional then branch (AC-4)', async () => {
      await expect(run('true ? { error "msg" }')).rejects.toThrow('msg');
    });

    it('does not execute in false conditional branch (AC-5)', async () => {
      expect(await run('false ? { error "msg" } ! "ok"')).toBe('ok');
    });

    it('throws with piped string form (AC-2)', async () => {
      try {
        await run('"failed" -> error');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.errorId).toBe('RILL-R016');
        expect(err.message).toContain('failed');
      }
    });
  });

  describe('Error Cases - Type Validation', () => {
    it('throws RILL-P004 for number message (AC-ERR-1)', async () => {
      try {
        await run('error 123');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.errorId).toBe('RILL-P004');
        expect(err.message).toContain('requires string message');
      }
    });

    it('throws RILL-P004 for boolean message (AC-ERR-2)', async () => {
      try {
        await run('error true');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.errorId).toBe('RILL-P004');
        expect(err.message).toContain('requires string message');
      }
    });

    it('throws RILL-P004 for list message (AC-ERR-3)', async () => {
      try {
        await run('error [1, 2]');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.errorId).toBe('RILL-P004');
        expect(err.message).toContain('requires string message');
      }
    });

    it('throws RILL-R002 when piping number (AC-ERR-4)', async () => {
      try {
        await run('42 -> error');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.errorId).toBe('RILL-R002');
        expect(err.message).toContain('requires string message');
        expect(err.message).toContain('got number');
      }
    });
  });

  describe('Boundary Conditions', () => {
    it('accepts empty string message (AC-BOUND-1)', async () => {
      try {
        await run('error ""');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.errorId).toBe('RILL-R016');
        // Error message is empty but includes location
        expect(err.message).toMatch(/^ at \d+:\d+$/);
      }
    });

    it('accepts long message (AC-BOUND-2)', async () => {
      const longMessage = 'x'.repeat(1024);
      const script = `error "${longMessage}"`;
      try {
        await run(script);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.errorId).toBe('RILL-R016');
        const message = err instanceof Error ? err.message : String(err);
        expect(message).toContain(longMessage);
      }
    });

    it('throws from nested blocks (AC-BOUND-3)', async () => {
      await expect(run('"" -> { "" -> { error "deep" } }')).rejects.toThrow(
        'deep'
      );
    });

    it('throws on first iteration in each loop (AC-BOUND-4)', async () => {
      await expect(run('[1, 2] -> each { error "stop" }')).rejects.toThrow(
        'stop'
      );
    });

    it('throws from closure when invoked with condition (AC-BOUND-5)', async () => {
      const script = `
        |x|{ ($x < 0) ? { error "negative" } ! $x } :> $check
        -5 -> $check()
      `;
      await expect(run(script)).rejects.toThrow('negative');
    });

    it('does not throw from closure when condition false', async () => {
      const script = `
        |x|{ ($x < 0) ? { error "negative" } ! $x } :> $check
        5 -> $check()
      `;
      expect(await run(script)).toBe(5);
    });
  });

  describe('Source Location Accuracy', () => {
    it('includes location in error on multiline script (AC-LOC-1)', async () => {
      const script = `
        "line 1"
        "line 2"
        "line 3"
        "line 4"
        error "line 5 error"
        "line 6"
      `;
      try {
        await run(script);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err).toHaveProperty('location');
        const location = err.location;
        expect(location).toBeDefined();
        // Error is on line 6 (after blank line 1)
        expect(location.line).toBeGreaterThanOrEqual(5);
      }
    });

    it('includes location for nested block error (AC-LOC-2)', async () => {
      const script = `
        "" -> {
          "" -> {
            error "nested error"
          }
        }
      `;
      try {
        await run(script);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err).toHaveProperty('location');
        const location = err.location;
        expect(location).toBeDefined();
        expect(location.line).toBeGreaterThanOrEqual(1);
      }
    });

    it('includes location with line and column info', async () => {
      try {
        await run('error "test"');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err).toHaveProperty('location');
        const location = err.location;
        expect(location).toHaveProperty('line');
        expect(location).toHaveProperty('column');
      }
    });
  });

  describe('Error Contract Validation', () => {
    it('handles error with interpolated variables', async () => {
      const script = `
        404 :> $code
        "Not Found" :> $msg
        error "Error {$code}: {$msg}"
      `;
      await expect(run(script)).rejects.toThrow('Error 404: Not Found');
    });

    it('throws RILL-R016 for direct form (EC-4)', async () => {
      try {
        await run('error "test"');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.errorId).toBe('RILL-R016');
      }
    });

    it('preserves multiline message formatting', async () => {
      const script = `
        error """
        Error occurred:
        - Line 1
        - Line 2
        """
      `;
      try {
        await run(script);
        expect.fail('Should have thrown');
      } catch (err: any) {
        const message = err instanceof Error ? err.message : String(err);
        expect(message).toContain('Error occurred:');
        expect(message).toContain('- Line 1');
        expect(message).toContain('- Line 2');
      }
    });

    it('throws from map operator on conditional error', async () => {
      const script = `
        [1, 2, 3] -> map {
          ($ == 2) ? { error "failed at 2" }
          $ * 2
        }
      `;
      await expect(run(script)).rejects.toThrow('failed at 2');
    });

    it('throws from filter operator on conditional error', async () => {
      const script = `
        [1, 2, 3] -> filter {
          ($ == 2) ? { error "filter error" }
          $ > 1
        }
      `;
      await expect(run(script)).rejects.toThrow('filter error');
    });

    it('throws from while loop body', async () => {
      const script = `
        1 -> ($ <= 5) @ {
          ($ == 3) ? { error "loop halted" }
          $ + 1
        }
      `;
      await expect(run(script)).rejects.toThrow('loop halted');
    });

    it('throws from fold operator accumulator', async () => {
      const script = `
        [1, 2, 3] -> fold(0) {
          ($ == 2) ? { error "fold error" }
          $@ + $
        }
      `;
      await expect(run(script)).rejects.toThrow('fold error');
    });
  });

  describe('Integration with Other Features', () => {
    it('works with conditional ternary operator', async () => {
      await expect(
        run('5 :> $x\n($x > 10) ? { error "too large" } ! $x')
      ).resolves.toBe(5);
    });

    it('throws when condition is true', async () => {
      await expect(
        run('15 :> $x\n($x > 10) ? { error "too large" } ! $x')
      ).rejects.toThrow('too large');
    });

    it('works with type checks in message', async () => {
      const script = `
        42 :> $val
        error "Value {$val} is {type($val)}"
      `;
      await expect(run(script)).rejects.toThrow('Value 42 is number');
    });

    it('works with method calls in interpolation', async () => {
      const script = `
        "hello world" :> $text
        error "Length: {$text -> .len}"
      `;
      await expect(run(script)).rejects.toThrow('Length: 11');
    });

    it('works with default operator in message', async () => {
      const script = `
        [name: "test"] :> $obj
        error "Value: {$obj.missing ?? "not found"}"
      `;
      await expect(run(script)).rejects.toThrow('Value: not found');
    });

    it('halts execution immediately (does not continue)', async () => {
      const script = `
        "step 1" :> $step1
        error "halted"
        "step 2" :> $step2
      `;
      try {
        await run(script);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).toContain('halted');
      }
    });
  });

  describe('Edge Cases', () => {
    it('works with dict message values via interpolation', async () => {
      const script = `
        [code: 500, msg: "Server Error"] :> $err
        error "{$err.code}: {$err.msg}"
      `;
      await expect(run(script)).rejects.toThrow('500: Server Error');
    });

    it('works with list message values via interpolation', async () => {
      const script = `
        [1, 2, 3] :> $items
        error "Items: {$items}"
      `;
      await expect(run(script)).rejects.toThrow('Items: [1,2,3]');
    });

    it('works with arithmetic in interpolation', async () => {
      const script = `
        5 :> $a
        3 :> $b
        error "Sum: {$a + $b}"
      `;
      await expect(run(script)).rejects.toThrow('Sum: 8');
    });

    it('works with comparison in interpolation', async () => {
      const script = `
        5 :> $val
        error "Valid: {$val > 0}"
      `;
      await expect(run(script)).rejects.toThrow('Valid: true');
    });

    it('works in do-while loop', async () => {
      const script = `
        1 -> @ {
          ($ == 3) ? { error "stopped" }
          $ + 1
        } ? ($ < 5)
      `;
      await expect(run(script)).rejects.toThrow('stopped');
    });

    it('works in nested each loops', async () => {
      const script = `
        [1, 2] -> each {
          [10, 20] -> each {
            ($ == 20) ? { error "inner error" }
            $
          }
        }
      `;
      await expect(run(script)).rejects.toThrow('inner error');
    });

    it('throws with special characters in message', async () => {
      await expect(run('error "Error: \\n\\t special"')).rejects.toThrow(
        'Error: \n\t special'
      );
    });

    it('throws with unicode in message', async () => {
      await expect(run('error "错误 🚨"')).rejects.toThrow('错误 🚨');
    });
  });

  describe('Parse Error Conditions', () => {
    it('rejects error without message (EC-2)', async () => {
      try {
        await run('error');
        expect.fail('Should have thrown');
      } catch (err: any) {
        // Note: Implementation throws RILL-P002 (Unexpected end of input)
        expect(err.errorId).toBe('RILL-P002');
        expect(err.message).toContain('expected string');
      }
    });

    it('rejects error with variable instead of literal', async () => {
      try {
        await run('"test" :> $msg\nerror $msg');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.errorId).toBe('RILL-P004');
      }
    });

    it('rejects error with expression instead of literal', async () => {
      try {
        await run('error ("test" -> .upper)');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.errorId).toBe('RILL-P004');
      }
    });
  });
});
