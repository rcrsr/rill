import { describe, it, expect } from 'vitest';
import { parse } from '../../src/index.js';
import type {
  DictEntryNode,
  DictKeyVariable,
  DictKeyComputed,
} from '../../src/types.js';
import { run } from '../helpers/runtime.js';

describe('Dict Variable and Computed Keys - Parser (Task 1.3)', () => {
  describe('Variable keys', () => {
    it('parses variable key syntax in dict context', () => {
      // Start with static key to establish dict context
      const source = '[static: 0, $key: "value"]';
      const ast = parse(source);

      expect(ast.type).toBe('Script');
      const stmt = ast.statements[0]!;
      const pipeChain = stmt.expression!;
      const expr = (pipeChain as any).head.primary;
      expect(expr.type).toBe('Dict');

      if (expr.type === 'Dict') {
        const entry = expr.entries[1] as DictEntryNode;
        expect(entry.type).toBe('DictEntry');

        const key = entry.key as DictKeyVariable;
        expect(key.kind).toBe('variable');
        expect(key.variableName).toBe('key');
      }
    });

    it('throws when $ is not followed by identifier in dict context', () => {
      const source = '[static: 0, $: "value"]';

      try {
        parse(source);
        expect.fail('Should have thrown ParseError');
      } catch (err: any) {
        expect(err.message).toContain('Expected variable name after $');
      }
    });
  });

  describe('Computed keys', () => {
    it('parses computed key syntax in dict context', () => {
      // Start with static key to establish dict context
      const source = '[static: 0, ($x -> .upper): "value"]';
      const ast = parse(source);

      expect(ast.type).toBe('Script');
      const stmt = ast.statements[0]!;
      const pipeChain = stmt.expression!;
      const expr = (pipeChain as any).head.primary;
      expect(expr.type).toBe('Dict');

      if (expr.type === 'Dict') {
        const entry = expr.entries[1] as DictEntryNode;
        expect(entry.type).toBe('DictEntry');

        const key = entry.key as DictKeyComputed;
        expect(key.kind).toBe('computed');
        expect(key.expression).toBeDefined();
        expect(key.expression.type).toBe('PipeChain');
      }
    });

    it('throws when computed key missing closing paren in dict context', () => {
      const source = '[static: 0, ($x, "value"]';

      try {
        parse(source);
        expect.fail('Should have thrown ParseError');
      } catch (err: any) {
        expect(err.message).toContain(
          'Expected ) after computed key expression'
        );
      }
    });
  });

  describe('Mixed dict entries', () => {
    it('parses dict with static, variable, and computed keys', () => {
      const source = '[a: 1, $varKey: 2, ($computed): 3]';
      const ast = parse(source);

      expect(ast.type).toBe('Script');
      const stmt = ast.statements[0]!;
      const pipeChain = stmt.expression!;
      const expr = (pipeChain as any).head.primary;
      expect(expr.type).toBe('Dict');

      if (expr.type === 'Dict') {
        expect(expr.entries.length).toBe(3);

        // First entry: static key
        const entry1 = expr.entries[0] as DictEntryNode;
        expect(entry1.key).toBe('a');

        // Second entry: variable key
        const entry2 = expr.entries[1] as DictEntryNode;
        const key2 = entry2.key as DictKeyVariable;
        expect(key2.kind).toBe('variable');
        expect(key2.variableName).toBe('varKey');

        // Third entry: computed key
        const entry3 = expr.entries[2] as DictEntryNode;
        const key3 = entry3.key as DictKeyComputed;
        expect(key3.kind).toBe('computed');
      }
    });
  });

  describe('Error Cases', () => {
    // EC-1: $ without identifier
    it('throws when $ has space after it instead of identifier', () => {
      const source = '[static: 0, $ : 1]';

      try {
        parse(source);
        expect.fail('Should have thrown ParseError');
      } catch (err: any) {
        expect(err.message).toContain('Expected variable name after $');
      }
    });

    // EC-2: Unclosed computed key
    it('throws when computed key missing closing paren', () => {
      const source = '[static: 0, ($expr, "value"]';

      try {
        parse(source);
        expect.fail('Should have thrown ParseError');
      } catch (err: any) {
        expect(err.message).toContain(
          'Expected ) after computed key expression'
        );
      }
    });

    // EC-3: Invalid token at key position
    it('throws when dict key is invalid token', () => {
      const source = '[static: 0, @ : 1]';

      try {
        parse(source);
        expect.fail('Should have thrown ParseError');
      } catch (err: any) {
        expect(err.message).toContain(
          'Dict key must be identifier, string, number, boolean, variable, or expression'
        );
      }
    });
  });
});

describe('Dict Variable and Computed Keys - Runtime (Task 2.5)', () => {
  describe('Success Cases', () => {
    describe('Variable Keys', () => {
      it('resolves variable key to create dict entry (AC-1)', async () => {
        // AC-1: "done" => $k then [$k: 1] produces dict {done: 1}
        // Note: Static key first required to establish dict context
        const code = `
          "done" => $k
          [_static: 0, $k: 1]
        `;
        const result = await run(code);
        expect(result).toHaveProperty('done', 1);
      });

      it('creates dict with multiple variable keys', async () => {
        const code = `
          "name" => $k1
          "age" => $k2
          [_static: 0, $k1: "alice", $k2: 30]
        `;
        const result = await run(code);
        expect(result).toHaveProperty('name', 'alice');
        expect(result).toHaveProperty('age', 30);
      });

      it('creates dict with mixed static and variable keys', async () => {
        const code = `
          "dynamic" => $key
          [static: 1, $key: 2, another: 3]
        `;
        expect(await run(code)).toEqual({
          static: 1,
          dynamic: 2,
          another: 3,
        });
      });

      it('resolves string from number variable as dict key', async () => {
        const code = `
          "42" => $numKey
          [_static: 0, $numKey: "numeric-key"]
        `;
        const result = await run(code);
        expect(result).toHaveProperty('42', 'numeric-key');
      });
    });

    describe('Computed Keys', () => {
      it('evaluates computed expression to create dict entry (AC-2)', async () => {
        // AC-2: [("a" -> .upper): 2] produces dict {A: 2}
        // Note: Static key first required to establish dict context
        const code = `[_static: 0, ("a" -> .upper): 2]`;
        const result = await run(code);
        expect(result).toHaveProperty('A', 2);
      });

      it('creates dict with computed key from arithmetic converted to string', async () => {
        const code = `
          2 => $base
          [_static: 0, (($base + 3) -> .str): "computed"]
        `;
        const result = await run(code);
        expect(result).toHaveProperty('5', 'computed');
      });

      it('creates dict with computed key from conditional', async () => {
        const code = `
          true => $flag
          [_static: 0, ($flag ? "yes" ! "no"): "value"]
        `;
        const result = await run(code);
        expect(result).toHaveProperty('yes', 'value');
      });

      it('creates dict with multiple computed keys', async () => {
        const code = `
          [_static: 0, ("a" -> .upper): 1, ("b" -> .upper): 2]
        `;
        const result = await run(code);
        expect(result).toHaveProperty('A', 1);
        expect(result).toHaveProperty('B', 2);
      });

      it('creates dict mixing static, variable, and computed keys', async () => {
        const code = `
          "var" => $k
          [static: 1, $k: 2, ("comp" -> .upper): 3]
        `;
        expect(await run(code)).toEqual({ static: 1, var: 2, COMP: 3 });
      });
    });

    describe('Complex Expressions', () => {
      it('uses computed key with method chain', async () => {
        const code = `
          "  key  " => $raw
          [_static: 0, ($raw -> .trim -> .upper): "cleaned"]
        `;
        const result = await run(code);
        expect(result).toHaveProperty('KEY', 'cleaned');
      });

      it('nests dicts with dynamic keys', async () => {
        const code = `
          "outer" => $k1
          "inner" => $k2
          [_static: 0, $k1: [_nested: 0, $k2: "nested"]]
        `;
        const result = await run(code);
        expect(result).toHaveProperty('outer');
        expect(result.outer).toHaveProperty('inner', 'nested');
      });

      it('uses variable key in value position', async () => {
        const code = `
          "value" => $v
          "key" => $k
          [_static: 0, $k: $v]
        `;
        const result = await run(code);
        expect(result).toHaveProperty('key', 'value');
      });
    });
  });

  describe('Error Cases', () => {
    describe('Undefined Variable Key', () => {
      it('throws RUNTIME_UNDEFINED_VARIABLE when variable key does not exist (AC-6, EC-6)', async () => {
        // AC-6: [$undefined: 1] throws RUNTIME_UNDEFINED_VARIABLE
        // EC-6: Variable '{name}' is undefined
        try {
          await run('[_static: 0, $undefined: 1]');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toHaveProperty('errorId', 'RILL-R005');
          expect(err.message).toMatch(/Variable 'undefined' is undefined/i);
        }
      });
    });

    describe('Variable Key Non-String', () => {
      it('throws RUNTIME_TYPE_ERROR when variable key is number (AC-7, EC-7)', async () => {
        // AC-7: 42 => $n then [$n: 1] throws RUNTIME_TYPE_ERROR
        // EC-7: "Dict key must be string, got number"
        try {
          await run(`
            42 => $n
            [_static: 0, $n: 1]
          `);
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toHaveProperty('errorId');
          const errorId = (err as { errorId: string }).errorId;
          expect(errorId).toMatch(/^RILL-R\d{3}$/);
          expect(err.message).toMatch(/Dict key must be string, got number/i);
        }
      });

      it('throws RUNTIME_TYPE_ERROR when variable key is boolean (EC-7)', async () => {
        // EC-7: Dict key must be string, got {type}
        try {
          await run(`
            true => $bool
            [_static: 0, $bool: 1]
          `);
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toHaveProperty('errorId');
          const errorId = (err as { errorId: string }).errorId;
          expect(errorId).toMatch(/^RILL-R\d{3}$/);
          expect(err.message).toMatch(/Dict key must be string, got boolean/i);
        }
      });

      it('throws RUNTIME_TYPE_ERROR when variable key is list (EC-7)', async () => {
        // EC-7: Dict key must be string, got {type}
        try {
          await run(`
            [1, 2, 3] => $list
            [_static: 0, $list: 1]
          `);
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toHaveProperty('errorId');
          const errorId = (err as { errorId: string }).errorId;
          expect(errorId).toMatch(/^RILL-R\d{3}$/);
          expect(err.message).toMatch(/Dict key must be string, got object/i);
        }
      });

      it('throws RUNTIME_TYPE_ERROR when variable key is dict (EC-7)', async () => {
        // EC-7: Dict key must be string, got {type}
        try {
          await run(`
            [a: 1] => $dict
            [_static: 0, $dict: 1]
          `);
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toHaveProperty('errorId');
          const errorId = (err as { errorId: string }).errorId;
          expect(errorId).toMatch(/^RILL-R\d{3}$/);
          expect(err.message).toMatch(/Dict key must be string, got object/i);
        }
      });
    });

    describe('Computed Key Non-String', () => {
      it('throws RUNTIME_TYPE_ERROR when computed key evaluates to number (AC-8, EC-8)', async () => {
        // AC-8: [(42): 1] throws RUNTIME_TYPE_ERROR
        // EC-8: "Dict key evaluated to number, expected string"
        try {
          await run('[_static: 0, (42): 1]');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toHaveProperty('errorId');
          const errorId = (err as { errorId: string }).errorId;
          expect(errorId).toMatch(/^RILL-R\d{3}$/);
          expect(err.message).toMatch(
            /Dict key evaluated to number, expected string/i
          );
        }
      });

      it('throws RUNTIME_TYPE_ERROR when computed key evaluates to boolean (EC-8)', async () => {
        // EC-8: Dict key evaluated to {type}, expected string
        try {
          await run('[_static: 0, (true): 1]');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toHaveProperty('errorId');
          const errorId = (err as { errorId: string }).errorId;
          expect(errorId).toMatch(/^RILL-R\d{3}$/);
          expect(err.message).toMatch(
            /Dict key evaluated to boolean, expected string/i
          );
        }
      });

      it('throws RUNTIME_TYPE_ERROR when computed key evaluates to list (EC-8)', async () => {
        // EC-8: Dict key evaluated to {type}, expected string
        try {
          await run('[_static: 0, ([1, 2]): 1]');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toHaveProperty('errorId');
          const errorId = (err as { errorId: string }).errorId;
          expect(errorId).toMatch(/^RILL-R\d{3}$/);
          expect(err.message).toMatch(
            /Dict key evaluated to object, expected string/i
          );
        }
      });

      it('throws RUNTIME_TYPE_ERROR for computed arithmetic without .str conversion (EC-8)', async () => {
        // EC-8: Dict key evaluated to {type}, expected string
        try {
          await run(`
            2 => $base
            [_static: 0, ($base + 3): "value"]
          `);
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toHaveProperty('errorId');
          const errorId = (err as { errorId: string }).errorId;
          expect(errorId).toMatch(/^RILL-R\d{3}$/);
          expect(err.message).toMatch(
            /Dict key evaluated to number, expected string/i
          );
        }
      });
    });
  });

  describe('Boundary Conditions', () => {
    describe('Empty and Whitespace Keys', () => {
      it('creates dict with empty string key (AC-12)', async () => {
        // AC-12: "" => $k then [$k: 1] produces dict {"": 1}
        const code = `
          "" => $k
          [_static: 0, $k: 1]
        `;
        const result = await run(code);
        expect(result).toHaveProperty('', 1);
      });

      it('creates dict with whitespace key (AC-13)', async () => {
        // AC-13: " " => $k then [$k: 1] produces dict {" ": 1}
        const code = `
          " " => $k
          [_static: 0, $k: 1]
        `;
        const result = await run(code);
        expect(result).toHaveProperty(' ', 1);
      });

      it('creates dict with multiple whitespace key', async () => {
        const code = `
          "   " => $k
          [_static: 0, $k: 1]
        `;
        const result = await run(code);
        expect(result).toHaveProperty('   ', 1);
      });
    });

    describe('Key Collision', () => {
      it('uses last-write-wins when static key and dynamic key collide (AC-14)', async () => {
        // AC-14: [a: 1, $key: 2] where $key = "a" should produce {a: 2}
        const code = `
          "a" => $key
          [a: 1, $key: 2]
        `;
        const result = await run(code);
        expect(result).toEqual({ a: 2 });
      });

      it('uses last-write-wins when dynamic key precedes static key', async () => {
        const code = `
          "a" => $key
          [_static: 0, $key: 1, a: 2]
        `;
        const result = await run(code);
        expect(result).toHaveProperty('a', 2);
        expect(result).toHaveProperty('_static', 0);
      });

      it('uses last-write-wins when computed key and static key collide', async () => {
        const code = `
          [a: 1, ("a"): 2]
        `;
        const result = await run(code);
        expect(result).toEqual({ a: 2 });
      });

      it('uses last-write-wins when multiple variable keys collide', async () => {
        const code = `
          "key" => $k1
          "key" => $k2
          [_static: 0, $k1: 1, $k2: 2]
        `;
        const result = await run(code);
        expect(result).toHaveProperty('key', 2);
      });

      it('uses last-write-wins when computed and variable keys collide', async () => {
        const code = `
          "a" => $key
          [_static: 0, $key: 1, ("a"): 2]
        `;
        const result = await run(code);
        expect(result).toHaveProperty('a', 2);
      });
    });
  });
});
