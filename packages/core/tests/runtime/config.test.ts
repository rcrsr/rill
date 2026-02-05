/**
 * Rill Runtime Tests: Configuration
 * Tests for timeout and autoExceptions
 */

import {
  AutoExceptionError,
  createRuntimeContext,
  RuntimeError,
  TimeoutError,
} from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

import { mockAsyncFn, run } from '../helpers/runtime.js';

describe('Rill Runtime: Configuration', () => {
  describe('Timeout', () => {
    it('completes when function finishes before timeout', async () => {
      const fastFn = mockAsyncFn(10, 'done');
      const result = await run('slowFn()', {
        functions: { slowFn: fastFn },
        timeout: 100,
      });
      expect(result).toBe('done');
    });

    it('throws TimeoutError when function exceeds timeout', async () => {
      const slowFn = mockAsyncFn(200, 'done');
      await expect(
        run('slowFn()', {
          functions: { slowFn },
          timeout: 50,
        })
      ).rejects.toThrow(TimeoutError);
    });

    it('TimeoutError has correct properties', async () => {
      const slowFn = mockAsyncFn(200, 'done');
      try {
        await run('slowFn()', {
          functions: { slowFn },
          timeout: 50,
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeoutError);
        const timeoutErr = err as TimeoutError;
        expect(timeoutErr.timeoutMs).toBe(50);
        expect(timeoutErr.functionName).toBe('slowFn');
      }
    });

    it('does not apply timeout to sync functions', async () => {
      const syncFn = {
        params: [{ name: 'input', type: 'string' }],
        fn: (): string => 'sync result',
      };
      const result = await run('"x" -> syncFn', {
        functions: { syncFn },
        timeout: 1, // Very short timeout
      });
      expect(result).toBe('sync result');
    });

    it('timeout applies to each function call independently', async () => {
      let callCount = 0;
      const fn = {
        params: [{ name: 'input', type: 'string' }],
        fn: async (): Promise<string> => {
          callCount++;
          await new Promise((r) => setTimeout(r, 30));
          return `call${callCount}`;
        },
      };
      const result = await run('"x" -> fn -> fn -> fn', {
        functions: { fn },
        timeout: 100, // Each call takes 30ms, should all complete
      });
      expect(result).toBe('call3');
      expect(callCount).toBe(3);
    });
  });

  describe('AutoExceptions', () => {
    it('throws when pattern matches string $_', async () => {
      await expect(
        run('"ERROR: something failed"', {
          autoExceptions: ['ERROR'],
        })
      ).rejects.toThrow(AutoExceptionError);
    });

    it('does not throw when pattern does not match', async () => {
      const result = await run('"OK: success"', {
        autoExceptions: ['ERROR'],
      });
      expect(result).toBe('OK: success');
    });

    it('matches with regex pattern', async () => {
      await expect(
        run('"Code: 500"', {
          autoExceptions: ['Code: [45]\\d\\d'],
        })
      ).rejects.toThrow(AutoExceptionError);
    });

    it('does not throw for non-string values', async () => {
      const result = await run('42', {
        autoExceptions: ['42'],
      });
      expect(result).toBe(42);
    });

    it('checks after each statement', async () => {
      // First statement OK, second triggers exception
      await expect(
        run('"OK" => $first\n"ERROR happened"', {
          autoExceptions: ['ERROR'],
        })
      ).rejects.toThrow(AutoExceptionError);
    });

    it('AutoExceptionError has correct properties', async () => {
      try {
        await run('"FATAL: crash"', {
          autoExceptions: ['FATAL'],
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AutoExceptionError);
        const autoErr = err as AutoExceptionError;
        expect(autoErr.pattern).toBe('FATAL');
        expect(autoErr.matchedValue).toBe('FATAL: crash');
      }
    });

    it('supports multiple patterns', async () => {
      await expect(
        run('"WARNING: issue"', {
          autoExceptions: ['ERROR', 'FATAL', 'WARNING'],
        })
      ).rejects.toThrow(AutoExceptionError);
    });

    it('first matching pattern wins', async () => {
      try {
        await run('"ERROR and FATAL"', {
          autoExceptions: ['ERROR', 'FATAL'],
        });
        expect.fail('Should have thrown');
      } catch (err) {
        const autoErr = err as AutoExceptionError;
        expect(autoErr.pattern).toBe('ERROR');
      }
    });

    it('throws on invalid regex pattern during context creation', () => {
      expect(() =>
        createRuntimeContext({
          autoExceptions: ['[invalid'],
        })
      ).toThrow(RuntimeError);
    });

    it('works with complex regex', async () => {
      await expect(
        run('"Exit code: 1"', {
          autoExceptions: ['Exit code: [1-9]\\d*'],
        })
      ).rejects.toThrow(AutoExceptionError);

      // Exit code 0 should not match
      const result = await run('"Exit code: 0"', {
        autoExceptions: ['Exit code: [1-9]\\d*'],
      });
      expect(result).toBe('Exit code: 0');
    });
  });

  describe('Combined Configuration', () => {
    it('timeout and autoExceptions work together', async () => {
      const slowFn = mockAsyncFn(50, 'ERROR: failed');

      // AutoException should trigger on the result
      await expect(
        run('slowFn()', {
          functions: { slowFn },
          timeout: 200,
          autoExceptions: ['ERROR'],
        })
      ).rejects.toThrow(AutoExceptionError);
    });

    it('timeout fires before autoException when function is slow', async () => {
      const verySlowFn = mockAsyncFn(500, 'ERROR: failed');

      await expect(
        run('verySlowFn()', {
          functions: { verySlowFn },
          timeout: 50,
          autoExceptions: ['ERROR'],
        })
      ).rejects.toThrow(TimeoutError);
    });
  });

  describe('requireDescriptions', () => {
    it('accepts requireDescriptions in RuntimeOptions', () => {
      const testFn = {
        params: [
          {
            name: 'input',
            type: 'string' as const,
            description: 'Test input',
          },
        ],
        fn: (): string => 'result',
        description: 'Test function',
      };

      expect(() =>
        createRuntimeContext({
          functions: { testFn },
          requireDescriptions: true,
        })
      ).not.toThrow();
    });

    it('accepts requireDescriptions: false', () => {
      const testFn = {
        params: [{ name: 'input', type: 'string' as const }],
        fn: (): string => 'result',
      };

      expect(() =>
        createRuntimeContext({
          functions: { testFn },
          requireDescriptions: false,
        })
      ).not.toThrow();
    });

    it('accepts requireDescriptions: undefined (default)', () => {
      const testFn = {
        params: [{ name: 'input', type: 'string' as const }],
        fn: (): string => 'result',
      };

      expect(() =>
        createRuntimeContext({
          functions: { testFn },
        })
      ).not.toThrow();
    });

    describe('EC-2: Function missing description', () => {
      it('throws Error when function has no description and requireDescriptions is true', () => {
        const testFn = {
          params: [
            {
              name: 'input',
              type: 'string' as const,
              description: 'Test input',
            },
          ],
          fn: (): string => 'result',
        };

        expect(() =>
          createRuntimeContext({
            functions: { myFunction: testFn },
            requireDescriptions: true,
          })
        ).toThrow(
          "Function 'myFunction' requires description (requireDescriptions enabled)"
        );
      });

      it('throws Error when function has undefined description', () => {
        const testFn = {
          params: [
            {
              name: 'input',
              type: 'string' as const,
              description: 'Test input',
            },
          ],
          fn: (): string => 'result',
          description: undefined,
        };

        expect(() =>
          createRuntimeContext({
            functions: { testFunc: testFn },
            requireDescriptions: true,
          })
        ).toThrow(
          "Function 'testFunc' requires description (requireDescriptions enabled)"
        );
      });

      it('throws Error when function has whitespace-only description', () => {
        const testFn = {
          params: [
            {
              name: 'input',
              type: 'string' as const,
              description: 'Test input',
            },
          ],
          fn: (): string => 'result',
          description: '   ',
        };

        expect(() =>
          createRuntimeContext({
            functions: { blankDesc: testFn },
            requireDescriptions: true,
          })
        ).toThrow(
          "Function 'blankDesc' requires description (requireDescriptions enabled)"
        );
      });

      it('throws Error when function has empty string description', () => {
        const testFn = {
          params: [
            {
              name: 'input',
              type: 'string' as const,
              description: 'Test input',
            },
          ],
          fn: (): string => 'result',
          description: '',
        };

        expect(() =>
          createRuntimeContext({
            functions: { emptyDesc: testFn },
            requireDescriptions: true,
          })
        ).toThrow(
          "Function 'emptyDesc' requires description (requireDescriptions enabled)"
        );
      });

      it('allows undocumented function when requireDescriptions is false', () => {
        const testFn = {
          params: [{ name: 'input', type: 'string' as const }],
          fn: (): string => 'result',
        };

        expect(() =>
          createRuntimeContext({
            functions: { testFn },
            requireDescriptions: false,
          })
        ).not.toThrow();
      });

      it('allows undocumented function when requireDescriptions is undefined', () => {
        const testFn = {
          params: [{ name: 'input', type: 'string' as const }],
          fn: (): string => 'result',
        };

        expect(() =>
          createRuntimeContext({
            functions: { testFn },
          })
        ).not.toThrow();
      });
    });

    describe('EC-3: Parameter missing description', () => {
      it('throws Error when parameter has no description and requireDescriptions is true', () => {
        const testFn = {
          params: [
            {
              name: 'undocumented',
              type: 'string' as const,
            },
          ],
          fn: (): string => 'result',
          description: 'Test function',
        };

        expect(() =>
          createRuntimeContext({
            functions: { myFunction: testFn },
            requireDescriptions: true,
          })
        ).toThrow(
          "Parameter 'undocumented' of function 'myFunction' requires description (requireDescriptions enabled)"
        );
      });

      it('throws Error when parameter has undefined description', () => {
        const testFn = {
          params: [
            {
              name: 'myParam',
              type: 'string' as const,
              description: undefined,
            },
          ],
          fn: (): string => 'result',
          description: 'Test function',
        };

        expect(() =>
          createRuntimeContext({
            functions: { testFunc: testFn },
            requireDescriptions: true,
          })
        ).toThrow(
          "Parameter 'myParam' of function 'testFunc' requires description (requireDescriptions enabled)"
        );
      });

      it('throws Error when parameter has whitespace-only description', () => {
        const testFn = {
          params: [
            {
              name: 'blankParam',
              type: 'string' as const,
              description: '  \t  ',
            },
          ],
          fn: (): string => 'result',
          description: 'Test function',
        };

        expect(() =>
          createRuntimeContext({
            functions: { myFunc: testFn },
            requireDescriptions: true,
          })
        ).toThrow(
          "Parameter 'blankParam' of function 'myFunc' requires description (requireDescriptions enabled)"
        );
      });

      it('throws Error when parameter has empty string description', () => {
        const testFn = {
          params: [
            {
              name: 'emptyParam',
              type: 'string' as const,
              description: '',
            },
          ],
          fn: (): string => 'result',
          description: 'Test function',
        };

        expect(() =>
          createRuntimeContext({
            functions: { testFunc: testFn },
            requireDescriptions: true,
          })
        ).toThrow(
          "Parameter 'emptyParam' of function 'testFunc' requires description (requireDescriptions enabled)"
        );
      });

      it('throws Error for first undocumented parameter in multi-parameter function', () => {
        const testFn = {
          params: [
            {
              name: 'documented',
              type: 'string' as const,
              description: 'First param',
            },
            {
              name: 'undocumented',
              type: 'number' as const,
            },
            {
              name: 'alsoDocumented',
              type: 'bool' as const,
              description: 'Third param',
            },
          ],
          fn: (): string => 'result',
          description: 'Test function',
        };

        expect(() =>
          createRuntimeContext({
            functions: { multiParam: testFn },
            requireDescriptions: true,
          })
        ).toThrow(
          "Parameter 'undocumented' of function 'multiParam' requires description (requireDescriptions enabled)"
        );
      });

      it('allows undocumented parameters when requireDescriptions is false', () => {
        const testFn = {
          params: [
            {
              name: 'undocumented',
              type: 'string' as const,
            },
          ],
          fn: (): string => 'result',
          description: 'Test function',
        };

        expect(() =>
          createRuntimeContext({
            functions: { testFn },
            requireDescriptions: false,
          })
        ).not.toThrow();
      });

      it('allows undocumented parameters when requireDescriptions is undefined', () => {
        const testFn = {
          params: [
            {
              name: 'undocumented',
              type: 'string' as const,
            },
          ],
          fn: (): string => 'result',
          description: 'Test function',
        };

        expect(() =>
          createRuntimeContext({
            functions: { testFn },
          })
        ).not.toThrow();
      });
    });

    describe('IC-3: Whitespace-only strings count as undocumented', () => {
      it('rejects function with tab-only description', () => {
        const testFn = {
          params: [
            {
              name: 'input',
              type: 'string' as const,
              description: 'Valid param description',
            },
          ],
          fn: (): string => 'result',
          description: '\t\t',
        };

        expect(() =>
          createRuntimeContext({
            functions: { testFunc: testFn },
            requireDescriptions: true,
          })
        ).toThrow(
          "Function 'testFunc' requires description (requireDescriptions enabled)"
        );
      });

      it('rejects parameter with newline-only description', () => {
        const testFn = {
          params: [
            {
              name: 'input',
              type: 'string' as const,
              description: '\n\n',
            },
          ],
          fn: (): string => 'result',
          description: 'Valid function description',
        };

        expect(() =>
          createRuntimeContext({
            functions: { testFunc: testFn },
            requireDescriptions: true,
          })
        ).toThrow(
          "Parameter 'input' of function 'testFunc' requires description (requireDescriptions enabled)"
        );
      });

      it('accepts description with content after trimming', () => {
        const testFn = {
          params: [
            {
              name: 'input',
              type: 'string' as const,
              description: '  Valid description  ',
            },
          ],
          fn: (): string => 'result',
          description: '  Valid function description  ',
        };

        expect(() =>
          createRuntimeContext({
            functions: { testFunc: testFn },
            requireDescriptions: true,
          })
        ).not.toThrow();
      });
    });

    describe('Combined validation', () => {
      it('validates both function and all parameters when requireDescriptions is true', () => {
        const testFn = {
          params: [
            {
              name: 'param1',
              type: 'string' as const,
              description: 'First parameter',
            },
            {
              name: 'param2',
              type: 'number' as const,
              description: 'Second parameter',
            },
          ],
          fn: (): string => 'result',
          description: 'Test function with documentation',
        };

        expect(() =>
          createRuntimeContext({
            functions: { validFunc: testFn },
            requireDescriptions: true,
          })
        ).not.toThrow();
      });

      it('accepts functions with no parameters when requireDescriptions is true', () => {
        const testFn = {
          params: [],
          fn: (): string => 'result',
          description: 'Function with no parameters',
        };

        expect(() =>
          createRuntimeContext({
            functions: { noParams: testFn },
            requireDescriptions: true,
          })
        ).not.toThrow();
      });
    });
  });

  describe('Return Type Validation (IC-3)', () => {
    it('accepts valid returnType "string" during registration', () => {
      const testFn = {
        params: [{ name: 'input', type: 'string' as const }],
        fn: (): string => 'result',
        returnType: 'string' as const,
      };

      expect(() =>
        createRuntimeContext({
          functions: { testFn },
        })
      ).not.toThrow();
    });

    it('accepts valid returnType "number" during registration', () => {
      const testFn = {
        params: [{ name: 'input', type: 'string' as const }],
        fn: (): number => 42,
        returnType: 'number' as const,
      };

      expect(() =>
        createRuntimeContext({
          functions: { testFn },
        })
      ).not.toThrow();
    });

    it('accepts valid returnType "bool" during registration', () => {
      const testFn = {
        params: [{ name: 'input', type: 'string' as const }],
        fn: (): boolean => true,
        returnType: 'bool' as const,
      };

      expect(() =>
        createRuntimeContext({
          functions: { testFn },
        })
      ).not.toThrow();
    });

    it('accepts valid returnType "list" during registration', () => {
      const testFn = {
        params: [{ name: 'input', type: 'string' as const }],
        fn: (): string[] => [],
        returnType: 'list' as const,
      };

      expect(() =>
        createRuntimeContext({
          functions: { testFn },
        })
      ).not.toThrow();
    });

    it('accepts valid returnType "dict" during registration', () => {
      const testFn = {
        params: [{ name: 'input', type: 'string' as const }],
        fn: (): Record<string, unknown> => ({}),
        returnType: 'dict' as const,
      };

      expect(() =>
        createRuntimeContext({
          functions: { testFn },
        })
      ).not.toThrow();
    });

    it('accepts valid returnType "any" during registration', () => {
      const testFn = {
        params: [{ name: 'input', type: 'string' as const }],
        fn: (): unknown => 'anything',
        returnType: 'any' as const,
      };

      expect(() =>
        createRuntimeContext({
          functions: { testFn },
        })
      ).not.toThrow();
    });

    it('accepts function without returnType (defaults to any)', () => {
      const testFn = {
        params: [{ name: 'input', type: 'string' as const }],
        fn: (): string => 'result',
      };

      expect(() =>
        createRuntimeContext({
          functions: { testFn },
        })
      ).not.toThrow();
    });

    it('throws Error for invalid returnType during registration', () => {
      const testFn = {
        params: [{ name: 'input', type: 'string' as const }],
        fn: (): string => 'result',
        returnType: 'void' as unknown as 'string',
      };

      expect(() =>
        createRuntimeContext({
          functions: { testFn },
        })
      ).toThrow(
        "Invalid returnType for function 'testFn': expected one of string, number, bool, list, dict, any"
      );
    });

    it('throws Error for invalid returnType "object"', () => {
      const testFn = {
        params: [{ name: 'input', type: 'string' as const }],
        fn: (): string => 'result',
        returnType: 'object' as unknown as 'string',
      };

      expect(() =>
        createRuntimeContext({
          functions: { badFn: testFn },
        })
      ).toThrow(
        "Invalid returnType for function 'badFn': expected one of string, number, bool, list, dict, any"
      );
    });

    it('validates returnType before storing callable', () => {
      const testFn = {
        params: [{ name: 'input', type: 'string' as const }],
        fn: (): string => 'result',
        returnType: 'invalid' as unknown as 'string',
      };

      let contextCreated = false;
      try {
        const ctx = createRuntimeContext({
          functions: { testFn },
        });
        contextCreated = true;
        expect(ctx.functions.has('testFn')).toBe(false);
      } catch (err) {
        expect(contextCreated).toBe(false);
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain('Invalid returnType');
      }
    });

    it('includes function name in error message', () => {
      const testFn = {
        params: [{ name: 'input', type: 'string' as const }],
        fn: (): string => 'result',
        returnType: 'invalid' as unknown as 'string',
      };

      expect(() =>
        createRuntimeContext({
          functions: { myCustomFunction: testFn },
        })
      ).toThrow('myCustomFunction');
    });
  });
});
