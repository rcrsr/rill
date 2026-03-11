/**
 * Bindings source generator tests
 */

import { describe, it, expect } from 'vitest';
import { buildBindingsSource } from '../../src/run/bindings.js';
import type { NestedExtConfig } from '../../src/run/loader.js';
import type { RillFunction } from '@rcrsr/rill';

function makeLeaf(name = 'fn'): RillFunction {
  return {
    fn: async () => 'result',
    params: [],
    description: `${name} function`,
  } as unknown as RillFunction;
}

function makeLeafWithParams(): RillFunction {
  return {
    fn: async () => 'result',
    params: [
      {
        name: 'text',
        type: { type: 'string' },
        defaultValue: undefined,
        annotations: {},
      },
      {
        name: 'options',
        type: { type: 'dict' },
        defaultValue: {},
        annotations: {},
      },
    ],
    description: 'function with params',
  } as unknown as RillFunction;
}

describe('buildBindingsSource', () => {
  describe('AC-28: empty tree', () => {
    it('returns "[:]" for an empty tree', () => {
      expect(buildBindingsSource({})).toBe('[:]');
    });
  });

  describe('AC-29: flat key generates single-level binding', () => {
    it('builds a single entry for a top-level extension with one function', () => {
      const tree: NestedExtConfig = { mcp: { call: makeLeaf('call') } };
      const result = buildBindingsSource(tree);
      expect(result).toContain('mcp:');
      expect(result).toContain('call:');
      expect(result).toContain('use<ext:mcp.call>');
      expect(result).toMatch(/^\[/);
      expect(result).toMatch(/\]$/);
    });

    it('builds multiple entries for a top-level extension with multiple functions', () => {
      const tree: NestedExtConfig = {
        mcp: { call: makeLeaf('call'), list: makeLeaf('list') },
      };
      const result = buildBindingsSource(tree);
      expect(result).toContain('use<ext:mcp.call>');
      expect(result).toContain('use<ext:mcp.list>');
    });
  });

  describe('AC-35: nested key generates nested binding key', () => {
    it('builds a doubly-qualified key for a two-segment namespace', () => {
      const tree: NestedExtConfig = {
        llm: { anthropic: { message: makeLeaf('message') } },
      };
      expect(buildBindingsSource(tree)).toContain(
        'use<ext:llm.anthropic.message>'
      );
    });

    it('includes param type annotations when params are present', () => {
      const tree: NestedExtConfig = {
        llm: { anthropic: { message: makeLeafWithParams() } },
      };
      const result = buildBindingsSource(tree);
      expect(result).toContain('text: string');
      expect(result).toContain('options: dict');
    });
  });

  describe('AC-34: deeply nested key generates 4-level qualified key', () => {
    it('builds a 4-segment key for a four-level namespace', () => {
      const tree: NestedExtConfig = {
        a: { b: { c: { d: { myFunc: makeLeaf('myFunc') } } } },
      };
      expect(buildBindingsSource(tree)).toContain('use<ext:a.b.c.d.myFunc>');
    });
  });

  describe('AC-35: shared prefix produces distinct qualified keys', () => {
    it('generates separate entries for llm.anthropic and llm.openai', () => {
      const tree: NestedExtConfig = {
        llm: {
          anthropic: { message: makeLeaf('message') },
          openai: { message: makeLeaf('message') },
        },
      };
      const result = buildBindingsSource(tree);
      expect(result).toContain('use<ext:llm.anthropic.message>');
      expect(result).toContain('use<ext:llm.openai.message>');
    });

    it('does not mix functions from anthropic and openai', () => {
      const tree: NestedExtConfig = {
        llm: {
          anthropic: { embed: makeLeaf('embed') },
          openai: { chat: makeLeaf('chat') },
        },
      };
      const result = buildBindingsSource(tree);
      expect(result).toContain('use<ext:llm.anthropic.embed>');
      expect(result).toContain('use<ext:llm.openai.chat>');
      expect(result).not.toContain('use<ext:llm.openai.embed>');
      expect(result).not.toContain('use<ext:llm.anthropic.chat>');
    });
  });

  describe('param serialization', () => {
    it('omits type annotation when param type is undefined', () => {
      const tree: NestedExtConfig = {
        mcp: {
          call: {
            fn: async () => 'result',
            params: [
              {
                name: 'input',
                type: undefined,
                defaultValue: undefined,
                annotations: {},
              },
            ],
            description: 'call fn',
          } as unknown as RillFunction,
        },
      };
      expect(buildBindingsSource(tree)).toContain('input: any');
    });

    it('includes description annotation when present', () => {
      const tree: NestedExtConfig = {
        mcp: {
          call: {
            fn: async () => 'result',
            params: [
              {
                name: 'text',
                type: { type: 'string' },
                defaultValue: undefined,
                annotations: { description: 'The input text' },
              },
            ],
            description: 'call fn',
          } as unknown as RillFunction,
        },
      };
      expect(buildBindingsSource(tree)).toContain(
        'description: "The input text"'
      );
    });

    it('omits description annotation when description is empty string', () => {
      const tree: NestedExtConfig = {
        mcp: {
          call: {
            fn: async () => 'result',
            params: [
              {
                name: 'text',
                type: { type: 'string' },
                defaultValue: undefined,
                annotations: { description: '' },
              },
            ],
            description: 'call fn',
          } as unknown as RillFunction,
        },
      };
      expect(buildBindingsSource(tree)).not.toContain('description: ""');
    });
  });

  describe('output format', () => {
    it('produces a valid rill dict literal with bracket delimiters', () => {
      const tree: NestedExtConfig = { mcp: { call: makeLeaf() } };
      const result = buildBindingsSource(tree);
      expect(result.startsWith('[')).toBe(true);
      expect(result.endsWith(']')).toBe(true);
    });

    it('separates multiple entries with commas', () => {
      const tree: NestedExtConfig = {
        mcp: { call: makeLeaf('call'), list: makeLeaf('list') },
      };
      expect(buildBindingsSource(tree)).toContain(',');
    });

    it('emits nested dict structure for intermediate nodes', () => {
      const tree: NestedExtConfig = {
        llm: { openai: { message: makeLeaf('message') } },
      };
      const result = buildBindingsSource(tree);
      expect(result).toContain('llm:');
      expect(result).toContain('openai:');
      expect(result).toContain('message:');
      expect(result).toContain('use<ext:llm.openai.message>:||');
    });

    it('applies basePath prefix to all dot-separated paths', () => {
      const tree: NestedExtConfig = {
        message: makeLeaf('message'),
        tool_loop: makeLeaf('tool_loop'),
      };
      const result = buildBindingsSource(tree, 'llm.openai');
      expect(result).toContain('use<ext:llm.openai.message>');
      expect(result).toContain('use<ext:llm.openai.tool_loop>');
    });

    it('uses empty basePath by default', () => {
      const tree: NestedExtConfig = { message: makeLeaf('message') };
      const result = buildBindingsSource(tree);
      expect(result).toContain('use<ext:message>');
      expect(result).not.toContain('use<ext:.message>');
    });
  });
});
