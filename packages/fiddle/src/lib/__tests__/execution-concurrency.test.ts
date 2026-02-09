/**
 * Tests for execution concurrency and output correctness
 *
 * Tests log output capture, re-execution clearing, and rapid re-execution
 * to ensure the fiddle handles concurrent operations correctly.
 *
 * Covers:
 * - AC-9: Log output capture
 * - AC-11: Re-execution clears previous output
 * - AC-23: Rapid re-execution does not duplicate output entries
 */

import { describe, it, expect } from 'vitest';
import { executeRill } from '../execution.js';

describe('executeRill', () => {
  describe('log output capture [AC-9]', () => {
    it('captures single log() call in output panel', async () => {
      const result = await executeRill('"test message" -> log\n"final"');

      expect(result.status).toBe('success');
      expect(result.logs).toEqual(['test message']);
      expect(result.result).toBe('final');
      expect(result.error).toBe(null);
    });

    it('captures multiple log() calls in order', async () => {
      const result = await executeRill(
        '"first" -> log\n"second" -> log\n"third" -> log\n"final"'
      );

      expect(result.status).toBe('success');
      expect(result.logs).toEqual(['first', 'second', 'third']);
      expect(result.result).toBe('final');
      expect(result.error).toBe(null);
    });

    it('captures log() with different value types', async () => {
      const result = await executeRill(
        '42 -> log\ntrue -> log\n"string" -> log\n[1, 2, 3] -> log\n"done"'
      );

      expect(result.status).toBe('success');
      expect(result.logs.length).toBe(4);
      expect(result.logs[0]).toBe('42');
      expect(result.logs[1]).toBe('true');
      expect(result.logs[2]).toBe('string');
      expect(result.logs[3]).toContain('1');
      expect(result.logs[3]).toContain('2');
      expect(result.logs[3]).toContain('3');
      expect(result.result).toBe('done');
    });

    it('captures log() output from loop iterations', async () => {
      const result = await executeRill(
        'range(1, 4) -> each { $ -> log }\n"done"'
      );

      expect(result.status).toBe('success');
      expect(result.logs).toEqual(['1', '2', '3']);
      expect(result.result).toBe('done');
    });

    it('captures log() output from conditional branches', async () => {
      const result = await executeRill(
        'true ? { "yes" -> log } ! { "no" -> log }\n"final"'
      );

      expect(result.status).toBe('success');
      expect(result.logs).toEqual(['yes']);
      expect(result.result).toBe('final');
    });

    it('captures log() output from piped expressions', async () => {
      const result = await executeRill(
        '"first" -> log\n"second" -> log -> .len -> log\n"done"'
      );

      expect(result.status).toBe('success');
      expect(result.logs).toEqual(['first', 'second', '6']);
      expect(result.result).toBe('done');
    });

    it('handles log() with zero value', async () => {
      const result = await executeRill('0 -> log\n"final"');

      expect(result.status).toBe('success');
      expect(result.logs).toEqual(['0']);
      expect(result.result).toBe('final');
    });

    it('handles log() with empty string', async () => {
      const result = await executeRill('"" -> log\n"final"');

      expect(result.status).toBe('success');
      expect(result.logs).toEqual(['']);
      expect(result.result).toBe('final');
    });

    it('handles log() with multiline string', async () => {
      const result = await executeRill(
        '"line1\\nline2\\nline3" -> log\n"final"'
      );

      expect(result.status).toBe('success');
      expect(result.logs.length).toBe(1);
      expect(result.logs[0]).toContain('line1');
      expect(result.logs[0]).toContain('line2');
      expect(result.logs[0]).toContain('line3');
      expect(result.result).toBe('final');
    });

    it('returns only final value when no log() calls', async () => {
      const result = await executeRill('42 + 8');

      expect(result.status).toBe('success');
      expect(result.logs).toEqual([]);
      expect(result.result).toBe('50');
    });
  });

  describe('re-execution clears previous output [AC-11]', () => {
    it('clears previous output on second execution', async () => {
      // First execution
      const firstResult = await executeRill('"first run" -> log\n"result1"');
      expect(firstResult.status).toBe('success');
      expect(firstResult.logs).toEqual(['first run']);
      expect(firstResult.result).toBe('result1');

      // Second execution - should not contain first run output
      const secondResult = await executeRill('"second run" -> log\n"result2"');
      expect(secondResult.status).toBe('success');
      expect(secondResult.logs).toEqual(['second run']);
      expect(secondResult.result).toBe('result2');
    });

    it('clears previous error on successful re-execution', async () => {
      // First execution with error
      const firstResult = await executeRill('$undefined_variable');
      expect(firstResult.status).toBe('error');
      expect(firstResult.error).not.toBe(null);

      // Second execution with success
      const secondResult = await executeRill('"success"');
      expect(secondResult.status).toBe('success');
      expect(secondResult.result).toBe('success');
      expect(secondResult.error).toBe(null);
    });

    it('clears previous success on error re-execution', async () => {
      // First execution with success
      const firstResult = await executeRill('"success" -> log\n42');
      expect(firstResult.status).toBe('success');
      expect(firstResult.logs).toEqual(['success']);
      expect(firstResult.result).toBe('42');

      // Second execution with error
      const secondResult = await executeRill('$undefined_variable');
      expect(secondResult.status).toBe('error');
      expect(secondResult.error).not.toBe(null);
      expect(secondResult.result).toBe(null);
      expect(secondResult.logs).toEqual([]);
    });

    it('clears logs from previous execution', async () => {
      // First execution with multiple logs
      const firstResult = await executeRill(
        '"log1" -> log\n"log2" -> log\n"log3" -> log\n"result1"'
      );
      expect(firstResult.status).toBe('success');
      expect(firstResult.logs).toEqual(['log1', 'log2', 'log3']);
      expect(firstResult.result).toBe('result1');

      // Second execution with different logs
      const secondResult = await executeRill('"newlog" -> log\n"result2"');
      expect(secondResult.status).toBe('success');
      expect(secondResult.logs).toEqual(['newlog']);
      expect(secondResult.result).toBe('result2');
    });

    it('starts with fresh duration on re-execution', async () => {
      // First execution
      const firstResult = await executeRill('42');
      expect(firstResult.duration).not.toBe(null);

      // Second execution
      const secondResult = await executeRill('84');
      expect(secondResult.duration).not.toBe(null);
      // Durations should be independent measurements
      expect(secondResult.duration).toBeGreaterThanOrEqual(0);
      // Don't assume second is faster or slower, just that it's measured independently
    });

    it('clears idle status on execution', async () => {
      // First execution - idle (empty source)
      const firstResult = await executeRill('');
      expect(firstResult.status).toBe('idle');
      expect(firstResult.result).toBe(null);

      // Second execution - success
      const secondResult = await executeRill('"active"');
      expect(secondResult.status).toBe('success');
      expect(secondResult.result).toBe('active');
    });
  });

  describe('rapid re-execution does not duplicate output [AC-23]', () => {
    it('does not duplicate output from rapid sequential executions', async () => {
      // Execute same source rapidly multiple times
      const source = '"output" -> log\n"final"';

      const results = await Promise.all([
        executeRill(source),
        executeRill(source),
        executeRill(source),
      ]);

      // Each result should be independent with no duplication
      for (const result of results) {
        expect(result.status).toBe('success');
        expect(result.logs).toEqual(['output']);
        expect(result.result).toBe('final');
      }
    });

    it('does not accumulate logs across rapid executions', async () => {
      // Execute different sources rapidly
      const executions = [
        executeRill('"first" -> log\n1'),
        executeRill('"second" -> log\n2'),
        executeRill('"third" -> log\n3'),
      ];

      const results = await Promise.all(executions);

      // First result should only contain "first"
      expect(results[0]?.status).toBe('success');
      expect(results[0]?.logs).toEqual(['first']);
      expect(results[0]?.result).toBe('1');

      // Second result should only contain "second"
      expect(results[1]?.status).toBe('success');
      expect(results[1]?.logs).toEqual(['second']);
      expect(results[1]?.result).toBe('2');

      // Third result should only contain "third"
      expect(results[2]?.status).toBe('success');
      expect(results[2]?.logs).toEqual(['third']);
      expect(results[2]?.result).toBe('3');
    });

    it('maintains independent log arrays for concurrent executions', async () => {
      // Execute sources with different numbers of log calls
      const executions = [
        executeRill('"a" -> log\n"b" -> log\n"result-ab"'),
        executeRill('"x" -> log\n"result-x"'),
        executeRill('"1" -> log\n"2" -> log\n"3" -> log\n"result-123"'),
      ];

      const results = await Promise.all(executions);

      // Verify each has correct log count and result
      expect(results[0]?.logs).toEqual(['a', 'b']);
      expect(results[0]?.result).toBe('result-ab');
      expect(results[1]?.logs).toEqual(['x']);
      expect(results[1]?.result).toBe('result-x');
      expect(results[2]?.logs).toEqual(['1', '2', '3']);
      expect(results[2]?.result).toBe('result-123');
    });

    it('handles rapid re-execution with errors', async () => {
      // Mix successful and failing executions
      const executions = [
        executeRill('"success1" -> log\n42'),
        executeRill('$undefined'),
        executeRill('"success2" -> log\n84'),
      ];

      const results = await Promise.all(executions);

      // First execution succeeds
      expect(results[0]?.status).toBe('success');
      expect(results[0]?.logs).toEqual(['success1']);
      expect(results[0]?.result).toBe('42');

      // Second execution fails
      expect(results[1]?.status).toBe('error');
      expect(results[1]?.error).not.toBe(null);
      expect(results[1]?.logs).toEqual([]);

      // Third execution succeeds independently
      expect(results[2]?.status).toBe('success');
      expect(results[2]?.logs).toEqual(['success2']);
      expect(results[2]?.result).toBe('84');
    });

    it('maintains isolated log state across 10 rapid executions', async () => {
      // Execute 10 times with unique identifiers
      const executions = Array.from({ length: 10 }, (_, i) =>
        executeRill(`"log${i}" -> log\n${i}`)
      );

      const results = await Promise.all(executions);

      // Verify each execution has only its own output
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        expect(result?.status).toBe('success');
        expect(result?.logs).toEqual([`log${i}`]);
        expect(result?.result).toBe(`${i}`);
      }
    });

    it('handles rapid re-execution with large log output', async () => {
      // Generate sources with many log calls
      const createSource = (prefix: string, count: number) => {
        const logs = Array.from(
          { length: count },
          (_, i) => `"${prefix}${i}" -> log`
        ).join('\n');
        return `${logs}\n"done-${prefix}"`;
      };

      const executions = [
        executeRill(createSource('a', 10)),
        executeRill(createSource('b', 10)),
        executeRill(createSource('c', 10)),
      ];

      const results = await Promise.all(executions);

      // Verify each has exactly 10 logs + final value
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        expect(result?.status).toBe('success');
        expect(result?.logs.length).toBe(10);
      }
    });
  });

  describe('output correctness under concurrency', () => {
    it('preserves log order within single execution', async () => {
      const result = await executeRill(
        '"a" -> log\n"b" -> log\n"c" -> log\n"d" -> log\n"e" -> log\n"final"'
      );

      expect(result.status).toBe('success');
      expect(result.logs).toEqual(['a', 'b', 'c', 'd', 'e']);
      expect(result.result).toBe('final');
    });

    it('maintains correct final value position after logs', async () => {
      const result = await executeRill(
        '"log1" -> log\n"log2" -> log\n"final value"'
      );

      expect(result.status).toBe('success');
      expect(result.logs).toEqual(['log1', 'log2']);
      expect(result.result).toBe('final value');
    });

    it('handles concurrent executions with different log patterns', async () => {
      // Different patterns: no logs, single log, multiple logs
      const executions = [
        executeRill('42'), // no logs
        executeRill('"single" -> log\n84'), // single log
        executeRill('"m1" -> log\n"m2" -> log\n"m3" -> log\n126'), // multiple logs
      ];

      const results = await Promise.all(executions);

      expect(results[0]?.logs).toEqual([]);
      expect(results[0]?.result).toBe('42');
      expect(results[1]?.logs).toEqual(['single']);
      expect(results[1]?.result).toBe('84');
      expect(results[2]?.logs).toEqual(['m1', 'm2', 'm3']);
      expect(results[2]?.result).toBe('126');
    });
  });
});
