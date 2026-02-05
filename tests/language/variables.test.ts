/**
 * Rill Runtime Tests: Variables
 * Tests for named variables, pipe variable, field access, and capture
 */

import { describe, expect, it } from 'vitest';

import { run, runFull } from '../helpers/runtime.js';
import { parse, type VariableNode } from '../../src/index.js';

describe('Rill Runtime: Variables', () => {
  describe('=> Capture Operator', () => {
    it('=> captures and continues chain', async () => {
      expect(await run('"hello" => $x -> .upper')).toBe('HELLO');
    });

    it('=> captured value equals original', async () => {
      const result = await runFull('"hello" => $x -> .upper');
      expect(result.variables['x']).toBe('hello');
    });

    it('=> at end of chain emits value', async () => {
      expect(await run('"hello" => $x')).toBe('hello');
    });

    it('multiple => in chain', async () => {
      expect(await run('"a" => $first -> "{$}b" => $second -> "{$}c"')).toBe(
        'abc'
      );
    });

    it('=> then -> continues with same value', async () => {
      expect(await run('"hello" => $orig -> .upper => $upper -> .len')).toBe(5);
    });

    it('$ inside chain is current pipe value', async () => {
      expect(await run('"hello" => $x -> "{$} world" => $y -> { $ }')).toBe(
        'hello world'
      );
    });

    it('=> at start of line continues chain', async () => {
      const code = `"hello"
        => $greeting
        -> .upper`;
      expect(await run(code)).toBe('HELLO');
    });

    it('mixed -> and => across lines', async () => {
      const code = `"start"
        => $a
        -> "{$}-middle"
        => $b
        -> "{$}-end"`;
      expect(await run(code)).toBe('start-middle-end');
    });

    it('captured var visible to siblings', async () => {
      expect(await run('"hello" => $x\n$x -> .upper')).toBe('HELLO');
    });

    it('captured var visible in nested blocks', async () => {
      expect(
        await run(`
          "outer" => $x
          "" -> {
            $x -> .upper
          }
        `)
      ).toBe('OUTER');
    });

    it('=> with type annotation', async () => {
      expect(await run('"hello" => $x:string -> .upper')).toBe('HELLO');
    });

    it('=> type mismatch errors', async () => {
      await expect(run('42 => $x:string')).rejects.toThrow();
    });

    it('=> in loop body is per-iteration', async () => {
      expect(
        await run('[1, 2, 3] -> each { $ => $curr -> { $curr * 2 } }')
      ).toEqual([2, 4, 6]);
    });
  });

  describe('Named Variables', () => {
    it('captures and reads variable', async () => {
      expect(await run('"x" => $v\n$v')).toBe('x');
    });

    it('overwrites variable', async () => {
      expect(await run('"a" => $v\n"b" => $v\n$v')).toBe('b');
    });

    it('supports multiple variables', async () => {
      expect(await run('"a" => $x\n"b" => $y\n[$x, $y]')).toEqual(['a', 'b']);
    });

    it('errors for undefined variable', async () => {
      await expect(run('$undefined')).rejects.toThrow('Undefined variable');
    });

    it('captures in execution result', async () => {
      const result = await runFull('"hello" => $msg\n$msg');
      expect(result.variables['msg']).toBe('hello');
    });

    it('captures multiple variables in result', async () => {
      const result = await runFull('"a" => $x\n"b" => $y\n[$x, $y]');
      expect(result.variables['x']).toBe('a');
      expect(result.variables['y']).toBe('b');
    });
  });

  describe('Pipe Variable ($)', () => {
    it('passes value through pipe', async () => {
      expect(await run('"x" -> identity')).toBe('x');
    });

    it('accesses $ in string interpolation via block', async () => {
      // Direct $ as pipe target isn't supported; use block
      expect(await run('"x" -> { "{$}" }')).toBe('x');
    });

    it('accesses $ in block', async () => {
      expect(await run('"x" -> { $ }')).toBe('x');
    });

    it('updates $ per pipe stage', async () => {
      expect(await run('"a" -> { "b" } -> { $ }')).toBe('b');
    });

    it('$ reflects current pipe value in chain', async () => {
      expect(await run('"first" -> { "second" } -> { "third" } -> { $ }')).toBe(
        'third'
      );
    });

    it('$ is undefined at script level without host context', async () => {
      await expect(run('$')).rejects.toThrow('Undefined variable: $');
    });

    it('bare method errors when $ is undefined', async () => {
      await expect(run('.len')).rejects.toThrow('Undefined variable: $');
    });

    it('$.field errors when $ is undefined', async () => {
      await expect(run('$.name')).rejects.toThrow('Undefined variable: $');
    });
  });

  describe('Field Access', () => {
    it('accesses tuple index via variable', async () => {
      expect(await run('[1, 2] => $t\n$t[0]')).toBe(1);
    });

    it('accesses dict field via variable', async () => {
      expect(await run('[x: "y"] => $d\n$d.x')).toBe('y');
    });

    it('chains field access', async () => {
      expect(await run('[a: [b: 1]] => $d\n$d.a.b')).toBe(1);
    });

    it('accesses field on $ in block', async () => {
      // Direct $.field as pipe target isn't supported; use block
      expect(await run('[x: 1] -> { $.x }')).toBe(1);
    });

    it('accesses nested tuple in dict', async () => {
      expect(await run('[items: [1, 2, 3]] => $d\n$d.items[1]')).toBe(2);
    });

    it('accesses dict in tuple', async () => {
      expect(await run('[[a: 1], [a: 2]] => $t\n$t[1].a')).toBe(2);
    });
  });

  describe('Initial Variables', () => {
    it('accesses pre-set variable', async () => {
      expect(await run('$name', { variables: { name: 'Alice' } })).toBe(
        'Alice'
      );
    });

    it('accesses pre-set number variable', async () => {
      expect(await run('$count', { variables: { count: 42 } })).toBe(42);
    });

    it('accesses pre-set tuple variable', async () => {
      expect(
        await run('$items[1]', { variables: { items: ['a', 'b', 'c'] } })
      ).toBe('b');
    });

    it('can overwrite pre-set variable', async () => {
      expect(
        await run('"new" => $name\n$name', { variables: { name: 'old' } })
      ).toBe('new');
    });
  });

  describe('AST Deprecated Fields', () => {
    // Helper to find first VariableNode in AST
    function findVariable(node: unknown): VariableNode | null {
      if (!node || typeof node !== 'object') return null;
      const n = node as { type?: string };
      if (n.type === 'Variable') return node as VariableNode;
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
          for (const item of value) {
            const found = findVariable(item);
            if (found) return found;
          }
        } else {
          const found = findVariable(value);
          if (found) return found;
        }
      }
      return null;
    }

    it('deprecated fields no longer exist', () => {
      const ast = parse('$data.field[0]');
      const variable = findVariable(ast);
      expect(variable).not.toBeNull();
      // fieldAccess and bracketAccess were removed in Phase 3
      expect('fieldAccess' in variable!).toBe(false);
      expect('bracketAccess' in variable!).toBe(false);
    });

    it('accessChain contains all property accesses', () => {
      const ast = parse('$data.field[0]');
      const variable = findVariable(ast);
      expect(variable).not.toBeNull();
      expect(variable!.accessChain).toHaveLength(2);
      // First access is field access (literal)
      expect(variable!.accessChain[0]).toHaveProperty('kind', 'literal');
      expect(variable!.accessChain[0]).toHaveProperty('field', 'field');
      // Second access is bracket access
      expect(variable!.accessChain[1]).toHaveProperty('accessKind', 'bracket');
    });

    it('accessChain maintains insertion order', () => {
      const ast = parse('$data[0].name[1].value');
      const variable = findVariable(ast);
      expect(variable).not.toBeNull();
      expect(variable!.accessChain).toHaveLength(4);
      // Bracket, Field, Bracket, Field
      expect(variable!.accessChain[0]).toHaveProperty('accessKind', 'bracket');
      expect(variable!.accessChain[1]).toHaveProperty('field', 'name');
      expect(variable!.accessChain[2]).toHaveProperty('accessKind', 'bracket');
      expect(variable!.accessChain[3]).toHaveProperty('field', 'value');
    });
  });
});
