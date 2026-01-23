/**
 * Rill Runtime Tests: Evaluator Base Class and Mixin Infrastructure
 * Tests for error contracts and boundary conditions in the evaluator architecture
 *
 * Covers:
 * - EC-1: RuntimeError from base class methods (type errors, undefined variables/functions)
 * - EC-3: TimeoutError when async operations exceed configured timeout
 * - EC-6: String interpolation error propagation from evaluateExpression()
 * - EC-7: Dict/tuple evaluation error propagation from nested expressions
 * - EC-22: Arithmetic type mismatch errors
 * - EC-23: Nested expression propagation
 * - EC-24: Type assertion failures
 * - AC-6: Mixin type inference failure (caught by typecheck)
 * - AC-10: Type assertion failure with expected vs actual
 * - AC-14: Single-mixin composition (Base + CoreMixin) boundary
 */

import { describe, expect, it } from 'vitest';
import { RuntimeError, TimeoutError } from '../../src/index.js';
import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Evaluator Base Class', () => {
  describe('RuntimeError from base class methods (EC-1)', () => {
    it('throws RuntimeError for undefined variable', async () => {
      try {
        await run('$undefined');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const runtimeErr = err as RuntimeError;
        expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_VARIABLE');
        expect(runtimeErr.message).toContain('Undefined variable');
      }
    });

    it('throws RuntimeError for undefined function', async () => {
      try {
        await run('undefined_func()');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const runtimeErr = err as RuntimeError;
        expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_FUNCTION');
        expect(runtimeErr.message).toContain('undefined_func');
      }
    });

    it('throws RuntimeError for type mismatch on variable reassignment', async () => {
      try {
        await run('"hello" :> $x\n42 :> $x');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const runtimeErr = err as RuntimeError;
        expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
        expect(runtimeErr.message).toContain('Type mismatch');
      }
    });

    it('throws RuntimeError for type assertion failure', async () => {
      try {
        await run('42 :string');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const runtimeErr = err as RuntimeError;
        expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
        expect(runtimeErr.message).toContain('expected string');
      }
    });

    it('throws RuntimeError for non-boolean condition in conditional', async () => {
      try {
        await run('"not a boolean" ? "then" ! "else"');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const runtimeErr = err as RuntimeError;
        expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
        expect(runtimeErr.message).toContain('boolean');
      }
    });

    it('throws RuntimeError for non-boolean while loop condition', async () => {
      try {
        await run('0 -> ("string") @ { $ + 1 }');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const runtimeErr = err as RuntimeError;
        expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
        expect(runtimeErr.message).toContain('boolean');
      }
    });

    it('throws RuntimeError for non-iterable input to each', async () => {
      try {
        await run('42 -> each { $ }');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const runtimeErr = err as RuntimeError;
        expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
        expect(runtimeErr.message).toContain('Collection operators require');
      }
    });

    it('RuntimeError includes location information', async () => {
      try {
        await run('"line1"\n$undefined');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const runtimeErr = err as RuntimeError;
        expect(runtimeErr.location).toBeDefined();
        expect(runtimeErr.location?.line).toBe(2);
      }
    });
  });

  describe('TimeoutError for async operations (EC-3)', () => {
    it('throws TimeoutError when async function exceeds timeout', async () => {
      try {
        await run('slowFunc()', {
          timeout: 10,
          functions: {
            slowFunc: async () => {
              await new Promise((r) => setTimeout(r, 100));
              return 'done';
            },
          },
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeoutError);
        const timeoutErr = err as TimeoutError;
        expect(timeoutErr.code).toBe('RUNTIME_TIMEOUT');
        expect(timeoutErr.message).toContain('timed out');
      }
    });

    it('completes successfully when async function within timeout', async () => {
      const result = await run('fastFunc()', {
        timeout: 1000,
        functions: {
          fastFunc: async () => {
            await new Promise((r) => setTimeout(r, 10));
            return 'done';
          },
        },
      });
      expect(result).toBe('done');
    });

    it('TimeoutError includes function name and location', async () => {
      try {
        await run('mySlowFunc()', {
          timeout: 10,
          functions: {
            mySlowFunc: async () => {
              await new Promise((r) => setTimeout(r, 100));
              return 'done';
            },
          },
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeoutError);
        const timeoutErr = err as TimeoutError;
        expect(timeoutErr.functionName).toBe('mySlowFunc');
        expect(timeoutErr.location).toBeDefined();
      }
    });

    it('throws TimeoutError in nested async calls', async () => {
      try {
        await run('outer()', {
          timeout: 10,
          functions: {
            outer: async (args, ctx) => {
              // Call another async function that will timeout
              const innerFn = ctx.functions.get('inner');
              if (innerFn) {
                return await innerFn([], ctx);
              }
              return 'no-inner';
            },
            inner: async () => {
              await new Promise((r) => setTimeout(r, 100));
              return 'done';
            },
          },
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeoutError);
      }
    });

    it('timeout applies per function call, not total execution', async () => {
      // Multiple fast calls should succeed even if total time > timeout
      const result = await run('fast() -> fast() -> fast()', {
        timeout: 100,
        functions: {
          fast: async (args) => {
            const input = args[0] ?? 'start';
            await new Promise((r) => setTimeout(r, 40));
            return `${input}-done`;
          },
        },
      });
      expect(result).toBe('start-done-done-done');
    });
  });

  describe('Single-mixin composition boundary (AC-14)', () => {
    it('evaluates basic expressions with minimal evaluator', async () => {
      // These tests verify that the core evaluation works
      // with just the base class and core mixin
      const result = await run('42');
      expect(result).toBe(42);
    });

    it('evaluates string literals', async () => {
      const result = await run('"hello"');
      expect(result).toBe('hello');
    });

    it('evaluates boolean literals', async () => {
      const result = await run('true');
      expect(result).toBe(true);
    });

    it('evaluates simple pipe chains', async () => {
      const result = await run('"hello" -> .upper');
      expect(result).toBe('HELLO');
    });

    it('evaluates variable access', async () => {
      const result = await run('"test" :> $x\n$x');
      expect(result).toBe('test');
    });

    it('evaluates list literals', async () => {
      const result = await run('[1, 2, 3]');
      expect(result).toEqual([1, 2, 3]);
    });

    it('evaluates dict literals', async () => {
      const result = await run('[a: 1, b: 2]');
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('evaluates arithmetic expressions', async () => {
      const result = await run('10 + 5 * 2');
      expect(result).toBe(20);
    });

    it('evaluates comparison expressions', async () => {
      const result = await run('10 > 5');
      expect(result).toBe(true);
    });

    it('evaluates logical expressions', async () => {
      const result = await run('true && false');
      expect(result).toBe(false);
    });
  });

  describe('Evaluator infrastructure boundaries', () => {
    it('handles deeply nested expressions', async () => {
      const result = await run(
        '((((1 + 2) * 3) - 4) / 5) -> ($ * 10) -> ($ + 1)'
      );
      expect(result).toBe(11);
    });

    it('handles mixed statement types in sequence', async () => {
      const result = await run(`
        "hello" :> $str
        42 :> $num
        true :> $bool
        [1, 2, 3] :> $list
        [a: "test"] :> $dict
        $dict.a
      `);
      expect(result).toBe('test');
    });

    it('evaluates complex pipe chains with multiple operations', async () => {
      const result = await run(`
        [1, 2, 3, 4, 5]
        -> map |x| { $x * 2 }
        -> filter { $ > 5 }
        -> fold(0) { $@ + $ }
      `);
      expect(result).toBe(24); // [6, 8, 10] -> sum = 24
    });

    it('handles closures with captured variables', async () => {
      const result = await run(`
        10 :> $outer
        |x| { $x + $outer } :> $addTen
        5 -> $addTen()
      `);
      expect(result).toBe(15);
    });

    it('evaluates conditional expressions', async () => {
      const result = await run('true ? "yes" ! "no"');
      expect(result).toBe('yes');
    });

    it('evaluates while loops', async () => {
      const result = await run('0 -> ($ < 5) @ { $ + 1 }');
      expect(result).toBe(5);
    });

    it('evaluates blocks with return', async () => {
      const result = await run(`
        {
          "first" :> $x
          ($x == "first") ? ("early" -> return)
          "should not reach"
        }
      `);
      expect(result).toBe('early');
    });

    it('evaluates each loops with break', async () => {
      const result = await run(`
        [1, 2, 3, 4, 5] -> each {
          ($ > 2) ? ($ -> break)
          $
        }
      `);
      // each with break returns partial results
      expect(result).toEqual([1, 2]);
    });
  });

  describe('Error handling edge cases', () => {
    it('throws RuntimeError for iteration limit exceeded', async () => {
      try {
        // Infinite loop with iteration limit
        await run('^(limit: 10) 0 -> (true) @ { $ }');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const runtimeErr = err as RuntimeError;
        expect(runtimeErr.message).toContain('exceeded');
        expect(runtimeErr.message).toContain('10');
      }
    });

    it('throws RuntimeError for undefined method', async () => {
      try {
        await run('"hello" -> .nonexistent()');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const runtimeErr = err as RuntimeError;
        expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_METHOD');
        expect(runtimeErr.message).toContain('nonexistent');
      }
    });

    it('error propagates through pipe chain', async () => {
      try {
        await run('"hello" -> .upper -> $undefined');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const runtimeErr = err as RuntimeError;
        expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_VARIABLE');
      }
    });

    it('error propagates through collection operator', async () => {
      try {
        await run('[1, 2, 3] -> map { $undefined }');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const runtimeErr = err as RuntimeError;
        expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_VARIABLE');
      }
    });
  });

  describe('TypesMixin error contracts', () => {
    describe('EC-24: Type assertion failures', () => {
      it('throws RuntimeError with RUNTIME_TYPE_ERROR for type mismatch', async () => {
        try {
          await run('42 :string');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain('Type assertion failed');
        }
      });

      it('AC-10: error message includes expected vs actual types', async () => {
        try {
          await run('"hello" :number');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.message).toContain('expected number');
          expect(runtimeErr.message).toContain('got string');
        }
      });

      it('AC-10: error includes location information', async () => {
        try {
          await run('42 :string');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.location).toBeDefined();
          expect(runtimeErr.location?.line).toBe(1);
        }
      });

      it('type assertion failure with list expected, got dict', async () => {
        try {
          await run('[a: 1] :list');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain('expected list');
          expect(runtimeErr.message).toContain('got dict');
        }
      });

      it('type assertion failure with dict expected, got list', async () => {
        try {
          await run('[1, 2, 3] :dict');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain('expected dict');
          expect(runtimeErr.message).toContain('got list');
        }
      });

      it('type assertion failure with bool expected, got number', async () => {
        try {
          await run('1 :bool');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain('expected bool');
          expect(runtimeErr.message).toContain('got number');
        }
      });

      it('type assertion failure in pipe chain', async () => {
        try {
          await run('"hello" -> .len -> :string');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain('expected string');
          expect(runtimeErr.message).toContain('got number');
        }
      });

      it('type assertion failure with tuple expected, got list', async () => {
        try {
          await run('[1, 2] :tuple');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain('expected tuple');
          expect(runtimeErr.message).toContain('got list');
        }
      });

      it('type assertion failure with closure expected, got string', async () => {
        try {
          await run('"not a function" :closure');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain('expected closure');
          expect(runtimeErr.message).toContain('got string');
        }
      });
    });

    describe('Type assertion success cases', () => {
      it('passes through value when type matches', async () => {
        const result = await run('"hello" :string');
        expect(result).toBe('hello');
      });

      it('type check returns boolean without throwing', async () => {
        const result = await run('42 :?string');
        expect(result).toBe(false);
      });

      it('type check returns true when type matches', async () => {
        const result = await run('42 :?number');
        expect(result).toBe(true);
      });
    });
  });

  describe('ExpressionsMixin error contracts', () => {
    describe('EC-22: Arithmetic type mismatch', () => {
      it('throws RuntimeError for addition with non-number left operand', async () => {
        try {
          await run('"string" + 5');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain(
            'Arithmetic requires number, got string'
          );
        }
      });

      it('throws RuntimeError for addition with non-number right operand', async () => {
        try {
          await run('5 + "string"');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain(
            'Arithmetic requires number, got string'
          );
        }
      });

      it('throws RuntimeError for subtraction with boolean', async () => {
        try {
          await run('10 - true');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain(
            'Arithmetic requires number, got bool'
          );
        }
      });

      it('throws RuntimeError for multiplication with list', async () => {
        try {
          await run('5 * [1, 2]');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain(
            'Arithmetic requires number, got list'
          );
        }
      });

      it('throws RuntimeError for division with dict', async () => {
        try {
          await run('10 / [a: 1]');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain(
            'Arithmetic requires number, got dict'
          );
        }
      });

      it('throws RuntimeError for modulo with string', async () => {
        try {
          await run('"10" % 3');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain(
            'Arithmetic requires number, got string'
          );
        }
      });

      it('throws RuntimeError for unary minus with non-number', async () => {
        try {
          await run('-"five"');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain(
            'Arithmetic requires number, got string'
          );
        }
      });

      it('throws RuntimeError for division by zero', async () => {
        try {
          await run('10 / 0');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain('Division by zero');
        }
      });

      it('throws RuntimeError for modulo by zero', async () => {
        try {
          await run('10 % 0');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain('Modulo by zero');
        }
      });
    });

    describe('EC-23: Nested expression propagation', () => {
      it('propagates error from nested binary expression left operand', async () => {
        try {
          await run('($undefined + 5) * 2');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_VARIABLE');
          expect(runtimeErr.message).toContain('undefined');
        }
      });

      it('propagates error from nested binary expression right operand', async () => {
        try {
          await run('10 + (5 * $missing)');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_VARIABLE');
        }
      });

      it('propagates error from deeply nested expressions', async () => {
        try {
          await run('(((10 + 5) * $x) - 3) / 2');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_VARIABLE');
          expect(runtimeErr.message).toContain('$x');
        }
      });

      it('propagates error from unary expression operand', async () => {
        try {
          await run('-$undefined');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_VARIABLE');
        }
      });

      it('propagates error from grouped expression', async () => {
        try {
          await run('(5 + $notDefined) * 2');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_VARIABLE');
        }
      });

      it('propagates type error from nested arithmetic', async () => {
        try {
          await run('10 + ("string" * 2)');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain(
            'Arithmetic requires number, got string'
          );
        }
      });

      it('preserves original error message in propagation', async () => {
        try {
          await run('(100 / 0) + 5');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.message).toContain('Division by zero');
        }
      });

      it('propagates error from comparison nested in arithmetic', async () => {
        try {
          await run('10 + (5 > $undefined ? 1 ! 0)');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_VARIABLE');
        }
      });
    });

    describe('Comparison type errors', () => {
      it('throws RuntimeError for ordering comparison between incompatible types', async () => {
        try {
          await run('5 < "string"');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain('Cannot compare');
          expect(runtimeErr.message).toContain('number');
          expect(runtimeErr.message).toContain('string');
        }
      });

      it('throws RuntimeError for ordering comparison with list', async () => {
        try {
          await run('[1, 2] > 5');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain('Cannot compare');
        }
      });

      it('allows equality comparison between any types', async () => {
        const result = await run('5 == "string"');
        expect(result).toBe(false);
      });
    });

    describe('Successful arithmetic operations', () => {
      it('evaluates addition correctly', async () => {
        const result = await run('10 + 5');
        expect(result).toBe(15);
      });

      it('evaluates complex expressions correctly', async () => {
        const result = await run('(10 + 5) * 2 - 3 / 3');
        expect(result).toBe(29);
      });

      it('evaluates unary minus correctly', async () => {
        const result = await run('-(10 + 5)');
        expect(result).toBe(-15);
      });
    });
  });

  describe('VariablesMixin error contracts', () => {
    describe('EC-8, AC-9: Undefined variable access', () => {
      it('throws RuntimeError with RUNTIME_UNDEFINED_VARIABLE code', async () => {
        try {
          await run('$undefined');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_VARIABLE');
        }
      });

      it('error message includes variable name', async () => {
        try {
          await run('$missingVar');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.message).toContain('Undefined variable');
          expect(runtimeErr.message).toContain('missingVar');
        }
      });

      it('error includes location information from AST node', async () => {
        try {
          await run('"line1"\n$undefined');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.location).toBeDefined();
          expect(runtimeErr.location?.line).toBe(2);
        }
      });

      it('throws for undefined pipe variable ($)', async () => {
        try {
          await run('$');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_VARIABLE');
          expect(runtimeErr.message).toContain('Undefined variable: $');
        }
      });

      it('throws for undefined variable in expression', async () => {
        try {
          await run('10 + $undefined');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_VARIABLE');
        }
      });
    });

    describe('EC-9: Type mismatch on reassignment', () => {
      it('throws RuntimeError with RUNTIME_TYPE_ERROR for type mismatch', async () => {
        try {
          await run('"hello" :> $x\n42 :> $x');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
        }
      });

      it('error message includes expected and actual types', async () => {
        try {
          await run('"string" :> $var\n123 :> $var');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.message).toContain('Type mismatch');
          expect(runtimeErr.message).toContain('string');
          expect(runtimeErr.message).toContain('number');
        }
      });

      it('throws when reassigning string to number variable', async () => {
        try {
          await run('42 :> $num\n"text" :> $num');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain('locked as number');
        }
      });

      it('throws when reassigning list to boolean variable', async () => {
        try {
          await run('true :> $flag\n[1, 2] :> $flag');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
        }
      });

      it('allows reassignment with same type', async () => {
        const result = await run('"first" :> $x\n"second" :> $x\n$x');
        expect(result).toBe('second');
      });

      it('throws for explicit type annotation mismatch', async () => {
        try {
          await run('42 :> $x:string');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain('Type mismatch');
        }
      });
    });
  });

  describe('ExtractionMixin error contracts', () => {
    describe('EC-14: List destructure size mismatch', () => {
      it('throws RuntimeError for too few elements', async () => {
        try {
          await run('[1, 2] -> *<$a, $b, $c>');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
        }
      });

      it('error message includes pattern size and list size', async () => {
        try {
          await run('[1, 2] -> *<$a, $b, $c>');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.message).toContain('3 elements');
          expect(runtimeErr.message).toContain('2');
        }
      });

      it('throws RuntimeError for too many elements', async () => {
        try {
          await run('[1, 2, 3, 4] -> *<$a, $b>');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain('2 elements');
          expect(runtimeErr.message).toContain('4');
        }
      });

      it('allows exact size match', async () => {
        const result = await run('[1, 2, 3] -> *<$a, $b, $c>\n[$a, $b, $c]');
        expect(result).toEqual([1, 2, 3]);
      });
    });

    describe('EC-13: Destructure on wrong type', () => {
      it('throws RuntimeError when destructuring non-list as positional', async () => {
        try {
          await run('"hello" -> *<$a, $b>');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain('requires list');
        }
      });

      it('throws RuntimeError when destructuring non-dict as key pattern', async () => {
        try {
          await run('[1, 2] -> *<key: $v>');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain('requires dict');
        }
      });

      it('throws when destructuring number', async () => {
        try {
          await run('42 -> *<$x>');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
        }
      });

      it('throws when destructuring boolean', async () => {
        try {
          await run('true -> *<$x>');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
        }
      });
    });

    describe('EC-13: Slice on wrong type', () => {
      it('throws RuntimeError for slice on number', async () => {
        try {
          await run('42 -> /<0:2>');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain('Slice requires list or string');
        }
      });

      it('throws RuntimeError for slice on boolean', async () => {
        try {
          await run('true -> /<0:1>');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain('Slice requires list or string');
        }
      });

      it('throws RuntimeError for slice on dict', async () => {
        try {
          await run('[a: 1, b: 2] -> /<0:1>');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain('dict');
        }
      });

      it('allows slice on list', async () => {
        const result = await run('[1, 2, 3, 4, 5] -> /<1:4>');
        expect(result).toEqual([2, 3, 4]);
      });

      it('allows slice on string', async () => {
        const result = await run('"hello" -> /<1:4>');
        expect(result).toBe('ell');
      });
    });

    describe('Extraction success cases', () => {
      it('destructures list correctly', async () => {
        const result = await run('[1, 2, 3] -> *<$a, $b, $c>\n$b');
        expect(result).toBe(2);
      });

      it('destructures dict correctly', async () => {
        const result = await run(
          '[name: "Alice", age: 30] -> *<name: $n, age: $a>\n$n'
        );
        expect(result).toBe('Alice');
      });

      it('slices list correctly', async () => {
        const result = await run('[1, 2, 3, 4, 5] -> /<2:>');
        expect(result).toEqual([3, 4, 5]);
      });

      it('slices string correctly', async () => {
        const result = await run('"hello world" -> /<0:5>');
        expect(result).toBe('hello');
      });
    });
  });

  describe('LiteralsMixin error contracts', () => {
    describe('EC-6: String interpolation error propagation', () => {
      it('propagates undefined variable error from interpolation', async () => {
        try {
          await run('"value: {$undefined}"');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_VARIABLE');
          expect(runtimeErr.message).toContain('undefined');
        }
      });

      it('propagates type error from interpolation expression', async () => {
        try {
          await run('"result: {"string" + 5}"');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain('Arithmetic requires number');
        }
      });

      it('propagates undefined function error from interpolation', async () => {
        try {
          await run('"output: {missing_func()}"');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_FUNCTION');
          expect(runtimeErr.message).toContain('missing_func');
        }
      });

      it('preserves original error message from nested evaluation', async () => {
        try {
          await run('"division: {10 / 0}"');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain('Division by zero');
        }
      });

      it('propagates error from complex interpolation expression', async () => {
        try {
          await run('[a: 1] :> $d\n"field: {$d.missing}"');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain("Dict has no field 'missing'");
        }
      });

      it('propagates error from multiple interpolations (first fails)', async () => {
        try {
          await run('"first: {$undefined}, second: {$other}"');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_VARIABLE');
          expect(runtimeErr.message).toContain('undefined');
        }
      });

      it('propagates error from method call in interpolation', async () => {
        try {
          await run('"upper: {"hello" -> .nonexistent()}"');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_METHOD');
          expect(runtimeErr.message).toContain('nonexistent');
        }
      });
    });

    describe('EC-7: Dict evaluation error propagation', () => {
      it('propagates undefined variable error from dict value', async () => {
        try {
          await run('[key: $undefined]');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_VARIABLE');
          expect(runtimeErr.message).toContain('undefined');
        }
      });

      it('propagates type error from dict value expression', async () => {
        try {
          await run('[result: "string" + 5]');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain('Arithmetic requires number');
        }
      });

      it('propagates error from nested dict evaluation', async () => {
        try {
          await run('[outer: [inner: $missing]]');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_VARIABLE');
          expect(runtimeErr.message).toContain('missing');
        }
      });

      it('propagates error from dict value computation', async () => {
        try {
          await run('[value: 10 / 0]');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain('Division by zero');
        }
      });

      it('preserves error code from nested expression', async () => {
        try {
          await run('[fn: undefined_func()]');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_FUNCTION');
        }
      });

      it('propagates error from multiple dict entries (first value fails)', async () => {
        try {
          await run('[first: $undefined, second: 42]');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_VARIABLE');
        }
      });

      it('propagates error from dict with non-closure expression value', async () => {
        try {
          await run('[computed: $undefined + 1]');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_VARIABLE');
        }
      });
    });

    describe('EC-7: Tuple evaluation error propagation', () => {
      it('propagates undefined variable error from tuple element', async () => {
        try {
          await run('[1, $undefined, 3]');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_VARIABLE');
          expect(runtimeErr.message).toContain('undefined');
        }
      });

      it('propagates type error from tuple element expression', async () => {
        try {
          await run('[1, "string" + 5, 3]');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain('Arithmetic requires number');
        }
      });

      it('propagates error from nested tuple evaluation', async () => {
        try {
          await run('[1, [2, $missing], 3]');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_VARIABLE');
          expect(runtimeErr.message).toContain('missing');
        }
      });

      it('propagates error from tuple element computation', async () => {
        try {
          await run('[1, 10 / 0, 3]');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_TYPE_ERROR');
          expect(runtimeErr.message).toContain('Division by zero');
        }
      });

      it('preserves error code from nested expression in tuple', async () => {
        try {
          await run('[missing_func(), 42]');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_FUNCTION');
        }
      });

      it('propagates error from method call in tuple element', async () => {
        try {
          await run('["hello" -> .nonexistent(), "world"]');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RuntimeError);
          const runtimeErr = err as RuntimeError;
          expect(runtimeErr.code).toBe('RUNTIME_UNDEFINED_METHOD');
          expect(runtimeErr.message).toContain('nonexistent');
        }
      });
    });

    describe('Literal evaluation success cases', () => {
      it('evaluates string with multiple interpolations', async () => {
        const result = await run('1 :> $a\n2 :> $b\n"sum: {$a + $b}"');
        expect(result).toBe('sum: 3');
      });

      it('evaluates dict with computed values', async () => {
        const result = await run('5 :> $x\n[a: $x * 2, b: $x + 1]');
        expect(result).toEqual({ a: 10, b: 6 });
      });

      it('evaluates tuple with expressions', async () => {
        const result = await run('3 :> $n\n[$n, $n * 2, $n * 3]');
        expect(result).toEqual([3, 6, 9]);
      });

      it('evaluates nested structures without errors', async () => {
        const result = await run('[outer: [inner: [1, 2, 3]]]');
        expect(result).toEqual({ outer: { inner: [1, 2, 3] } });
      });
    });
  });
});
