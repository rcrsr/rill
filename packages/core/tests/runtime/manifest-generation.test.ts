/**
 * Rill Runtime Tests: Manifest Generation
 *
 * Specification Mapping (conduct/specifications/host-type-system-refactor.md):
 *
 * FR-HTR-9 (Manifest generation):
 * - AC-28: 3 registered host functions → 3 dict entries in manifest
 * - AC-29: Structured RillFunction entry serializes params, return type, defaults, annotations
 * - AC-30: Signature-string entry serializes to equivalent structured form
 * - AC-31: Mixed registrations produce correct entries for both forms
 * - AC-32: generateManifest() returns string, does not write to disk
 * - AC-33: Returned string parses as valid rill file
 * - AC-34: Manifest entries are closure type declarations (no body)
 * - AC-35: Generated manifest does not end with -> export
 * - AC-36: Manifest is a valid rill file without -> export
 *
 * FR-HTR-13:
 * - AC-38: Manifest with annotated descriptions contains names, types, descriptions
 * - AC-39: Default values appear using = value syntax
 *
 * FR-HTR-14:
 * - AC-40: Two closures with same signature but different annotations are type-equal in checker
 * - AC-41: callableEquals continues to compare annotations for runtime identity
 *
 * Boundary conditions:
 * - AC-59: Zero-param function has empty param list in manifest
 * - AC-60: Empty function map produces [:] (EC-6)
 * - AC-61: type: { kind: 'any' } serializes as 'any' in manifest
 * - AC-62: dict param with no fields serializes as 'dict'
 *
 * DEFERRED:
 * - AC-37: Static type checker consumption — DEFERRED to `static-type-checker` initiative
 */

import { describe, expect, it } from 'vitest';
import type {
  RillAtomValue,
  RillDatetime,
  RillFunctionDefinition,
  RillParam,
  RillValue,
  RuntimeContext,
  TypeStructure,
} from '@rcrsr/rill';
import {
  anyTypeValue,
  callable,
  createOrdered,
  createRuntimeContext,
  createTuple,
  execute,
  generateManifest,
  getFunctions,
  isTypeValue,
  parse,
  resolveAtom,
  structureToTypeValue,
} from '@rcrsr/rill';

import { expectRuntimeError } from '../helpers/halt.js';
import { run } from '../helpers/runtime.js';
import { parseSignatureRegistration } from '../../src/runtime/core/signature-registration.js';

describe('Rill Runtime: Manifest Generation', () => {
  describe('AC-32: generateManifest returns a string', () => {
    it('returns a string value', () => {
      const ctx = createRuntimeContext({
        functions: {
          fn: {
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
        },
      });
      const manifest = generateManifest(ctx);
      expect(typeof manifest).toBe('string');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('returns string without writing to disk (pure function)', () => {
      const ctx = createRuntimeContext({
        functions: {
          fn: {
            params: [],
            fn: () => null,
            returnType: anyTypeValue,
          },
        },
      });
      // Calling multiple times returns consistent results (no side effects)
      const m1 = generateManifest(ctx);
      const m2 = generateManifest(ctx);
      expect(m1).toBe(m2);
      expect(() => parse(m1)).not.toThrow();
    });
  });

  describe('AC-35 / AC-36: Manifest does not end with -> export', () => {
    it('manifest string does not end with -> export', () => {
      const ctx = createRuntimeContext({
        functions: {
          fn: {
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
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest.trimEnd()).not.toMatch(/-> export$/);
      expect(() => parse(manifest)).not.toThrow();
    });

    it('empty manifest does not end with -> export', () => {
      const ctx = createRuntimeContext({});
      // Clear all functions so manifest generates empty dict
      ctx.functions.clear();
      const manifest = generateManifest(ctx);
      expect(manifest.trimEnd()).not.toMatch(/-> export$/);
      expect(() => parse(manifest)).not.toThrow();
    });

    it('manifest file is valid rill without -> export (AC-36)', () => {
      const ctx = createRuntimeContext({
        functions: {
          fn: {
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
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest.trimEnd()).not.toMatch(/-> export$/);
      expect(() => parse(manifest)).not.toThrow();
    });
  });

  describe('AC-60 / EC-6: Empty function map generates [:]', () => {
    it('returns [:] for empty function map', () => {
      const ctx = createRuntimeContext({});
      ctx.functions.clear();
      const manifest = generateManifest(ctx);
      expect(manifest).toBe('[:]');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('empty manifest is a valid rill file', async () => {
      const ctx = createRuntimeContext({});
      ctx.functions.clear();
      const manifest = generateManifest(ctx);
      await expect(run(manifest)).resolves.not.toThrow();
    });
  });

  describe('AC-28: 3 registered host functions produce 3 manifest entries', () => {
    it('manifest contains one entry per registered host function', () => {
      const ctx = createRuntimeContext({
        functions: {
          alpha: {
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
          beta: {
            params: [
              {
                name: 'y',
                type: { kind: 'number' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['y']!,
            returnType: anyTypeValue,
          },
          gamma: {
            params: [],
            fn: () => null,
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      // Each function name appears as a quoted key
      expect(manifest).toContain('"alpha"');
      expect(manifest).toContain('"beta"');
      expect(manifest).toContain('"gamma"');
      expect(() => parse(manifest)).not.toThrow();
    });
  });

  describe('AC-29: Structured RillFunction serializes params, return type, defaults, annotations', () => {
    it('serializes param name and type in fn signature format', () => {
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
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('name: string');
      expect(manifest).toContain('fn(name: string):string');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('prints a parameter default as = literal', () => {
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
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('name: string = "world"');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('serializes description annotation in manifest (AC-38)', () => {
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
            annotations: { description: 'Greets a user' },
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('Greets a user');
      expect(manifest).toContain('The name to greet');
      expect(() => parse(manifest)).not.toThrow();
    });
  });

  describe('AC-30: Structured entry serializes to closure signature format', () => {
    it('structured function appears in manifest with params and return type', () => {
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
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('"echo"');
      expect(manifest).toContain('message: string');
      expect(manifest).toContain(':string');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('structured function with description appears in manifest (AC-38)', () => {
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
            annotations: { description: 'Echoes the message' },
            returnType: structureToTypeValue({ kind: 'string' }),
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('Echoes the message');
      expect(() => parse(manifest)).not.toThrow();
    });
  });

  describe('AC-31: Multiple structured registrations produce correct entries', () => {
    it('manifest contains entries for both structured functions', () => {
      const ctx = createRuntimeContext({
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
            annotations: { description: 'A structured function' },
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
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('"structured"');
      expect(manifest).toContain('"typed"');
      expect(manifest).toContain('x: number');
      expect(manifest).toContain('y: string');
      expect(() => parse(manifest)).not.toThrow();
    });
  });

  describe('AC-33 / AC-34: Manifest is a valid rill file with closure type declarations', () => {
    it('manifest is a non-empty string containing the function names (AC-33)', () => {
      const ctx = createRuntimeContext({
        functions: {
          add: {
            params: [
              {
                name: 'a',
                type: { kind: 'number' },
                defaultValue: undefined,
                annotations: {},
              },
              {
                name: 'b',
                type: { kind: 'number' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => (args['a'] as number) + (args['b'] as number),
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(typeof manifest).toBe('string');
      expect(manifest).toContain('"add"');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('manifest entries use closure syntax |params|', () => {
      const ctx = createRuntimeContext({
        functions: {
          fn: {
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
        },
      });
      const manifest = generateManifest(ctx);
      // fn type format: fn(params)
      expect(manifest).toMatch(/fn\(.*\)/);
      expect(() => parse(manifest)).not.toThrow();
    });
  });

  describe('AC-59: Zero-param function has empty param list in manifest', () => {
    it('zero-param function renders || in manifest', () => {
      const ctx = createRuntimeContext({
        functions: {
          ping: {
            params: [],
            fn: () => 'pong',
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('fn()');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('zero-param manifest contains the function name', () => {
      const ctx = createRuntimeContext({
        functions: {
          ping: {
            params: [],
            fn: () => 'pong',
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('"ping"');
      expect(manifest.trimEnd()).not.toMatch(/-> export$/);
      expect(() => parse(manifest)).not.toThrow();
    });

    it('bodyless form is emitted unconditionally, with no {pass} fallback, for zero-param and annotated-param entries', async () => {
      const ctx = createRuntimeContext({
        functions: {
          ping: {
            params: [],
            fn: () => 'pong',
            returnType: anyTypeValue,
          },
          greet: {
            params: [
              {
                name: 'name',
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: { description: 'd' },
              },
            ],
            fn: (args) => `Hello ${args['name']}`,
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);

      expect(manifest).not.toContain('{pass}');
      expect(manifest).toContain('fn():');
      expect(manifest).toContain('^(description: "d")');
      expect(() => parse(manifest)).not.toThrow();

      const result = await execute(parse(manifest), ctx);
      const dict = result.result as Record<string, RillValue>;
      for (const value of Object.values(dict)) {
        expect(isTypeValue(value)).toBe(true);
      }
    });
  });

  describe('AC-61: type: { type: "any" } serializes as any in manifest', () => {
    it('any-typed param serializes as "any" type name', () => {
      const ctx = createRuntimeContext({
        functions: {
          fn: {
            params: [
              {
                name: 'val',
                type: { kind: 'any' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['val']!,
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('val: any');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('type: undefined param (any-typed) also serializes as any', () => {
      const ctx = createRuntimeContext({
        functions: {
          fn: {
            params: [
              {
                name: 'val',
                type: undefined,
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['val']!,
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('val: any');
      expect(() => parse(manifest)).not.toThrow();
    });
  });

  describe('AC-62: dict param with no fields serializes as dict', () => {
    it('plain dict param renders as dict type in manifest', () => {
      const ctx = createRuntimeContext({
        functions: {
          fn: {
            params: [
              {
                name: 'data',
                type: { kind: 'dict' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['data']!,
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('data: dict');
      expect(() => parse(manifest)).not.toThrow();
    });
  });

  describe('Builtin exclusion: built-in functions do not appear in manifest', () => {
    it('log, range, json, enumerate are absent from manifest when host functions are also registered', () => {
      const ctx = createRuntimeContext({
        functions: {
          myFn: {
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
        },
      });
      const manifest = generateManifest(ctx);
      // Host function appears
      expect(manifest).toContain('"myFn"');
      // Built-in names must not appear as manifest keys
      expect(manifest).not.toMatch(/"log"/);
      expect(manifest).not.toMatch(/"range"/);
      expect(manifest).not.toMatch(/"json"/);
      expect(manifest).not.toMatch(/"enumerate"/);
      expect(() => parse(manifest)).not.toThrow();
    });
  });

  describe('Bug #278: descriptions are emitted as valid rill; default values never break parsing', () => {
    it('prints a string default as a quoted literal rather than a bare word', () => {
      const ctx = createRuntimeContext({
        functions: {
          greet: {
            params: [
              {
                name: 'name',
                type: { kind: 'string' },
                defaultValue: 'World',
                annotations: {},
              },
            ],
            fn: (args) => `Hello ${args['name']}`,
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('name: string = "World"');
      expect(manifest).not.toMatch(/=\s+World\b/);
      expect(() => parse(manifest)).not.toThrow();
    });

    it('escapes quotes and backslashes in a string default and still parses', () => {
      const ctx = createRuntimeContext({
        functions: {
          fn: {
            params: [
              {
                name: 'q',
                type: { kind: 'string' },
                defaultValue: 'a "quoted" \\ value',
                annotations: {},
              },
            ],
            fn: (args) => args['q']!,
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('q: string = "a \\"quoted\\" \\\\ value"');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('escapes double quotes in parameter and fn descriptions', () => {
      const ctx = createRuntimeContext({
        functions: {
          fn: {
            params: [
              {
                name: 'x',
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: { description: 'the "x" value' },
              },
            ],
            fn: (args) => args['x']!,
            annotations: { description: 'a "described" function' },
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      // Both the closure-level and param-level descriptions escape their quotes,
      // so they cannot terminate the surrounding annotation string early.
      expect(manifest).toContain(
        '^(description: "a \\"described\\" function")'
      );
      expect(manifest).toContain('^(description: "the \\"x\\" value")');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('re-parses a typed manifest whose fn description contains escaped quotes', () => {
      // A typed function with an explicit return type serializes to the
      // parseable fn-type form `^(description: "...") fn(name: type):ret`.
      // The escaped quotes in the description keep the annotation string from
      // terminating early, so the whole manifest is a valid rill file.
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
            annotations: { description: 'greet "someone"' },
            returnType: structureToTypeValue({ kind: 'string' }),
          },
          echo: {
            params: [
              {
                name: 'msg',
                type: { kind: 'number' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['msg']!,
            returnType: structureToTypeValue({ kind: 'number' }),
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('greet \\"someone\\"');
      expect(() => parse(manifest)).not.toThrow();
    });
  });

  describe('Parseable manifests for every default value kind and param/return type shape', () => {
    it('a bool default value does not break parsing', () => {
      const ctx = createRuntimeContext({
        functions: {
          fn: {
            params: [
              {
                name: 'flag',
                type: { kind: 'bool' },
                defaultValue: true,
                annotations: {},
              },
            ],
            fn: (args) => args['flag']!,
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('flag: bool = true');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('a large-exponent number default value does not break parsing', () => {
      const ctx = createRuntimeContext({
        functions: {
          fn: {
            params: [
              {
                name: 'n',
                type: { kind: 'number' },
                defaultValue: 1e23,
                annotations: {},
              },
            ],
            fn: (args) => args['n']!,
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('n: number');
      expect(manifest).not.toMatch(/n: number =/);
      expect(() => parse(manifest)).not.toThrow();
    });

    it('an atom default value does not break parsing', () => {
      const atomDefault: RillAtomValue = {
        __rill_atom: true,
        atom: resolveAtom('TIMEOUT'),
      };
      const ctx = createRuntimeContext({
        functions: {
          fn: {
            params: [
              {
                name: 'code',
                type: { kind: 'atom' },
                defaultValue: atomDefault,
                annotations: {},
              },
            ],
            fn: (args) => args['code']!,
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('code: atom = #TIMEOUT');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('a datetime default value does not break parsing', () => {
      const datetimeDefault: RillDatetime = {
        __rill_datetime: true,
        unix: Date.now(),
      };
      const ctx = createRuntimeContext({
        functions: {
          fn: {
            params: [
              {
                name: 'at',
                type: { kind: 'datetime' },
                defaultValue: datetimeDefault,
                annotations: {},
              },
            ],
            fn: (args) => args['at']!,
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('at: datetime');
      expect(manifest).not.toMatch(/at: datetime =/);
      expect(() => parse(manifest)).not.toThrow();
    });

    it('a union-typed param prints as union(...) and still parses', () => {
      const ctx = createRuntimeContext({
        functions: {
          fn: {
            params: [
              {
                name: 'value',
                type: {
                  kind: 'union',
                  members: [{ kind: 'string' }, { kind: 'number' }],
                },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['value']!,
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('value: union(number, string)');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('a fn-typed param keeps its signature and still parses', () => {
      const ctx = createRuntimeContext({
        functions: {
          fn: {
            params: [
              {
                name: 'q',
                type: {
                  kind: 'fn',
                  params: [{ name: 'n', type: { kind: 'number' } }],
                  ret: { kind: 'string' },
                } as never,
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['q']!,
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('q: fn(n: number):string');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('a fn nested inside a list element type keeps its signature and still parses', () => {
      const ctx = createRuntimeContext({
        functions: {
          fn: {
            params: [
              {
                name: 'cbs',
                type: {
                  kind: 'list',
                  element: {
                    kind: 'fn',
                    params: [{ name: 'n', type: { kind: 'number' } }],
                    ret: { kind: 'string' },
                  },
                } as never,
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['cbs']!,
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('cbs: list(fn(n: number):string)');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('a fn nested inside a dict field type keeps its signature and still parses', () => {
      const ctx = createRuntimeContext({
        functions: {
          fn: {
            params: [
              {
                name: 'handlers',
                type: {
                  kind: 'dict',
                  fields: {
                    onDone: {
                      name: 'onDone',
                      type: {
                        kind: 'fn',
                        params: [{ name: 'n', type: { kind: 'number' } }],
                        ret: { kind: 'string' },
                      },
                    },
                  },
                } as never,
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['handlers']!,
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain(
        'handlers: dict(onDone: fn(n: number):string)'
      );
      expect(() => parse(manifest)).not.toThrow();
    });

    it('a dict field default with no literal form is left out of the manifest but still shown by getFunctions', () => {
      const ctx = createRuntimeContext({
        functions: {
          fn: {
            params: [
              {
                name: 'opts',
                type: {
                  kind: 'dict',
                  fields: {
                    cb: {
                      name: 'cb',
                      type: { kind: 'fn' },
                      defaultValue: callable(() => 1),
                    },
                  },
                } as never,
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['opts']!,
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('opts: dict(cb: fn)');
      expect(manifest).not.toContain('cb: fn =');
      expect(() => parse(manifest)).not.toThrow();
      const shown = getFunctions(ctx).find((f) => f.name === 'fn');
      expect(shown?.params[0]?.type).toContain('cb: fn = ');
    });

    it('a tuple element default value is printed and does not break parsing', () => {
      const atomDefault: RillAtomValue = {
        __rill_atom: true,
        atom: resolveAtom('TIMEOUT'),
      };
      const ctx = createRuntimeContext({
        functions: {
          fn: {
            params: [
              {
                name: 'pair',
                type: {
                  kind: 'tuple',
                  elements: [
                    {
                      type: { kind: 'atom' },
                      defaultValue: atomDefault,
                    },
                  ],
                } as never,
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['pair']!,
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('pair: tuple(atom = #TIMEOUT)');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('an ordered field default value is printed and does not break parsing', () => {
      const atomDefault: RillAtomValue = {
        __rill_atom: true,
        atom: resolveAtom('TIMEOUT'),
      };
      const ctx = createRuntimeContext({
        functions: {
          fn: {
            params: [
              {
                name: 'rec',
                type: {
                  kind: 'ordered',
                  fields: [
                    {
                      name: 'code',
                      type: { kind: 'atom' },
                      defaultValue: atomDefault,
                    },
                  ],
                } as never,
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['rec']!,
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('rec: ordered(code: atom = #TIMEOUT)');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('a fn nested inside a stream ret type keeps its signature and the outer', () => {
      const ctx = createRuntimeContext({
        functions: {
          fn: {
            params: [
              {
                name: 's',
                type: {
                  kind: 'stream',
                  chunk: { kind: 'number' },
                  ret: {
                    kind: 'fn',
                    params: [{ name: 'n', type: { kind: 'number' } }],
                    ret: { kind: 'string' },
                  },
                } as never,
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['s']!,
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('s: stream(number):fn(n: number):string');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('a plain number param and return type round-trips unchanged', () => {
      const ctx = createRuntimeContext({
        functions: {
          fn: {
            params: [
              {
                name: 'x',
                type: { kind: 'number' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['x']!,
            returnType: structureToTypeValue({ kind: 'number' }),
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('x: number');
      expect(manifest).toContain(':number');
      expect(() => parse(manifest)).not.toThrow();
    });
  });

  describe('AC-40 / AC-41: Type equality vs identity for closures with same signature but different annotations', () => {
    it('two closures with identical param types compare as structurally equal regardless of annotations (AC-40)', async () => {
      // The type checker uses structural type equality — annotations are NOT part of the type.
      // Use .^type to get the structural type of each closure and compare.
      const result = await run(`
        fn(x: string) { $x } => $a
        fn(x: string) { $x } => $b
        $a.^type == $b.^type
      `);
      expect(result).toBe(true);
    });

    it('two closures with same params but different annotations have same structural type (AC-40)', async () => {
      // Annotations are metadata, not part of the structural type for type-checking.
      // Use .^type to compare structural types — annotations do not affect structural equality.
      const result = await run(`
        ^(role: "primary") fn(x: string) { $x } => $a
        ^(role: "secondary") fn(x: string) { $x } => $b
        $a.^type == $b.^type
      `);
      expect(result).toBe(true);
    });

    it('callableEquals treats two closures with different annotations as non-identical (AC-41)', async () => {
      // Runtime identity (callableEquals) includes annotations.
      // Two closures with different annotations compared with == should be non-equal at value level.
      const result = await run(`
        ^(role: "primary") fn(x: string) { $x } => $a
        ^(role: "secondary") fn(x: string) { $x } => $b
        $a == $b
      `);
      // Different annotations → not value-equal
      expect(result).toBe(false);
    });
  });
});

describe('Rill Runtime: Manifest field keys', () => {
  it('quotes a dict param key that is not an identifier and re-parses', () => {
    const ctx = createRuntimeContext({
      functions: {
        fn: {
          params: [
            {
              name: 'x',
              type: {
                kind: 'dict',
                fields: {
                  'a b': { type: { kind: 'string' }, defaultValue: undefined },
                },
              },
              defaultValue: undefined,
              annotations: {},
            },
          ],
          fn: (args) => args['x']!,
          returnType: anyTypeValue,
        },
      },
    });
    const manifest = generateManifest(ctx);
    expect(manifest).toContain('dict("a b": string)');
    expect(() => parse(manifest)).not.toThrow();
  });

  it('escapes quote and brace characters in a function name key', async () => {
    const ctx = createRuntimeContext({
      functions: {
        'say"hi{x}': {
          params: [],
          fn: () => '',
          returnType: anyTypeValue,
        },
      },
    });
    const manifest = generateManifest(ctx);
    expect(manifest).toContain('"say\\"hi{{x}}":');
    expect(() => parse(manifest)).not.toThrow();

    const result = await execute(parse(manifest), ctx);
    const dict = result.result as Record<string, RillValue>;
    expect(Object.hasOwn(dict, 'say"hi{x}')).toBe(true);
  });

  it('round-trips every manifest entry through parseSignatureRegistration', () => {
    const noop = (): RillValue => 1;
    const ctx = createRuntimeContext({
      functions: {
        plain: { signature: 'fn()', fn: noop },
        typed: {
          signature:
            'fn(^(description: "pd") x: union(string, number), cb: fn(string):bool):list',
          description: 'does "it"',
          fn: noop,
        },
        shaped: {
          signature: 'fn(d: dict(k: string = "a"), t: tuple(number, string))',
          fn: noop,
        },
      },
    });
    const entries = generateManifest(ctx)
      .split('\n')
      .map((line) => /^\s*"([^"]+)": (.*?),?$/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null);

    expect(entries.map((m) => m[1])).toEqual(['plain', 'typed', 'shaped']);
    for (const [, name, signature] of entries) {
      expect(() => parseSignatureRegistration(signature!, name!)).not.toThrow();
    }
  });
});

/** Signature text of each manifest entry, keyed by function name. */
function manifestSignatures(ctx: RuntimeContext): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of generateManifest(ctx).split('\n')) {
    const m = /^\s*"([^"]+)": (.*?),?$/.exec(line);
    if (m !== null) out[m[1]!] = m[2]!;
  }
  return out;
}

type Captured = Record<string, RillValue>;

describe('round-trips defaults through re-registration', () => {
  const atom: RillAtomValue = {
    __rill_atom: true,
    atom: resolveAtom('TIMEOUT'),
  };
  const noDefault = { annotations: {}, defaultValue: undefined } as const;
  const dictType = (b: number): TypeStructure => ({
    kind: 'dict',
    fields: {
      a: { name: 'a', type: { kind: 'number' }, defaultValue: undefined },
      b: { name: 'b', type: { kind: 'number' }, defaultValue: b },
    },
  });

  function build(
    seen: Record<string, Captured>
  ): Record<string, RillFunctionDefinition> {
    const capture =
      (key: string) =>
      (args: Captured): RillValue => {
        seen[key] = args;
        return 1;
      };
    const param = (
      name: string,
      type: TypeStructure,
      defaultValue: RillValue
    ): RillParam => ({ name, type, defaultValue, annotations: {} });
    return {
      scalars: {
        params: [
          param('s', { kind: 'string' }, 'a "q" {x} \\ b\nc'),
          param('n', { kind: 'number' }, -3),
          param('f', { kind: 'bool' }, false),
          param('at', { kind: 'atom' }, atom),
          param('l', { kind: 'list' }, [1, 2]),
          param('d', { kind: 'dict' }, { k: 'v' }),
          param('t', { kind: 'tuple' }, createTuple([1, 'x'])),
          param('o', { kind: 'ordered' }, createOrdered([['k', 1]])),
        ],
        returnType: anyTypeValue,
        fn: capture('scalars'),
      },
      shaped: {
        params: [{ name: 'v', type: dictType(9), ...noDefault }],
        returnType: anyTypeValue,
        fn: capture('shaped'),
      },
      unioned: {
        params: [
          {
            name: 'v',
            type: {
              kind: 'union',
              members: [dictType(1), dictType(2)],
            },
            ...noDefault,
          },
        ],
        returnType: anyTypeValue,
        fn: capture('unioned'),
      },
    } as never;
  }

  const script = 'scalars()\nshaped(dict[a: 1])\nunioned(dict[a: 1])';

  it('re-registers every printed default so the host sees the same arguments', async () => {
    const originalSeen: Record<string, Captured> = {};
    const originalFns = build(originalSeen);
    const original = createRuntimeContext({ functions: originalFns });
    await run(script, { functions: originalFns });

    const signatures = manifestSignatures(original);
    expect(Object.keys(signatures)).toEqual(['scalars', 'shaped', 'unioned']);
    const reSeen: Record<string, Captured> = {};
    const reFns: Record<string, RillFunctionDefinition> = {};
    const capture = build(reSeen);
    for (const [name, signature] of Object.entries(signatures)) {
      reFns[name] = { signature, fn: capture[name]!.fn };
    }
    const reregistered = createRuntimeContext({ functions: reFns });
    await run(script, { functions: reFns });

    expect(Object.keys(originalSeen)).toEqual(['scalars', 'shaped', 'unioned']);
    expect(reSeen).toEqual(originalSeen);
    expect(reSeen['unioned']).toEqual({ v: { a: 1, b: 1 } });
    expect(generateManifest(reregistered)).toBe(generateManifest(original));
  });
});

describe('defaults without a literal form', () => {
  const duration: RillValue = {
    __rill_duration: true,
    months: 0,
    ms: 1000,
  };
  const functions = {
    f: {
      params: [
        {
          name: 'at',
          type: { kind: 'datetime' },
          defaultValue: { __rill_datetime: true, unix: 0 } as RillDatetime,
          annotations: {},
        },
        {
          name: 'big',
          type: { kind: 'number' },
          defaultValue: 1e23,
          annotations: {},
        },
        {
          name: 'cfg',
          type: {
            kind: 'dict',
            fields: {
              wait: {
                name: 'wait',
                type: { kind: 'duration' },
                defaultValue: duration,
              },
              cb: {
                name: 'cb',
                type: { kind: 'fn' },
                defaultValue: callable(() => 1),
              },
              k: { name: 'k', type: { kind: 'number' }, defaultValue: 1 },
            },
          },
          defaultValue: undefined,
          annotations: {},
        },
      ],
      returnType: anyTypeValue,
      fn: (): RillValue => 1,
    },
  } as never;

  it('leaves each such default out and keeps the rest', () => {
    const entry = manifestSignatures(createRuntimeContext({ functions }))['f']!;
    expect(entry).toContain('at: datetime,');
    expect(entry).toContain('big: number,');
    expect(entry).toContain('wait: duration');
    expect(entry).not.toContain('wait: duration =');
    expect(entry).toContain('cb: fn');
    expect(entry).not.toContain('cb: fn =');
    expect(entry).toContain('k: number = 1');
    expect(entry).not.toMatch(/(?:at: datetime|big: number) =/);
  });

  it('re-registers without throwing and requires the dropped parameter', async () => {
    const entry = manifestSignatures(createRuntimeContext({ functions }))['f']!;
    const reFns = { f: { signature: entry, fn: (): RillValue => 1 } };
    expect(() => createRuntimeContext({ functions: reFns })).not.toThrow();
    await expectRuntimeError(() => run('f()', { functions: reFns }), {
      code: 'RILL-R044',
    });
  });
});
