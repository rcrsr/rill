/**
 * Rill Runtime Tests: field defaults nested in host function types
 * Explicit host registration rejects a nested default that does not match its field type.
 */

import { describe, expect, it } from 'vitest';
import type { TypeStructure } from '@rcrsr/rill';
import { anyTypeValue, createRuntimeContext } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

function register(type: TypeStructure): void {
  createRuntimeContext({
    functions: {
      f: {
        returnType: anyTypeValue,
        params: [{ name: 'p', type, defaultValue: undefined, annotations: {} }],
        fn: () => 'unreached',
      },
    },
  });
}

function rejection(type: TypeStructure): unknown {
  try {
    register(type);
  } catch (err) {
    return err;
  }
  return undefined;
}

describe('Rill Runtime: nested defaults in host function types', () => {
  it('rejects a mismatched dict field default', () => {
    const err = rejection({
      kind: 'dict',
      fields: { a: { type: { kind: 'number' }, defaultValue: 'x' } },
    });
    expect(err).toMatchObject({
      errorId: 'RILL-R077',
      message:
        "Invalid defaultValue for parameter 'p': Default value for field 'a' must be number, got string",
    });
  });

  it('rejects a mismatched tuple element default', () => {
    const err = rejection({
      kind: 'tuple',
      elements: [{ type: { kind: 'bool' }, defaultValue: 1 }],
    });
    expect(err).toMatchObject({
      errorId: 'RILL-R077',
      message:
        "Invalid defaultValue for parameter 'p': Default value for tuple element must be bool, got number",
    });
  });

  it('rejects a mismatched ordered field default', () => {
    const err = rejection({
      kind: 'ordered',
      fields: [{ name: 'b', type: { kind: 'string' }, defaultValue: 2 }],
    });
    expect(err).toMatchObject({
      errorId: 'RILL-R077',
      message:
        "Invalid defaultValue for parameter 'p': Default value for field 'b' must be string, got number",
    });
  });

  it('rejects a mismatched default nested two levels deep', () => {
    const err = rejection({
      kind: 'dict',
      fields: {
        outer: {
          type: {
            kind: 'list',
            element: {
              kind: 'tuple',
              elements: [
                {
                  type: {
                    kind: 'ordered',
                    fields: [
                      {
                        name: 'inner',
                        type: { kind: 'number' },
                        defaultValue: 'deep',
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    });
    expect(err).toMatchObject({
      errorId: 'RILL-R077',
      message:
        "Invalid defaultValue for parameter 'p': Default value for field 'inner' must be number, got string",
    });
  });

  it('rejects a mismatched default in the return type', () => {
    let err: unknown;
    try {
      createRuntimeContext({
        functions: {
          g: {
            returnType: {
              __rill_type: true,
              typeName: 'dict',
              structure: {
                kind: 'dict',
                fields: { n: { type: { kind: 'number' }, defaultValue: 'x' } },
              },
            },
            params: [],
            fn: () => 'unreached',
          },
        },
      });
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({
      errorId: 'RILL-R077',
      message:
        "Invalid defaultValue in return type of function 'g': Default value for field 'n' must be number, got string",
    });
  });

  const badDict: TypeStructure = {
    kind: 'dict',
    fields: { a: { type: { kind: 'number' }, defaultValue: 'x' } },
  };
  const badDictMessage =
    "Invalid defaultValue for parameter 'p': Default value for field 'a' must be number, got string";

  it('rejects a mismatched default on a parameter of a fn type', () => {
    const err = rejection({
      kind: 'fn',
      params: [{ name: 'q', type: { kind: 'number' }, defaultValue: 'x' }],
    });
    expect(err).toMatchObject({
      errorId: 'RILL-R077',
      message:
        "Invalid defaultValue for parameter 'p': Default value for parameter 'q' must be number, got string",
    });
  });

  it('rejects a mismatched default inside the return type of a fn type', () => {
    const err = rejection({ kind: 'fn', params: [], ret: badDict });
    expect(err).toMatchObject({
      errorId: 'RILL-R077',
      message: badDictMessage,
    });
  });

  it('rejects a mismatched default inside a union member', () => {
    const err = rejection({
      kind: 'union',
      members: [{ kind: 'string' }, badDict],
    });
    expect(err).toMatchObject({
      errorId: 'RILL-R077',
      message: badDictMessage,
    });
  });

  it('rejects a mismatched default inside a map key type', () => {
    const err = rejection({
      kind: 'map',
      key: badDict,
      value: { kind: 'any' },
    });
    expect(err).toMatchObject({
      errorId: 'RILL-R077',
      message: badDictMessage,
    });
  });

  it('rejects a mismatched default inside a map value type', () => {
    const err = rejection({
      kind: 'map',
      key: { kind: 'string' },
      value: badDict,
    });
    expect(err).toMatchObject({
      errorId: 'RILL-R077',
      message: badDictMessage,
    });
  });

  it('rejects a mismatched default inside a stream chunk type', () => {
    const err = rejection({ kind: 'stream', chunk: badDict });
    expect(err).toMatchObject({
      errorId: 'RILL-R077',
      message: badDictMessage,
    });
  });

  it('rejects a mismatched default inside a stream return type', () => {
    const err = rejection({ kind: 'stream', ret: badDict });
    expect(err).toMatchObject({
      errorId: 'RILL-R077',
      message: badDictMessage,
    });
  });

  it('registers a parameter that declares no type', () => {
    expect(() =>
      createRuntimeContext({
        functions: {
          f: {
            returnType: anyTypeValue,
            params: [{ name: 'p', defaultValue: undefined, annotations: {} }],
            fn: () => 1,
          },
        } as never,
      })
    ).not.toThrow();
  });

  it('registers a parameter whose type is null', () => {
    expect(() =>
      createRuntimeContext({
        functions: {
          g: {
            returnType: anyTypeValue,
            params: [{ name: 'p', type: null, defaultValue: undefined }],
            fn: () => 1,
          },
        } as never,
      })
    ).not.toThrow();
  });

  it('registers a union type that carries no members', () => {
    expect(() =>
      createRuntimeContext({
        functions: {
          g: {
            returnType: anyTypeValue,
            params: [
              { name: 'p', type: { kind: 'union' }, defaultValue: undefined },
            ],
            fn: () => 1,
          },
        } as never,
      })
    ).not.toThrow();
  });

  it('registers a return type that carries no structure', () => {
    expect(() =>
      createRuntimeContext({
        functions: {
          g: {
            returnType: { __rill_type: true, typeName: 'dict' },
            params: [],
            fn: () => 1,
          },
        } as never,
      })
    ).not.toThrow();
  });

  it('accepts a matching nested default and fills it on call', async () => {
    const result = await run('f(dict[])', {
      functions: {
        f: {
          returnType: anyTypeValue,
          params: [
            {
              name: 'p',
              defaultValue: undefined,
              type: {
                kind: 'dict',
                fields: { a: { type: { kind: 'number' }, defaultValue: 5 } },
              },
              annotations: {},
            },
          ],
          fn: (args) => args['p'] ?? null,
        },
      },
    });
    expect(result).toEqual({ a: 5 });
  });
});
