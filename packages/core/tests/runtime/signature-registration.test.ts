/**
 * Rill Runtime Tests: Structured Function Registration
 *
 * Specification Mapping (conduct/specifications/host-type-system-refactor.md):
 *
 * FR-HTR-7 (Structured registration):
 * - AC-17: Structured RillParam[] registers and validates on every call
 * - AC-18: Multiple structured entries in same functions map process without error
 * - AC-19: Structured registration with requireDescriptions validates all param descriptions
 * - AC-20: Structured params carry typed param and return type
 * - AC-21: annotations.description sets function description
 * - AC-22: Parameter-level annotations.description populates param description
 * - AC-23: defaultValue in RillParam is applied when argument omitted
 * - AC-24: Structured registration with missing required param throws at call time
 * - AC-25: requireDescriptions rejects structured function without annotations.description
 *
 * Error contracts:
 * - AC-53: Missing required argument → Error at call time (EC-8)
 * - AC-55: requireDescriptions without description → Error (EC-10)
 *
 * BLOCKED:
 * - AC-9:  Union-typed param validation — BLOCKED by `type-system-improvements`
 * - AC-26: Union-typed signature parsing — BLOCKED by `type-system-improvements`
 * - AC-27: Union-typed rejection — BLOCKED by `type-system-improvements`
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  createRuntimeContext,
  getFunctions,
  rillTypeToTypeValue,
  RuntimeError,
} from '@rcrsr/rill';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Signature Registration', () => {
  describe('AC-17: Structured RillParam[] registers and validates on every call', () => {
    it('validates typed param on first call', async () => {
      await expect(
        run('fn(42)', {
          functions: {
            fn: {
              params: [
                {
                  name: 'msg',
                  type: { type: 'string' },
                  defaultValue: undefined,
                  annotations: {},
                },
              ],
              fn: (args) => args['msg'],
              returnType: anyTypeValue,
            },
          },
        })
      ).rejects.toThrow(RuntimeError);
    });

    it('validates typed param on repeated calls', async () => {
      const fns = {
        fn: {
          params: [
            {
              name: 'msg',
              type: { type: 'string' },
              defaultValue: undefined,
              annotations: {},
            },
          ],
          fn: (args: unknown[]) => args['msg'],
          returnType: anyTypeValue,
        },
      };

      // First call with valid arg succeeds
      const r1 = await run('fn("hello")', { functions: fns });
      expect(r1).toBe('hello');

      // Second call with invalid arg still throws (validation fires each call)
      await expect(run('fn(99)', { functions: fns })).rejects.toThrow(
        RuntimeError
      );
    });
  });

  describe('AC-18: Multiple structured entries in same functions map process without error', () => {
    it('registers both structured entries in one functions map', () => {
      expect(() =>
        createRuntimeContext({
          functions: {
            structured: {
              params: [
                {
                  name: 'x',
                  type: { type: 'number' },
                  defaultValue: undefined,
                  annotations: {},
                },
              ],
              fn: (args) => args['x'],
              annotations: { description: 'Structured form' },
              returnType: anyTypeValue,
            },
            typed: {
              params: [
                {
                  name: 'y',
                  type: { type: 'string' },
                  defaultValue: undefined,
                  annotations: {},
                },
              ],
              fn: (args) => args['y'],
              returnType: rillTypeToTypeValue({ type: 'string' }),
            },
          },
        })
      ).not.toThrow();
    });

    it('calls both functions after registration', async () => {
      const r1 = await run('structured(10)', {
        functions: {
          structured: {
            params: [
              {
                name: 'x',
                type: { type: 'number' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => (args['x'] as number) * 2,
            returnType: anyTypeValue,
          },
          typed: {
            params: [
              {
                name: 'y',
                type: { type: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => `${args['y']}!`,
            returnType: rillTypeToTypeValue({ type: 'string' }),
          },
        },
      });
      expect(r1).toBe(20);

      const r2 = await run('typed("hi")', {
        functions: {
          structured: {
            params: [
              {
                name: 'x',
                type: { type: 'number' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => (args['x'] as number) * 2,
            returnType: anyTypeValue,
          },
          typed: {
            params: [
              {
                name: 'y',
                type: { type: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => `${args['y']}!`,
            returnType: rillTypeToTypeValue({ type: 'string' }),
          },
        },
      });
      expect(r2).toBe('hi!');
    });
  });

  describe('AC-19: requireDescriptions validates structured param descriptions', () => {
    it('requires all params to have descriptions when requireDescriptions is true', () => {
      expect(() =>
        createRuntimeContext({
          functions: {
            fn: {
              params: [
                {
                  name: 'input',
                  type: { type: 'string' },
                  defaultValue: undefined,
                  annotations: {},
                },
              ],
              fn: (args) => args['input'],
              annotations: { description: 'A function' },
              returnType: anyTypeValue,
            },
          },
          requireDescriptions: true,
        })
      ).toThrow(/input.*requires description|requires description.*input/i);
    });

    it('passes when all params have descriptions', () => {
      expect(() =>
        createRuntimeContext({
          functions: {
            fn: {
              params: [
                {
                  name: 'input',
                  type: { type: 'string' },
                  defaultValue: undefined,
                  annotations: { description: 'The input string' },
                },
              ],
              fn: (args) => args['input'],
              annotations: { description: 'A function' },
              returnType: anyTypeValue,
            },
          },
          requireDescriptions: true,
        })
      ).not.toThrow();
    });
  });

  describe('AC-20: Structured params carry typed param and return type', () => {
    it('structured registration exposes typed param and return type in metadata', async () => {
      const ctx = createRuntimeContext({
        functions: {
          echo: {
            params: [
              {
                name: 'message',
                type: { type: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['message'],
            returnType: rillTypeToTypeValue({ type: 'string' }),
          },
        },
      });

      const fns = getFunctions(ctx);
      const echo = fns.find((f) => f.name === 'echo');
      expect(echo).toBeDefined();
      expect(echo?.params).toHaveLength(1);
      expect(echo?.params[0]?.name).toBe('message');
      expect(echo?.params[0]?.type).toBe('string');
      expect(echo?.returnType).toBe('string');
    });

    it('enforces typed param at call time', async () => {
      await expect(
        run('echo(42)', {
          functions: {
            echo: {
              params: [
                {
                  name: 'message',
                  type: { type: 'string' },
                  defaultValue: undefined,
                  annotations: {},
                },
              ],
              fn: (args) => args['message'],
              returnType: rillTypeToTypeValue({ type: 'string' }),
            },
          },
        })
      ).rejects.toThrow(RuntimeError);
    });

    it('accepts valid arg for typed function', async () => {
      const result = await run('echo("hello")', {
        functions: {
          echo: {
            params: [
              {
                name: 'message',
                type: { type: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['message'],
            returnType: rillTypeToTypeValue({ type: 'string' }),
          },
        },
      });
      expect(result).toBe('hello');
    });
  });

  describe('AC-21: annotations.description sets function description', () => {
    it('extracts description from annotations.description', () => {
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
            fn: (args) => `Hello ${args['name']}`,
            annotations: { description: 'Greets the user' },
            returnType: rillTypeToTypeValue({ type: 'string' }),
          },
        },
      });

      const fns = getFunctions(ctx);
      const greet = fns.find((f) => f.name === 'greet');
      expect(greet?.description).toBe('Greets the user');
    });

    it('returns empty description when annotations.description absent', () => {
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
            fn: (args) => `Hello ${args['name']}`,
            returnType: rillTypeToTypeValue({ type: 'string' }),
          },
        },
      });

      const fns = getFunctions(ctx);
      const greet = fns.find((f) => f.name === 'greet');
      expect(greet?.description).toBe('');
    });
  });

  describe('AC-22: Parameter-level annotation populates param description', () => {
    it('extracts param description from param annotations.description', () => {
      const ctx = createRuntimeContext({
        functions: {
          greet: {
            params: [
              {
                name: 'name',
                type: { type: 'string' },
                defaultValue: undefined,
                annotations: { description: 'The name to greet' },
              },
            ],
            fn: (args) => `Hello ${args['name']}`,
            returnType: rillTypeToTypeValue({ type: 'string' }),
          },
        },
      });

      const fns = getFunctions(ctx);
      const greet = fns.find((f) => f.name === 'greet');
      expect(greet?.params[0]?.description).toBe('The name to greet');
    });

    it('supports both function-level and param-level descriptions', () => {
      const ctx = createRuntimeContext({
        functions: {
          greet: {
            params: [
              {
                name: 'name',
                type: { type: 'string' },
                defaultValue: undefined,
                annotations: { description: 'The name' },
              },
            ],
            fn: (args) => `Hello ${args['name']}`,
            annotations: { description: 'A greeter' },
            returnType: rillTypeToTypeValue({ type: 'string' }),
          },
        },
      });

      const fns = getFunctions(ctx);
      const greet = fns.find((f) => f.name === 'greet');
      expect(greet?.description).toBe('A greeter');
      expect(greet?.params[0]?.description).toBe('The name');
    });
  });

  describe('AC-23: = value default syntax parsed and applied', () => {
    it('applies string default value when arg omitted', async () => {
      const result = await run('greet()', {
        functions: {
          greet: {
            params: [
              {
                name: 'name',
                type: { type: 'string' },
                defaultValue: 'world',
                annotations: {},
              },
            ],
            fn: (args) => `Hello ${args['name']}`,
            returnType: rillTypeToTypeValue({ type: 'string' }),
          },
        },
      });
      expect(result).toBe('Hello world');
    });

    it('applies number default value when arg omitted', async () => {
      const result = await run('scale()', {
        functions: {
          scale: {
            params: [
              {
                name: 'factor',
                type: { type: 'number' },
                defaultValue: 2,
                annotations: {},
              },
            ],
            fn: (args) => (args['factor'] as number) * 10,
            returnType: rillTypeToTypeValue({ type: 'number' }),
          },
        },
      });
      expect(result).toBe(20);
    });

    it('overrides default when arg is supplied', async () => {
      const result = await run('greet("alice")', {
        functions: {
          greet: {
            params: [
              {
                name: 'name',
                type: { type: 'string' },
                defaultValue: 'world',
                annotations: {},
              },
            ],
            fn: (args) => `Hello ${args['name']}`,
            returnType: rillTypeToTypeValue({ type: 'string' }),
          },
        },
      });
      expect(result).toBe('Hello alice');
    });

    it('default value appears in getFunctions metadata', () => {
      const ctx = createRuntimeContext({
        functions: {
          greet: {
            params: [
              {
                name: 'name',
                type: { type: 'string' },
                defaultValue: 'world',
                annotations: {},
              },
            ],
            fn: (args) => `Hello ${args['name']}`,
            returnType: rillTypeToTypeValue({ type: 'string' }),
          },
        },
      });

      const fns = getFunctions(ctx);
      const greet = fns.find((f) => f.name === 'greet');
      expect(greet?.params[0]?.defaultValue).toBe('world');
    });
  });

  describe('AC-24 / AC-53: Missing required argument throws descriptive Error at call time (EC-8)', () => {
    it('throws Error synchronously at registration for invalid params', () => {
      // Invalid: passing non-array as params triggers error at registration
      expect(() =>
        createRuntimeContext({
          functions: {
            broken: {
              params: null as any,
              fn: (args) => args[0],
              returnType: anyTypeValue,
            },
          },
        })
      ).toThrow(Error);
    });

    it('error message includes function name when missing required argument', async () => {
      await expect(
        run('multiArg("only-one")', {
          functions: {
            multiArg: {
              params: [
                {
                  name: 'first',
                  type: { type: 'string' },
                  defaultValue: undefined,
                  annotations: {},
                },
                {
                  name: 'second',
                  type: { type: 'string' },
                  defaultValue: undefined,
                  annotations: {},
                },
              ],
              fn: (args) => `${args['first']} ${args['second']}`,
              returnType: anyTypeValue,
            },
          },
        })
      ).rejects.toThrow(/multiArg|second/);
    });

    it('throws at call time when required argument missing', async () => {
      let threwAtCallTime = false;
      // Registration succeeds
      const ctx = createRuntimeContext({
        functions: {
          required: {
            params: [
              {
                name: 'x',
                type: { type: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['x'],
            returnType: anyTypeValue,
          },
        },
      });
      // Error occurs at call time, not registration time
      try {
        await run('required()', {
          functions: Object.fromEntries(ctx.functions),
        });
      } catch {
        threwAtCallTime = true;
      }
      expect(threwAtCallTime).toBe(true);
    });
  });

  describe('AC-25 / AC-55: requireDescriptions rejects function without description (EC-10)', () => {
    it('throws when function has no description annotation and requireDescriptions is true', () => {
      expect(() =>
        createRuntimeContext({
          functions: {
            echo: {
              params: [
                {
                  name: 'message',
                  type: { type: 'string' },
                  defaultValue: undefined,
                  annotations: { description: 'The message' },
                },
              ],
              fn: (args) => args['message'],
              returnType: rillTypeToTypeValue({ type: 'string' }),
            },
          },
          requireDescriptions: true,
        })
      ).toThrow(/echo.*requires description|requires description.*echo/i);
    });

    it('passes when function has annotations.description', () => {
      expect(() =>
        createRuntimeContext({
          functions: {
            echo: {
              params: [
                {
                  name: 'message',
                  type: { type: 'string' },
                  defaultValue: undefined,
                  annotations: { description: 'The message' },
                },
              ],
              fn: (args) => args['message'],
              annotations: { description: 'Echoes a message' },
              returnType: rillTypeToTypeValue({ type: 'string' }),
            },
          },
          requireDescriptions: true,
        })
      ).not.toThrow();
    });
  });

  describe('AC-63: Structured registration with all features parses correctly', () => {
    it('registers function with annotation, typed params with defaults, and return type', async () => {
      const ctx = createRuntimeContext({
        functions: {
          format: {
            params: [
              {
                name: 'template',
                type: { type: 'string' },
                defaultValue: undefined,
                annotations: { description: 'Template string' },
              },
              {
                name: 'value',
                type: { type: 'string' },
                defaultValue: 'default',
                annotations: { description: 'Value to insert' },
              },
            ],
            fn: (args) =>
              String(args['template']).replace('{}', String(args['value'])),
            annotations: { description: 'Format a template' },
            returnType: rillTypeToTypeValue({ type: 'string' }),
          },
        },
      });

      const fns = getFunctions(ctx);
      const format = fns.find((f) => f.name === 'format');
      expect(format?.description).toBe('Format a template');
      expect(format?.params).toHaveLength(2);
      expect(format?.params[0]?.name).toBe('template');
      expect(format?.params[0]?.type).toBe('string');
      expect(format?.params[1]?.name).toBe('value');
      expect(format?.params[1]?.defaultValue).toBe('default');
      expect(format?.params[1]?.description).toBe('Value to insert');
    });
  });
});
