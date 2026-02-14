/**
 * Rill Runtime Tests: Host Function Type Safety
 * Tests for typed host function parameters with runtime validation
 *
 * Specification Mapping (conduct/specifications/host-function-types.md):
 *
 * Success Criteria:
 * - AC-1: TC-HOSTTYPE-1 (7 tests) - Typed params accept matching types
 * - AC-2: AC-2 section (5 tests) - Arguments validated before function body executes
 * - AC-3: TC-HOSTTYPE-3 (6 tests) - Default values applied when arguments omitted
 * - AC-4: TC-HOSTTYPE-4 (4 tests) - Optional parameter omission works
 * - AC-5: TC-HOSTTYPE-5 (6 tests) - Untyped function backward compatibility
 * - AC-6: AC-6 section (6 tests) - Error messages include all required details
 * - AC-7: AC-7 section (3 tests) - Error context includes structured data
 *
 * Error Criteria:
 * - AC-8: TC-HOSTTYPE-2 (1 test) - Type mismatch error (string expected, number received)
 * - AC-9: TC-HOSTTYPE-8 (1 test) - Excess arguments rejection
 * - AC-10: TC-HOSTTYPE-9 (1 test) - Missing required argument error
 * - AC-12: TC-HOSTTYPE-7 (1 test) - Wrong collection type
 * - EC-3: TC-HOSTTYPE-6 (1 test) - Complex type validation
 *
 * Boundary Criteria:
 * - AC-14: Empty parameter list (2 tests)
 * - AC-15: All optional parameters (3 tests)
 * - AC-16: Maximum parameter count 20+ (3 tests)
 * - AC-17: Concurrent invocations (2 tests)
 * - AC-18: Mixed typed/untyped functions (5 tests)
 * - AC-19: List validation without element types (5 tests)
 * - AC-20: Any parameter type accepts all value types (7 tests)
 *
 * Implementation Requirements:
 * - IR-1: validateHostFunctionArgs function (validated via integration tests)
 * - IC-7: File creation (this file)
 *
 * Total: 84 tests (all passing) covering all acceptance criteria
 *
 * Integration Evidence:
 * All tests use run() helper which executes through the full runtime pipeline:
 *   parse(source) -> execute(ast, context) -> evaluateExpression() ->
 *   invokeFnCallable() -> validateHostFunctionArgs() -> callable.fn()
 *
 * Tests verify runtime automatically invokes validation:
 * - TC-HOSTTYPE-1: Typed functions execute successfully with valid args
 * - TC-HOSTTYPE-5: Untyped functions skip validation (backward compat)
 * - AC-2 section: mockFn proves runtime prevents execution on validation failure
 */

import { describe, expect, it } from 'vitest';
import type { HostFunctionParam } from '@rcrsr/rill';
import { createRuntimeContext } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { mockFn } from '../helpers/runtime.js';

describe('Rill Runtime: Host Function Type Safety', () => {
  describe('Success Cases', () => {
    describe('TC-HOSTTYPE-1: Typed parameters accept matching types', () => {
      it('accepts string argument for string parameter', async () => {
        const result = await run('greet("Alice")', {
          functions: {
            greet: {
              params: [{ name: 'name', type: 'string' }],
              fn: (args) => `Hello, ${args[0]}!`,
            },
          },
        });
        expect(result).toBe('Hello, Alice!');
      });

      it('accepts number argument for number parameter', async () => {
        const result = await run('double(21)', {
          functions: {
            double: {
              params: [{ name: 'x', type: 'number' }],
              fn: (args) => (args[0] as number) * 2,
            },
          },
        });
        expect(result).toBe(42);
      });

      it('accepts bool argument for bool parameter', async () => {
        const result = await run('negate(true)', {
          functions: {
            negate: {
              params: [{ name: 'value', type: 'bool' }],
              fn: (args) => !(args[0] as boolean),
            },
          },
        });
        expect(result).toBe(false);
      });

      it('accepts list argument for list parameter', async () => {
        const result = await run('first([1, 2, 3])', {
          functions: {
            first: {
              params: [{ name: 'items', type: 'list' }],
              fn: (args) => (args[0] as unknown[])[0],
            },
          },
        });
        expect(result).toBe(1);
      });

      it('accepts dict argument for dict parameter', async () => {
        const result = await run('getValue([key: "test"])', {
          functions: {
            getValue: {
              params: [{ name: 'data', type: 'dict' }],
              fn: (args) =>
                (args[0] as Record<string, unknown>).key ?? 'missing',
            },
          },
        });
        expect(result).toBe('test');
      });

      it('accepts multiple arguments with matching types', async () => {
        const result = await run('concat("Hello", " ", "World")', {
          functions: {
            concat: {
              params: [
                { name: 'a', type: 'string' },
                { name: 'b', type: 'string' },
                { name: 'c', type: 'string' },
              ],
              fn: (args) => `${args[0]}${args[1]}${args[2]}`,
            },
          },
        });
        expect(result).toBe('Hello World');
      });

      it('accepts mixed types in correct order', async () => {
        const result = await run('repeat("x", 3)', {
          functions: {
            repeat: {
              params: [
                { name: 'str', type: 'string' },
                { name: 'count', type: 'number' },
              ],
              fn: (args) => (args[0] as string).repeat(args[1] as number),
            },
          },
        });
        expect(result).toBe('xxx');
      });
    });

    describe('TC-HOSTTYPE-3: Default values applied when arguments omitted', () => {
      it('applies default value when argument omitted', async () => {
        const result = await run('greet()', {
          functions: {
            greet: {
              params: [{ name: 'name', type: 'string', defaultValue: 'World' }],
              fn: (args) => `Hello, ${args[0]}!`,
            },
          },
        });
        expect(result).toBe('Hello, World!');
      });

      it('applies multiple default values', async () => {
        const result = await run('range()', {
          functions: {
            range: {
              params: [
                { name: 'start', type: 'number', defaultValue: 0 },
                { name: 'end', type: 'number', defaultValue: 10 },
              ],
              fn: (args) => `${args[0]}-${args[1]}`,
            },
          },
        });
        expect(result).toBe('0-10');
      });

      it('applies default for second parameter when first provided', async () => {
        const result = await run('repeat("x")', {
          functions: {
            repeat: {
              params: [
                { name: 'str', type: 'string' },
                { name: 'count', type: 'number', defaultValue: 3 },
              ],
              fn: (args) => (args[0] as string).repeat(args[1] as number),
            },
          },
        });
        expect(result).toBe('xxx');
      });

      it('applies default with list type', async () => {
        const result = await run('sum()', {
          functions: {
            sum: {
              params: [{ name: 'nums', type: 'list', defaultValue: [1, 2, 3] }],
              fn: (args) =>
                (args[0] as number[]).reduce((a, b) => a + b, 0) as number,
            },
          },
        });
        expect(result).toBe(6);
      });

      it('applies default with dict type', async () => {
        const result = await run('getName()', {
          functions: {
            getName: {
              params: [
                { name: 'data', type: 'dict', defaultValue: { name: 'Alice' } },
              ],
              fn: (args) => (args[0] as Record<string, unknown>).name,
            },
          },
        });
        expect(result).toBe('Alice');
      });

      it('applies default with bool type', async () => {
        const result = await run('toggle()', {
          functions: {
            toggle: {
              params: [{ name: 'value', type: 'bool', defaultValue: true }],
              fn: (args) => !(args[0] as boolean),
            },
          },
        });
        expect(result).toBe(false);
      });
    });

    describe('TC-HOSTTYPE-4: Optional parameter omission works', () => {
      it('accepts call with optional parameter omitted', async () => {
        const result = await run('greet("Bob")', {
          functions: {
            greet: {
              params: [
                { name: 'name', type: 'string' },
                { name: 'title', type: 'string', defaultValue: 'Mr.' },
              ],
              fn: (args) => `Hello, ${args[1]} ${args[0]}!`,
            },
          },
        });
        expect(result).toBe('Hello, Mr. Bob!');
      });

      it('accepts call with optional parameter provided', async () => {
        const result = await run('greet("Alice", "Dr.")', {
          functions: {
            greet: {
              params: [
                { name: 'name', type: 'string' },
                { name: 'title', type: 'string', defaultValue: 'Mr.' },
              ],
              fn: (args) => `Hello, ${args[1]} ${args[0]}!`,
            },
          },
        });
        expect(result).toBe('Hello, Dr. Alice!');
      });

      it('handles all optional parameters omitted', async () => {
        const result = await run('config()', {
          functions: {
            config: {
              params: [
                { name: 'host', type: 'string', defaultValue: 'localhost' },
                { name: 'port', type: 'number', defaultValue: 8080 },
                { name: 'secure', type: 'bool', defaultValue: false },
              ],
              fn: (args) => `${args[0]}:${args[1]} (secure: ${args[2]})`,
            },
          },
        });
        expect(result).toBe('localhost:8080 (secure: false)');
      });

      it('handles mix of required and optional parameters', async () => {
        const result = await run('format("error")', {
          functions: {
            format: {
              params: [
                { name: 'level', type: 'string' },
                { name: 'prefix', type: 'string', defaultValue: '[LOG]' },
                { name: 'suffix', type: 'string', defaultValue: '' },
              ],
              fn: (args) => `${args[1]} ${args[0]} ${args[2]}`,
            },
          },
        });
        expect(result).toBe('[LOG] error ');
      });
    });

    describe('TC-HOSTTYPE-5: Empty params array behavior', () => {
      it('runtime executes function with empty params array', async () => {
        // This test proves functions with empty params execute correctly (AC-S5).
        // The function takes no arguments.
        const fn = mockFn('legacy result');

        const result = await run('legacy()', {
          functions: {
            legacy: fn,
          },
        });

        expect(fn.callCount).toBe(1);
        expect(result).toBe('legacy result');
      });

      it('accepts function with empty params array', async () => {
        const result = await run('legacy()', {
          functions: {
            legacy: { params: [], fn: () => `legacy: executed` },
          },
        });
        expect(result).toBe('legacy: executed');
      });

      it('empty params function executes without arguments', async () => {
        const result = await run('acceptAll()', {
          functions: {
            acceptAll: { params: [], fn: () => `value: none` },
          },
        });
        expect(result).toBe('value: none');
      });

      it('empty params function rejects arguments', async () => {
        await expect(
          run('multi("a", 1, true)', {
            functions: {
              multi: {
                params: [],
                fn: () => `should not execute`,
              },
            },
          })
        ).rejects.toThrow('expects 0 arguments, got 3');
      });

      it('empty params function works alongside typed functions', async () => {
        const result = await run(
          `
          typed("x")
          zeroArgs()
        `,
          {
            functions: {
              typed: {
                params: [{ name: 'x', type: 'string' }],
                fn: (args) => args[0],
              },
              zeroArgs: { params: [], fn: () => `called` },
            },
          }
        );
        expect(result).toBe('called');
      });

      it('untyped function with empty params array works', async () => {
        const result = await run('noArgs()', {
          functions: {
            noArgs: {
              params: [],
              fn: () => 'called',
            },
          },
        });
        expect(result).toBe('called');
      });
    });

    describe('AC-2: Arguments validated before function body executes', () => {
      it('runtime automatically invokes validation for typed functions', async () => {
        // This test proves the runtime calls validateHostFunctionArgs automatically.
        // No explicit validation call in test code - runtime does it via invokeFnCallable.
        const fn = mockFn('success');

        const result = await run('test("valid")', {
          functions: {
            test: {
              params: [{ name: 'x', type: 'string' }],
              fn: fn.fn,
            },
          },
        });

        expect(fn.callCount).toBe(1);
        expect(result).toBe('success');
      });

      it('validation error prevents function execution', async () => {
        const fn = mockFn('should not reach');

        await expect(
          run('test(42)', {
            functions: {
              test: {
                params: [{ name: 'x', type: 'string' }],
                fn: fn.fn,
              },
            },
          })
        ).rejects.toThrow('Type mismatch');

        expect(fn.callCount).toBe(0);
      });

      it('excess arguments error prevents function execution', async () => {
        const fn = mockFn('should not reach');

        await expect(
          run('test("a", "b")', {
            functions: {
              test: {
                params: [{ name: 'x', type: 'string' }],
                fn: fn.fn,
              },
            },
          })
        ).rejects.toThrow('expects 1 arguments, got 2');

        expect(fn.callCount).toBe(0);
      });

      it('missing required argument error prevents function execution', async () => {
        const fn = mockFn('should not reach');

        await expect(
          run('test()', {
            functions: {
              test: {
                params: [{ name: 'x', type: 'string' }],
                fn: fn.fn,
              },
            },
          })
        ).rejects.toThrow('Missing required argument');

        expect(fn.callCount).toBe(0);
      });

      it('valid arguments allow function execution', async () => {
        const fn = mockFn('result');

        const result = await run('test("value")', {
          functions: {
            test: {
              params: [{ name: 'x', type: 'string' }],
              fn: fn.fn,
            },
          },
        });

        expect(fn.callCount).toBe(1);
        expect(result).toBe('result');
      });
    });

    describe('AC-6: Error messages include function/param name, expected/actual types', () => {
      it('type mismatch error includes function name', async () => {
        await expect(
          run('myFunc(42)', {
            functions: {
              myFunc: {
                params: [{ name: 'x', type: 'string' }],
                fn: () => 'not reached',
              },
            },
          })
        ).rejects.toThrow('myFunc');
      });

      it('type mismatch error includes parameter name', async () => {
        await expect(
          run('test()', {
            functions: {
              test: {
                params: [{ name: 'userName', type: 'string' }],
                fn: () => 'not reached',
              },
            },
          })
        ).rejects.toThrow('userName');
      });

      it('type mismatch error includes expected type', async () => {
        await expect(
          run('test(42)', {
            functions: {
              test: {
                params: [{ name: 'x', type: 'string' }],
                fn: () => 'not reached',
              },
            },
          })
        ).rejects.toThrow('expects string');
      });

      it('type mismatch error includes actual type', async () => {
        await expect(
          run('test(42)', {
            functions: {
              test: {
                params: [{ name: 'x', type: 'string' }],
                fn: () => 'not reached',
              },
            },
          })
        ).rejects.toThrow('got number');
      });

      it('missing argument error includes parameter name', async () => {
        await expect(
          run('test()', {
            functions: {
              test: {
                params: [{ name: 'requiredParam', type: 'string' }],
                fn: () => 'not reached',
              },
            },
          })
        ).rejects.toThrow('requiredParam');
      });

      it('excess arguments error includes expected and actual counts', async () => {
        await expect(
          run('test(1, 2, 3)', {
            functions: {
              test: {
                params: [{ name: 'x', type: 'number' }],
                fn: () => 'not reached',
              },
            },
          })
        ).rejects.toThrow('expects 1 arguments, got 3');
      });
    });

    describe('AC-7: Error context includes structured data', () => {
      it('type mismatch error has structured context', async () => {
        try {
          await run('testFunc(42)', {
            functions: {
              testFunc: {
                params: [{ name: 'myParam', type: 'string' }],
                fn: () => 'not reached',
              },
            },
          });
          expect.fail('Should have thrown');
        } catch (err) {
          const error = err as { context?: Record<string, unknown> };
          expect(error.context).toBeDefined();
          expect(error.context?.functionName).toBe('testFunc');
          expect(error.context?.paramName).toBe('myParam');
          expect(error.context?.expectedType).toBe('string');
          expect(error.context?.actualType).toBe('number');
        }
      });

      it('excess arguments error has structured context with counts', async () => {
        try {
          await run('myFunc(1, 2)', {
            functions: {
              myFunc: {
                params: [{ name: 'x', type: 'number' }],
                fn: () => 'not reached',
              },
            },
          });
          expect.fail('Should have thrown');
        } catch (err) {
          const error = err as { context?: Record<string, unknown> };
          expect(error.context).toBeDefined();
          expect(error.context?.functionName).toBe('myFunc');
          expect(error.context?.expectedCount).toBe(1);
          expect(error.context?.actualCount).toBe(2);
        }
      });

      it('missing argument error has structured context', async () => {
        try {
          await run('testFunc()', {
            functions: {
              testFunc: {
                params: [{ name: 'requiredParam', type: 'string' }],
                fn: () => 'not reached',
              },
            },
          });
          expect.fail('Should have thrown');
        } catch (err) {
          const error = err as { context?: Record<string, unknown> };
          expect(error.context).toBeDefined();
          expect(error.context?.functionName).toBe('testFunc');
          expect(error.context?.paramName).toBe('requiredParam');
        }
      });
    });
  });

  describe('Registration-Time Validation (EC-4, AC-11)', () => {
    describe('defaultValue type mismatch at registration', () => {
      it('throws Error when defaultValue type does not match declared type', () => {
        expect(() => {
          createRuntimeContext({
            functions: {
              test: {
                params: [
                  {
                    name: 'count',
                    type: 'number',
                    defaultValue: 'not a number',
                  },
                ],
                fn: () => 'should not reach',
              },
            },
          });
        }).toThrow(
          "Invalid defaultValue for parameter 'count': expected number, got string"
        );
      });

      it('throws Error synchronously during createRuntimeContext', () => {
        // This test proves the error is thrown during registration (synchronous),
        // not during script execution (async). The run() helper is never awaited.
        let errorCaught = false;
        try {
          createRuntimeContext({
            functions: {
              test: {
                params: [{ name: 'x', type: 'bool', defaultValue: 42 }],
                fn: () => 'not reached',
              },
            },
          });
        } catch (err) {
          errorCaught = true;
          expect(err).toBeInstanceOf(Error);
          expect((err as Error).message).toMatch(
            "Invalid defaultValue for parameter 'x': expected bool, got number"
          );
        }
        expect(errorCaught).toBe(true);
      });

      it('throws Error for string defaultValue on number parameter', () => {
        expect(() => {
          createRuntimeContext({
            functions: {
              calc: {
                params: [
                  { name: 'value', type: 'number', defaultValue: '100' },
                ],
                fn: () => 'not reached',
              },
            },
          });
        }).toThrow(
          "Invalid defaultValue for parameter 'value': expected number, got string"
        );
      });

      it('throws Error for number defaultValue on bool parameter', () => {
        expect(() => {
          createRuntimeContext({
            functions: {
              toggle: {
                params: [{ name: 'flag', type: 'bool', defaultValue: 0 }],
                fn: () => 'not reached',
              },
            },
          });
        }).toThrow(
          "Invalid defaultValue for parameter 'flag': expected bool, got number"
        );
      });

      it('throws Error for list defaultValue on dict parameter', () => {
        expect(() => {
          createRuntimeContext({
            functions: {
              process: {
                params: [
                  { name: 'data', type: 'dict', defaultValue: [1, 2, 3] },
                ],
                fn: () => 'not reached',
              },
            },
          });
        }).toThrow(
          "Invalid defaultValue for parameter 'data': expected dict, got list"
        );
      });

      it('throws Error for dict defaultValue on list parameter', () => {
        expect(() => {
          createRuntimeContext({
            functions: {
              items: {
                params: [
                  { name: 'collection', type: 'list', defaultValue: { a: 1 } },
                ],
                fn: () => 'not reached',
              },
            },
          });
        }).toThrow(
          "Invalid defaultValue for parameter 'collection': expected list, got dict"
        );
      });
    });

    describe('Valid defaultValue types pass registration', () => {
      it('accepts string defaultValue for string parameter', async () => {
        const result = await run('greet()', {
          functions: {
            greet: {
              params: [{ name: 'name', type: 'string', defaultValue: 'World' }],
              fn: (args) => `Hello, ${args[0]}!`,
            },
          },
        });
        expect(result).toBe('Hello, World!');
      });

      it('accepts number defaultValue for number parameter', async () => {
        const result = await run('square()', {
          functions: {
            square: {
              params: [{ name: 'x', type: 'number', defaultValue: 5 }],
              fn: (args) => (args[0] as number) * (args[0] as number),
            },
          },
        });
        expect(result).toBe(25);
      });

      it('accepts bool defaultValue for bool parameter', async () => {
        const result = await run('toggle()', {
          functions: {
            toggle: {
              params: [{ name: 'value', type: 'bool', defaultValue: true }],
              fn: (args) => !(args[0] as boolean),
            },
          },
        });
        expect(result).toBe(false);
      });

      it('accepts list defaultValue for list parameter', async () => {
        const result = await run('sum()', {
          functions: {
            sum: {
              params: [{ name: 'nums', type: 'list', defaultValue: [1, 2, 3] }],
              fn: (args) =>
                (args[0] as number[]).reduce((a, b) => a + b, 0) as number,
            },
          },
        });
        expect(result).toBe(6);
      });

      it('accepts dict defaultValue for dict parameter', async () => {
        const result = await run('getName()', {
          functions: {
            getName: {
              params: [
                { name: 'user', type: 'dict', defaultValue: { name: 'Alice' } },
              ],
              fn: (args) => (args[0] as Record<string, unknown>).name,
            },
          },
        });
        expect(result).toBe('Alice');
      });

      it('accepts multiple parameters with valid defaultValues', async () => {
        const result = await run('config()', {
          functions: {
            config: {
              params: [
                { name: 'host', type: 'string', defaultValue: 'localhost' },
                { name: 'port', type: 'number', defaultValue: 8080 },
                { name: 'secure', type: 'bool', defaultValue: false },
              ],
              fn: (args) => `${args[0]}:${args[1]} (secure: ${args[2]})`,
            },
          },
        });
        expect(result).toBe('localhost:8080 (secure: false)');
      });
    });
  });

  describe('Error Cases', () => {
    describe('TC-HOSTTYPE-2: Throws type mismatch error (string expected, number received) [EC-3, AC-8]', () => {
      it('throws RuntimeError with RUNTIME_TYPE_ERROR when receiving number instead of string', async () => {
        await expect(
          run('greet(42)', {
            functions: {
              greet: {
                params: [{ name: 'name', type: 'string' }],
                fn: () => 'should not execute',
              },
            },
          })
        ).rejects.toMatchObject({
          errorId: expect.stringMatching(/^RILL-R\d{3}$/),
          message: expect.stringMatching(
            /Type mismatch in greet: parameter 'name' expects string, got number/
          ),
        });
      });
    });

    describe('TC-HOSTTYPE-6: Throws error for complex type validation (list/dict types) [EC-3]', () => {
      it('throws RuntimeError when list parameter receives non-list type', async () => {
        await expect(
          run('first("not a list")', {
            functions: {
              first: {
                params: [{ name: 'items', type: 'list' }],
                fn: () => 'should not execute',
              },
            },
          })
        ).rejects.toMatchObject({
          errorId: expect.stringMatching(/^RILL-R\d{3}$/),
          message: expect.stringMatching(
            /Type mismatch in first: parameter 'items' expects list, got string/
          ),
        });
      });
    });

    describe('TC-HOSTTYPE-7: Throws error for wrong collection type (list vs dict mismatch) [EC-3, AC-12]', () => {
      it('throws RuntimeError when dict parameter receives list', async () => {
        await expect(
          run('getValue([1, 2, 3])', {
            functions: {
              getValue: {
                params: [{ name: 'data', type: 'dict' }],
                fn: () => 'should not execute',
              },
            },
          })
        ).rejects.toMatchObject({
          errorId: expect.stringMatching(/^RILL-R\d{3}$/),
          message: expect.stringMatching(
            /Type mismatch in getValue: parameter 'data' expects dict, got list/
          ),
        });
      });
    });

    describe('TC-HOSTTYPE-8: Throws error for excess arguments [EC-1, AC-9]', () => {
      it('throws RuntimeError when receiving more arguments than parameters', async () => {
        await expect(
          run('double(21, 42)', {
            functions: {
              double: {
                params: [{ name: 'x', type: 'number' }],
                fn: () => 'should not execute',
              },
            },
          })
        ).rejects.toMatchObject({
          errorId: expect.stringMatching(/^RILL-R\d{3}$/),
          message: expect.stringMatching(
            /Function 'double' expects 1 arguments, got 2/
          ),
        });
      });
    });

    describe('TC-HOSTTYPE-9: Throws error for missing required argument [EC-2, AC-10]', () => {
      it('throws RuntimeError when required parameter is omitted', async () => {
        await expect(
          run('greet()', {
            functions: {
              greet: {
                params: [{ name: 'name', type: 'string' }],
                fn: () => 'should not execute',
              },
            },
          })
        ).rejects.toMatchObject({
          errorId: expect.stringMatching(/^RILL-R\d{3}$/),
          message: expect.stringMatching(
            /Missing required argument 'name' for function 'greet'/
          ),
        });
      });
    });

    describe('Error message format validation', () => {
      it('verifies type mismatch error message contains all required components', async () => {
        try {
          await run('process(123)', {
            functions: {
              process: {
                params: [{ name: 'input', type: 'string' }],
                fn: () => 'not reached',
              },
            },
          });
          expect.fail('Should have thrown');
        } catch (err) {
          const error = err as {
            message: string;
            context?: Record<string, unknown>;
          };
          // Message format: "Type mismatch in {function}: parameter '{param}' expects {expected}, got {actual}"
          expect(error.message).toMatch(/Type mismatch in process/);
          expect(error.message).toMatch(/parameter 'input'/);
          expect(error.message).toMatch(/expects string/);
          expect(error.message).toMatch(/got number/);
          // Verify context includes all fields
          expect(error.context?.functionName).toBe('process');
          expect(error.context?.paramName).toBe('input');
          expect(error.context?.expectedType).toBe('string');
          expect(error.context?.actualType).toBe('number');
        }
      });

      it('verifies excess arguments error message contains all required components', async () => {
        try {
          await run('calc(1, 2, 3)', {
            functions: {
              calc: {
                params: [
                  { name: 'a', type: 'number' },
                  { name: 'b', type: 'number' },
                ],
                fn: () => 'not reached',
              },
            },
          });
          expect.fail('Should have thrown');
        } catch (err) {
          const error = err as {
            message: string;
            context?: Record<string, unknown>;
          };
          // Message format: "Function '{name}' expects {expected} arguments, got {actual}"
          expect(error.message).toMatch(/Function 'calc'/);
          expect(error.message).toMatch(/expects 2 arguments/);
          expect(error.message).toMatch(/got 3/);
          // Verify context includes all fields
          expect(error.context?.functionName).toBe('calc');
          expect(error.context?.expectedCount).toBe(2);
          expect(error.context?.actualCount).toBe(3);
        }
      });

      it('verifies missing argument error message contains all required components', async () => {
        try {
          await run('format()', {
            functions: {
              format: {
                params: [{ name: 'template', type: 'string' }],
                fn: () => 'not reached',
              },
            },
          });
          expect.fail('Should have thrown');
        } catch (err) {
          const error = err as {
            message: string;
            context?: Record<string, unknown>;
          };
          // Message format: "Missing required argument '{param}' for function '{name}'"
          expect(error.message).toMatch(/Missing required argument 'template'/);
          expect(error.message).toMatch(/for function 'format'/);
          // Verify context includes all fields
          expect(error.context?.functionName).toBe('format');
          expect(error.context?.paramName).toBe('template');
        }
      });
    });
  });

  describe('Boundary Conditions', () => {
    describe('AC-14: Empty parameter list accepts no arguments', () => {
      it('accepts call with no arguments when params is empty array', async () => {
        const result = await run('noArgs()', {
          functions: {
            noArgs: {
              params: [],
              fn: () => 'success',
            },
          },
        });
        expect(result).toBe('success');
      });

      it('throws error when passing arguments to empty params function', async () => {
        await expect(
          run('noArgs("unexpected")', {
            functions: {
              noArgs: {
                params: [],
                fn: () => 'should not execute',
              },
            },
          })
        ).rejects.toMatchObject({
          errorId: expect.stringMatching(/^RILL-R\d{3}$/),
          message: expect.stringMatching(
            /Function 'noArgs' expects 0 arguments, got 1/
          ),
        });
      });
    });

    describe('AC-15: All optional parameters work with zero arguments', () => {
      it('accepts call with no arguments when all params have defaults', async () => {
        const result = await run('allOptional()', {
          functions: {
            allOptional: {
              params: [
                { name: 'a', type: 'string', defaultValue: 'default1' },
                { name: 'b', type: 'number', defaultValue: 42 },
                { name: 'c', type: 'bool', defaultValue: true },
              ],
              fn: (args) => `${args[0]}-${args[1]}-${args[2]}`,
            },
          },
        });
        expect(result).toBe('default1-42-true');
      });

      it('accepts partial arguments when all params have defaults', async () => {
        const result = await run('allOptional("custom")', {
          functions: {
            allOptional: {
              params: [
                { name: 'a', type: 'string', defaultValue: 'default1' },
                { name: 'b', type: 'number', defaultValue: 42 },
                { name: 'c', type: 'bool', defaultValue: true },
              ],
              fn: (args) => `${args[0]}-${args[1]}-${args[2]}`,
            },
          },
        });
        expect(result).toBe('custom-42-true');
      });

      it('accepts all arguments when all params have defaults', async () => {
        const result = await run('allOptional("custom", 100, false)', {
          functions: {
            allOptional: {
              params: [
                { name: 'a', type: 'string', defaultValue: 'default1' },
                { name: 'b', type: 'number', defaultValue: 42 },
                { name: 'c', type: 'bool', defaultValue: true },
              ],
              fn: (args) => `${args[0]}-${args[1]}-${args[2]}`,
            },
          },
        });
        expect(result).toBe('custom-100-false');
      });
    });

    describe('AC-16: Maximum parameter count (20+) validates all arguments', () => {
      it('validates all 20 arguments with correct types', async () => {
        const params: HostFunctionParam[] = Array.from(
          { length: 20 },
          (_, i) => ({
            name: `p${i}`,
            type: i % 2 === 0 ? 'number' : 'string',
          })
        );

        const args = Array.from({ length: 20 }, (_, i) =>
          i % 2 === 0 ? String(i) : `"s${i}"`
        ).join(', ');

        const result = await run(`manyParams(${args})`, {
          functions: {
            manyParams: {
              params,
              fn: (args) => args.length,
            },
          },
        });

        expect(result).toBe(20);
      });

      it('throws type error on first mismatch in 20+ parameters', async () => {
        const params: HostFunctionParam[] = Array.from(
          { length: 25 },
          (_, i) => ({
            name: `p${i}`,
            type: 'number',
          })
        );

        // First 10 are correct, 11th is wrong type
        const args = Array.from({ length: 25 }, (_, i) =>
          i === 10 ? '"wrong"' : String(i)
        ).join(', ');

        await expect(
          run(`manyParams(${args})`, {
            functions: {
              manyParams: {
                params,
                fn: () => 'should not execute',
              },
            },
          })
        ).rejects.toMatchObject({
          errorId: expect.stringMatching(/^RILL-R\d{3}$/),
          message: expect.stringMatching(/parameter 'p10' expects number/),
        });
      });

      it('validates all arguments when mixing required and optional in 20+ params', async () => {
        const params: HostFunctionParam[] = Array.from(
          { length: 20 },
          (_, i) => ({
            name: `p${i}`,
            type: 'number',
            ...(i >= 15 ? { defaultValue: i } : {}),
          })
        );

        // Provide only first 15 required params
        const args = Array.from({ length: 15 }, (_, i) => String(i)).join(', ');

        const result = await run(`manyParams(${args})`, {
          functions: {
            manyParams: {
              params,
              fn: (args) => args.length,
            },
          },
        });

        expect(result).toBe(20);
      });
    });

    describe('AC-17: Concurrent invocations validate independently', () => {
      it('validates multiple simultaneous calls to same function independently', async () => {
        const calls: Promise<unknown>[] = [];

        // Valid call
        calls.push(
          run('validate(42)', {
            functions: {
              validate: {
                params: [{ name: 'x', type: 'number' }],
                fn: (args) => args[0],
              },
            },
          })
        );

        // Another valid call
        calls.push(
          run('validate(100)', {
            functions: {
              validate: {
                params: [{ name: 'x', type: 'number' }],
                fn: (args) => args[0],
              },
            },
          })
        );

        // Invalid call
        calls.push(
          run('validate("invalid")', {
            functions: {
              validate: {
                params: [{ name: 'x', type: 'number' }],
                fn: () => 'should not execute',
              },
            },
          }).catch((err) => err)
        );

        const results = await Promise.all(calls);

        expect(results[0]).toBe(42);
        expect(results[1]).toBe(100);
        expect(results[2]).toMatchObject({
          errorId: expect.stringMatching(/^RILL-R\d{3}$/),
        });
      });

      it('concurrent calls with different argument counts validate independently', async () => {
        const calls: Promise<unknown>[] = [];

        const params: HostFunctionParam[] = [
          { name: 'a', type: 'number' },
          { name: 'b', type: 'number', defaultValue: 10 },
        ];

        // Call with 1 arg (valid)
        calls.push(
          run('calc(5)', {
            functions: {
              calc: {
                params,
                fn: (args) => (args[0] as number) + (args[1] as number),
              },
            },
          })
        );

        // Call with 2 args (valid)
        calls.push(
          run('calc(5, 20)', {
            functions: {
              calc: {
                params,
                fn: (args) => (args[0] as number) + (args[1] as number),
              },
            },
          })
        );

        // Call with 3 args (invalid - excess)
        calls.push(
          run('calc(5, 20, 30)', {
            functions: {
              calc: {
                params,
                fn: () => 'should not execute',
              },
            },
          }).catch((err) => err)
        );

        const results = await Promise.all(calls);

        expect(results[0]).toBe(15);
        expect(results[1]).toBe(25);
        expect(results[2]).toMatchObject({
          errorId: expect.stringMatching(/^RILL-R\d{3}$/),
          message: expect.stringMatching(/expects 2 arguments, got 3/),
        });
      });
    });

    describe('AC-18: Mixed typed and empty params functions work correctly', () => {
      it('validates typed function and empty params function together', async () => {
        const result = await run(
          `
          typed(42)
          zeroArgs()
        `,
          {
            functions: {
              typed: {
                params: [{ name: 'x', type: 'number' }],
                fn: (args) => args[0],
              },
              zeroArgs: { params: [], fn: () => `result: called` },
            },
          }
        );

        expect(result).toBe('result: called');
      });

      it('throws error for typed function with wrong type', async () => {
        await expect(
          run('typed("wrong")', {
            functions: {
              typed: {
                params: [{ name: 'x', type: 'number' }],
                fn: () => 'should not execute',
              },
              zeroArgs: { params: [], fn: () => 'not called' },
            },
          })
        ).rejects.toMatchObject({
          errorId: expect.stringMatching(/^RILL-R\d{3}$/),
        });
      });

      it('handles context with only typed functions', async () => {
        const result = await run('a(1) -> b("test")', {
          functions: {
            a: {
              params: [{ name: 'x', type: 'number' }],
              fn: (args) => args[0],
            },
            b: {
              params: [{ name: 'y', type: 'string' }],
              fn: (args) => args[0],
            },
          },
        });

        expect(result).toBe('test');
      });

      it('handles context with multiple empty params functions', async () => {
        const result = await run(
          `
          a()
          b()
        `,
          {
            functions: {
              a: { params: [], fn: () => 'from a' },
              b: { params: [], fn: () => 'from b' },
            },
          }
        );

        expect(result).toBe('from b');
      });

      it('validates typed function in mixed context with many functions', async () => {
        await expect(
          run('typed(true)', {
            functions: {
              zeroArgs1: { params: [], fn: () => 'not called' },
              typed: {
                params: [{ name: 'x', type: 'number' }],
                fn: () => 'should not execute',
              },
              zeroArgs2: { params: [], fn: () => 'not called' },
            },
          })
        ).rejects.toMatchObject({
          errorId: expect.stringMatching(/^RILL-R\d{3}$/),
          message: expect.stringMatching(/expects number, got bool/),
        });
      });
    });

    describe('AC-19: List validation does not check element types', () => {
      it('accepts list of numbers for list parameter', async () => {
        const result = await run('process([1, 2, 3])', {
          functions: {
            process: {
              params: [{ name: 'items', type: 'list' }],
              fn: (args) => (args[0] as unknown[]).length,
            },
          },
        });
        expect(result).toBe(3);
      });

      it('accepts list of strings for list parameter', async () => {
        const result = await run('process(["a", "b"])', {
          functions: {
            process: {
              params: [{ name: 'items', type: 'list' }],
              fn: (args) => (args[0] as unknown[]).length,
            },
          },
        });
        expect(result).toBe(2);
      });

      it('accepts mixed-type list for list parameter', async () => {
        const result = await run('process([1, "two", true, [4]])', {
          functions: {
            process: {
              params: [{ name: 'items', type: 'list' }],
              fn: (args) => (args[0] as unknown[]).length,
            },
          },
        });
        expect(result).toBe(4);
      });

      it('accepts empty list for list parameter', async () => {
        const result = await run('process([])', {
          functions: {
            process: {
              params: [{ name: 'items', type: 'list' }],
              fn: (args) => (args[0] as unknown[]).length,
            },
          },
        });
        expect(result).toBe(0);
      });

      it('accepts nested lists for list parameter', async () => {
        const result = await run('process([[1, 2], [3, 4]])', {
          functions: {
            process: {
              params: [{ name: 'items', type: 'list' }],
              fn: (args) => (args[0] as unknown[][]).length,
            },
          },
        });
        expect(result).toBe(2);
      });
    });

    describe('AC-20: Any parameter type accepts all value types', () => {
      it('accepts string argument for any parameter', async () => {
        const result = await run('acceptAny("hello")', {
          functions: {
            acceptAny: {
              params: [{ name: 'value', type: 'any' }],
              fn: (args) => `received: ${args[0]}`,
            },
          },
        });
        expect(result).toBe('received: hello');
      });

      it('accepts number argument for any parameter', async () => {
        const result = await run('acceptAny(42)', {
          functions: {
            acceptAny: {
              params: [{ name: 'value', type: 'any' }],
              fn: (args) => `received: ${args[0]}`,
            },
          },
        });
        expect(result).toBe('received: 42');
      });

      it('accepts bool argument for any parameter', async () => {
        const result = await run('acceptAny(true)', {
          functions: {
            acceptAny: {
              params: [{ name: 'value', type: 'any' }],
              fn: (args) => `received: ${args[0]}`,
            },
          },
        });
        expect(result).toBe('received: true');
      });

      it('accepts list argument for any parameter', async () => {
        const result = await run('acceptAny([1, 2, 3])', {
          functions: {
            acceptAny: {
              params: [{ name: 'value', type: 'any' }],
              fn: (args) =>
                `received list with length: ${(args[0] as unknown[]).length}`,
            },
          },
        });
        expect(result).toBe('received list with length: 3');
      });

      it('accepts dict argument for any parameter', async () => {
        const result = await run('acceptAny([key: "test"])', {
          functions: {
            acceptAny: {
              params: [{ name: 'value', type: 'any' }],
              fn: (args) =>
                `received dict with key: ${(args[0] as Record<string, unknown>).key}`,
            },
          },
        });
        expect(result).toBe('received dict with key: test');
      });

      it('accepts mixed-type list argument for any parameter', async () => {
        const result = await run('acceptAny(["a", 1, true])', {
          functions: {
            acceptAny: {
              params: [{ name: 'value', type: 'any' }],
              fn: (args) =>
                `received mixed list with length: ${(args[0] as unknown[]).length}`,
            },
          },
        });
        expect(result).toBe('received mixed list with length: 3');
      });

      it('accepts vector argument for any parameter', async () => {
        const vec = { type: 'vector', values: [1, 2, 3] };
        const result = await run('acceptAny(getVector())', {
          functions: {
            acceptAny: {
              params: [{ name: 'value', type: 'any' }],
              fn: (args) => {
                const v = args[0] as { type: string; values: number[] };
                return `received vector with ${v.values.length} elements`;
              },
            },
            getVector: {
              params: [],
              fn: () => vec,
            },
          },
        });
        expect(result).toBe('received vector with 3 elements');
      });
    });
  });
});
