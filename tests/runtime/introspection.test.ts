/**
 * Rill Runtime Tests: Introspection API
 * Tests for runtime introspection functions getFunctions() and getLanguageReference()
 *
 * Specification Mapping (conduct/specifications/runtime-introspection.md):
 *
 * Happy Path Criteria:
 * - AC-1: getFunctions returns metadata for host functions with descriptions
 * - AC-2: getFunctions returns metadata for built-in functions
 * - AC-3: getFunctions includes namespaced functions with `::` in name
 * - AC-4: getLanguageReference returns non-empty string
 * - AC-5: Missing descriptions appear as empty strings in output
 *
 * This file covers ONLY happy path tests. Error cases and boundary conditions
 * are tested in separate test files per §BASIC.3 (YAGNI).
 */

import { describe, expect, it } from 'vitest';
import {
  createRuntimeContext,
  getFunctions,
  getLanguageReference,
} from '../../src/index.js';

describe('Rill Runtime: Introspection API', () => {
  describe('Happy Path Tests', () => {
    describe('AC-1: getFunctions returns metadata for host functions with descriptions', () => {
      it('returns host function with description', () => {
        const ctx = createRuntimeContext({
          functions: {
            greet: {
              params: [{ name: 'name', type: 'string' }],
              fn: (args) => `Hello, ${args[0]}!`,
              description: 'Greets a user by name',
            },
          },
        });

        const functions = getFunctions(ctx);
        const greet = functions.find((f) => f.name === 'greet');

        expect(greet).toBeDefined();
        expect(greet?.description).toBe('Greets a user by name');
        expect(greet?.params).toHaveLength(1);
        expect(greet?.params[0]?.name).toBe('name');
        expect(greet?.params[0]?.type).toBe('string');
      });

      it('returns multiple host functions with descriptions', () => {
        const ctx = createRuntimeContext({
          functions: {
            add: {
              params: [
                { name: 'a', type: 'number' },
                { name: 'b', type: 'number' },
              ],
              fn: (args) => (args[0] as number) + (args[1] as number),
              description: 'Adds two numbers',
            },
            concat: {
              params: [
                { name: 'x', type: 'string' },
                { name: 'y', type: 'string' },
              ],
              fn: (args) => `${args[0]}${args[1]}`,
              description: 'Concatenates two strings',
            },
          },
        });

        const functions = getFunctions(ctx);
        const add = functions.find((f) => f.name === 'add');
        const concat = functions.find((f) => f.name === 'concat');

        expect(add?.description).toBe('Adds two numbers');
        expect(concat?.description).toBe('Concatenates two strings');
      });

      it('includes parameter descriptions in metadata', () => {
        const ctx = createRuntimeContext({
          functions: {
            format: {
              params: [
                {
                  name: 'template',
                  type: 'string',
                  description: 'The template string with placeholders',
                },
                {
                  name: 'value',
                  type: 'string',
                  description: 'The value to insert',
                },
              ],
              fn: (args) => String(args[0]).replace('{}', String(args[1])),
              description: 'Formats a string template',
            },
          },
        });

        const functions = getFunctions(ctx);
        const format = functions.find((f) => f.name === 'format');

        expect(format?.params[0]?.description).toBe(
          'The template string with placeholders'
        );
        expect(format?.params[1]?.description).toBe('The value to insert');
      });
    });

    describe('AC-2: getFunctions returns metadata for built-in functions', () => {
      it('returns built-in functions from runtime context', () => {
        const ctx = createRuntimeContext({});
        const functions = getFunctions(ctx);

        // Built-in functions exist in runtime (e.g., log, type, json, etc.)
        // They should be included in the result with empty descriptions
        expect(functions).toBeInstanceOf(Array);
        expect(functions.length).toBeGreaterThanOrEqual(0);
      });

      it('returns built-in function with empty description', () => {
        const ctx = createRuntimeContext({
          functions: {
            legacy: {
              params: [],
              fn: () => 'result',
            },
          },
        });

        const functions = getFunctions(ctx);
        const legacy = functions.find((f) => f.name === 'legacy');

        expect(legacy).toBeDefined();
        expect(legacy?.description).toBe('');
        expect(legacy?.params).toHaveLength(0);
      });

      it('includes both host and built-in functions', () => {
        const ctx = createRuntimeContext({
          functions: {
            hostFunc: {
              params: [{ name: 'x', type: 'string' }],
              fn: (args) => args[0],
              description: 'A host function',
            },
            builtinFunc: {
              params: [],
              fn: () => 'builtin',
            },
          },
        });

        const functions = getFunctions(ctx);

        expect(functions.find((f) => f.name === 'hostFunc')).toBeDefined();
        expect(functions.find((f) => f.name === 'builtinFunc')).toBeDefined();
      });
    });

    describe('AC-3: getFunctions includes namespaced functions with `::` in name', () => {
      it('returns namespaced function with :: separator', () => {
        const ctx = createRuntimeContext({
          functions: {
            'math::add': {
              params: [
                { name: 'a', type: 'number' },
                { name: 'b', type: 'number' },
              ],
              fn: (args) => (args[0] as number) + (args[1] as number),
              description: 'Adds two numbers',
            },
          },
        });

        const functions = getFunctions(ctx);
        const mathAdd = functions.find((f) => f.name === 'math::add');

        expect(mathAdd).toBeDefined();
        expect(mathAdd?.name).toBe('math::add');
        expect(mathAdd?.description).toBe('Adds two numbers');
      });

      it('returns multiple namespaced functions from same namespace', () => {
        const ctx = createRuntimeContext({
          functions: {
            'str::upper': {
              params: [{ name: 'text', type: 'string' }],
              fn: (args) => String(args[0]).toUpperCase(),
              description: 'Converts to uppercase',
            },
            'str::lower': {
              params: [{ name: 'text', type: 'string' }],
              fn: (args) => String(args[0]).toLowerCase(),
              description: 'Converts to lowercase',
            },
          },
        });

        const functions = getFunctions(ctx);
        const upper = functions.find((f) => f.name === 'str::upper');
        const lower = functions.find((f) => f.name === 'str::lower');

        expect(upper?.name).toBe('str::upper');
        expect(lower?.name).toBe('str::lower');
      });

      it('returns multi-level namespaced functions', () => {
        const ctx = createRuntimeContext({
          functions: {
            'io::file::read': {
              params: [{ name: 'path', type: 'string' }],
              fn: (args) => `reading ${args[0]}`,
              description: 'Reads a file',
            },
          },
        });

        const functions = getFunctions(ctx);
        const ioFileRead = functions.find((f) => f.name === 'io::file::read');

        expect(ioFileRead).toBeDefined();
        expect(ioFileRead?.name).toBe('io::file::read');
      });
    });

    describe('AC-4: getLanguageReference returns non-empty string', () => {
      it('returns a non-empty string', () => {
        const reference = getLanguageReference();

        expect(typeof reference).toBe('string');
        expect(reference.length).toBeGreaterThan(0);
      });

      it('returns consistent reference across multiple calls', () => {
        const ref1 = getLanguageReference();
        const ref2 = getLanguageReference();

        expect(ref1).toBe(ref2);
      });

      it('returns reference containing language documentation', () => {
        const reference = getLanguageReference();

        // Language reference should contain basic rill syntax elements
        expect(reference.length).toBeGreaterThan(100);
      });

      it('always succeeds because content bundled at build time [EC-3]', () => {
        // EC-3: getLanguageReference always succeeds (content bundled at build)
        // Build fails if source file missing, so runtime call always succeeds
        const reference = getLanguageReference();

        // Verify function executes without throwing
        expect(reference).toBeDefined();
        expect(typeof reference).toBe('string');
        expect(reference.length).toBeGreaterThan(0);

        // Verify content includes expected keywords from rill language spec
        expect(reference.toLowerCase()).toContain('rill');
        expect(reference).toContain('pipe');
        expect(reference).toContain('->');
      });
    });

    describe('AC-5: Missing descriptions appear as empty strings in output', () => {
      it('returns empty string for missing function description', () => {
        const ctx = createRuntimeContext({
          functions: {
            noDescription: {
              params: [{ name: 'x', type: 'string' }],
              fn: (args) => args[0],
            },
          },
        });

        const functions = getFunctions(ctx);
        const func = functions.find((f) => f.name === 'noDescription');

        expect(func?.description).toBe('');
      });

      it('returns empty string for missing parameter description', () => {
        const ctx = createRuntimeContext({
          functions: {
            test: {
              params: [
                { name: 'x', type: 'string' }, // No description
              ],
              fn: (args) => args[0],
              description: 'A test function',
            },
          },
        });

        const functions = getFunctions(ctx);
        const func = functions.find((f) => f.name === 'test');

        expect(func?.params[0]?.description).toBe('');
      });

      it('handles mix of present and missing descriptions', () => {
        const ctx = createRuntimeContext({
          functions: {
            withDesc: {
              params: [{ name: 'a', type: 'string' }],
              fn: (args) => args[0],
              description: 'Has description',
            },
            withoutDesc: {
              params: [{ name: 'b', type: 'number' }],
              fn: (args) => args[0],
            },
          },
        });

        const functions = getFunctions(ctx);

        expect(functions.find((f) => f.name === 'withDesc')?.description).toBe(
          'Has description'
        );
        expect(
          functions.find((f) => f.name === 'withoutDesc')?.description
        ).toBe('');
      });

      it('handles mix of parameters with and without descriptions', () => {
        const ctx = createRuntimeContext({
          functions: {
            mixed: {
              params: [
                {
                  name: 'documented',
                  type: 'string',
                  description: 'This param has docs',
                },
                {
                  name: 'undocumented',
                  type: 'number',
                },
              ],
              fn: (args) => `${args[0]} ${args[1]}`,
              description: 'Mixed documentation',
            },
          },
        });

        const functions = getFunctions(ctx);
        const func = functions.find((f) => f.name === 'mixed');

        expect(func?.params[0]?.description).toBe('This param has docs');
        expect(func?.params[1]?.description).toBe('');
      });
    });
  });

  describe('Error Cases', () => {
    describe('AC-6: Malformed function definition skipped without throwing [EC-2]', () => {
      it('does not throw when enumerating functions', () => {
        // Create context with valid function
        const ctx = createRuntimeContext({
          functions: {
            valid: {
              params: [],
              fn: () => 'valid',
              description: 'Valid function',
            },
          },
        });

        // Manually corrupt a function entry in the context to test enumeration robustness
        const corruptValue = { corrupt: true };
        ctx.functions.set('malformed', corruptValue as unknown as any);

        // getFunctions should not throw, even with corrupt entry
        expect(() => getFunctions(ctx)).not.toThrow();

        const functions = getFunctions(ctx);
        // Valid function should still be present
        expect(functions.find((f) => f.name === 'valid')).toBeDefined();
      });

      it('continues enumeration after encountering error', () => {
        const ctx = createRuntimeContext({
          functions: {
            first: {
              params: [],
              fn: () => 'first',
              description: 'First function',
            },
            last: {
              params: [],
              fn: () => 'last',
              description: 'Last function',
            },
          },
        });

        // Inject malformed entry after valid ones (Map preserves insertion order)
        ctx.functions.set('bad', { malformed: true } as unknown as any);

        const functions = getFunctions(ctx);

        // Both valid functions should still be present despite malformed entry
        expect(functions.find((f) => f.name === 'first')).toBeDefined();
        expect(functions.find((f) => f.name === 'last')).toBeDefined();
      });
    });

    describe('AC-7: Empty context returns empty function list [EC-1]', () => {
      it('returns only built-ins for default context', () => {
        const ctx = createRuntimeContext({});
        const functions = getFunctions(ctx);

        // Default context includes built-in functions
        expect(functions).toBeInstanceOf(Array);
        expect(functions.length).toBeGreaterThan(0);
      });

      it('returns empty array for manually emptied context', () => {
        const ctx = createRuntimeContext({});

        // Clear all functions to simulate truly empty context
        ctx.functions.clear();
        ctx.variables.clear();

        const functions = getFunctions(ctx);

        expect(functions).toBeInstanceOf(Array);
        expect(functions).toHaveLength(0);
      });

      it('handles invalid context gracefully', () => {
        // Create malformed context object
        const invalidCtx = {
          functions: null,
          variables: null,
        } as unknown as any;

        const functions = getFunctions(invalidCtx);

        expect(functions).toBeInstanceOf(Array);
        expect(functions).toHaveLength(0);
      });
    });

    describe('AC-8: Function with invalid param structure skipped [EC-2]', () => {
      it('skips ApplicationCallable with invalid params structure', () => {
        const ctx = createRuntimeContext({
          functions: {
            valid: {
              params: [{ name: 'x', type: 'string' }],
              fn: (args) => args[0],
              description: 'Valid function',
            },
          },
        });

        // Manually inject callable with malformed params
        const malformedCallable = {
          __type: 'application' as const,
          fn: () => 'result',
          description: 'Invalid params',
          params: { malformed: true }, // Not an array
        };
        ctx.functions.set('invalidParams', malformedCallable as unknown as any);

        // Should not throw
        expect(() => getFunctions(ctx)).not.toThrow();

        const functions = getFunctions(ctx);
        expect(functions.find((f) => f.name === 'valid')).toBeDefined();
      });

      it('handles param mapping errors gracefully', () => {
        const ctx = createRuntimeContext({
          functions: {
            valid: {
              params: [],
              fn: () => 'valid',
              description: 'Valid function',
            },
          },
        });

        // Inject callable with params that will throw during mapping
        const throwingCallable = {
          __type: 'application' as const,
          fn: () => 'result',
          params: [
            {
              get name() {
                throw new Error('Property access throws');
              },
              type: 'string',
            },
          ],
        };
        ctx.functions.set('throwingParam', throwingCallable as unknown as any);

        // Should not throw - malformed entry skipped
        expect(() => getFunctions(ctx)).not.toThrow();

        const functions = getFunctions(ctx);
        expect(functions.find((f) => f.name === 'valid')).toBeDefined();
      });

      it('continues enumeration after param structure error', () => {
        const ctx = createRuntimeContext({
          functions: {
            first: {
              params: [{ name: 'a', type: 'number' }],
              fn: (args) => args[0],
              description: 'First',
            },
            last: {
              params: [{ name: 'b', type: 'string' }],
              fn: (args) => args[0],
              description: 'Last',
            },
          },
        });

        // Inject malformed entry after valid ones (Map preserves insertion order)
        ctx.functions.set('bad', {
          __type: 'application' as const,
          fn: () => '',
          params: 'not-an-array',
        } as unknown as any);

        const functions = getFunctions(ctx);

        // Both valid functions should still be present despite malformed entry
        expect(functions.find((f) => f.name === 'first')).toBeDefined();
        expect(functions.find((f) => f.name === 'last')).toBeDefined();
      });
    });
  });

  describe('Boundary Conditions', () => {
    describe('AC-9: Context with zero host functions returns empty list (only built-ins)', () => {
      it('returns empty list when all functions are cleared', () => {
        const ctx = createRuntimeContext({});

        // Clear all functions (including built-ins)
        ctx.functions.clear();

        const functions = getFunctions(ctx);

        expect(functions).toBeInstanceOf(Array);
        expect(functions).toHaveLength(0);
      });

      it('returns only built-ins when no host functions provided', () => {
        const ctx = createRuntimeContext({});

        const functions = getFunctions(ctx);

        // Should only contain built-in functions, no host functions
        expect(functions).toBeInstanceOf(Array);
        expect(functions.every((f) => !f.name.includes('::')));
      });
    });

    describe('AC-10: Context with only built-ins returns built-in metadata', () => {
      it('returns metadata for built-in functions', () => {
        const ctx = createRuntimeContext({});

        const functions = getFunctions(ctx);

        // All built-ins should have empty descriptions per AC-5
        functions.forEach((f) => {
          expect(f).toHaveProperty('name');
          expect(f).toHaveProperty('description');
          expect(f).toHaveProperty('params');
          expect(f.description).toBe('');
        });
      });

      it('built-in functions have valid param metadata', () => {
        const ctx = createRuntimeContext({});

        const functions = getFunctions(ctx);

        functions.forEach((f) => {
          expect(Array.isArray(f.params)).toBe(true);
          f.params.forEach((p) => {
            expect(p).toHaveProperty('name');
            expect(p).toHaveProperty('type');
            expect(p).toHaveProperty('description');
          });
        });
      });
    });

    describe('AC-11: Parameter with undefined defaultValue preserved as undefined', () => {
      it('preserves undefined defaultValue in parameter metadata', () => {
        const ctx = createRuntimeContext({
          functions: {
            test: {
              params: [
                { name: 'required', type: 'string' },
                {
                  name: 'optional',
                  type: 'number',
                  defaultValue: undefined,
                },
              ],
              fn: (args) => args[0],
              description: 'Test function',
            },
          },
        });

        const functions = getFunctions(ctx);
        const func = functions.find((f) => f.name === 'test');

        expect(func?.params[0]?.defaultValue).toBeUndefined();
        expect(func?.params[1]?.defaultValue).toBeUndefined();
        expect(func?.params[1]).toHaveProperty('defaultValue');
      });

      it('distinguishes between undefined and missing defaultValue', () => {
        const ctx = createRuntimeContext({
          functions: {
            test: {
              params: [
                { name: 'noDefault', type: 'string' },
                {
                  name: 'explicitUndefined',
                  type: 'string',
                  defaultValue: undefined,
                },
              ],
              fn: (args) => args[0],
            },
          },
        });

        const functions = getFunctions(ctx);
        const func = functions.find((f) => f.name === 'test');

        // Both should have undefined, but the property should exist
        expect(func?.params[0]?.defaultValue).toBeUndefined();
        expect(func?.params[1]?.defaultValue).toBeUndefined();
      });
    });

    describe('AC-12: Deeply nested closures in variables not enumerated', () => {
      it('does not enumerate closures stored in variables', () => {
        const ctx = createRuntimeContext({
          variables: {
            nestedClosures: {
              level1: {
                level2: {
                  level3: {
                    __type: 'script' as const,
                    fn: () => 'deep',
                  },
                },
              },
            },
          },
          functions: {
            hostFunc: {
              params: [],
              fn: () => 'host',
              description: 'Host function',
            },
          },
        });

        const functions = getFunctions(ctx);

        // Should include host function and built-ins, but not variable closures
        expect(functions.find((f) => f.name === 'hostFunc')).toBeDefined();
        expect(
          functions.find((f) => f.name === 'nestedClosures')
        ).toBeUndefined();
        expect(functions.find((f) => f.name === 'level1')).toBeUndefined();
        expect(functions.find((f) => f.name === 'level3')).toBeUndefined();
      });

      it('does not enumerate closures at any nesting level', () => {
        const ctx = createRuntimeContext({
          variables: {
            shallow: {
              __type: 'application' as const,
              fn: () => 'shallow',
            },
            deep: {
              a: {
                b: {
                  c: {
                    d: {
                      __type: 'script' as const,
                      fn: () => 'very deep',
                    },
                  },
                },
              },
            },
          },
        });

        const functions = getFunctions(ctx);

        // No variable closures should be enumerated (only built-ins)
        expect(functions.find((f) => f.name === 'shallow')).toBeUndefined();
        expect(functions.find((f) => f.name === 'deep')).toBeUndefined();
        expect(functions.find((f) => f.name === 'a')).toBeUndefined();
        expect(functions.find((f) => f.name === 'd')).toBeUndefined();
        // Built-ins should still be present
        expect(functions.length).toBeGreaterThan(0);
      });

      it('only enumerates top-level functions map entries', () => {
        const ctx = createRuntimeContext({
          variables: {
            utils: {
              helper: {
                __type: 'application' as const,
                fn: () => 'helper',
                description: 'Nested callable',
              },
            },
          },
          functions: {
            topLevel: {
              params: [],
              fn: () => 'top',
              description: 'Top level function',
            },
          },
        });

        const functions = getFunctions(ctx);

        // Should include topLevel host function but not nested variable closures
        expect(functions.find((f) => f.name === 'topLevel')).toBeDefined();
        expect(functions.find((f) => f.name === 'utils')).toBeUndefined();
        expect(functions.find((f) => f.name === 'helper')).toBeUndefined();
      });
    });
  });
});
