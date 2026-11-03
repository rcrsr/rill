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
  type RillFunction,
  type RillParam,
  structureToTypeValue,
} from '@rcrsr/rill';

import { run } from '../helpers/runtime.js';
import { expectRuntimeError } from '../helpers/halt.js';
import { parseSignatureRegistration } from '../../src/signature-parser.js';

describe('Rill Runtime: Signature Registration', () => {
  describe('AC-17: Structured RillParam[] registers and validates on every call', () => {
    it('validates typed param on first call', async () => {
      await expectRuntimeError(
        () =>
          run('fn(42)', {
            functions: {
              fn: {
                params: [
                  {
                    name: 'msg',
                    type: { kind: 'string' },
                    defaultValue: undefined,
                    annotations: {},
                  },
                ],
                fn: (args) => args['msg']!,
                returnType: anyTypeValue,
              },
            },
          }),
        { code: 'RILL-R001' }
      );
    });

    it('validates typed param on repeated calls', async () => {
      const fns: Record<string, RillFunction> = {
        fn: {
          params: [
            {
              name: 'msg',
              type: { kind: 'string' },
              defaultValue: undefined,
              annotations: {},
            },
          ],
          fn: (args) => args['msg'] ?? null,
          returnType: anyTypeValue,
        },
      };

      // First call with valid arg succeeds
      const r1 = await run('fn("hello")', { functions: fns });
      expect(r1).toBe('hello');

      // Second call with invalid arg still throws (validation fires each call)
      await expectRuntimeError(() => run('fn(99)', { functions: fns }), {
        code: 'RILL-R001',
      });
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
                  type: { kind: 'number' },
                  defaultValue: undefined,
                  annotations: {},
                },
              ],
              fn: (args) => args['x']!,
              annotations: { description: 'Structured form' },
              returnType: anyTypeValue,
            },
            typed: {
              params: [
                {
                  name: 'y',
                  type: { kind: 'string' },
                  defaultValue: undefined,
                  annotations: {},
                },
              ],
              fn: (args) => args['y']!,
              returnType: structureToTypeValue({ kind: 'string' }),
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
                type: { kind: 'number' },
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
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => `${args['y']}!`,
            returnType: structureToTypeValue({ kind: 'string' }),
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
                type: { kind: 'number' },
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
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => `${args['y']}!`,
            returnType: structureToTypeValue({ kind: 'string' }),
          },
        },
      });
      expect(r2).toBe('hi!');
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
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['message']!,
            returnType: structureToTypeValue({ kind: 'string' }),
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
      await expectRuntimeError(
        () =>
          run('echo(42)', {
            functions: {
              echo: {
                params: [
                  {
                    name: 'message',
                    type: { kind: 'string' },
                    defaultValue: undefined,
                    annotations: {},
                  },
                ],
                fn: (args) => args['message']!,
                returnType: structureToTypeValue({ kind: 'string' }),
              },
            },
          }),
        { code: 'RILL-R001' }
      );
    });

    it('accepts valid arg for typed function', async () => {
      const result = await run('echo("hello")', {
        functions: {
          echo: {
            params: [
              {
                name: 'message',
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['message']!,
            returnType: structureToTypeValue({ kind: 'string' }),
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
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => `Hello ${args['name']}`,
            annotations: { description: 'Greets the user' },
            returnType: structureToTypeValue({ kind: 'string' }),
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
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => `Hello ${args['name']}`,
            returnType: structureToTypeValue({ kind: 'string' }),
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
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: { description: 'The name to greet' },
              },
            ],
            fn: (args) => `Hello ${args['name']}`,
            returnType: structureToTypeValue({ kind: 'string' }),
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
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: { description: 'The name' },
              },
            ],
            fn: (args) => `Hello ${args['name']}`,
            annotations: { description: 'A greeter' },
            returnType: structureToTypeValue({ kind: 'string' }),
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
                type: { kind: 'string' },
                defaultValue: 'world',
                annotations: {},
              },
            ],
            fn: (args) => `Hello ${args['name']}`,
            returnType: structureToTypeValue({ kind: 'string' }),
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
                type: { kind: 'number' },
                defaultValue: 2,
                annotations: {},
              },
            ],
            fn: (args) => (args['factor'] as number) * 10,
            returnType: structureToTypeValue({ kind: 'number' }),
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
                type: { kind: 'string' },
                defaultValue: 'world',
                annotations: {},
              },
            ],
            fn: (args) => `Hello ${args['name']}`,
            returnType: structureToTypeValue({ kind: 'string' }),
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
                type: { kind: 'string' },
                defaultValue: 'world',
                annotations: {},
              },
            ],
            fn: (args) => `Hello ${args['name']}`,
            returnType: structureToTypeValue({ kind: 'string' }),
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
              params: null as unknown as RillParam[],
              fn: (args) => args[0]!,
              returnType: anyTypeValue,
            },
          },
        })
      ).toThrow(Error);
    });

    it('error message includes function name when missing required argument', async () => {
      await expectRuntimeError(
        () =>
          run('multiArg("only-one")', {
            functions: {
              multiArg: {
                params: [
                  {
                    name: 'first',
                    type: { kind: 'string' },
                    defaultValue: undefined,
                    annotations: {},
                  },
                  {
                    name: 'second',
                    type: { kind: 'string' },
                    defaultValue: undefined,
                    annotations: {},
                  },
                ],
                fn: (args) => `${args['first']} ${args['second']}`,
                returnType: anyTypeValue,
              },
            },
          }),
        { code: 'RILL-R044', messagePattern: /multiArg|second/ }
      );
    });

    it('throws at call time when required argument missing', async () => {
      let threwAtCallTime = false;
      // Registration succeeds
      const requiredFns: Record<string, RillFunction> = {
        required: {
          params: [
            {
              name: 'x',
              type: { kind: 'string' },
              defaultValue: undefined,
              annotations: {},
            },
          ],
          fn: (args) => args['x']!,
          returnType: anyTypeValue,
        },
      };
      createRuntimeContext({ functions: requiredFns });
      // Error occurs at call time, not registration time
      try {
        await run('required()', { functions: requiredFns });
      } catch {
        threwAtCallTime = true;
      }
      expect(threwAtCallTime).toBe(true);
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
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: { description: 'Template string' },
              },
              {
                name: 'value',
                type: { kind: 'string' },
                defaultValue: 'default',
                annotations: { description: 'Value to insert' },
              },
            ],
            fn: (args) =>
              String(args['template']).replace('{}', String(args['value'])),
            annotations: { description: 'Format a template' },
            returnType: structureToTypeValue({ kind: 'string' }),
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

  describe('parseSignatureRegistration: parameter separator validation', () => {
    it('rejects two params with no separator between them', () => {
      expect(() => parseSignatureRegistration('|a b|', 'fn')).toThrow(
        /expected ',' or '\|' between parameters/
      );
    });

    it('parses comma-separated params', () => {
      const parsed = parseSignatureRegistration('|a, b|', 'fn');
      expect(parsed.params.map((p) => p.name)).toEqual(['a', 'b']);
    });

    it('parses a single param', () => {
      const parsed = parseSignatureRegistration('|a|', 'fn');
      expect(parsed.params.map((p) => p.name)).toEqual(['a']);
    });

    it('parses zero params with ||', () => {
      const parsed = parseSignatureRegistration('||', 'fn');
      expect(parsed.params).toEqual([]);
    });

    it('parses a trailing comma the same as without one', () => {
      const parsed = parseSignatureRegistration('|a,|', 'fn');
      expect(parsed.params.map((p) => p.name)).toEqual(['a']);
    });
  });

  describe('parseSignatureRegistration: malformed signatures', () => {
    const prefix = "Invalid signature for function 'fn': ";

    function expectInvalid(signature: string, fragment: string): Error {
      let caught: unknown;
      try {
        parseSignatureRegistration(signature, 'fn');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      const error = caught as Error;
      expect(error.message.startsWith(prefix)).toBe(true);
      expect(error.message).toContain(fragment);
      return error;
    }

    it('wraps a tokenizer failure with its cause', () => {
      const error = expectInvalid('"unterminated', 'Unterminated string');
      expect(error.cause).toBeInstanceOf(Error);
    });

    it('wraps a parse error with its cause', () => {
      const error = expectInvalid('|a: list(', 'Expected type name');
      expect(error.cause).toBeInstanceOf(Error);
    });

    it('rejects a signature that does not start with | or ||', () => {
      expectInvalid('x', "expected '|' or '||' to start parameter list");
    });

    it('rejects an unclosed parameter list', () => {
      expectInvalid('|a', "expected ',' or '|' between parameters");
    });

    it('rejects a trailing token after the signature', () => {
      expectInvalid('|a| extra', "unexpected token 'extra' after signature");
    });

    it('rejects a dynamic type reference', () => {
      expectInvalid(
        '|a: $t|',
        'dynamic type references ($variable) are not allowed'
      );
    });

    it('rejects annotation values that are not string literals', () => {
      expectInvalid('^(x: 1) |a|', 'annotation values must be string literals');
    });

    it('rejects an annotation key without a colon', () => {
      expectInvalid('^(x "y") |a|', "Expected ':' after annotation key");
    });

    it('rejects a caret without a following parenthesis', () => {
      expectInvalid('^ x', "Expected '(' after '^'");
    });
  });

  describe('parseSignatureRegistration: type structures', () => {
    const prefix = "Invalid signature for function 'fn': ";

    it('parses union members', () => {
      const parsed = parseSignatureRegistration('|a: string|number|', 'fn');
      expect(parsed.params[0]?.type).toEqual({
        kind: 'union',
        members: [{ kind: 'string' }, { kind: 'number' }],
      });
    });

    it('parses a union return type', () => {
      const parsed = parseSignatureRegistration(
        '|a: string| : string|number',
        'fn'
      );
      expect(parsed.returnType).toEqual({
        kind: 'union',
        members: [{ kind: 'string' }, { kind: 'number' }],
      });
    });

    it('parses list(T) with an element type', () => {
      const parsed = parseSignatureRegistration('|a: list(string)|', 'fn');
      expect(parsed.params[0]?.type).toEqual({
        kind: 'list',
        element: { kind: 'string' },
      });
    });

    it('rejects a list with a named argument', () => {
      expect(() =>
        parseSignatureRegistration('|a: list(x: string)|', 'fn')
      ).toThrow(`${prefix}list requires exactly one positional type argument`);
    });

    it('rejects a list with multiple arguments', () => {
      expect(() =>
        parseSignatureRegistration('|a: list(string, number)|', 'fn')
      ).toThrow(`${prefix}list requires exactly one positional type argument`);
    });

    it('parses a dict with named fields and a list return type', () => {
      const parsed = parseSignatureRegistration(
        '|a: dict(k: string)| : list(string)',
        'fn'
      );
      expect(parsed.params[0]?.type).toEqual({
        kind: 'dict',
        fields: { k: { type: { kind: 'string' } } },
      });
      expect(parsed.returnType).toEqual({
        kind: 'list',
        element: { kind: 'string' },
      });
    });

    it('rejects a dict with a positional argument', () => {
      expect(() =>
        parseSignatureRegistration('|a: dict(string)|', 'fn')
      ).toThrow(
        `${prefix}dict type arguments must be named (e.g. dict(key: string))`
      );
    });

    it('parses a tuple mixing named and positional elements', () => {
      const parsed = parseSignatureRegistration(
        '|a: tuple(a: string, number)|',
        'fn'
      );
      expect(parsed.params[0]?.type).toEqual({
        kind: 'tuple',
        elements: [
          { name: 'a', type: { kind: 'string' } },
          { type: { kind: 'number' } },
        ],
      });
    });

    it('rejects type arguments on a non-parameterizable type', () => {
      expect(() =>
        parseSignatureRegistration('|a: string(number)|', 'fn')
      ).toThrow(`${prefix}type 'string' does not accept type arguments`);
    });
  });

  describe('parseSignatureRegistration: descriptions and defaults', () => {
    const prefix = "Invalid signature for function 'fn': ";

    it('treats a bare string in function annotations as the description', () => {
      const parsed = parseSignatureRegistration('^("desc") |a|', 'fn');
      expect(parsed.description).toBe('desc');
    });

    it('treats a bare string in param annotations as the param description', () => {
      const parsed = parseSignatureRegistration('|^("pd") a|', 'fn');
      expect(parsed.params[0]?.annotations).toEqual({ description: 'pd' });
    });

    it('parses string, number, true, false, and negative number defaults', () => {
      const parsed = parseSignatureRegistration(
        '|a = "s", b = 1.5, c = true, d = false, e = -2|',
        'fn'
      );
      expect(parsed.params.map((p) => p.defaultValue)).toEqual([
        's',
        1.5,
        true,
        false,
        -2,
      ]);
    });

    it('rejects a minus followed by a non-number default', () => {
      expect(() => parseSignatureRegistration('|a = -x|', 'fn')).toThrow(
        `${prefix}expected number after '-' in default value`
      );
    });

    it('rejects an unsupported default value', () => {
      expect(() => parseSignatureRegistration('|a = list|', 'fn')).toThrow(
        `${prefix}unsupported default value 'list' (only string, number, bool supported)`
      );
    });
  });

  describe('annotation keys named __proto__', () => {
    it('stores a param annotation key __proto__ as an own property', () => {
      const parsed = parseSignatureRegistration(
        '|^(__proto__: "x") a: string|',
        'fn'
      );
      const annotations = parsed.params[0]?.annotations ?? {};
      expect(Object.hasOwn(annotations, '__proto__')).toBe(true);
      expect(Object.getPrototypeOf(annotations)).toBe(Object.prototype);
    });

    it('accepts a function-level annotation key __proto__ alongside description', () => {
      const parsed = parseSignatureRegistration(
        '^(__proto__: "x", description: "d") |a: string|',
        'fn'
      );
      expect(parsed.description).toBe('d');
    });

    it('stores a dict type field named __proto__ as an own property', () => {
      const parsed = parseSignatureRegistration(
        '|a: dict(__proto__: string)|',
        'fn'
      );
      const type = parsed.params[0]?.type as
        | { fields?: Record<string, unknown> }
        | undefined;
      expect(Object.hasOwn(type?.fields ?? {}, '__proto__')).toBe(true);
    });
  });
});
