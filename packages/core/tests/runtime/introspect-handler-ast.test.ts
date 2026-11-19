/**
 * Tests for introspectHandlerFromAST() static handler introspection.
 *
 * Validates extraction of handler metadata from parsed AST without execution.
 */

import { describe, expect, it } from 'vitest';
import { introspectHandlerFromAST, parse } from '@rcrsr/rill';

describe('introspectHandlerFromAST', () => {
  describe('handler discovery', () => {
    it('returns null when no handler matches the name', () => {
      const ast = parse('"hello" => $greet');
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).toBeNull();
    });

    it('finds handler by capture name', () => {
      const ast = parse('fn(name: string) { "hi" } => $run');
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
    });

    it('returns null for empty script', () => {
      const ast = parse('');
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).toBeNull();
    });

    it('finds handler among multiple statements', () => {
      const source = `
        "setup" => $init
        fn(name: string) { "hi" } => $run
      `;
      const ast = parse(source);
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.params).toHaveLength(1);
      expect(result!.params[0]!.name).toBe('name');
    });
  });

  describe('parameter extraction', () => {
    it('extracts parameter name and type', () => {
      const ast = parse('fn(greeting: string, count: number) { "hi" } => $run');
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.params).toHaveLength(2);
      expect(result!.params[0]).toMatchObject({
        name: 'greeting',
        type: 'string',
        required: true,
      });
      expect(result!.params[1]).toMatchObject({
        name: 'count',
        type: 'number',
        required: true,
      });
    });

    it('prints unspecified container parameter types as bare names', () => {
      const ast = parse(
        'fn(a: list(any), b: stream(any):any, c: stream(number):any, d: dict(), e: tuple(any)) { $a } => $run'
      );
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.params.map((p) => p.type)).toEqual([
        'list',
        'stream',
        'stream(number)',
        'dict',
        'tuple(any)',
      ]);
    });

    it('uses any for untyped parameters', () => {
      const ast = parse('fn(x) { $x } => $run');
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.params[0]).toMatchObject({
        name: 'x',
        type: 'any',
        required: true,
      });
    });

    it('marks parameters with defaults as not required', () => {
      const ast = parse('fn(name: string = "world") { $name } => $run');
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.params[0]).toMatchObject({
        name: 'name',
        type: 'string',
        required: false,
        defaultValue: 'world',
      });
    });

    it('extracts number default values', () => {
      const ast = parse('fn(count: number = 42) { $count } => $run');
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.params[0]!.defaultValue).toBe(42);
    });

    it('extracts boolean default values', () => {
      const ast = parse('fn(flag: bool = true) { $flag } => $run');
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.params[0]!.defaultValue).toBe(true);
    });

    it('handles union types', () => {
      const ast = parse('fn(value: union(string, number)) { $value } => $run');
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.params[0]!.type).toBe('union(string, number)');
    });
  });

  describe('parameter descriptions', () => {
    it('extracts parameter description from annotation', () => {
      const source =
        'fn(^(description: "The user name") name: string) { $name } => $run';
      const ast = parse(source);
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.params[0]!.description).toBe('The user name');
    });

    it('omits description when no annotation present', () => {
      const ast = parse('fn(name: string) { $name } => $run');
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.params[0]!.description).toBeUndefined();
    });
  });

  describe('fn-level description', () => {
    it('extracts description from annotated statement', () => {
      const source =
        '^(description: "Greets the user") fn(name: string) { $name } => $run';
      const ast = parse(source);
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.description).toBe('Greets the user');
    });

    it('omits description when statement has no annotation', () => {
      const ast = parse('fn(name: string) { $name } => $run');
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.description).toBeUndefined();
    });
  });

  describe('fn in pipes', () => {
    it('finds fn piped into a capture', () => {
      const source = 'fn(name: string) { $name } => $run';
      const ast = parse(source);
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.params).toHaveLength(1);
    });
  });

  describe('zero-parameter closures', () => {
    it('handles fn with no parameters', () => {
      const ast = parse('fn() { "hello" } => $run');
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.params).toHaveLength(0);
    });
  });

  describe('returnType field', () => {
    it('emits returnType for a scalar TypeRef annotation', () => {
      const ast = parse('fn(name: string):string { $name } => $run');
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.returnType).toBe('string');
    });

    it('emits returnType for a parameterized TypeRef annotation', () => {
      const ast = parse('fn(items: list):list(string) { $items } => $run');
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.returnType).toBe('list(string)');
    });

    it('emits returnType for a stream annotation with chunk type only', () => {
      const ast = parse('fn():stream(string) { "hello" -> yield } => $run');
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.returnType).toBe('stream(string)');
    });

    it('emits returnType for a stream annotation with chunk and resolution types', () => {
      const ast = parse(
        'fn():stream(string):number { "hello" -> yield\n42 } => $run'
      );
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.returnType).toBe('stream(string):number');
    });

    it('omits returnType when no return type annotation is present', () => {
      const ast = parse('fn(name: string) { $name } => $run');
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.returnType).toBeUndefined();
      expect('returnType' in result!).toBe(false);
    });
  });
});
