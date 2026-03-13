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

  describe('paramsToStructuralType via ^input', () => {
    it('host callable with default value shows default in ^input type', async () => {
      const fn: ApplicationCallable = {
        __type: 'callable',
        kind: 'application',
        isProperty: false,
        fn: (args) => `${args[0]}!`,
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
        type: string;
        params: {
          __rill_ordered: true;
          entries: [string, { type: string }, RillValue?][];
        };
        ret: { type: string };
      };

      expect(shape.type).toBe('closure');
      expect(shape.params.entries[0]).toEqual([
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
        type: string;
        params: {
          __rill_ordered: true;
          entries: [string, { type: string }][];
        };
        ret: { type: string };
      };

      expect(shape.type).toBe('closure');
      expect(shape.params.entries[0]).toEqual(['x', { type: 'number' }]);
      expect(shape.params.entries[0]).toHaveLength(2);
    });
  });

  describe('script closures with default params', () => {
    it('script closure with string default shows default in ^input', async () => {
      const result = await run(`
        |name: string = "World"| { $name } => $greet
        $greet.^input
      `);
      const shape = result as {
        type: string;
        params: {
          __rill_ordered: true;
          entries: [string, { type: string }, RillValue?][];
        };
        ret: { type: string };
      };

      expect(shape.type).toBe('closure');
      expect(shape.params.entries[0]).toEqual([
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
        type: string;
        params: {
          __rill_ordered: true;
          entries: [string, { type: string }, RillValue?][];
        };
        ret: { type: string };
      };

      expect(shape.type).toBe('closure');
      expect(shape.params.entries[0]).toEqual([
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
        type: string;
        params: {
          __rill_ordered: true;
          entries: (
            | [string, { type: string }]
            | [string, { type: string }, RillValue]
          )[];
        };
        ret: { type: string };
      };

      expect(shape.type).toBe('closure');
      expect(shape.params.entries[0]).toEqual(['x', { type: 'number' }]);
      expect(shape.params.entries[0]).toHaveLength(2);
      expect(shape.params.entries[1]).toEqual(['y', { type: 'number' }, 0]);
    });
  });
});
