/**
 * Rill Runtime Tests: Function Metadata
 * Tests for returnType, requireDescriptions, and getDocumentationCoverage
 *
 * Specification Mapping:
 *
 * Return Type Tests (AC-1, AC-2, AC-3, AC-14):
 * - AC-1: Host function with returnType 'string' includes in metadata
 * - AC-2: Host function without returnType defaults to 'any'
 * - AC-3: Script closure reports returnType 'any'
 * - AC-14: All 6 return types preserved in metadata
 *
 * requireDescriptions Tests (AC-4, AC-7, AC-8, EC-2, EC-3):
 * - AC-4: requireDescriptions false allows undocumented functions
 * - AC-7: requireDescriptions true + missing function description throws [EC-2]
 * - AC-8: requireDescriptions true + missing parameter description throws [EC-3]
 *
 * getDocumentationCoverage Tests (AC-5, AC-11, AC-12, AC-13):
 * - AC-5: Fully documented context returns 100% completeness
 * - AC-11: Empty context returns { total: 0, documented: 0, percentage: 100 }
 * - AC-12: Whitespace-only description counts as undocumented
 * - AC-13: Function with 0 params and description counts as documented
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  createRuntimeContext,
  getFunctions,
  getDocumentationCoverage,
  rillTypeToTypeValue,
} from '@rcrsr/rill';

describe('Rill Runtime: Function Metadata', () => {
  describe('Return Type Tests', () => {
    describe('AC-1: Host function with returnType includes in metadata', () => {
      it('returns host function with returnType "string"', () => {
        const ctx = createRuntimeContext({
          functions: {
            greet: {
              params: [
                {
                  name: 'name',
                  type: { type: 'string' },
                  defaultValue: undefined,
                  annotations: {},
                },
              ],
              fn: (args) => `Hello, ${args[0]}!`,
              annotations: { description: 'Greets a user by name' },
              returnType: rillTypeToTypeValue({ type: 'string' }),
            },
          },
        });

        const functions = getFunctions(ctx);
        const greet = functions.find((f) => f.name === 'greet');

        expect(greet).toBeDefined();
        expect(greet?.returnType).toBe('string');
      });

      it('returns host function with returnType "number"', () => {
        const ctx = createRuntimeContext({
          functions: {
            add: {
              params: [
                {
                  name: 'a',
                  type: { type: 'number' },
                  defaultValue: undefined,
                  annotations: {},
                },
                {
                  name: 'b',
                  type: { type: 'number' },
                  defaultValue: undefined,
                  annotations: {},
                },
              ],
              fn: (args) => (args[0] as number) + (args[1] as number),
              annotations: { description: 'Adds two numbers' },
              returnType: rillTypeToTypeValue({ type: 'number' }),
            },
          },
        });

        const functions = getFunctions(ctx);
        const add = functions.find((f) => f.name === 'add');

        expect(add?.returnType).toBe('number');
      });

      it('returns host function with returnType "bool"', () => {
        const ctx = createRuntimeContext({
          functions: {
            isValid: {
              params: [
                {
                  name: 'value',
                  type: { type: 'string' },
                  defaultValue: undefined,
                  annotations: {},
                },
              ],
              fn: (args) => (args[0] as string).length > 0,
              annotations: { description: 'Checks if string is non-empty' },
              returnType: rillTypeToTypeValue({ type: 'bool' }),
            },
          },
        });

        const functions = getFunctions(ctx);
        const isValid = functions.find((f) => f.name === 'isValid');

        expect(isValid?.returnType).toBe('bool');
      });
    });

    describe('AC-2: Host function without returnType defaults to "any"', () => {
      it('defaults to "any" when returnType omitted', () => {
        const ctx = createRuntimeContext({
          functions: {
            noReturnType: {
              params: [
                {
                  name: 'x',
                  type: { type: 'string' },
                  defaultValue: undefined,
                  annotations: {},
                },
              ],
              fn: (args) => args[0],
              annotations: { description: 'Function without return type' },
              returnType: anyTypeValue,
            },
          },
        });

        const functions = getFunctions(ctx);
        const func = functions.find((f) => f.name === 'noReturnType');

        expect(func?.returnType).toBe('any');
      });

      it('defaults to "any" for multiple functions without returnType', () => {
        const ctx = createRuntimeContext({
          functions: {
            first: {
              params: [],
              fn: () => 'first',
              annotations: { description: 'First function' },
              returnType: anyTypeValue,
            },
            second: {
              params: [],
              fn: () => 42,
              annotations: { description: 'Second function' },
              returnType: anyTypeValue,
            },
          },
        });

        const functions = getFunctions(ctx);

        expect(functions.find((f) => f.name === 'first')?.returnType).toBe(
          'any'
        );
        expect(functions.find((f) => f.name === 'second')?.returnType).toBe(
          'any'
        );
      });
    });

    describe('AC-3: Script closure reports returnType "any"', () => {
      it('returns "any" for script closure', () => {
        const ctx = createRuntimeContext({
          variables: {
            scriptFn: {
              __type: 'callable' as const,
              kind: 'script' as const,
              params: [
                {
                  name: 'x',
                  type: { type: 'string' } as const,
                  defaultValue: undefined,
                  annotations: {},
                },
              ],
              body: { type: 'Body' as const, statements: [] },
              definingScope: {} as any,
              annotations: {},
              isProperty: false,
            },
          },
        });

        const functions = getFunctions(ctx);
        const scriptFn = functions.find((f) => f.name === 'scriptFn');

        expect(scriptFn).toBeDefined();
        expect(scriptFn?.returnType).toBe('any');
      });
    });

    describe('AC-14: All 6 return types preserved in metadata', () => {
      it('preserves all return types: string, number, bool, list, dict, any', () => {
        const ctx = createRuntimeContext({
          functions: {
            getString: {
              params: [],
              fn: () => 'text',
              returnType: rillTypeToTypeValue({ type: 'string' }),
            },
            getNumber: {
              params: [],
              fn: () => 42,
              returnType: rillTypeToTypeValue({ type: 'number' }),
            },
            getBool: {
              params: [],
              fn: () => true,
              returnType: rillTypeToTypeValue({ type: 'bool' }),
            },
            getList: {
              params: [],
              fn: () => [1, 2, 3],
              returnType: rillTypeToTypeValue({ type: 'list' }),
            },
            getDict: {
              params: [],
              fn: () => ({ key: 'value' }),
              returnType: rillTypeToTypeValue({ type: 'dict' }),
            },
            getAny: {
              params: [],
              fn: () => 'anything',
              returnType: anyTypeValue,
            },
          },
        });

        const functions = getFunctions(ctx);

        expect(functions.find((f) => f.name === 'getString')?.returnType).toBe(
          'string'
        );
        expect(functions.find((f) => f.name === 'getNumber')?.returnType).toBe(
          'number'
        );
        expect(functions.find((f) => f.name === 'getBool')?.returnType).toBe(
          'bool'
        );
        expect(functions.find((f) => f.name === 'getList')?.returnType).toBe(
          'list'
        );
        expect(functions.find((f) => f.name === 'getDict')?.returnType).toBe(
          'dict'
        );
        expect(functions.find((f) => f.name === 'getAny')?.returnType).toBe(
          'any'
        );
      });
    });
  });

  describe('requireDescriptions Validation', () => {
    describe('AC-4: requireDescriptions false allows undocumented functions', () => {
      it('allows function without description when requireDescriptions false', () => {
        expect(() =>
          createRuntimeContext({
            functions: {
              undocumented: {
                params: [
                  {
                    name: 'x',
                    type: { type: 'string' },
                    defaultValue: undefined,
                    annotations: {},
                  },
                ],
                fn: (args) => args[0],
                returnType: anyTypeValue,
              },
            },
            requireDescriptions: false,
          })
        ).not.toThrow();
      });

      it('allows function without description when requireDescriptions omitted', () => {
        expect(() =>
          createRuntimeContext({
            functions: {
              undocumented: {
                params: [
                  {
                    name: 'x',
                    type: { type: 'string' },
                    defaultValue: undefined,
                    annotations: {},
                  },
                ],
                fn: (args) => args[0],
                returnType: anyTypeValue,
              },
            },
          })
        ).not.toThrow();
      });

      it('allows parameter without description when requireDescriptions false', () => {
        expect(() =>
          createRuntimeContext({
            functions: {
              partialDocs: {
                params: [
                  {
                    name: 'x',
                    type: { type: 'string' },
                    defaultValue: undefined,
                    annotations: {},
                  },
                ],
                fn: (args) => args[0],
                annotations: { description: 'Function with description' },
                returnType: anyTypeValue,
              },
            },
            requireDescriptions: false,
          })
        ).not.toThrow();
      });
    });

    describe('AC-7: requireDescriptions true + missing function description throws [EC-2]', () => {
      it('throws Error when function description missing', () => {
        expect(() =>
          createRuntimeContext({
            functions: {
              noDesc: {
                params: [
                  {
                    name: 'x',
                    type: { type: 'string' },
                    defaultValue: undefined,
                    annotations: { description: 'A param' },
                  },
                ],
                fn: (args) => args[0],
                returnType: anyTypeValue,
              },
            },
            requireDescriptions: true,
          })
        ).toThrow(
          "Function 'noDesc' requires description (requireDescriptions enabled)"
        );
      });

      it('throws Error when function description is undefined', () => {
        expect(() =>
          createRuntimeContext({
            functions: {
              noDesc: {
                params: [
                  {
                    name: 'x',
                    type: { type: 'string' },
                    defaultValue: undefined,
                    annotations: { description: 'A param' },
                  },
                ],
                fn: (args) => args[0],
                returnType: anyTypeValue,
                // No annotations.description
              },
            },
            requireDescriptions: true,
          })
        ).toThrow(
          "Function 'noDesc' requires description (requireDescriptions enabled)"
        );
      });

      it('throws Error when function description is empty string', () => {
        expect(() =>
          createRuntimeContext({
            functions: {
              emptyDesc: {
                params: [
                  {
                    name: 'x',
                    type: { type: 'string' },
                    defaultValue: undefined,
                    annotations: { description: 'A param' },
                  },
                ],
                fn: (args) => args[0],
                annotations: { description: '' },
                returnType: anyTypeValue,
              },
            },
            requireDescriptions: true,
          })
        ).toThrow(
          "Function 'emptyDesc' requires description (requireDescriptions enabled)"
        );
      });

      it('throws Error when function description is whitespace-only', () => {
        expect(() =>
          createRuntimeContext({
            functions: {
              whitespaceDesc: {
                params: [
                  {
                    name: 'x',
                    type: { type: 'string' },
                    defaultValue: undefined,
                    annotations: { description: 'A param' },
                  },
                ],
                fn: (args) => args[0],
                annotations: { description: '   ' },
                returnType: anyTypeValue,
              },
            },
            requireDescriptions: true,
          })
        ).toThrow(
          "Function 'whitespaceDesc' requires description (requireDescriptions enabled)"
        );
      });
    });

    describe('AC-8: requireDescriptions true + missing parameter description throws [EC-3]', () => {
      it('throws Error when parameter description missing', () => {
        expect(() =>
          createRuntimeContext({
            functions: {
              noParamDesc: {
                params: [
                  {
                    name: 'x',
                    type: { type: 'string' },
                    defaultValue: undefined,
                    annotations: {},
                  },
                ],
                fn: (args) => args[0],
                annotations: { description: 'Function with description' },
                returnType: anyTypeValue,
              },
            },
            requireDescriptions: true,
          })
        ).toThrow(
          "Parameter 'x' of function 'noParamDesc' requires description (requireDescriptions enabled)"
        );
      });

      it('throws Error when parameter description is undefined', () => {
        expect(() =>
          createRuntimeContext({
            functions: {
              noParamDesc: {
                params: [
                  {
                    name: 'x',
                    type: { type: 'string' },
                    defaultValue: undefined,
                    annotations: {},
                  },
                ],
                fn: (args) => args[0],
                annotations: { description: 'Function with description' },
                returnType: anyTypeValue,
              },
            },
            requireDescriptions: true,
          })
        ).toThrow(
          "Parameter 'x' of function 'noParamDesc' requires description (requireDescriptions enabled)"
        );
      });

      it('throws Error when parameter description is empty string', () => {
        expect(() =>
          createRuntimeContext({
            functions: {
              emptyParamDesc: {
                params: [
                  {
                    name: 'x',
                    type: { type: 'string' },
                    defaultValue: undefined,
                    annotations: { description: '' },
                  },
                ],
                fn: (args) => args[0],
                annotations: { description: 'Function with description' },
                returnType: anyTypeValue,
              },
            },
            requireDescriptions: true,
          })
        ).toThrow(
          "Parameter 'x' of function 'emptyParamDesc' requires description (requireDescriptions enabled)"
        );
      });

      it('throws Error when parameter description is whitespace-only', () => {
        expect(() =>
          createRuntimeContext({
            functions: {
              whitespaceParamDesc: {
                params: [
                  {
                    name: 'x',
                    type: { type: 'string' },
                    defaultValue: undefined,
                    annotations: { description: '  \n  ' },
                  },
                ],
                fn: (args) => args[0],
                annotations: { description: 'Function with description' },
                returnType: anyTypeValue,
              },
            },
            requireDescriptions: true,
          })
        ).toThrow(
          "Parameter 'x' of function 'whitespaceParamDesc' requires description (requireDescriptions enabled)"
        );
      });

      it('throws Error with parameter name in message', () => {
        expect(() =>
          createRuntimeContext({
            functions: {
              multiParam: {
                params: [
                  {
                    name: 'first',
                    type: { type: 'string' },
                    defaultValue: undefined,
                    annotations: { description: 'First param' },
                  },
                  {
                    name: 'second',
                    type: { type: 'number' },
                    defaultValue: undefined,
                    annotations: {},
                  },
                ],
                fn: (args) => args[0],
                annotations: { description: 'Function with description' },
                returnType: anyTypeValue,
              },
            },
            requireDescriptions: true,
          })
        ).toThrow(
          "Parameter 'second' of function 'multiParam' requires description (requireDescriptions enabled)"
        );
      });
    });

    describe('requireDescriptions: valid cases', () => {
      it('accepts fully documented function with requireDescriptions true', () => {
        expect(() =>
          createRuntimeContext({
            functions: {
              fullyDocumented: {
                params: [
                  {
                    name: 'x',
                    type: { type: 'string' },
                    defaultValue: undefined,
                    annotations: { description: 'The input string' },
                  },
                ],
                fn: (args) => args[0],
                annotations: { description: 'A fully documented function' },
                returnType: anyTypeValue,
              },
            },
            requireDescriptions: true,
          })
        ).not.toThrow();
      });

      it('accepts function with no params and description', () => {
        expect(() =>
          createRuntimeContext({
            functions: {
              noParams: {
                params: [],
                fn: () => 'result',
                annotations: { description: 'Function with no parameters' },
                returnType: anyTypeValue,
              },
            },
            requireDescriptions: true,
          })
        ).not.toThrow();
      });
    });
  });

  describe('getDocumentationCoverage Tests', () => {
    describe('AC-5: Fully documented context returns 100% completeness', () => {
      it('returns 100% for fully documented single function', () => {
        const ctx = createRuntimeContext({});
        ctx.functions.clear();
        ctx.functions.set('documented', {
          __type: 'callable',
          kind: 'application',
          params: [
            {
              name: 'x',
              type: { type: 'string' },
              defaultValue: undefined,
              annotations: { description: 'Input value' },
            },
          ],
          fn: (args) => args[0],
          annotations: { description: 'A documented function' },
          returnType: anyTypeValue,
          isProperty: false,
        });

        const result = getDocumentationCoverage(ctx);

        expect(result.total).toBe(1);
        expect(result.documented).toBe(1);
        expect(result.percentage).toBe(100);
      });

      it('returns 100% for multiple fully documented functions', () => {
        const ctx = createRuntimeContext({});
        ctx.functions.clear();
        ctx.functions.set('first', {
          __type: 'callable',
          kind: 'application',
          params: [
            {
              name: 'a',
              type: { type: 'string' },
              defaultValue: undefined,
              annotations: { description: 'First param' },
            },
          ],
          fn: (args) => args[0],
          annotations: { description: 'First function' },
          returnType: anyTypeValue,
          isProperty: false,
        });
        ctx.functions.set('second', {
          __type: 'callable',
          kind: 'application',
          params: [
            {
              name: 'b',
              type: { type: 'number' },
              defaultValue: undefined,
              annotations: { description: 'Second param' },
            },
          ],
          fn: (args) => args[0],
          annotations: { description: 'Second function' },
          returnType: anyTypeValue,
          isProperty: false,
        });

        const result = getDocumentationCoverage(ctx);

        expect(result.total).toBe(2);
        expect(result.documented).toBe(2);
        expect(result.percentage).toBe(100);
      });
    });

    describe('AC-11: Empty context returns { total: 0, documented: 0, percentage: 100 }', () => {
      it('returns correct metrics for empty context', () => {
        const ctx = createRuntimeContext({});
        ctx.functions.clear();

        const result = getDocumentationCoverage(ctx);

        expect(result.total).toBe(0);
        expect(result.documented).toBe(0);
        expect(result.percentage).toBe(100);
      });
    });

    describe('AC-12: Whitespace-only description counts as undocumented', () => {
      it('counts function with whitespace-only description as undocumented', () => {
        const ctx = createRuntimeContext({});
        ctx.functions.clear();
        ctx.functions.set('whitespace', {
          __type: 'callable',
          kind: 'application',
          params: [],
          fn: () => 'result',
          annotations: { description: '   ' },
          returnType: anyTypeValue,
          isProperty: false,
        });

        const result = getDocumentationCoverage(ctx);

        expect(result.total).toBe(1);
        expect(result.documented).toBe(0);
        expect(result.percentage).toBe(0);
      });

      it('counts parameter with whitespace-only description as undocumented', () => {
        const ctx = createRuntimeContext({});
        ctx.functions.clear();
        ctx.functions.set('whitespaceParam', {
          __type: 'callable',
          kind: 'application',
          params: [
            {
              name: 'x',
              type: { type: 'string' },
              defaultValue: undefined,
              annotations: { description: '  \n  ' },
            },
          ],
          fn: (args) => args[0],
          annotations: { description: 'Function description' },
          returnType: anyTypeValue,
          isProperty: false,
        });

        const result = getDocumentationCoverage(ctx);

        expect(result.total).toBe(1);
        expect(result.documented).toBe(0);
        expect(result.percentage).toBe(0);
      });

      it('counts function with empty description as undocumented', () => {
        const ctx = createRuntimeContext({});
        ctx.functions.clear();
        ctx.functions.set('empty', {
          __type: 'callable',
          kind: 'application',
          params: [],
          fn: () => 'result',
          description: '',
          annotations: {},
          returnType: anyTypeValue,
          isProperty: false,
        });

        const result = getDocumentationCoverage(ctx);

        expect(result.total).toBe(1);
        expect(result.documented).toBe(0);
        expect(result.percentage).toBe(0);
      });
    });

    describe('AC-13: Function with 0 params and description counts as documented', () => {
      it('counts zero-parameter function with description as documented', () => {
        const ctx = createRuntimeContext({});
        ctx.functions.clear();
        ctx.functions.set('noParams', {
          __type: 'callable',
          kind: 'application',
          params: [],
          fn: () => 'result',
          annotations: { description: 'Function with no parameters' },
          returnType: anyTypeValue,
          isProperty: false,
        });

        const result = getDocumentationCoverage(ctx);

        expect(result.total).toBe(1);
        expect(result.documented).toBe(1);
        expect(result.percentage).toBe(100);
      });
    });

    describe('Documentation completeness percentage calculation', () => {
      it('calculates 50% when half documented', () => {
        const ctx = createRuntimeContext({});
        ctx.functions.clear();
        ctx.functions.set('documented', {
          __type: 'callable',
          kind: 'application',
          params: [
            {
              name: 'x',
              type: { type: 'string' },
              defaultValue: undefined,
              annotations: { description: 'Documented param' },
            },
          ],
          fn: (args) => args[0],
          annotations: { description: 'Documented function' },
          returnType: anyTypeValue,
          isProperty: false,
        });
        ctx.functions.set('undocumented', {
          __type: 'callable',
          kind: 'application',
          params: [],
          fn: () => 'result',
          description: '',
          annotations: {},
          returnType: anyTypeValue,
          isProperty: false,
        });

        const result = getDocumentationCoverage(ctx);

        expect(result.total).toBe(2);
        expect(result.documented).toBe(1);
        expect(result.percentage).toBe(50);
      });

      it('calculates 33.33% for one documented out of three', () => {
        const ctx = createRuntimeContext({});
        ctx.functions.clear();
        ctx.functions.set('documented', {
          __type: 'callable',
          kind: 'application',
          params: [
            {
              name: 'x',
              type: { type: 'string' },
              defaultValue: undefined,
              annotations: { description: 'Param' },
            },
          ],
          fn: (args) => args[0],
          annotations: { description: 'Documented' },
          returnType: anyTypeValue,
          isProperty: false,
        });
        ctx.functions.set('undocumented1', {
          __type: 'callable',
          kind: 'application',
          params: [],
          fn: () => 'result',
          description: '',
          annotations: {},
          returnType: anyTypeValue,
          isProperty: false,
        });
        ctx.functions.set('undocumented2', {
          __type: 'callable',
          kind: 'application',
          params: [],
          fn: () => 'result',
          description: '',
          annotations: {},
          returnType: anyTypeValue,
          isProperty: false,
        });

        const result = getDocumentationCoverage(ctx);

        expect(result.total).toBe(3);
        expect(result.documented).toBe(1);
        expect(result.percentage).toBe(33.33);
      });

      it('rounds percentage to 2 decimal places', () => {
        const ctx = createRuntimeContext({});
        ctx.functions.clear();

        // Create 7 functions (1 documented, 6 undocumented) for percentage = 14.285714...
        ctx.functions.set('documented', {
          __type: 'callable',
          kind: 'application',
          params: [],
          fn: () => 'result',
          annotations: { description: 'Documented' },
          returnType: anyTypeValue,
          isProperty: false,
        });

        for (let i = 0; i < 6; i++) {
          ctx.functions.set(`undocumented${i}`, {
            __type: 'callable',
            kind: 'application',
            params: [],
            fn: () => 'result',
            description: '',
            annotations: {},
            returnType: anyTypeValue,
            isProperty: false,
          });
        }

        const result = getDocumentationCoverage(ctx);

        expect(result.total).toBe(7);
        expect(result.documented).toBe(1);
        expect(result.percentage).toBe(14.29);
      });
    });

    describe('Mixed documentation scenarios', () => {
      it('counts function as undocumented when missing parameter description', () => {
        const ctx = createRuntimeContext({});
        ctx.functions.clear();
        ctx.functions.set('partialDocs', {
          __type: 'callable',
          kind: 'application',
          params: [
            {
              name: 'x',
              type: { type: 'string' },
              defaultValue: undefined,
              annotations: { description: '' },
            },
          ],
          fn: (args) => args[0],
          annotations: { description: 'Function has description' },
          returnType: anyTypeValue,
          isProperty: false,
        });

        const result = getDocumentationCoverage(ctx);

        expect(result.total).toBe(1);
        expect(result.documented).toBe(0);
        expect(result.percentage).toBe(0);
      });

      it('counts function as undocumented when one parameter missing description', () => {
        const ctx = createRuntimeContext({});
        ctx.functions.clear();
        ctx.functions.set('multiParam', {
          __type: 'callable',
          kind: 'application',
          params: [
            {
              name: 'a',
              type: { type: 'string' },
              defaultValue: undefined,
              annotations: { description: 'First param documented' },
            },
            {
              name: 'b',
              type: { type: 'number' },
              defaultValue: undefined,
              annotations: { description: '' },
            },
          ],
          fn: (args) => args[0],
          annotations: { description: 'Function description' },
          returnType: anyTypeValue,
          isProperty: false,
        });

        const result = getDocumentationCoverage(ctx);

        expect(result.total).toBe(1);
        expect(result.documented).toBe(0);
        expect(result.percentage).toBe(0);
      });
    });
  });
});
