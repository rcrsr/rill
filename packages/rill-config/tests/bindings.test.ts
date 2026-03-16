/**
 * Tests for buildExtensionBindings and buildContextBindings
 */

import {
  buildContextBindings,
  buildExtensionBindings,
  ExtensionBindingError,
} from '@rcrsr/rill-config';
import type { ContextFieldSchema } from '@rcrsr/rill-config';
import { createTuple, structureToTypeValue, toCallable } from '@rcrsr/rill';
import type { RillValue } from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

// ============================================================
// buildExtensionBindings
// ============================================================

describe('buildExtensionBindings', () => {
  it("returns '[:]' for an empty extension tree", () => {
    const result = buildExtensionBindings({});
    expect(result).toBe('[:]');
  });

  it('produces a use<ext:...> entry for a callable leaf', () => {
    const tree: Record<string, RillValue> = {
      tools: {
        run: toCallable({
          fn: async () => 'ok',
          params: [
            {
              name: 'input',
              type: { kind: 'string' },
              defaultValue: undefined,
              annotations: {},
            },
          ],
          returnType: structureToTypeValue({ kind: 'any' }),
        }),
      },
    };
    const result = buildExtensionBindings(tree);
    expect(result).toContain('use<ext:tools.run>');
    expect(result).toContain('input: string');
  });

  it('nests dicts for multi-segment mount paths with string leaves', () => {
    const tree: Record<string, RillValue> = {
      ns: {
        sub: { val: 'hello' } as Record<string, RillValue>,
      },
    };
    const result = buildExtensionBindings(tree);
    expect(result).toContain('ns');
    expect(result).toContain('sub');
    expect(result).toContain('use<ext:ns.sub.val>:string');
  });

  it('throws ExtensionBindingError for callable with empty params', () => {
    // Parser does not support empty closure annotations :||
    const tree: Record<string, RillValue> = {
      ns: {
        sub: {
          fn1: toCallable({
            fn: async () => null,
            params: [],
            returnType: structureToTypeValue({ kind: 'any' }),
          }),
        },
      },
    };
    expect(() => buildExtensionBindings(tree)).toThrow(ExtensionBindingError);
  });

  it('omits param annotations from bindings output', () => {
    const tree: Record<string, RillValue> = {
      ext: {
        greet: toCallable({
          fn: async () => 'hi',
          params: [
            {
              name: 'name',
              type: { kind: 'string' },
              defaultValue: undefined,
              annotations: { description: 'The name to greet' },
            },
          ],
          returnType: structureToTypeValue({ kind: 'any' }),
        }),
      },
    };
    const result = buildExtensionBindings(tree);
    expect(result).not.toContain('description');
    expect(result).toContain('name: string');
  });

  // Default values in closure annotations are not supported by the parser.
  // buildExtensionBindings generates `= literal` syntax but parse validation
  // rejects it. These tests document the current ExtensionBindingError behavior.

  it('throws ExtensionBindingError for string default value in param', () => {
    const tree: Record<string, RillValue> = {
      ext: {
        greet: toCallable({
          fn: async () => 'hi',
          params: [
            {
              name: 'name',
              type: { kind: 'string' },
              defaultValue: 'World',
              annotations: {},
            },
          ],
          returnType: structureToTypeValue({ kind: 'any' }),
        }),
      },
    };
    expect(() => buildExtensionBindings(tree)).toThrow(ExtensionBindingError);
  });

  it('throws ExtensionBindingError for number default value in param', () => {
    const tree: Record<string, RillValue> = {
      ext: {
        repeat: toCallable({
          fn: async () => null,
          params: [
            {
              name: 'count',
              type: { kind: 'number' },
              defaultValue: 42,
              annotations: {},
            },
          ],
          returnType: structureToTypeValue({ kind: 'any' }),
        }),
      },
    };
    expect(() => buildExtensionBindings(tree)).toThrow(ExtensionBindingError);
  });

  it('throws ExtensionBindingError for mixed default and no-default params', () => {
    const tree: Record<string, RillValue> = {
      ext: {
        send: toCallable({
          fn: async () => null,
          params: [
            {
              name: 'message',
              type: { kind: 'string' },
              defaultValue: undefined,
              annotations: {},
            },
            {
              name: 'retries',
              type: { kind: 'number' },
              defaultValue: 3,
              annotations: {},
            },
          ],
          returnType: structureToTypeValue({ kind: 'any' }),
        }),
      },
    };
    expect(() => buildExtensionBindings(tree)).toThrow(ExtensionBindingError);
  });

  it('throws ExtensionBindingError for boolean default value in param', () => {
    const tree: Record<string, RillValue> = {
      ext: {
        toggle: toCallable({
          fn: async () => null,
          params: [
            {
              name: 'flag',
              type: { kind: 'bool' },
              defaultValue: false,
              annotations: {},
            },
          ],
          returnType: structureToTypeValue({ kind: 'any' }),
        }),
      },
    };
    expect(() => buildExtensionBindings(tree)).toThrow(ExtensionBindingError);
  });

  it('renders full structural type for dict params and return type', () => {
    const tree: Record<string, RillValue> = {
      tools: {
        infer: toCallable({
          fn: async () => ({ result: 'ok' }),
          params: [
            {
              name: 'opts',
              type: {
                kind: 'dict',
                fields: {
                  model: { type: { kind: 'string' } },
                  temperature: { type: { kind: 'number' } },
                },
              },
              defaultValue: undefined,
              annotations: {},
            },
          ],
          returnType: structureToTypeValue({
            kind: 'dict',
            fields: { result: { type: { kind: 'string' } } },
          }),
        }),
      },
    };
    const result = buildExtensionBindings(tree);
    expect(result).toContain('dict(model: string, temperature: number)');
    expect(result).toContain('dict(result: string)');
  });

  it('throws ExtensionBindingError for dict default value in param', () => {
    const tree: Record<string, RillValue> = {
      ext: {
        call: toCallable({
          fn: async () => null,
          params: [
            {
              name: 'options',
              type: { kind: 'dict', fields: {} },
              defaultValue: { model: 'gpt-4', temperature: 0.7 },
              annotations: {},
            },
          ],
          returnType: structureToTypeValue({ kind: 'any' }),
        }),
      },
    };
    expect(() => buildExtensionBindings(tree)).toThrow(ExtensionBindingError);
  });

  it('throws ExtensionBindingError for empty dict default value', () => {
    const tree: Record<string, RillValue> = {
      ext: {
        call: toCallable({
          fn: async () => null,
          params: [
            {
              name: 'options',
              type: { kind: 'dict', fields: {} },
              defaultValue: {},
              annotations: {},
            },
          ],
          returnType: structureToTypeValue({ kind: 'any' }),
        }),
      },
    };
    expect(() => buildExtensionBindings(tree)).toThrow(ExtensionBindingError);
  });

  it('throws ExtensionBindingError for list default value in param', () => {
    const tree: Record<string, RillValue> = {
      ext: {
        process: toCallable({
          fn: async () => null,
          params: [
            {
              name: 'items',
              type: { kind: 'list', elementType: { kind: 'string' } },
              defaultValue: ['a', 'b'],
              annotations: {},
            },
          ],
          returnType: structureToTypeValue({ kind: 'any' }),
        }),
      },
    };
    expect(() => buildExtensionBindings(tree)).toThrow(ExtensionBindingError);
  });

  it('throws ExtensionBindingError for nested dict default value', () => {
    const tree: Record<string, RillValue> = {
      ext: {
        configure: toCallable({
          fn: async () => null,
          params: [
            {
              name: 'config',
              type: { kind: 'dict', fields: {} },
              defaultValue: { nested: { key: 'val' } },
              annotations: {},
            },
          ],
          returnType: structureToTypeValue({ kind: 'any' }),
        }),
      },
    };
    expect(() => buildExtensionBindings(tree)).toThrow(ExtensionBindingError);
  });

  it('appends return type suffix after closing | when returnType is set', () => {
    const tree: Record<string, RillValue> = {
      tools: {
        summarize: toCallable({
          fn: async () => 'summary',
          params: [
            {
              name: 'text',
              type: { kind: 'string' },
              defaultValue: undefined,
              annotations: {},
            },
          ],
          returnType: structureToTypeValue({ kind: 'string' }),
        }),
      },
    };
    const result = buildExtensionBindings(tree);
    expect(result).toContain('| :string');
  });

  // ============================================================
  // SCALAR LEAF BINDINGS (AC-7, AC-8)
  // ============================================================

  it('emits use<ext:name.version>:string for a string leaf', () => {
    const tree: Record<string, RillValue> = {
      name: { version: '1.0' } as Record<string, RillValue>,
    };
    const result = buildExtensionBindings(tree);
    expect(result).toContain('version: use<ext:name.version>:string');
  });

  it('emits use<ext:...>:number for a number leaf', () => {
    const tree: Record<string, RillValue> = {
      config: { port: 8080 } as Record<string, RillValue>,
    };
    const result = buildExtensionBindings(tree);
    expect(result).toContain('port: use<ext:config.port>:number');
  });

  it('emits use<ext:...>:bool for a boolean leaf', () => {
    const tree: Record<string, RillValue> = {
      config: { debug: true } as Record<string, RillValue>,
    };
    const result = buildExtensionBindings(tree);
    expect(result).toContain('debug: use<ext:config.debug>:bool');
  });

  it('emits use<ext:...>:list for a list (array) leaf', () => {
    const tree: Record<string, RillValue> = {
      data: { items: ['a', 'b', 'c'] } as Record<string, RillValue>,
    };
    const result = buildExtensionBindings(tree);
    expect(result).toContain('items: use<ext:data.items>:list');
  });

  it('emits use<ext:...>:tuple for a tuple leaf', () => {
    const tree: Record<string, RillValue> = {
      data: { pair: createTuple([1, 2]) } as Record<string, RillValue>,
    };
    const result = buildExtensionBindings(tree);
    expect(result).toContain('pair: use<ext:data.pair>:tuple');
  });

  // ============================================================
  // PARSE VALIDATION ERROR (EC-4, AC-18)
  // ============================================================

  it('throws ExtensionBindingError when generated source fails to parse', () => {
    // Symbol keys produce identifiers that are invalid rill syntax.
    // Use an object with a key containing characters invalid for rill identifiers.
    const tree: Record<string, RillValue> = {
      'invalid key with spaces': 'value',
    };
    expect(() => buildExtensionBindings(tree)).toThrow(ExtensionBindingError);
  });

  it('includes parser error detail in ExtensionBindingError message', () => {
    const tree: Record<string, RillValue> = {
      'invalid key with spaces': 'value',
    };
    expect(() => buildExtensionBindings(tree)).toThrow(
      /Extension bindings failed to parse:/
    );
  });
});

// ============================================================
// buildContextBindings
// ============================================================

describe('buildContextBindings', () => {
  it("returns '[:]' for an empty schema", () => {
    const result = buildContextBindings({}, {});
    expect(result).toBe('[:]');
  });

  it('emits string literal for a string context field', () => {
    const schema: Record<string, ContextFieldSchema> = {
      apiUrl: { type: 'string' },
    };
    const result = buildContextBindings(schema, {
      apiUrl: 'https://example.com',
    });
    expect(result).toContain('apiUrl: "https://example.com"');
  });

  it('emits numeric literal for a number context field', () => {
    const schema: Record<string, ContextFieldSchema> = {
      timeout: { type: 'number' },
    };
    const result = buildContextBindings(schema, { timeout: 30 });
    expect(result).toContain('timeout: 30');
  });

  it("emits 'true' for a truthy bool context field", () => {
    const schema: Record<string, ContextFieldSchema> = {
      debug: { type: 'bool' },
    };
    const result = buildContextBindings(schema, { debug: true });
    expect(result).toContain('debug: true');
  });

  it("emits 'false' for a falsy bool context field", () => {
    const schema: Record<string, ContextFieldSchema> = {
      verbose: { type: 'bool' },
    };
    const result = buildContextBindings(schema, { verbose: false });
    expect(result).toContain('verbose: false');
  });

  it('escapes double quotes in string values', () => {
    const schema: Record<string, ContextFieldSchema> = {
      msg: { type: 'string' },
    };
    const result = buildContextBindings(schema, { msg: 'say "hello"' });
    expect(result).toContain('\\"hello\\"');
  });
});
