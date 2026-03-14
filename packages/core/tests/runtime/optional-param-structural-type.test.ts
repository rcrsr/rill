/**
 * Tests for optional parameter representation in closure structural types.
 *
 * Verifies that default values propagate from RillParam through RillType
 * and render in formatStructuralType output.
 */

import {
  anyTypeValue,
  formatStructuralType,
  inferStructuralType,
  rillTypeToTypeValue,
  type ApplicationCallable,
  type RillType,
  type RillValue,
} from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Optional parameter structural types', () => {
  describe('RillType carries default values', () => {
    it('closure RillType stores default value in params tuple', () => {
      const type: RillType = {
        type: 'closure',
        params: [
          ['name', { type: 'string' }, 'World'],
          ['count', { type: 'number' }],
        ],
        ret: { type: 'string' },
      };
      expect(type.params![0]![2]).toBe('World');
      expect(type.params![1]![2]).toBeUndefined();
    });
  });

  describe('formatStructuralType renders default values', () => {
    it('renders string default value', () => {
      const type: RillType = {
        type: 'closure',
        params: [['name', { type: 'string' }, 'World']],
        ret: { type: 'string' },
      };
      expect(formatStructuralType(type)).toBe(
        '|name: string = "World"| :string'
      );
    });

    it('renders number default value', () => {
      const type: RillType = {
        type: 'closure',
        params: [['count', { type: 'number' }, 42]],
        ret: { type: 'number' },
      };
      expect(formatStructuralType(type)).toBe('|count: number = 42| :number');
    });

    it('renders boolean default value', () => {
      const type: RillType = {
        type: 'closure',
        params: [['flag', { type: 'bool' }, false]],
        ret: { type: 'bool' },
      };
      expect(formatStructuralType(type)).toBe('|flag: bool = false| :bool');
    });

    it('renders mixed required and optional params', () => {
      const type: RillType = {
        type: 'closure',
        params: [
          ['required', { type: 'number' }],
          ['optional', { type: 'string' }, 'default'],
        ],
        ret: { type: 'any' },
      };
      expect(formatStructuralType(type)).toBe(
        '|required: number, optional: string = "default"| :any'
      );
    });

    it('renders closure with no defaults unchanged', () => {
      const type: RillType = {
        type: 'closure',
        params: [['x', { type: 'number' }]],
        ret: { type: 'number' },
      };
      expect(formatStructuralType(type)).toBe('|x: number| :number');
    });

    it('renders unparameterized closure unchanged', () => {
      const type: RillType = { type: 'closure' };
      expect(formatStructuralType(type)).toBe('closure');
    });
  });

  describe('inferStructuralType preserves default values', () => {
    it('carries default value from ApplicationCallable params', () => {
      const fn: ApplicationCallable = {
        __type: 'callable',
        kind: 'application',
        isProperty: false,
        fn: () => null,
        params: [
          {
            name: 'greeting',
            type: { type: 'string' },
            defaultValue: 'Hello',
            annotations: {},
          },
          {
            name: 'count',
            type: { type: 'number' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        returnType: anyTypeValue,
        annotations: {},
      };

      const result = inferStructuralType(fn as unknown as RillValue);
      expect(result.type).toBe('closure');
      if (result.type === 'closure') {
        expect(result.params).toEqual([
          ['greeting', { type: 'string' }, 'Hello'],
          ['count', { type: 'number' }],
        ]);
      }
    });

    it('omits third element when no default value', () => {
      const fn: ApplicationCallable = {
        __type: 'callable',
        kind: 'application',
        isProperty: false,
        fn: () => null,
        params: [
          {
            name: 'x',
            type: { type: 'number' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        returnType: rillTypeToTypeValue({ type: 'number' }),
        annotations: {},
      };

      const result = inferStructuralType(fn as unknown as RillValue);
      expect(result.type).toBe('closure');
      if (result.type === 'closure') {
        expect(result.params![0]).toEqual(['x', { type: 'number' }]);
        expect(result.params![0]).toHaveLength(2);
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
            type: { type: 'string' },
            defaultValue: 'World',
            annotations: {},
          },
        ],
        returnType: rillTypeToTypeValue({ type: 'string' }),
        annotations: {},
      };

      const result = await run('$fn.^input', { variables: { fn } });
      const shape = result as {
        __rill_type: true;
        typeName: string;
        structure: { type: string; fields: [string, unknown, RillValue?][] };
      };

      expect(shape.__rill_type).toBe(true);
      expect(shape.typeName).toBe('ordered');
      expect(shape.structure.fields[0]).toEqual([
        'name',
        { type: 'string' },
        'World',
      ]);
    });

    it('host callable without default omits third element in ^input', async () => {
      const fn: ApplicationCallable = {
        __type: 'callable',
        kind: 'application',
        isProperty: false,
        fn: () => null,
        params: [
          {
            name: 'x',
            type: { type: 'number' },
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
        structure: { type: string; fields: [string, unknown][] };
      };

      expect(shape.__rill_type).toBe(true);
      expect(shape.typeName).toBe('ordered');
      expect(shape.structure.fields[0]).toEqual(['x', { type: 'number' }]);
      expect(shape.structure.fields[0]).toHaveLength(2);
    });
  });

  describe('formatStructuralType dict branch with defaults', () => {
    it('renders dict field with string default', () => {
      const type: RillType = {
        type: 'dict',
        fields: {
          a: { type: { type: 'string' }, defaultValue: 'Test' },
          b: { type: 'number' },
        },
      };
      expect(formatStructuralType(type)).toBe(
        'dict(a: string = "Test", b: number)'
      );
    });

    it('renders dict with all fields having defaults', () => {
      const type: RillType = {
        type: 'dict',
        fields: {
          x: { type: { type: 'number' }, defaultValue: 0 },
          y: { type: { type: 'bool' }, defaultValue: true },
        },
      };
      expect(formatStructuralType(type)).toBe(
        'dict(x: number = 0, y: bool = true)'
      );
    });

    it('renders dict with no defaults unchanged', () => {
      const type: RillType = {
        type: 'dict',
        fields: {
          name: { type: 'string' },
          count: { type: 'number' },
        },
      };
      expect(formatStructuralType(type)).toBe(
        'dict(count: number, name: string)'
      );
    });
  });

  describe('formatStructuralType ordered branch with defaults', () => {
    it('renders ordered field with string default', () => {
      const type: RillType = {
        type: 'ordered',
        fields: [
          ['a', { type: 'string' }, 'Test'],
          ['b', { type: 'number' }],
        ],
      };
      expect(formatStructuralType(type)).toBe(
        'ordered(a: string = "Test", b: number)'
      );
    });

    it('renders ordered with number default', () => {
      const type: RillType = {
        type: 'ordered',
        fields: [['count', { type: 'number' }, 42]],
      };
      expect(formatStructuralType(type)).toBe('ordered(count: number = 42)');
    });

    it('renders ordered with no defaults unchanged', () => {
      const type: RillType = {
        type: 'ordered',
        fields: [
          ['x', { type: 'number' }],
          ['y', { type: 'string' }],
        ],
      };
      expect(formatStructuralType(type)).toBe('ordered(x: number, y: string)');
    });
  });

  describe('formatStructuralType tuple branch with defaults', () => {
    it('renders tuple element with number default', () => {
      const type: RillType = {
        type: 'tuple',
        elements: [[{ type: 'string' }], [{ type: 'number' }, 0]],
      };
      expect(formatStructuralType(type)).toBe('tuple(string, number = 0)');
    });

    it('renders tuple element with boolean default', () => {
      const type: RillType = {
        type: 'tuple',
        elements: [[{ type: 'bool' }, false]],
      };
      expect(formatStructuralType(type)).toBe('tuple(bool = false)');
    });

    it('renders tuple with no defaults unchanged', () => {
      const type: RillType = {
        type: 'tuple',
        elements: [[{ type: 'string' }], [{ type: 'number' }]],
      };
      expect(formatStructuralType(type)).toBe('tuple(string, number)');
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
        structure: { type: string; fields: [string, unknown, RillValue?][] };
      };

      expect(shape.__rill_type).toBe(true);
      expect(shape.typeName).toBe('ordered');
      expect(shape.structure.fields[0]).toEqual([
        'name',
        { type: 'string' },
        'World',
      ]);
    });

    it('script closure with number default shows default in ^input', async () => {
      const result = await run(`
        |count: number = 10| { $count } => $fn
        $fn.^input
      `);
      const shape = result as {
        __rill_type: true;
        typeName: string;
        structure: { type: string; fields: [string, unknown, RillValue?][] };
      };

      expect(shape.__rill_type).toBe(true);
      expect(shape.typeName).toBe('ordered');
      expect(shape.structure.fields[0]).toEqual([
        'count',
        { type: 'number' },
        10,
      ]);
    });

    it('mixed required and optional params in script closure', async () => {
      const result = await run(`
        |x: number, y: number = 0| { $x + $y } => $add
        $add.^input
      `);
      const shape = result as {
        __rill_type: true;
        typeName: string;
        structure: {
          type: string;
          fields: ([string, unknown] | [string, unknown, RillValue])[];
        };
      };

      expect(shape.__rill_type).toBe(true);
      expect(shape.typeName).toBe('ordered');
      expect(shape.structure.fields[0]).toEqual(['x', { type: 'number' }]);
      expect(shape.structure.fields[0]).toHaveLength(2);
      expect(shape.structure.fields[1]).toEqual(['y', { type: 'number' }, 0]);
    });
  });
});
