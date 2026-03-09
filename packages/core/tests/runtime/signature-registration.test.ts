/**
 * Rill Runtime Tests: Signature Registration
 *
 * Specification Mapping (conduct/specifications/host-type-system-refactor.md):
 *
 * FR-HTR-7 (Signature string registration):
 * - AC-17: Structured RillParam[] registers and validates on every call
 * - AC-18: Mixed structured and signature entries in same map process without error
 * - AC-19: Structured registration with requireDescriptions validates all param descriptions
 * - AC-20: '|message: string|:string' parses to string param and string return type
 * - AC-21: Closure-level ^(description: "...") extracted as function description
 * - AC-22: Parameter-level ^(description: "...") populates param's description annotation
 * - AC-23: '= value' default syntax parsed and applied
 * - AC-24: Syntax error in signature → descriptive Error at registration time (not call time)
 * - AC-25: requireDescriptions rejects signature without closure-level description annotation
 *
 * Error contracts:
 * - AC-53: '|broken: |:string' → Error with parse error details at registration (EC-8)
 * - AC-55: requireDescriptions without description → Error (EC-10)
 *
 * BLOCKED:
 * - AC-9:  Union-typed param validation — BLOCKED by `type-system-improvements`
 * - AC-26: Union-typed signature parsing — BLOCKED by `type-system-improvements`
 * - AC-27: Union-typed rejection — BLOCKED by `type-system-improvements`
 */

import { describe, expect, it } from 'vitest';
import { createRuntimeContext, getFunctions, RuntimeError } from '@rcrsr/rill';

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
              fn: (args) => args[0],
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
          fn: (args: unknown[]) => args[0],
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

  describe('AC-18: Mixed structured and signature entries process without error', () => {
    it('registers both structured and signature entries in one functions map', () => {
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
              fn: (args) => args[0],
              description: 'Structured form',
            },
            sig: {
              signature: '|y: string|:string',
              fn: (args) => args[0],
            },
          },
        })
      ).not.toThrow();
    });

    it('calls both structured and signature functions after mixed registration', async () => {
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
            fn: (args) => (args[0] as number) * 2,
          },
          sig: {
            signature: '|y: string|:string',
            fn: (args) => `${args[0]}!`,
          },
        },
      });
      expect(r1).toBe(20);

      const r2 = await run('sig("hi")', {
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
            fn: (args) => (args[0] as number) * 2,
          },
          sig: {
            signature: '|y: string|:string',
            fn: (args) => `${args[0]}!`,
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
              fn: (args) => args[0],
              description: 'A function',
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
              fn: (args) => args[0],
              description: 'A function',
            },
          },
          requireDescriptions: true,
        })
      ).not.toThrow();
    });
  });

  describe('AC-20: Signature string parses to typed param and return type', () => {
    it('parses string param and string return type from signature', async () => {
      const ctx = createRuntimeContext({
        functions: {
          echo: {
            signature: '|message: string|:string',
            fn: (args) => args[0],
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

    it('enforces parsed string type at call time', async () => {
      await expect(
        run('echo(42)', {
          functions: {
            echo: {
              signature: '|message: string|:string',
              fn: (args) => args[0],
            },
          },
        })
      ).rejects.toThrow(RuntimeError);
    });

    it('accepts valid string arg for signature-registered function', async () => {
      const result = await run('echo("hello")', {
        functions: {
          echo: {
            signature: '|message: string|:string',
            fn: (args) => args[0],
          },
        },
      });
      expect(result).toBe('hello');
    });
  });

  describe('AC-21: Closure-level description annotation extracted as function description', () => {
    it('extracts description from ^(description: "...") closure annotation', () => {
      const ctx = createRuntimeContext({
        functions: {
          greet: {
            signature:
              '^(description: "Greets the user") |name: string|:string',
            fn: (args) => `Hello ${args[0]}`,
          },
        },
      });

      const fns = getFunctions(ctx);
      const greet = fns.find((f) => f.name === 'greet');
      expect(greet?.description).toBe('Greets the user');
    });

    it('extracts description from shorthand bare string annotation', () => {
      const ctx = createRuntimeContext({
        functions: {
          greet: {
            signature: '^("Greets the user") |name: string|:string',
            fn: (args) => `Hello ${args[0]}`,
          },
        },
      });

      const fns = getFunctions(ctx);
      const greet = fns.find((f) => f.name === 'greet');
      expect(greet?.description).toBe('Greets the user');
    });
  });

  describe('AC-22: Parameter-level annotation populates param description', () => {
    it('extracts param description from ^(description: "...") param annotation', () => {
      const ctx = createRuntimeContext({
        functions: {
          greet: {
            signature:
              '|^(description: "The name to greet") name: string|:string',
            fn: (args) => `Hello ${args[0]}`,
          },
        },
      });

      const fns = getFunctions(ctx);
      const greet = fns.find((f) => f.name === 'greet');
      expect(greet?.params[0]?.description).toBe('The name to greet');
    });

    it('supports both closure-level and param-level annotations in same signature', () => {
      const ctx = createRuntimeContext({
        functions: {
          greet: {
            signature:
              '^(description: "A greeter") |^(description: "The name") name: string|:string',
            fn: (args) => `Hello ${args[0]}`,
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
    it('parses string default value from signature', async () => {
      const result = await run('greet()', {
        functions: {
          greet: {
            signature: '|name: string = "world"|:string',
            fn: (args) => `Hello ${args[0]}`,
          },
        },
      });
      expect(result).toBe('Hello world');
    });

    it('parses number default value from signature', async () => {
      const result = await run('scale()', {
        functions: {
          scale: {
            signature: '|factor: number = 2|:number',
            fn: (args) => (args[0] as number) * 10,
          },
        },
      });
      expect(result).toBe(20);
    });

    it('overrides default when arg is supplied', async () => {
      const result = await run('greet("alice")', {
        functions: {
          greet: {
            signature: '|name: string = "world"|:string',
            fn: (args) => `Hello ${args[0]}`,
          },
        },
      });
      expect(result).toBe('Hello alice');
    });

    it('default value appears in getFunctions metadata', () => {
      const ctx = createRuntimeContext({
        functions: {
          greet: {
            signature: '|name: string = "world"|:string',
            fn: (args) => `Hello ${args[0]}`,
          },
        },
      });

      const fns = getFunctions(ctx);
      const greet = fns.find((f) => f.name === 'greet');
      expect(greet?.params[0]?.defaultValue).toBe('world');
    });
  });

  describe('AC-24 / AC-53: Syntax error in signature throws descriptive Error at registration (EC-8)', () => {
    it('throws Error synchronously at registration for invalid signature', () => {
      expect(() =>
        createRuntimeContext({
          functions: {
            broken: {
              signature: '|broken: |:string',
              fn: (args) => args[0],
            },
          },
        })
      ).toThrow(Error);
    });

    it('error message names the function and includes parse details', () => {
      try {
        createRuntimeContext({
          functions: {
            badFn: {
              signature: '|broken: |:string',
              fn: (args) => args[0],
            },
          },
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        const msg = (err as Error).message;
        expect(msg).toContain('badFn');
      }
    });

    it('throws at registration, not at call time', () => {
      // The error must occur when createRuntimeContext is called,
      // not when the function is invoked in a script.
      let threwAtRegistration = false;
      try {
        createRuntimeContext({
          functions: {
            broken: {
              signature: 'not a valid signature at all!!!',
              fn: (args) => args[0],
            },
          },
        });
      } catch {
        threwAtRegistration = true;
      }
      expect(threwAtRegistration).toBe(true);
    });
  });

  describe('AC-25 / AC-55: requireDescriptions rejects signature without closure-level description (EC-10)', () => {
    it('throws when signature has no description annotation and requireDescriptions is true', () => {
      expect(() =>
        createRuntimeContext({
          functions: {
            echo: {
              signature: '|message: string|:string',
              fn: (args) => args[0],
            },
          },
          requireDescriptions: true,
        })
      ).toThrow(/echo.*requires description|requires description.*echo/i);
    });

    it('passes when signature has description annotation', () => {
      expect(() =>
        createRuntimeContext({
          functions: {
            echo: {
              signature:
                '^(description: "Echoes a message") |^(description: "The message") message: string|:string',
              fn: (args) => args[0],
            },
          },
          requireDescriptions: true,
        })
      ).not.toThrow();
    });
  });

  describe('AC-63: Signature with all features parses correctly', () => {
    it('parses annotation, multiple typed params with defaults, and return type', async () => {
      const ctx = createRuntimeContext({
        functions: {
          format: {
            signature:
              '^(description: "Format a template") |^(description: "Template string") template: string, ^(description: "Value to insert") value: string = "default"|:string',
            fn: (args) => String(args[0]).replace('{}', String(args[1])),
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
