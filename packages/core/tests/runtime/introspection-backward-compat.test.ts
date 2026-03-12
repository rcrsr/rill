/**
 * Rill Runtime Tests: Introspection Backward Compatibility (IR-3, IR-4)
 * Verifies existing host function registrations work without description fields
 *
 * Specification Mapping (conduct/specifications/runtime-introspection.md):
 * - IR-3: RillParam.description?: string (optional, defaults to empty string)
 * - IR-4: RillFunction.description?: string (optional, defaults to empty string)
 *
 * This test verifies backward compatibility: code written before IR-3/IR-4
 * continues to work without modification.
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  createRuntimeContext,
  getFunctions,
  type RillFunction,
} from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Introspection Backward Compatibility', () => {
  describe('IR-3: RillParam.description backward compatibility', () => {
    it('registers function without param description field', async () => {
      // Pattern used before IR-3 (no description field)
      const result = await run('greet("Alice")', {
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
            returnType: anyTypeValue,
          },
        },
      });

      expect(result).toBe('Hello, Alice!');
    });

    it('getFunctions returns empty string for missing param description', () => {
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
            returnType: anyTypeValue,
          },
        },
      });

      const functions = getFunctions(ctx);
      const add = functions.find((f) => f.name === 'add');

      expect(add).toBeDefined();
      expect(add?.params[0]?.description).toBe('');
      expect(add?.params[1]?.description).toBe('');
    });

    it('handles mixed parameters with and without descriptions', () => {
      const ctx = createRuntimeContext({
        functions: {
          format: {
            params: [
              {
                name: 'template',
                type: { type: 'string' },
                defaultValue: undefined,
                annotations: {},
              }, // No description
              {
                name: 'value',
                type: { type: 'string' },
                defaultValue: undefined,
                annotations: { description: 'Value to insert' },
              }, // With description
            ],
            fn: (args) => String(args[0]).replace('{}', String(args[1])),
            returnType: anyTypeValue,
          },
        },
      });

      const functions = getFunctions(ctx);
      const format = functions.find((f) => f.name === 'format');

      expect(format?.params[0]?.description).toBe('');
      expect(format?.params[1]?.description).toBe('Value to insert');
    });
  });

  describe('IR-4: RillFunction.description backward compatibility', () => {
    it('registers function without description field', async () => {
      // Pattern used before IR-4 (no description field)
      const result = await run('double(5)', {
        functions: {
          double: {
            params: [
              {
                name: 'x',
                type: { type: 'number' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => (args[0] as number) * 2,
            returnType: anyTypeValue,
          },
        },
      });

      expect(result).toBe(10);
    });

    it('getFunctions returns empty string for missing function description', () => {
      const ctx = createRuntimeContext({
        functions: {
          legacy: {
            params: [
              {
                name: 'input',
                type: { type: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args[0],
            returnType: anyTypeValue,
          },
        },
      });

      const functions = getFunctions(ctx);
      const legacy = functions.find((f) => f.name === 'legacy');

      expect(legacy).toBeDefined();
      expect(legacy?.description).toBe('');
    });

    it('handles namespaced functions without descriptions', () => {
      const ctx = createRuntimeContext({
        functions: {
          'math::add': {
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
            returnType: anyTypeValue,
          },
        },
      });

      const functions = getFunctions(ctx);
      const mathAdd = functions.find((f) => f.name === 'math::add');

      expect(mathAdd?.description).toBe('');
    });
  });

  describe('Combined IR-3 & IR-4: Complete backward compatibility', () => {
    it('registers complex function without any description fields', async () => {
      // Real-world pattern before IR-3/IR-4
      const result = await run('process("data", 42, true)', {
        functions: {
          process: {
            params: [
              {
                name: 'input',
                type: { type: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
              {
                name: 'count',
                type: { type: 'number' },
                defaultValue: undefined,
                annotations: {},
              },
              {
                name: 'flag',
                type: { type: 'bool' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => {
              const input = String(args[0]);
              const count = args[1] as number;
              const flag = args[2] as boolean;
              return flag ? input.repeat(count) : input;
            },
            returnType: anyTypeValue,
          },
        },
      });

      expect(result).toBe(
        'datadatadatadatadatadatadatadatadatadatadatadatadatadatadatadatadatadatadatadatadatadatadatadatadatadatadatadatadatadatadatadatadatadatadatadatadatadatadatadatadatadata'
      );
    });

    it('getFunctions returns all empty descriptions for legacy function', () => {
      const ctx = createRuntimeContext({
        functions: {
          oldStyle: {
            params: [
              {
                name: 'a',
                type: { type: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
              {
                name: 'b',
                type: { type: 'number' },
                defaultValue: undefined,
                annotations: {},
              },
              {
                name: 'c',
                type: { type: 'bool' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => `${args[0]} ${args[1]} ${args[2]}`,
            returnType: anyTypeValue,
          },
        },
      });

      const functions = getFunctions(ctx);
      const oldStyle = functions.find((f) => f.name === 'oldStyle');

      expect(oldStyle?.description).toBe('');
      expect(oldStyle?.params[0]?.description).toBe('');
      expect(oldStyle?.params[1]?.description).toBe('');
      expect(oldStyle?.params[2]?.description).toBe('');
    });

    it('TypeScript allows omitting description fields', () => {
      // This test verifies TypeScript compilation succeeds
      // Description now lives in annotations.description, not as a top-level field
      const funcDef: RillFunction = {
        params: [
          {
            name: 'x',
            type: { type: 'string' },
            defaultValue: undefined,
            annotations: {},
          },
          {
            name: 'y',
            type: { type: 'number' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: (args) => args[0],
        returnType: anyTypeValue,
        // No annotations field - should compile without error
      };

      // annotations is optional on RillFunction; if absent, description is absent
      expect(funcDef.annotations).toBeUndefined();
    });

    it('handles mix of old and new style function definitions', async () => {
      const result = await run('old("x") -> new("y")', {
        functions: {
          old: {
            params: [
              {
                name: 'input',
                type: { type: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args[0],
            returnType: anyTypeValue,
            // No annotations - old style
          },
          new: {
            params: [
              {
                name: 'input',
                type: { type: 'string' },
                defaultValue: undefined,
                annotations: { description: 'Input value' },
              },
            ],
            fn: (args) => args[0],
            annotations: { description: 'New style function with docs' },
            returnType: anyTypeValue,
          },
        },
      });

      expect(result).toBe('y');

      const ctx = createRuntimeContext({
        functions: {
          old: {
            params: [
              {
                name: 'input',
                type: { type: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args[0],
            returnType: anyTypeValue,
          },
          new: {
            params: [
              {
                name: 'input',
                type: { type: 'string' },
                defaultValue: undefined,
                annotations: { description: 'Input value' },
              },
            ],
            fn: (args) => args[0],
            annotations: { description: 'New style function with docs' },
            returnType: anyTypeValue,
          },
        },
      });

      const functions = getFunctions(ctx);
      const oldFunc = functions.find((f) => f.name === 'old');
      const newFunc = functions.find((f) => f.name === 'new');

      expect(oldFunc?.description).toBe('');
      expect(newFunc?.description).toBe('New style function with docs');
    });
  });
});
