/**
 * Tests for buildExtensionBindings and buildContextBindings
 */

import {
  buildContextBindings,
  buildExtensionBindings,
} from '@rcrsr/rill-config';
import type { ContextFieldSchema, NestedExtConfig } from '@rcrsr/rill-config';
import { rillTypeToTypeValue } from '@rcrsr/rill';
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
              type: { type: 'string' },
              defaultValue: undefined,
              annotations: {},
            },
          ],
          returnType: rillTypeToTypeValue({ type: 'any' }),
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
            returnType: rillTypeToTypeValue({ type: 'any' }),
          },
        },
      },
    };
    const result = buildExtensionBindings(tree);
    expect(result).toContain('ns');
    expect(result).toContain('sub');
    expect(result).toContain('use<ext:ns.sub.fn1>');
  });

  it('emits param description annotation when present', () => {
    const tree: NestedExtConfig = {
      ext: {
        greet: {
          fn: async () => 'hi',
          params: [
            {
              name: 'name',
              type: { type: 'string' },
              defaultValue: undefined,
              annotations: { description: 'The name to greet' },
            },
          ],
          returnType: rillTypeToTypeValue({ type: 'any' }),
        },
      },
    };
    const result = buildExtensionBindings(tree);
    expect(result).toContain('description: ');
    expect(result).toContain('The name to greet');
  });

  it('appends return type suffix after closing | when returnType is set', () => {
    const tree: NestedExtConfig = {
      tools: {
        summarize: {
          fn: async () => 'summary',
          params: [
            {
              name: 'text',
              type: { type: 'string' },
              defaultValue: undefined,
              annotations: {},
            },
          ],
          returnType: rillTypeToTypeValue({ type: 'string' }),
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
