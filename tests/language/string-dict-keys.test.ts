/**
 * Rill Language Tests: String Literal Dict Keys
 * Tests for using string literals as dict keys
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Language: String Literal Dict Keys', () => {
  describe('Basic String Key Parsing', () => {
    it('parses dict with single string literal key', async () => {
      const result = await run('["key": 42]');
      expect(result).toEqual({ key: 42 });
    });

    it('parses dict with multiple string literal keys', async () => {
      const result = await run('["blocked": 1, "error": 2]');
      expect(result).toEqual({ blocked: 1, error: 2 });
    });

    it('parses dict with string keys containing spaces', async () => {
      const result = await run('["hello world": 1, "foo bar": 2]');
      expect(result).toEqual({ 'hello world': 1, 'foo bar': 2 });
    });

    it('parses dict with string keys containing special characters', async () => {
      const result = await run('["@key": 1, "$value": 2, "foo-bar": 3]');
      expect(result).toEqual({ '@key': 1, $value: 2, 'foo-bar': 3 });
    });

    it('parses dict with empty string key', async () => {
      const result = await run('["": 42]');
      expect(result).toEqual({ '': 42 });
    });
  });

  describe('Mixed Key Types', () => {
    it('parses dict with string, identifier, number, and boolean keys', async () => {
      const result = await run('["str": 1, ident: 2, 3: 3, true: 4]');
      expect(result).toEqual({ str: 1, ident: 2, 3: 3, true: 4 });
    });

    it('parses dict with string and identifier keys with same value', async () => {
      const result = await run('["key": 1, key: 2]');
      expect(result).toEqual({ key: 2 }); // Later value overwrites
    });

    it('parses dict with negative number and string keys', async () => {
      const result = await run('["-1": "string", -1: "number"]');
      // Both become "-1" key, later overwrites
      expect(result).toEqual({ '-1': 'number' });
    });
  });

  describe('String Keys with Complex Values', () => {
    it('parses dict with string key and nested dict value', async () => {
      const result = await run('["outer": [inner: 42]]');
      expect(result).toEqual({ outer: { inner: 42 } });
    });

    it('parses dict with string key and list value', async () => {
      const result = await run('["items": [1, 2, 3]]');
      expect(result).toEqual({ items: [1, 2, 3] });
    });

    it('parses dict with string key and closure value', async () => {
      const script = '["fn": ||{ 42 }]';
      const result = await run(script);
      expect(result).toHaveProperty('fn');
      expect(typeof result.fn).toBe('object');
      expect(result.fn.__type).toBe('callable');
    });

    it('parses dict with string key and callable block value', async () => {
      const script = '["key": { 1 + 1 }]';
      const result = await run(script);
      expect(result).toHaveProperty('key');
      // Blocks in dict values are stored as callables, not evaluated
      expect(typeof result.key).toBe('object');
      expect(result.key.__type).toBe('callable');
    });
  });

  describe('String Keys in Dispatch', () => {
    it('dispatches using string literal keys', async () => {
      const result = await run(
        '"blocked" -> ["blocked": "is blocked", "error": "is error"]'
      );
      expect(result).toBe('is blocked');
    });

    it('dispatches with string keys and closure values', async () => {
      const result = await run('"status" -> ["status": ||{ $ -> .upper }]');
      expect(result).toBe('STATUS');
    });

    it('dispatches with mixed key types including strings', async () => {
      const result = await run('"key" -> ["key": "string", other: "ident"]');
      expect(result).toBe('string');
    });

    it('throws error when string key not found in dispatch', async () => {
      await expect(run('"missing" -> ["key": 1]')).rejects.toThrow(
        /not found/i
      );
    });
  });

  describe('Field Access with String Keys', () => {
    it('accesses field defined with string key using dot notation', async () => {
      const result = await run('["name": "alice"] :> $d\n$d.name');
      expect(result).toBe('alice');
    });

    it('accesses nested fields defined with string keys', async () => {
      const result = await run(
        '["outer": ["inner": 42]] :> $d\n$d.outer.inner'
      );
      expect(result).toBe(42);
    });

    it('accesses field with string key containing special chars using dynamic access', async () => {
      const result = await run('["foo-bar": 42] :> $d\n$d.("foo-bar")');
      expect(result).toBe(42);
    });
  });

  describe('Original Bug Scenario', () => {
    it('parses conditional with string literal dict keys in block', async () => {
      const script = `
        "blocked" :> $type
        $type -> [
          "blocked": "blocked result",
          "error": "error result"
        ]
      `;
      const result = await run(script);
      expect(result).toBe('blocked result');
    });

    it('parses conditional with string keys and closures', async () => {
      const script = `
        "error" :> $type
        $type -> [
          "blocked": ||{ "blocked" -> .upper },
          "error": ||{ "error" -> .len }
        ]
      `;
      const result = await run(script);
      expect(result).toBe(5);
    });

    it('parses nested dicts with string keys', async () => {
      const script = `
        "active" -> [
          "active": "running",
          "inactive": "stopped"
        ]
      `;
      const result = await run(script);
      expect(result).toBe('running');
    });
  });

  describe('String Keys with Escapes', () => {
    it('parses string key with escaped quote', async () => {
      const result = await run('["key\\"with\\"quotes": 42]');
      expect(result).toEqual({ 'key"with"quotes': 42 });
    });

    it('parses string key with newline escape', async () => {
      const result = await run('["key\\nline": 42]');
      expect(result).toEqual({ 'key\nline': 42 });
    });

    it('parses string key with tab escape', async () => {
      const result = await run('["key\\ttab": 42]');
      expect(result).toEqual({ 'key\ttab': 42 });
    });
  });

  describe('Type Assertions Still Work', () => {
    it('parses string type assertion outside dict context', async () => {
      const result = await run('"hello":string');
      expect(result).toBe('hello');
    });

    it('parses type assertion on variable', async () => {
      const result = await run('"test" :> $x\n$x:string');
      expect(result).toBe('test');
    });

    it('parses type check with string value', async () => {
      const result = await run('"hello":?string');
      expect(result).toBe(true);
    });

    it('distinguishes dict key colon from type assertion colon', async () => {
      // Dict key: ["key": value]
      const dict = await run('["key": 42]');
      expect(dict).toEqual({ key: 42 });

      // Type assertion: "value":string
      const assertion = await run('"value":string');
      expect(assertion).toBe('value');
    });
  });
});
