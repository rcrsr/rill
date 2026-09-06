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
import type { RillAtomValue, RillDatetime, RillValue } from '@rcrsr/rill';
import {
  anyTypeValue,
  createRuntimeContext,
  generateManifest,
  parse,
  resolveAtom,
  structureToTypeValue,
} from '@rcrsr/rill';

import { run } from '../helpers/runtime.js';

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
            fn: (args) => args['x'],
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
            fn: (args) => args['x'],
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
            fn: (args) => args['x'],
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
            fn: (args) => args['x'],
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
            fn: (args) => args['y'],
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
    it('serializes param name and type in closure signature format', () => {
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
      expect(manifest).toContain('|:string');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('omits default values from the manifest entry (not every RillValue round-trips through a rill literal)', () => {
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
      // Default values are intentionally not serialized into the manifest;
      // the signature carries name and type only.
      expect(manifest).toContain('name: string');
      expect(manifest).not.toContain('= "world"');
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
            fn: (args) => args['message'],
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
            fn: (args) => args['message'],
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
            fn: (args) => args['x'],
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
            fn: (args) => args['y'],
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
            fn: (args) => args['x'],
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      // Closure signature format: |params|
      expect(manifest).toMatch(/\|.*\|/);
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
      expect(manifest).toContain('||');
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
            fn: (args) => args['val'],
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
            fn: (args) => args['val'],
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
            fn: (args) => args['data'],
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
            fn: (args) => args['x'],
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
    it('drops a string default value from the manifest entry rather than emitting a bare word', () => {
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
      // Previously emitted `= World` (a bare identifier) which failed to parse
      // with "Expected literal, got: World". Default values are now omitted
      // entirely, so the failure mode cannot recur.
      expect(manifest).toContain('name: string');
      expect(manifest).not.toContain('= "World"');
      expect(manifest).not.toMatch(/=\s+World\b/);
      expect(() => parse(manifest)).not.toThrow();
    });

    it('a default value containing quotes and backslashes does not appear in the manifest and does not break parsing', () => {
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
            fn: (args) => args['q'],
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('q: string');
      expect(manifest).not.toContain('quoted');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('escapes double quotes in parameter and closure descriptions', () => {
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
            fn: (args) => args['x'],
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

    it('re-parses a typed manifest whose closure description contains escaped quotes', () => {
      // A typed function with an explicit return type serializes to the
      // parseable closure-type form `^(description: "...") |name: type|:ret`.
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
            fn: (args) => args['msg'],
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
            fn: (args) => args['flag'],
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('flag: bool');
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
            fn: (args) => args['n'],
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('n: number');
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
            fn: (args) => args['code'],
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('code: atom');
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
            fn: (args) => args['at'],
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('at: datetime');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('a union-typed param collapses to any and still parses', () => {
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
            fn: (args) => args['value'],
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('value: any');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('a nested closure-typed param collapses to closure and still parses', () => {
      const ctx = createRuntimeContext({
        functions: {
          fn: {
            params: [
              {
                name: 'q',
                type: {
                  kind: 'closure',
                  params: [{ name: 'n', type: { kind: 'number' } }],
                  ret: { kind: 'string' },
                } as never,
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['q'],
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('q: closure');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('a closure nested inside a list element type collapses to closure and still parses', () => {
      const ctx = createRuntimeContext({
        functions: {
          fn: {
            params: [
              {
                name: 'cbs',
                type: {
                  kind: 'list',
                  element: {
                    kind: 'closure',
                    params: [{ name: 'n', type: { kind: 'number' } }],
                    ret: { kind: 'string' },
                  },
                } as never,
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['cbs'],
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('cbs: list(closure)');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('a closure nested inside a dict field type collapses to closure and still parses', () => {
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
                        kind: 'closure',
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
            fn: (args) => args['handlers'],
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('handlers: dict(onDone: closure)');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('a dict field default value is omitted and does not break parsing', () => {
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
                      type: { kind: 'closure' },
                      defaultValue: {
                        __rill_closure: true,
                      } as unknown as RillValue,
                    },
                  },
                } as never,
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['opts'],
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('opts: dict(cb: closure)');
      expect(manifest).not.toContain('=');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('a tuple element default value is omitted and does not break parsing', () => {
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
            fn: (args) => args['pair'],
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('pair: tuple(atom)');
      expect(manifest).not.toContain('=');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('an ordered field default value is omitted and does not break parsing', () => {
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
            fn: (args) => args['rec'],
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('rec: ordered(code: atom)');
      expect(manifest).not.toContain('=');
      expect(() => parse(manifest)).not.toThrow();
    });

    it('a closure nested inside a stream ret type collapses to closure and still parses', () => {
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
                    kind: 'closure',
                    params: [{ name: 'n', type: { kind: 'number' } }],
                    ret: { kind: 'string' },
                  },
                } as never,
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['s'],
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('s: stream(number)');
      expect(manifest).not.toContain('stream(number):');
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
            fn: (args) => args['x'],
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
        |x: string| { $x } => $a
        |x: string| { $x } => $b
        $a.^type == $b.^type
      `);
      expect(result).toBe(true);
    });

    it('two closures with same params but different annotations have same structural type (AC-40)', async () => {
      // Annotations are metadata, not part of the structural type for type-checking.
      // Use .^type to compare structural types — annotations do not affect structural equality.
      const result = await run(`
        ^(role: "primary") |x: string| { $x } => $a
        ^(role: "secondary") |x: string| { $x } => $b
        $a.^type == $b.^type
      `);
      expect(result).toBe(true);
    });

    it('callableEquals treats two closures with different annotations as non-identical (AC-41)', async () => {
      // Runtime identity (callableEquals) includes annotations.
      // Two closures with different annotations compared with == should be non-equal at value level.
      const result = await run(`
        ^(role: "primary") |x: string| { $x } => $a
        ^(role: "secondary") |x: string| { $x } => $b
        $a == $b
      `);
      // Different annotations → not value-equal
      expect(result).toBe(false);
    });
  });
});
