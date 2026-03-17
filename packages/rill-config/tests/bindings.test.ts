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

  it('emits :|| with return type for callable with empty params', () => {
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
    const result = buildExtensionBindings(tree);
    expect(result).toContain('use<ext:ns.sub.fn1>:||');
    expect(result).toContain(':any');
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

  // Param defaultValues are runtime-only; the annotation format strips them.

  it('strips string default value from param annotation', () => {
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
    const result = buildExtensionBindings(tree);
    expect(result).toContain('name: string');
    expect(result).not.toContain('= ');
  });

  it('strips number default value from param annotation', () => {
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
    const result = buildExtensionBindings(tree);
    expect(result).toContain('count: number');
    expect(result).not.toContain('= 42');
  });

  it('strips defaults from mixed default and no-default params', () => {
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
    const result = buildExtensionBindings(tree);
    expect(result).toContain('message: string');
    expect(result).toContain('retries: number');
    expect(result).not.toContain('= 3');
  });

  it('strips boolean default value from param annotation', () => {
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
    const result = buildExtensionBindings(tree);
    expect(result).toContain('flag: bool');
    expect(result).not.toContain('= false');
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

  it('strips dict default value from param annotation', () => {
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
    const result = buildExtensionBindings(tree);
    expect(result).toContain('options:');
    expect(result).not.toContain('= [');
  });

  it('strips empty dict default value from param annotation', () => {
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
    const result = buildExtensionBindings(tree);
    expect(result).toContain('options:');
    expect(result).not.toContain('= [:]');
  });

  it('strips list default value from param annotation', () => {
    const tree: Record<string, RillValue> = {
      ext: {
        process: toCallable({
          fn: async () => null,
          params: [
            {
              name: 'items',
              type: { kind: 'list' },
              defaultValue: ['a', 'b'],
              annotations: {},
            },
          ],
          returnType: structureToTypeValue({ kind: 'any' }),
        }),
      },
    };
    const result = buildExtensionBindings(tree);
    expect(result).toContain('items: list');
    expect(result).not.toContain('= list[');
  });

  it('strips dict field defaults from param type annotation', () => {
    // dict(max_tokens: number = 0) strips to dict(max_tokens: number)
    const tree: Record<string, RillValue> = {
      ext: {
        call: toCallable({
          fn: async () => null,
          params: [
            {
              name: 'opts',
              type: {
                kind: 'dict',
                fields: {
                  max_tokens: { type: { kind: 'number' }, defaultValue: 0 },
                  system: { type: { kind: 'string' }, defaultValue: '' },
                },
              },
              defaultValue: {},
              annotations: {},
            },
          ],
          returnType: structureToTypeValue({ kind: 'any' }),
        }),
      },
    };
    const result = buildExtensionBindings(tree);
    expect(result).toContain('dict(max_tokens: number, system: string)');
    expect(result).not.toContain('= 0');
    expect(result).not.toContain('= ""');
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
