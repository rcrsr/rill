/**
 * Tests for optional parameter representation in closure structural types.
 *
 * Verifies that default values propagate from RillParam through TypeStructure
 * and render in formatStructure output.
 */

import {
  anyTypeValue,
  formatStructure,
  inferStructure,
  structureToTypeValue,
  type ApplicationCallable,
  type RillFieldDef,
  type TypeStructure,
  type RillValue,
} from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Optional parameter structural types', () => {
  describe('TypeStructure carries default values', () => {
    it('closure TypeStructure stores default value in params RillFieldDef', () => {
      const type: TypeStructure = {
        kind: 'closure',
        params: [
          { name: 'name', type: { kind: 'string' }, defaultValue: 'World' },
          { name: 'count', type: { kind: 'number' } },
        ],
        ret: { kind: 'string' },
      };
      expect(type.params![0]!.defaultValue).toBe('World');
      expect(type.params![1]!.defaultValue).toBeUndefined();
    });
  });

  describe('formatStructure renders default values', () => {
    it('renders string default value', () => {
      const type: TypeStructure = {
        kind: 'closure',
        params: [
          { name: 'name', type: { kind: 'string' }, defaultValue: 'World' },
        ],
        ret: { kind: 'string' },
      };
      expect(formatStructure(type)).toBe('|name: string = "World"| :string');
    });

    it('renders number default value', () => {
      const type: TypeStructure = {
        kind: 'closure',
        params: [{ name: 'count', type: { kind: 'number' }, defaultValue: 42 }],
        ret: { kind: 'number' },
      };
      expect(formatStructure(type)).toBe('|count: number = 42| :number');
    });

    it('renders boolean default value', () => {
      const type: TypeStructure = {
        kind: 'closure',
        params: [{ name: 'flag', type: { kind: 'bool' }, defaultValue: false }],
        ret: { kind: 'bool' },
      };
      expect(formatStructure(type)).toBe('|flag: bool = false| :bool');
    });

    it('renders mixed required and optional params', () => {
      const type: TypeStructure = {
        kind: 'closure',
        params: [
          { name: 'required', type: { kind: 'number' } },
          {
            name: 'optional',
            type: { kind: 'string' },
            defaultValue: 'default',
          },
        ],
        ret: { kind: 'any' },
      };
      expect(formatStructure(type)).toBe(
        '|required: number, optional: string = "default"| :any'
      );
    });

    it('renders closure with no defaults unchanged', () => {
      const type: TypeStructure = {
        kind: 'closure',
        params: [{ name: 'x', type: { kind: 'number' } }],
        ret: { kind: 'number' },
      };
      expect(formatStructure(type)).toBe('|x: number| :number');
    });

    it('renders unparameterized closure unchanged', () => {
      const type: TypeStructure = { kind: 'closure' };
      expect(formatStructure(type)).toBe('closure');
    });
  });

  describe('inferStructure preserves default values', () => {
    it('carries default value from ApplicationCallable params', () => {
      const fn: ApplicationCallable = {
        __type: 'callable',
        kind: 'application',
        isProperty: false,
        fn: () => null,
        params: [
          {
            name: 'greeting',
            type: { kind: 'string' },
            defaultValue: 'Hello',
            annotations: {},
          },
          {
            name: 'count',
            type: { kind: 'number' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        returnType: anyTypeValue,
        annotations: {},
      };

      const result = inferStructure(fn as unknown as RillValue);
      expect(result.kind).toBe('closure');
      if (result.kind === 'closure') {
        expect(result.params).toEqual([
          { name: 'greeting', type: { kind: 'string' }, defaultValue: 'Hello' },
          { name: 'count', type: { kind: 'number' } },
        ]);
      }
    });

    it('omits defaultValue property when no default value', () => {
      const fn: ApplicationCallable = {
        __type: 'callable',
        kind: 'application',
        isProperty: false,
        fn: () => null,
        params: [
          {
            name: 'x',
            type: { kind: 'number' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        returnType: structureToTypeValue({ kind: 'number' }),
        annotations: {},
      };

      const result = inferStructure(fn as unknown as RillValue);
      expect(result.kind).toBe('closure');
      if (result.kind === 'closure') {
        expect(result.params![0]).toEqual({
          name: 'x',
          type: { kind: 'number' },
        });
        expect(result.params![0]).not.toHaveProperty('defaultValue');
      }
    });
  });

  describe('param type via ^input', () => {
    it('host callable with default value shows default in ^input type', async () => {
      const fn: ApplicationCallable = {
        __type: 'callable',
        kind: 'application',
        isProperty: false,
        fn: (args) => `${args['name']}!`,
        params: [
          {
            name: 'name',
            type: { kind: 'string' },
            defaultValue: 'World',
            annotations: {},
          },
        ],
        returnType: structureToTypeValue({ kind: 'string' }),
        annotations: {},
      };

      const result = await run('$fn.^input', { variables: { fn } });
      const shape = result as {
        __rill_type: true;
        typeName: string;
        structure: { type: string; fields: RillFieldDef[] };
      };

      expect(shape.__rill_type).toBe(true);
      expect(shape.typeName).toBe('ordered');
      expect(shape.structure.fields[0]).toEqual({
        name: 'name',
        type: { kind: 'string' },
        defaultValue: 'World',
      });
    });

    it('host callable without default omits defaultValue in ^input', async () => {
      const fn: ApplicationCallable = {
        __type: 'callable',
        kind: 'application',
        isProperty: false,
        fn: () => null,
        params: [
          {
            name: 'x',
            type: { kind: 'number' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        returnType: anyTypeValue,
        annotations: {},
      };

      const result = await run('$fn.^input', { variables: { fn } });
      const shape = result as {
        __rill_type: true;
        typeName: string;
        structure: { type: string; fields: RillFieldDef[] };
      };

      expect(shape.__rill_type).toBe(true);
      expect(shape.typeName).toBe('ordered');
      expect(shape.structure.fields[0]).toEqual({
        name: 'x',
        type: { kind: 'number' },
      });
      expect(shape.structure.fields[0]).not.toHaveProperty('defaultValue');
    });
  });

  describe('formatStructure dict branch with defaults', () => {
    it('renders dict field with string default', () => {
      const type: TypeStructure = {
        kind: 'dict',
        fields: {
          a: { type: { kind: 'string' }, defaultValue: 'Test' },
          b: { type: { kind: 'number' } },
        },
      };
      expect(formatStructure(type)).toBe('dict(a: string = "Test", b: number)');
    });

    it('renders dict with all fields having defaults', () => {
      const type: TypeStructure = {
        kind: 'dict',
        fields: {
          x: { type: { kind: 'number' }, defaultValue: 0 },
          y: { type: { kind: 'bool' }, defaultValue: true },
        },
      };
      expect(formatStructure(type)).toBe('dict(x: number = 0, y: bool = true)');
    });

    it('renders dict with no defaults unchanged', () => {
      const type: TypeStructure = {
        kind: 'dict',
        fields: {
          name: { type: { kind: 'string' } },
          count: { type: { kind: 'number' } },
        },
      };
      expect(formatStructure(type)).toBe('dict(count: number, name: string)');
    });
  });

  describe('formatStructure ordered branch with defaults', () => {
    it('renders ordered field with string default', () => {
      const type: TypeStructure = {
        kind: 'ordered',
        fields: [
          { name: 'a', type: { kind: 'string' }, defaultValue: 'Test' },
          { name: 'b', type: { kind: 'number' } },
        ],
      };
      expect(formatStructure(type)).toBe(
        'ordered(a: string = "Test", b: number)'
      );
    });

    it('renders ordered with number default', () => {
      const type: TypeStructure = {
        kind: 'ordered',
        fields: [{ name: 'count', type: { kind: 'number' }, defaultValue: 42 }],
      };
      expect(formatStructure(type)).toBe('ordered(count: number = 42)');
    });

    it('renders ordered with no defaults unchanged', () => {
      const type: TypeStructure = {
        kind: 'ordered',
        fields: [
          { name: 'x', type: { kind: 'number' } },
          { name: 'y', type: { kind: 'string' } },
        ],
      };
      expect(formatStructure(type)).toBe('ordered(x: number, y: string)');
    });

    it('renders ordered format display with default value suffix [AC-9]', () => {
      const type: TypeStructure = {
        kind: 'ordered',
        fields: [
          { name: 'host', type: { kind: 'string' }, defaultValue: 'localhost' },
          { name: 'port', type: { kind: 'number' }, defaultValue: 8080 },
        ],
      };
      expect(formatStructure(type)).toBe(
        'ordered(host: string = "localhost", port: number = 8080)'
      );
    });
  });

  describe('formatStructure tuple branch with defaults', () => {
    it('renders tuple element with number default', () => {
      const type: TypeStructure = {
        kind: 'tuple',
        elements: [
          { type: { kind: 'string' } },
          { type: { kind: 'number' }, defaultValue: 0 },
        ],
      };
      expect(formatStructure(type)).toBe('tuple(string, number = 0)');
    });

    it('renders tuple element with boolean default', () => {
      const type: TypeStructure = {
        kind: 'tuple',
        elements: [{ type: { kind: 'bool' }, defaultValue: false }],
      };
      expect(formatStructure(type)).toBe('tuple(bool = false)');
    });

    it('renders tuple with no defaults unchanged', () => {
      const type: TypeStructure = {
        kind: 'tuple',
        elements: [{ type: { kind: 'string' } }, { type: { kind: 'number' } }],
      };
      expect(formatStructure(type)).toBe('tuple(string, number)');
    });

    it('renders tuple format display with default value suffix [AC-9]', () => {
      const type: TypeStructure = {
        kind: 'tuple',
        elements: [
          { type: { kind: 'string' } },
          { type: { kind: 'number' }, defaultValue: 42 },
          { type: { kind: 'bool' }, defaultValue: true },
        ],
      };
      expect(formatStructure(type)).toBe(
        'tuple(string, number = 42, bool = true)'
      );
    });
  });

  describe('script closures with default params', () => {
    it('script closure with string default shows default in ^input', async () => {
      const result = await run(`
        |name: string = "World"| { $name } => $greet
        $greet.^input
      `);
      const shape = result as {
        __rill_type: true;
        typeName: string;
        structure: { type: string; fields: RillFieldDef[] };
      };

      expect(shape.__rill_type).toBe(true);
      expect(shape.typeName).toBe('ordered');
      expect(shape.structure.fields[0]).toEqual({
        name: 'name',
        type: { kind: 'string' },
        defaultValue: 'World',
      });
    });

    it('script closure with number default shows default in ^input', async () => {
      const result = await run(`
        |count: number = 10| { $count } => $fn
        $fn.^input
      `);
      const shape = result as {
        __rill_type: true;
        typeName: string;
        structure: { type: string; fields: RillFieldDef[] };
      };

      expect(shape.__rill_type).toBe(true);
      expect(shape.typeName).toBe('ordered');
      expect(shape.structure.fields[0]).toEqual({
        name: 'count',
        type: { kind: 'number' },
        defaultValue: 10,
      });
    });

    it('mixed required and optional params in script closure', async () => {
      const result = await run(`
        |x: number, y: number = 0| { $x + $y } => $add
        $add.^input
      `);
      const shape = result as {
        __rill_type: true;
        typeName: string;
        structure: { type: string; fields: RillFieldDef[] };
      };

      expect(shape.__rill_type).toBe(true);
      expect(shape.typeName).toBe('ordered');
      expect(shape.structure.fields[0]).toEqual({
        name: 'x',
        type: { kind: 'number' },
      });
      expect(shape.structure.fields[0]).not.toHaveProperty('defaultValue');
      expect(shape.structure.fields[1]).toEqual({
        name: 'y',
        type: { kind: 'number' },
        defaultValue: 0,
      });
    });
  });
});
