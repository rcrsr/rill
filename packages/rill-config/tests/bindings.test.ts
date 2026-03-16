/**
 * Tests for buildExtensionBindings and buildContextBindings
 */

import {
  buildContextBindings,
  buildExtensionBindings,
} from '@rcrsr/rill-config';
import type { ContextFieldSchema, NestedExtConfig } from '@rcrsr/rill-config';
import { structureToTypeValue } from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

// ============================================================
// buildExtensionBindings
// ============================================================

describe('buildExtensionBindings', () => {
  it("returns '[:]' for an empty extension tree", () => {
    const result = buildExtensionBindings({});
    expect(result).toBe('[:]');
  });

  it('produces a use<ext:...> entry for a leaf function', () => {
    const tree: NestedExtConfig = {
      tools: {
        run: {
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
        },
      },
    };
    const result = buildExtensionBindings(tree);
    expect(result).toContain('use<ext:tools.run>');
    expect(result).toContain('input: string');
  });

  it('nests dicts for multi-segment mount paths', () => {
    const tree: NestedExtConfig = {
      ns: {
        sub: {
          fn1: {
            fn: async () => null,
            params: [],
            returnType: structureToTypeValue({ kind: 'any' }),
          },
        },
      },
    };
    const result = buildExtensionBindings(tree);
    expect(result).toContain('ns');
    expect(result).toContain('sub');
    expect(result).toContain('use<ext:ns.sub.fn1>');
  });

  it('omits param annotations from bindings output', () => {
    const tree: NestedExtConfig = {
      ext: {
        greet: {
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
        },
      },
    };
    const result = buildExtensionBindings(tree);
    expect(result).not.toContain('description');
    expect(result).toContain('name: string');
  });

  it('renders string default value in param binding', () => {
    const tree: NestedExtConfig = {
      ext: {
        greet: {
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
        },
      },
    };
    const result = buildExtensionBindings(tree);
    expect(result).toContain('name: string = "World"');
  });

  it('renders number default value in param binding', () => {
    const tree: NestedExtConfig = {
      ext: {
        repeat: {
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
        },
      },
    };
    const result = buildExtensionBindings(tree);
    expect(result).toContain('count: number = 42');
  });

  it('renders default value only for params that have one', () => {
    const tree: NestedExtConfig = {
      ext: {
        send: {
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
        },
      },
    };
    const result = buildExtensionBindings(tree);
    expect(result).toContain('message: string');
    expect(result).not.toContain('message: string =');
    expect(result).toContain('retries: number = 3');
  });

  it('renders boolean default value in param binding', () => {
    const tree: NestedExtConfig = {
      ext: {
        toggle: {
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
        },
      },
    };
    const result = buildExtensionBindings(tree);
    expect(result).toContain('flag: bool = false');
  });

  it('renders full structural type for dict params and return type', () => {
    const tree: NestedExtConfig = {
      tools: {
        infer: {
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
        },
      },
    };
    const result = buildExtensionBindings(tree);
    expect(result).toContain('dict(model: string, temperature: number)');
    expect(result).toContain('dict(result: string)');
  });

  it('renders dict default value in param binding', () => {
    const tree: NestedExtConfig = {
      ext: {
        call: {
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
        },
      },
    };
    const result = buildExtensionBindings(tree);
    expect(result).toContain(
      'options: dict() = [model: "gpt-4", temperature: 0.7]'
    );
  });

  it('renders empty dict default value as [:]', () => {
    const tree: NestedExtConfig = {
      ext: {
        call: {
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
        },
      },
    };
    const result = buildExtensionBindings(tree);
    expect(result).toContain('options: dict() = [:]');
  });

  it('renders list default value in param binding', () => {
    const tree: NestedExtConfig = {
      ext: {
        process: {
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
        },
      },
    };
    const result = buildExtensionBindings(tree);
    expect(result).toContain('items: list = list["a", "b"]');
  });

  it('renders nested dict default value in param binding', () => {
    const tree: NestedExtConfig = {
      ext: {
        configure: {
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
        },
      },
    };
    const result = buildExtensionBindings(tree);
    expect(result).toContain('config: dict() = [nested: [key: "val"]]');
  });

  it('appends return type suffix after closing | when returnType is set', () => {
    const tree: NestedExtConfig = {
      tools: {
        summarize: {
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
        },
      },
    };
    const result = buildExtensionBindings(tree);
    expect(result).toContain('| :string');
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
