/**
 * Rill Runtime Tests: CoreMixin and AnnotationsMixin Error Contracts
 * Tests for EC-4, EC-5, EC-25, EC-26
 */

import { describe, expect, it } from 'vitest';
import {
  AbortError,
  RuntimeError,
  createRuntimeContext,
  parse,
  execute,
  type RillValue,
} from '../../src/index.js';
import { run } from '../helpers/runtime.js';

describe('Rill Runtime: CoreMixin Error Contracts', () => {
  describe('EC-4: Unsupported expression types', () => {
    it('throws RuntimeError for unsupported expression type', async () => {
      // Create a mock AST node with an unsupported type
      const ast = parse('"hello"');
      const ctx = createRuntimeContext();

      // Modify the AST to have an invalid type
      if (ast.statements[0]?.type === 'Statement') {
        const stmt = ast.statements[0];
        // @ts-expect-error Testing invalid type
        stmt.expression.head.primary.type = 'InvalidType';
      }

      await expect(execute(ast, ctx)).rejects.toThrow(RuntimeError);
      await expect(execute(ast, ctx)).rejects.toThrow(
        /Unsupported expression type/
      );
    });

    it('throws RuntimeError with correct error code for unsupported type', async () => {
      const ast = parse('"hello"');
      const ctx = createRuntimeContext();

      // Modify the AST to have an invalid type
      if (ast.statements[0]?.type === 'Statement') {
        const stmt = ast.statements[0];
        // @ts-expect-error Testing invalid type
        stmt.expression.head.primary.type = 'UnknownNode';
      }

      try {
        await execute(ast, ctx);
        expect.fail('Should have thrown RuntimeError');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const runtimeErr = err as RuntimeError;
        expect(runtimeErr.errorId).toBe('RILL-R004');
        expect(runtimeErr.message).toContain('Unsupported expression type');
        expect(runtimeErr.message).toContain('UnknownNode');
      }
    });

    it('throws RuntimeError for unsupported pipe target type', async () => {
      const ast = parse('"hello" -> .trim');
      const ctx = createRuntimeContext();

      // Modify the AST to have an invalid pipe target type
      if (ast.statements[0]?.type === 'Statement') {
        const stmt = ast.statements[0];
        if (stmt.expression.pipes.length > 0) {
          const target = stmt.expression.pipes[0];
          // @ts-expect-error Testing invalid type
          target.type = 'InvalidPipeTarget';
        }
      }

      try {
        await execute(ast, ctx);
        expect.fail('Should have thrown RuntimeError');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const runtimeErr = err as RuntimeError;
        expect(runtimeErr.errorId).toBe('RILL-R004');
        expect(runtimeErr.message).toContain('Unsupported pipe target type');
        expect(runtimeErr.message).toContain('InvalidPipeTarget');
      }
    });
  });

  describe('EC-5: Context signal aborted', () => {
    it('throws AbortError when signal aborted before execution', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        run('"test"', { signal: controller.signal })
      ).rejects.toThrow(AbortError);
    });

    it('throws AbortError with correct error code and message', async () => {
      const controller = new AbortController();
      controller.abort();

      try {
        await run('"test"', { signal: controller.signal });
        expect.fail('Should have thrown AbortError');
      } catch (err) {
        expect(err).toBeInstanceOf(AbortError);
        const abortErr = err as AbortError;
        expect(abortErr.errorId).toBe('RILL-R013');
        expect(abortErr.message).toContain('Execution aborted');
      }
    });

    it('throws AbortError when aborted during expression evaluation', async () => {
      const controller = new AbortController();
      let callCount = 0;

      const slowFn = {
        params: [],
        fn: async (): Promise<RillValue> => {
          callCount++;
          if (callCount >= 2) {
            controller.abort();
          }
          await new Promise((r) => setTimeout(r, 10));
          return callCount;
        },
      };

      await expect(
        run('slow() -> slow() -> slow()', {
          functions: { slow: slowFn },
          signal: controller.signal,
        })
      ).rejects.toThrow(AbortError);

      // Should not complete all three calls
      expect(callCount).toBeLessThan(3);
    });

    it('throws AbortError during nested expression evaluation', async () => {
      const controller = new AbortController();

      await expect(
        run('"" -> { slow() -> slow() -> slow() }', {
          functions: {
            slow: {
              params: [],
              fn: async () => {
                controller.abort();
                return 'done';
              },
            },
          },
          signal: controller.signal,
        })
      ).rejects.toThrow(AbortError);
    });

    it('checks abort signal in evaluateExpression', async () => {
      const controller = new AbortController();
      const ast = parse('"a"\n"b"\n"c"');
      const ctx = createRuntimeContext({ signal: controller.signal });

      const { createStepper } = await import('../../src/index.js');
      const stepper = createStepper(ast, ctx);

      // First step succeeds
      await stepper.step();
      expect(stepper.done).toBe(false);

      // Abort before second step
      controller.abort();

      // Second step should throw AbortError
      await expect(stepper.step()).rejects.toThrow(AbortError);
    });

    it('propagates AbortError through pipe chains', async () => {
      const controller = new AbortController();
      let callCount = 0;

      await expect(
        run('"test" -> check -> check', {
          functions: {
            check: {
              params: [{ name: 'input', type: 'string' }],
              fn: async (args) => {
                callCount++;
                if (callCount >= 1) {
                  controller.abort();
                }
                await new Promise((r) => setTimeout(r, 5));
                return args[0];
              },
            },
          },
          signal: controller.signal,
        })
      ).rejects.toThrow(AbortError);
    });
  });
});

describe('Rill Runtime: AnnotationsMixin Error Contracts', () => {
  describe('EC-25: Annotated statement execution errors', () => {
    it('propagates errors from annotated statement execution', async () => {
      await expect(run('^(limit: 10) $undefined_var')).rejects.toThrow(
        /Undefined variable/
      );
    });

    it('propagates RuntimeError with correct error code from inner statement', async () => {
      try {
        await run('^(limit: 5) "" -> { $missing }');
        expect.fail('Should have thrown RuntimeError');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const runtimeErr = err as RuntimeError;
        expect(runtimeErr.errorId).toBe('RILL-R005');
        expect(runtimeErr.message).toContain('Undefined variable');
      }
    });

    it('propagates type errors from annotated statement', async () => {
      await expect(run('^(limit: 10) "string" + 5')).rejects.toThrow(
        RuntimeError
      );
    });

    it('propagates errors from nested annotated statements', async () => {
      const script = `
        ^(limit: 100) "" -> {
          ^(limit: 50) "" -> {
            $nonexistent
          }
        }
      `;
      await expect(run(script)).rejects.toThrow(/Undefined variable/);
    });

    it('propagates custom function errors from annotated statement', async () => {
      await expect(
        run('^(limit: 10) fail()', {
          functions: {
            fail: {
              params: [],
              fn: () => {
                throw new Error('Custom error');
              },
            },
          },
        })
      ).rejects.toThrow('Custom error');
    });

    it('propagates AbortError from annotated statement', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        run('^(limit: 10) "test"', { signal: controller.signal })
      ).rejects.toThrow(AbortError);
    });

    it('preserves error location from inner statement', async () => {
      // Multiline script with annotated statement
      const script = `5 => $x
^(limit: 5) $undefined`;
      try {
        await run(script);
        expect.fail('Should have thrown RuntimeError');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const runtimeErr = err as RuntimeError;
        expect(runtimeErr.location).toBeDefined();
        expect(runtimeErr.location?.line).toBe(2); // Error on line 2
      }
    });
  });

  describe('EC-26: Annotation evaluation errors', () => {
    it('propagates errors from annotation value evaluation', async () => {
      await expect(run('^(limit: $undefined_var) "test"')).rejects.toThrow(
        /Undefined variable/
      );
    });

    it('propagates RuntimeError with correct error code from annotation', async () => {
      try {
        await run('^(limit: $missing) "test"');
        expect.fail('Should have thrown RuntimeError');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const runtimeErr = err as RuntimeError;
        expect(runtimeErr.errorId).toBe('RILL-R005');
      }
    });

    it('propagates errors from annotation expression evaluation', async () => {
      await expect(run('^(limit: "string" + 5) "test"')).rejects.toThrow(
        RuntimeError
      );
    });

    it('propagates errors from annotation function calls', async () => {
      await expect(
        run('^(limit: fail()) "test"', {
          functions: {
            fail: {
              params: [],
              fn: () => {
                throw new Error('Annotation error');
              },
            },
          },
        })
      ).rejects.toThrow('Annotation error');
    });

    it('throws error for invalid spread annotation type', async () => {
      try {
        await run('[1, 2, 3] => $list\n^(*$list) "test"');
        expect.fail('Should have thrown RuntimeError');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const runtimeErr = err as RuntimeError;
        expect(runtimeErr.errorId).toBe('RILL-R002');
        expect(runtimeErr.message).toContain('Annotation spread requires dict');
      }
    });

    it('throws error for spread annotation with non-dict string', async () => {
      try {
        await run('"string" => $s\n^(*$s) "test"');
        expect.fail('Should have thrown RuntimeError');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const runtimeErr = err as RuntimeError;
        expect(runtimeErr.errorId).toBe('RILL-R002');
        expect(runtimeErr.message).toContain('Annotation spread requires dict');
      }
    });

    it('propagates errors from spread annotation evaluation', async () => {
      await expect(run('^(*$undefined) "test"')).rejects.toThrow(
        /Undefined variable/
      );
    });

    it('propagates errors from complex annotation expressions', async () => {
      await expect(
        run('^(limit: getLimit()) "test"', {
          functions: {
            getLimit: {
              params: [],
              fn: () => {
                throw new Error('Failed to get limit');
              },
            },
          },
        })
      ).rejects.toThrow('Failed to get limit');
    });

    it('preserves error location from annotation evaluation', async () => {
      try {
        await run('^(limit: $missing) "test"');
        expect.fail('Should have thrown RuntimeError');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const runtimeErr = err as RuntimeError;
        expect(runtimeErr.location).toBeDefined();
        // Error should be on line 1 where annotation is
        expect(runtimeErr.location?.line).toBe(1);
      }
    });
  });

  describe('Annotation error cleanup', () => {
    it('pops annotation stack even when statement execution fails', async () => {
      const ctx = createRuntimeContext();
      const ast = parse('^(limit: 5) $undefined');

      try {
        await execute(ast, ctx);
        expect.fail('Should have thrown');
      } catch {
        // Annotation stack should be empty after error
        expect(ctx.annotationStack).toHaveLength(0);
      }
    });

    it('restores annotation stack to correct state after nested error', async () => {
      const ctx = createRuntimeContext();
      const script = `
        ^(limit: 100) "" -> {
          ^(limit: 10) $undefined
        }
      `;
      const ast = parse(script);

      try {
        await execute(ast, ctx);
        expect.fail('Should have thrown');
      } catch {
        // Stack should be empty after error unwinding
        expect(ctx.annotationStack).toHaveLength(0);
      }
    });
  });
});
