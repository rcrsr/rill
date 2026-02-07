/**
 * Boundary condition tests for executeRill
 *
 * Tests large inputs, deep nesting, and execution timeouts to ensure
 * the fiddle handles extreme cases gracefully.
 */

import { describe, it, expect } from 'vitest';
import { executeRill } from '../execution.js';

describe('executeRill', () => {
  describe('boundary conditions', () => {
    describe('large source input', () => {
      it('executes 10KB source without freezing [AC-18]', async () => {
        // Generate source exceeding 10KB
        // Strategy: Create a script with many variable assignments
        const lines: string[] = [];
        let currentSize = 0;
        let counter = 0;

        // Build source until we exceed 10KB
        while (currentSize < 10 * 1024) {
          const line = `${counter} => $var${counter}\n`;
          lines.push(line);
          currentSize += line.length;
          counter++;
        }

        // Add final expression to return a value
        lines.push('42');

        const largeSource = lines.join('');

        // Verify we actually created 10KB+ source
        expect(largeSource.length).toBeGreaterThanOrEqual(10 * 1024);

        // Execute large source
        const result = await executeRill(largeSource);

        // Should complete without error
        expect(result.status).toBe('success');
        expect(result.result).toBe('42');
        expect(result.error).toBe(null);
        expect(result.duration).not.toBe(null);
        expect(result.duration).toBeGreaterThanOrEqual(0);
      }, 10000); // 10 second timeout for test itself

      it('handles large source with many operations', async () => {
        // Create 10KB of actual computations
        const operations: string[] = [];
        let currentSize = 0;

        // Build chain of additions
        while (currentSize < 10 * 1024) {
          const line = '1 + 1\n';
          operations.push(line);
          currentSize += line.length;
        }

        // Add final expression
        operations.push('42');

        const largeSource = operations.join('');

        expect(largeSource.length).toBeGreaterThanOrEqual(10 * 1024);

        const result = await executeRill(largeSource);

        expect(result.status).toBe('success');
        expect(result.result).toBe('42');
        expect(result.error).toBe(null);
      }, 10000);
    });

    describe('deep nesting', () => {
      it('executes 50-level nested expression within 500ms or reports error [AC-19]', async () => {
        // Build deeply nested arithmetic expression: ((((...(1 + 1)...))))
        const depth = 50;
        let source = '1';

        for (let i = 0; i < depth; i++) {
          source = `(${source} + 1)`;
        }

        const startTime = performance.now();
        const result = await executeRill(source);
        const executionTime = performance.now() - startTime;

        // Should either:
        // 1. Complete successfully within 500ms
        // 2. Report an error (stack depth, timeout, etc.)

        if (result.status === 'success') {
          // Success path: must complete within 500ms
          expect(executionTime).toBeLessThan(500);
          expect(result.result).toBe(String(1 + depth)); // 1 + 50 additions
          expect(result.error).toBe(null);
        } else {
          // Error path: acceptable to fail on deep nesting
          expect(result.status).toBe('error');
          expect(result.error).not.toBe(null);
          expect(result.error?.message).toBeTruthy();
        }
      }, 10000);

      it('handles deeply nested conditionals', async () => {
        // Build nested conditionals: true ? (true ? (true ? ... 1 ! 0) ! 0) ! 0
        const depth = 50;
        let source = '1';

        for (let i = 0; i < depth; i++) {
          source = `true ? ${source} ! 0`;
        }

        const result = await executeRill(source);

        // Either succeeds or fails gracefully
        if (result.status === 'success') {
          expect(result.result).toBe('1');
        } else {
          expect(result.error).not.toBe(null);
        }
      }, 10000);

      it('handles deeply nested arrays', async () => {
        // Build nested arrays: [[[...[42]...]]]
        const depth = 50;
        let source = '42';

        for (let i = 0; i < depth; i++) {
          source = `[${source}]`;
        }

        const result = await executeRill(source);

        // Either succeeds or fails gracefully
        if (result.status === 'success') {
          expect(result.result).toBeTruthy();
        } else {
          expect(result.error).not.toBe(null);
        }
      }, 10000);

      it('handles deeply nested dicts', async () => {
        // Build nested dicts: [x: [x: [x: ... [x: 42]]]]
        const depth = 50;
        let source = '42';

        for (let i = 0; i < depth; i++) {
          source = `[x: ${source}]`;
        }

        const result = await executeRill(source);

        // Either succeeds or fails gracefully
        if (result.status === 'success') {
          expect(result.result).toBeTruthy();
        } else {
          expect(result.error).not.toBe(null);
        }
      }, 10000);
    });

    describe('execution timeout', () => {
      it('triggers iteration limit error for infinite loop [AC-25]', async () => {
        // Create infinite while loop that exceeds iteration limit
        // Syntax: cond @ body (while loop)
        // Default iteration limit is 10,000
        const infiniteLoop = `
          0 => $counter
          $counter -> ($ < 20000) @ {
            $ + 1
          }
        `;

        const result = await executeRill(infiniteLoop);

        // Should fail with iteration limit error
        expect(result.status).toBe('error');
        expect(result.error).not.toBe(null);
        expect(result.error?.category).toBe('runtime');
        expect(result.error?.message).toContain('exceeded');

        // Duration should be recorded
        expect(result.duration).not.toBe(null);
        expect(result.duration).toBeGreaterThanOrEqual(0);
      }, 10000);

      it('triggers iteration limit for large range expansion', async () => {
        // Create a very large range that will exceed iteration limit
        // Default limit is 10,000 iterations
        const longRunning = `
          range(1, 1000000) -> each {
            $ * 2
          }
        `;

        const result = await executeRill(longRunning);

        // Should fail with iteration limit error
        expect(result.status).toBe('error');
        expect(result.error).not.toBe(null);
        expect(result.error?.category).toBe('runtime');
        expect(result.error?.message).toBeTruthy();
      }, 10000);

      it('completes operations within iteration limit', async () => {
        // Operation well under 10,000 iteration limit
        const quickOperation = `
          range(1, 100) -> map { $ * 2 }
        `;

        const result = await executeRill(quickOperation);

        // Should succeed
        expect(result.status).toBe('success');
        expect(result.error).toBe(null);
        expect(result.duration).not.toBe(null);
        expect(result.duration).toBeGreaterThanOrEqual(0);
      });

      it('handles do-while loop with break before exceeding limit', async () => {
        // Do-while syntax: @ body ? cond
        // Use break to exit after a reasonable number of iterations
        const doWhileLoop = `
          0 -> @ {
            ($ + 1) -> ($ >= 100) ? break ! $
          } ? ($ < 1000)
        `;

        const result = await executeRill(doWhileLoop);

        // Should succeed with break value
        expect(result.status).toBe('success');
        expect(result.result).toBe('100');
        expect(result.error).toBe(null);
      });

      it('completes loop within iteration limit', async () => {
        // Loop that completes successfully
        const finiteLoop = `
          0 -> ($ < 100) @ {
            $ + 1
          }
        `;

        const result = await executeRill(finiteLoop);

        // Should succeed
        expect(result.status).toBe('success');
        expect(result.result).toBe('100');
        expect(result.error).toBe(null);
      });
    });

    describe('combined boundary conditions', () => {
      it('handles large source with deep nesting', async () => {
        // Combine large source size with moderate nesting
        const baseNesting = 20; // Moderate depth
        let nestedExpr = '1';

        for (let i = 0; i < baseNesting; i++) {
          nestedExpr = `(${nestedExpr} + 1)`;
        }

        // Repeat this pattern many times to reach 10KB
        const lines: string[] = [];
        let currentSize = 0;

        while (currentSize < 10 * 1024) {
          const line = `${nestedExpr} => $val${lines.length}\n`;
          lines.push(line);
          currentSize += line.length;
        }

        lines.push('42');
        const combinedSource = lines.join('');

        expect(combinedSource.length).toBeGreaterThanOrEqual(10 * 1024);

        const result = await executeRill(combinedSource);

        // Either succeeds or fails gracefully
        if (result.status === 'success') {
          expect(result.result).toBe('42');
        } else {
          expect(result.error).not.toBe(null);
        }
      }, 15000);

      it('handles many variables with deep nesting', async () => {
        // Create many variables, each with nested expressions
        const lines: string[] = [];

        for (let i = 0; i < 100; i++) {
          let nested = `${i}`;
          for (let j = 0; j < 10; j++) {
            nested = `(${nested} + 1)`;
          }
          lines.push(`${nested} => $var${i}`);
        }

        lines.push('42');
        const source = lines.join('\n');

        const result = await executeRill(source);

        if (result.status === 'success') {
          expect(result.result).toBe('42');
        } else {
          expect(result.error).not.toBe(null);
        }
      }, 10000);
    });

    describe('edge cases with boundary conditions', () => {
      it('handles simple operations in large source', async () => {
        // Large source with many simple operations
        const lines: string[] = [];
        let currentSize = 0;

        while (currentSize < 10 * 1024) {
          const line = '1 + 1\n';
          lines.push(line);
          currentSize += line.length;
        }

        lines.push('"done"');
        const source = lines.join('');

        const result = await executeRill(source);

        expect(result.status).toBe('success');
        expect(result.result).toBe('done');
      }, 10000);

      it('handles deeply nested empty arrays', async () => {
        const depth = 50;
        let source = '[]';

        for (let i = 0; i < depth; i++) {
          source = `[${source}]`;
        }

        const result = await executeRill(source);

        if (result.status === 'success') {
          expect(result.result).toBeTruthy();
        } else {
          expect(result.error).not.toBe(null);
        }
      }, 10000);

      it('handles large strings in source', async () => {
        // Create a very large string literal
        const largeString = 'x'.repeat(10 * 1024);
        const source = `"${largeString}"`;

        const result = await executeRill(source);

        expect(result.status).toBe('success');
        expect(result.result).toBe(largeString);
      }, 10000);
    });
  });
});
