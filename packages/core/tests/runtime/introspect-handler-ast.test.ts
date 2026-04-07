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
      const ast = parse('|name: string| { "hi" } => $run');
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
        |name: string| { "hi" } => $run
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
      const ast = parse('|greeting: string, count: number| { "hi" } => $run');
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

    it('uses any for untyped parameters', () => {
      const ast = parse('|x| { $x } => $run');
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.params[0]).toMatchObject({
        name: 'x',
        type: 'any',
        required: true,
      });
    });

    it('marks parameters with defaults as not required', () => {
      const ast = parse('|name: string = "world"| { $name } => $run');
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
      const ast = parse('|count: number = 42| { $count } => $run');
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.params[0]!.defaultValue).toBe(42);
    });

    it('extracts boolean default values', () => {
      const ast = parse('|flag: bool = true| { $flag } => $run');
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.params[0]!.defaultValue).toBe(true);
    });

    it('handles union types', () => {
      const ast = parse('|value: string | number| { $value } => $run');
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.params[0]!.type).toBe('string | number');
    });
  });

  describe('parameter descriptions', () => {
    it('extracts parameter description from annotation', () => {
      const source =
        '|^(description: "The user name") name: string| { $name } => $run';
      const ast = parse(source);
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.params[0]!.description).toBe('The user name');
    });

    it('omits description when no annotation present', () => {
      const ast = parse('|name: string| { $name } => $run');
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.params[0]!.description).toBeUndefined();
    });
  });

  describe('closure-level description', () => {
    it('extracts description from annotated statement', () => {
      const source =
        '^(description: "Greets the user") |name: string| { $name } => $run';
      const ast = parse(source);
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.description).toBe('Greets the user');
    });

    it('omits description when statement has no annotation', () => {
      const ast = parse('|name: string| { $name } => $run');
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.description).toBeUndefined();
    });
  });

  describe('closure in pipes', () => {
    it('finds closure piped into a capture', () => {
      const source = '|name: string| { $name } => $run';
      const ast = parse(source);
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.params).toHaveLength(1);
    });
  });

  describe('zero-parameter closures', () => {
    it('handles closure with no parameters', () => {
      const ast = parse('|| { "hello" } => $run');
      const result = introspectHandlerFromAST(ast, 'run');
      expect(result).not.toBeNull();
      expect(result!.params).toHaveLength(0);
    });
  });
});
