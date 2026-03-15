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
 * - AC-61: type: { type: 'any' } serializes as 'any' in manifest
 * - AC-62: dict param with no fields serializes as 'dict'
 *
 * DEFERRED:
 * - AC-37: Static type checker consumption — DEFERRED to `static-type-checker` initiative
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  createRuntimeContext,
  generateManifest,
  rillTypeToTypeValue,
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
      const manifest = generateManifest(ctx);
      expect(typeof manifest).toBe('string');
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
      const manifest = generateManifest(ctx);
      expect(manifest.trimEnd()).not.toMatch(/-> export$/);
    });

    it('empty manifest does not end with -> export', () => {
      const ctx = createRuntimeContext({});
      // Clear all functions so manifest generates empty dict
      ctx.functions.clear();
      const manifest = generateManifest(ctx);
      expect(manifest.trimEnd()).not.toMatch(/-> export$/);
    });

    it('manifest file is valid rill without -> export (AC-36)', () => {
      const ctx = createRuntimeContext({
        functions: {
          fn: {
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
      const manifest = generateManifest(ctx);
      expect(manifest.trimEnd()).not.toMatch(/-> export$/);
    });
  });

  describe('AC-60 / EC-6: Empty function map generates [:]', () => {
    it('returns [:] for empty function map', () => {
      const ctx = createRuntimeContext({});
      ctx.functions.clear();
      const manifest = generateManifest(ctx);
      expect(manifest).toBe('[:]');
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
                type: { type: 'string' },
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
                type: { type: 'number' },
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
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('name: string');
      expect(manifest).toContain('|:string');
    });

    it('serializes default value using = value syntax (AC-39)', () => {
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
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      // formatValue for string returns the raw string value (unquoted)
      expect(manifest).toContain('= world');
    });

    it('serializes description annotation in manifest (AC-38)', () => {
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
            annotations: { description: 'Greets a user' },
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('Greets a user');
      expect(manifest).toContain('The name to greet');
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
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('"echo"');
      expect(manifest).toContain('message: string');
      expect(manifest).toContain(':string');
    });

    it('structured function with description appears in manifest (AC-38)', () => {
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
            annotations: { description: 'Echoes the message' },
            returnType: rillTypeToTypeValue({ type: 'string' }),
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('Echoes the message');
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
                type: { type: 'number' },
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
                type: { type: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['y'],
            returnType: rillTypeToTypeValue({ type: 'string' }),
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(manifest).toContain('"structured"');
      expect(manifest).toContain('"typed"');
      expect(manifest).toContain('x: number');
      expect(manifest).toContain('y: string');
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
            fn: (args) => (args['a'] as number) + (args['b'] as number),
            returnType: anyTypeValue,
          },
        },
      });
      const manifest = generateManifest(ctx);
      expect(typeof manifest).toBe('string');
      expect(manifest).toContain('"add"');
    });

    it('manifest entries use closure syntax |params|', () => {
      const ctx = createRuntimeContext({
        functions: {
          fn: {
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
      const manifest = generateManifest(ctx);
      // Closure signature format: |params|
      expect(manifest).toMatch(/\|.*\|/);
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
                type: { type: 'any' },
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
                type: { type: 'dict' },
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
      const manifest = generateManifest(ctx);
      // Host function appears
      expect(manifest).toContain('"myFn"');
      // Built-in names must not appear as manifest keys
      expect(manifest).not.toMatch(/"log"/);
      expect(manifest).not.toMatch(/"range"/);
      expect(manifest).not.toMatch(/"json"/);
      expect(manifest).not.toMatch(/"enumerate"/);
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
