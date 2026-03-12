/**
 * Tests for introspectHandler and marshalCliArgs
 * Covers: AC-22, AC-29, EC-16, BC-7
 */

import {
  introspectHandler,
  marshalCliArgs,
  HandlerArgError,
} from '@rcrsr/rill-config';
import type { HandlerParam } from '@rcrsr/rill-config';
import type { ScriptCallable } from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

// ============================================================
// TEST HELPERS
// ============================================================

/**
 * Build a minimal ScriptCallable for introspection tests.
 * Only fields consumed by introspectHandler are populated.
 */
function makeCallable(options: {
  annotations?: Record<string, unknown>;
  params?: Array<{
    name: string;
    type?: { type: string };
    defaultValue?: unknown;
    annotations?: Record<string, unknown>;
  }>;
}): ScriptCallable {
  const params = (options.params ?? []).map((p) => ({
    name: p.name,
    type: p.type as { type: string } | undefined,
    defaultValue: p.defaultValue as unknown,
    annotations: (p.annotations ?? {}) as Record<string, unknown>,
  }));

  return {
    __type: 'callable',
    kind: 'script',
    isProperty: false,
    params: params as ScriptCallable['params'],
    body: {
      type: 'Body',
      statements: [],
      span: { start: 0, end: 0 },
    } as ScriptCallable['body'],
    definingScope: {
      variables: new Map(),
      pipeValue: null,
    } as ScriptCallable['definingScope'],
    annotations: (options.annotations ?? {}) as Record<string, unknown>,
    inputShape: { type: 'closure', params: [], ret: { type: 'any' } },
  } as unknown as ScriptCallable;
}

// ============================================================
// introspectHandler
// ============================================================

describe('introspectHandler', () => {
  describe('BC-7: zero params', () => {
    it('returns empty params array for a closure with no parameters', () => {
      // AC-29: zero params -> empty array
      const closure = makeCallable({});
      const result = introspectHandler(closure);
      expect(result.params).toEqual([]);
    });

    it('returns no description when closure has no description annotation', () => {
      const closure = makeCallable({});
      const result = introspectHandler(closure);
      expect(result.description).toBeUndefined();
    });
  });

  describe('closure-level description', () => {
    it('reads description from closure annotations', () => {
      const closure = makeCallable({
        annotations: { description: 'Does something useful' },
      });
      const result = introspectHandler(closure);
      expect(result.description).toBe('Does something useful');
    });

    it('ignores non-string description annotation', () => {
      const closure = makeCallable({
        annotations: { description: 42 },
      });
      const result = introspectHandler(closure);
      expect(result.description).toBeUndefined();
    });
  });

  describe('parameter introspection', () => {
    it('maps param name and type from closure params', () => {
      const closure = makeCallable({
        params: [{ name: 'input', type: { type: 'string' } }],
      });
      const result = introspectHandler(closure);
      expect(result.params).toHaveLength(1);
      expect(result.params[0]?.name).toBe('input');
      expect(result.params[0]?.type).toBe('string');
    });

    it('sets required=true when defaultValue is undefined', () => {
      const closure = makeCallable({
        params: [
          {
            name: 'required',
            type: { type: 'string' },
            defaultValue: undefined,
          },
        ],
      });
      const result = introspectHandler(closure);
      expect(result.params[0]?.required).toBe(true);
    });

    it('sets required=false and includes defaultValue when defaultValue is present', () => {
      const closure = makeCallable({
        params: [{ name: 'opt', type: { type: 'number' }, defaultValue: 10 }],
      });
      const result = introspectHandler(closure);
      expect(result.params[0]?.required).toBe(false);
      expect(result.params[0]?.defaultValue).toBe(10);
    });

    it("defaults type to 'any' when param has no type declared", () => {
      const closure = makeCallable({
        params: [{ name: 'untyped' }],
      });
      const result = introspectHandler(closure);
      expect(result.params[0]?.type).toBe('any');
    });

    it('reads param description from param.annotations', () => {
      const closure = makeCallable({
        params: [
          {
            name: 'query',
            type: { type: 'string' },
            annotations: { description: 'The search query' },
          },
        ],
      });
      const result = introspectHandler(closure);
      expect(result.params[0]?.description).toBe('The search query');
    });

    it('omits param description when param.annotations has no description', () => {
      const closure = makeCallable({
        params: [{ name: 'count', type: { type: 'number' }, annotations: {} }],
      });
      const result = introspectHandler(closure);
      expect(result.params[0]?.description).toBeUndefined();
    });
  });
});

// ============================================================
// marshalCliArgs
// ============================================================

describe('marshalCliArgs', () => {
  function makeParam(
    name: string,
    type: string,
    required = true,
    defaultValue?: unknown
  ): HandlerParam {
    return defaultValue !== undefined
      ? { name, type, required, defaultValue }
      : { name, type, required };
  }

  describe('type coercion: string passthrough', () => {
    it('passes string values through unchanged', () => {
      const params = [makeParam('name', 'string')];
      const result = marshalCliArgs({ name: 'Alice' }, params);
      expect(result['name']).toBe('Alice');
    });
  });

  describe('type coercion: number', () => {
    it('converts numeric string to number', () => {
      const params = [makeParam('count', 'number')];
      const result = marshalCliArgs({ count: '42' }, params);
      expect(result['count']).toBe(42);
    });

    it('throws HandlerArgError for non-numeric string', () => {
      // AC-22: coercion failure
      const params = [makeParam('count', 'number')];
      expect(() => marshalCliArgs({ count: 'abc' }, params)).toThrow(
        HandlerArgError
      );
    });
  });

  describe('type coercion: bool', () => {
    it('sets bool param to true when flag is present', () => {
      const params = [makeParam('verbose', 'bool')];
      const result = marshalCliArgs({ verbose: '' }, params);
      expect(result['verbose']).toBe(true);
    });
  });

  describe('type coercion: dict', () => {
    it('parses JSON string into object for dict param', () => {
      const params = [makeParam('opts', 'dict')];
      const result = marshalCliArgs({ opts: '{"key":"val"}' }, params);
      expect(result['opts']).toEqual({ key: 'val' });
    });

    it('throws HandlerArgError for invalid JSON in dict param', () => {
      // AC-22: coercion failure
      const params = [makeParam('opts', 'dict')];
      expect(() => marshalCliArgs({ opts: 'not-json' }, params)).toThrow(
        HandlerArgError
      );
    });
  });

  describe('type coercion: list', () => {
    it('parses JSON array string for list param', () => {
      const params = [makeParam('items', 'list')];
      const result = marshalCliArgs({ items: '[1,2,3]' }, params);
      expect(result['items']).toEqual([1, 2, 3]);
    });

    it('throws HandlerArgError for invalid JSON in list param', () => {
      const params = [makeParam('items', 'list')];
      expect(() => marshalCliArgs({ items: 'bad' }, params)).toThrow(
        HandlerArgError
      );
    });
  });

  describe('EC-16: missing required param', () => {
    it('throws HandlerArgError when required param has no value', () => {
      // AC-22: required param missing from args
      const params = [makeParam('name', 'string', true)];
      expect(() => marshalCliArgs({}, params)).toThrow(HandlerArgError);
    });

    it('includes the param name in the error message', () => {
      const params = [makeParam('userId', 'string', true)];
      expect(() => marshalCliArgs({}, params)).toThrow('userId');
    });
  });

  describe('EC-16: unknown flag', () => {
    it('throws HandlerArgError for an unrecognised flag name', () => {
      // AC-22: unknown flag
      const params = [makeParam('name', 'string')];
      expect(() =>
        marshalCliArgs({ name: 'Alice', unknown: 'value' }, params)
      ).toThrow(HandlerArgError);
    });

    it('includes the unknown flag name in the error message', () => {
      const params: HandlerParam[] = [];
      expect(() => marshalCliArgs({ ghost: 'value' }, params)).toThrow('ghost');
    });
  });

  describe('optional params', () => {
    it('omits optional params from result when not provided', () => {
      const params = [makeParam('opt', 'string', false, 'default')];
      const result = marshalCliArgs({}, params);
      expect(result).not.toHaveProperty('opt');
    });
  });
});
