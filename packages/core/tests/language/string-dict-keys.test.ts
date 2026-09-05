/**
 * Rill Language Tests: String Literal Dict Keys
 * Tests for using string literals as dict keys
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Language: String Literal Dict Keys', () => {
  describe('Basic String Key Parsing', () => {
    it('parses dict with single string literal key', async () => {
      const result = await run('dict["key": 42]');
      expect(result).toEqual({ key: 42 });
    });

    it('parses dict with multiple string literal keys', async () => {
      const result = await run('dict["blocked": 1, "error": 2]');
      expect(result).toEqual({ blocked: 1, error: 2 });
    });

    it('parses dict with string keys containing spaces', async () => {
      const result = await run('dict["hello world": 1, "foo bar": 2]');
      expect(result).toEqual({ 'hello world': 1, 'foo bar': 2 });
    });

    it('parses dict with string keys containing special characters', async () => {
      const result = await run('dict["@key": 1, "$value": 2, "foo-bar": 3]');
      expect(result).toEqual({ '@key': 1, $value: 2, 'foo-bar': 3 });
    });

    it('parses dict with empty string key', async () => {
      const result = await run('dict["": 42]');
      expect(result).toEqual({ '': 42 });
    });
  });

  describe('Mixed Key Types', () => {
    it('parses dict with string, identifier, number, and boolean keys', async () => {
      // Dict keys are type-aware: string/identifier keys are stored as plain
      // properties while number and boolean keys are distinct typed keys. The
      // plain object surfaces only the string keys; typed keys are reached via
      // dispatch and counted by .len.
      const src = 'dict["str": 1, ident: 2, 3: 3, true: 4]';
      expect(await run(src)).toEqual({ str: 1, ident: 2 });
      expect(await run(`${src} -> .len`)).toBe(4);
      expect(await run(`${src} => $d\n3 -> $d`)).toBe(3);
      expect(await run(`${src} => $d\ntrue -> $d`)).toBe(4);
    });

    it('parses dict with string and identifier keys with same value', async () => {
      const result = await run('dict["key": 1, key: 2]');
      expect(result).toEqual({ key: 2 }); // Later value overwrites
    });

    it('keeps a negative number key distinct from its string form', async () => {
      // dict["-1": ..., -1: ...] holds TWO entries: string "-1" and number -1.
      const src = 'dict["-1": "string", -1: "number"]';
      expect(await run(`${src} -> .len`)).toBe(2);
      expect(await run(`${src} => $d\n-1 -> $d`)).toBe('number');
      expect(await run(`${src} => $d\n"-1" -> $d`)).toBe('string');
    });
  });

  describe('String Keys with Complex Values', () => {
    it('parses dict with string key and nested dict value', async () => {
      const result = await run('dict["outer": dict[inner: 42]]');
      expect(result).toEqual({ outer: { inner: 42 } });
    });

    it('parses dict with string key and list value', async () => {
      const result = await run('dict["items": list[1, 2, 3]]');
      expect(result).toEqual({ items: [1, 2, 3] });
    });

    it('parses dict with string key and closure value', async () => {
      // Return the type of the closure value via host typeName property.
      // Use |x|{ $x } (explicit-param closure) so property access does not auto-invoke.
      const result = (await run(
        'dict["fn": |x|{ $x }] => $d\n$d.fn.^type'
      )) as any;
      expect(result.typeName).toBe('closure');
    });

    it('parses dict with string key and callable block value', async () => {
      // Return the type of the block-closure value via host typeName property.
      const result = (await run(
        'dict["key": { 1 + 1 }] => $d\n$d.key.^type'
      )) as any;
      // Blocks in dict values are stored as callables, not evaluated
      expect(result.typeName).toBe('closure');
    });
  });

  describe('String Keys in Dispatch', () => {
    it('dispatches using string literal keys', async () => {
      const result = await run(
        '"blocked" -> dict["blocked": "is blocked", "error": "is error"]'
      );
      expect(result).toBe('is blocked');
    });

    it('dispatches with string keys and closure values', async () => {
      const result = await run('"status" -> dict["status": ||{ $ -> .upper }]');
      expect(result).toBe('STATUS');
    });

    it('dispatches with mixed key types including strings', async () => {
      const result = await run(
        '"key" -> dict["key": "string", other: "ident"]'
      );
      expect(result).toBe('string');
    });

    it('throws error when string key not found in dispatch', async () => {
      await expect(run('"missing" -> dict["key": 1]')).rejects.toThrow(
        /not found/i
      );
    });
  });

  describe('Field Access with String Keys', () => {
    it('accesses field defined with string key using dot notation', async () => {
      const result = await run('dict["name": "alice"] => $d\n$d.name');
      expect(result).toBe('alice');
    });

    it('accesses nested fields defined with string keys', async () => {
      const result = await run(
        'dict["outer": dict["inner": 42]] => $d\n$d.outer.inner'
      );
      expect(result).toBe(42);
    });

    it('accesses field with string key containing special chars using dynamic access', async () => {
      const result = await run('dict["foo-bar": 42] => $d\n$d.("foo-bar")');
      expect(result).toBe(42);
    });
  });

  describe('Original Bug Scenario', () => {
    it('parses conditional with string literal dict keys in block', async () => {
      const script = `
        "blocked" => $type
        $type -> dict[
          "blocked": "blocked result",
          "error": "error result"
        ]
      `;
      const result = await run(script);
      expect(result).toBe('blocked result');
    });

    it('parses conditional with string keys and closures', async () => {
      const script = `
        "error" => $type
        $type -> dict[
          "blocked": ||{ "blocked" -> .upper },
          "error": ||{ "error" -> .len }
        ]
      `;
      const result = await run(script);
      expect(result).toBe(5);
    });

    it('parses nested dicts with string keys', async () => {
      const script = `
        "active" -> dict[
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
      const result = await run('dict["key\\"with\\"quotes": 42]');
      expect(result).toEqual({ 'key"with"quotes': 42 });
    });

    it('parses string key with newline escape', async () => {
      const result = await run('dict["key\\nline": 42]');
      expect(result).toEqual({ 'key\nline': 42 });
    });

    it('parses string key with tab escape', async () => {
      const result = await run('dict["key\\ttab": 42]');
      expect(result).toEqual({ 'key\ttab': 42 });
    });
  });

  describe('Type Assertions Still Work', () => {
    it('parses string type assertion outside dict context', async () => {
      const result = await run('"hello":string');
      expect(result).toBe('hello');
    });

    it('parses type assertion on variable', async () => {
      const result = await run('"test" => $x\n$x:string');
      expect(result).toBe('test');
    });

    it('parses type check with string value', async () => {
      const result = await run('"hello":?string');
      expect(result).toBe(true);
    });

    it('distinguishes dict key colon from type assertion colon', async () => {
      // Dict key: ["key": value]
      const dict = await run('dict["key": 42]');
      expect(dict).toEqual({ key: 42 });

      // Type assertion: "value":string
      const assertion = await run('"value":string');
      expect(assertion).toBe('value');
    });
  });

  describe('Reserved Brand Keys', () => {
    const brandKeys = [
      '__type',
      '__rill_atom',
      '__rill_tuple',
      '__rill_vector',
      '__rill_datetime',
      '__rill_duration',
      '__rill_ordered',
      '__rill_type',
      '__rill_stream',
      '__rill_stream_resolve',
      '__rill_stream_dispose',
      '__rill_stream_chunk_type',
      '__rill_stream_ret_type',
    ];

    for (const key of brandKeys) {
      it(`halts with RILL-R002 for reserved brand key '${key}' as a plain dict key`, async () => {
        await expect(run(`dict[${key}: "x"]`)).rejects.toHaveProperty(
          'errorId',
          'RILL-R002'
        );
        await expect(run(`dict[${key}: "x"]`)).rejects.toThrow(
          new RegExp(`Cannot use reserved brand key '${key}' as dict key`, 'i')
        );
      });
    }

    it('halts with RILL-R002 when a variable resolves to a reserved brand key', async () => {
      const script = `"__type" => $k\ndict[static: 0, $k: "x"]`;
      await expect(run(script)).rejects.toHaveProperty('errorId', 'RILL-R002');
      await expect(run(script)).rejects.toThrow(
        /Cannot use reserved brand key '__type' as dict key/i
      );
    });

    it('halts with RILL-R002 when a computed key evaluates to a reserved brand key', async () => {
      const script = `"__type" => $k\ndict[static: 0, ($k): "x"]`;
      await expect(run(script)).rejects.toHaveProperty('errorId', 'RILL-R002');
      await expect(run(script)).rejects.toThrow(
        /Cannot use reserved brand key '__type' as dict key/i
      );
    });

    it('still allows a normal dict key that is not reserved', async () => {
      const result = await run('dict[foo: 1]');
      expect(result).toEqual({ foo: 1 });
    });

    for (const key of brandKeys) {
      it(`halts with RILL-R002 for reserved brand key '${key}' in an ordered[] literal`, async () => {
        await expect(run(`ordered[${key}: "x"]`)).rejects.toHaveProperty(
          'errorId',
          'RILL-R002'
        );
        await expect(run(`ordered[${key}: "x"]`)).rejects.toThrow(
          new RegExp(`Cannot use reserved brand key '${key}' as dict key`, 'i')
        );
      });
    }

    it('still allows a normal key in an ordered[] literal', async () => {
      const result = await run('ordered[foo: 1] -> dict');
      expect(result).toEqual({ foo: 1 });
    });
  });
});
