/**
 * Rill Parser Syntax Error Tests
 * Tests for parser-level syntax validation
 */

import { describe, expect, it } from 'vitest';
import { parse, ParseError } from '../../src/index.js';
import type { ScriptNode, DictNode, StatementNode } from '../../src/types.js';

describe('Parser Syntax Errors', () => {
  describe('Dict literal key validation - Success Cases', () => {
    it('parses dict with number key to DictNode (AC-1)', () => {
      const source = '[1: "one"]';
      const ast = parse(source) as ScriptNode;
      expect(ast.type).toBe('Script');

      // Navigate to Dict node through AST structure
      const statement = ast.statements[0] as StatementNode;
      const pipeChain = statement.expression;
      const postfixExpr = pipeChain.head;
      const dictNode = postfixExpr.primary as DictNode;

      expect(dictNode.type).toBe('Dict');
      expect(dictNode.entries).toHaveLength(1);
      expect(typeof dictNode.entries[0].key).toBe('number');
      expect(dictNode.entries[0].key).toBe(1);
    });

    it('parses dict with boolean keys to DictNode (AC-2)', () => {
      const source = '[true: "yes", false: "no"]';
      const ast = parse(source) as ScriptNode;

      const statement = ast.statements[0] as StatementNode;
      const pipeChain = statement.expression;
      const postfixExpr = pipeChain.head;
      const dictNode = postfixExpr.primary as DictNode;

      expect(dictNode.type).toBe('Dict');
      expect(dictNode.entries).toHaveLength(2);
      expect(typeof dictNode.entries[0].key).toBe('boolean');
      expect(dictNode.entries[0].key).toBe(true);
      expect(typeof dictNode.entries[1].key).toBe('boolean');
      expect(dictNode.entries[1].key).toBe(false);
    });

    it('parses dict with identifier key (AC-5, backward compatibility)', () => {
      const source = '[name: "alice"]';
      const ast = parse(source) as ScriptNode;

      const statement = ast.statements[0] as StatementNode;
      const pipeChain = statement.expression;
      const postfixExpr = pipeChain.head;
      const dictNode = postfixExpr.primary as DictNode;

      expect(dictNode.type).toBe('Dict');
      expect(dictNode.entries).toHaveLength(1);
      expect(typeof dictNode.entries[0].key).toBe('string');
      expect(dictNode.entries[0].key).toBe('name');
    });

    it('parses dict with positive integer number key', () => {
      const source = '[42: "answer"]';
      const ast = parse(source) as ScriptNode;

      const statement = ast.statements[0] as StatementNode;
      const pipeChain = statement.expression;
      const postfixExpr = pipeChain.head;
      const dictNode = postfixExpr.primary as DictNode;

      expect(dictNode.type).toBe('Dict');
      expect(dictNode.entries).toHaveLength(1);
      expect(typeof dictNode.entries[0].key).toBe('number');
      expect(dictNode.entries[0].key).toBe(42);
    });

    it('parses dict with decimal number key (AC-10)', () => {
      const source = '[3.14: "pi"]';
      const ast = parse(source) as ScriptNode;

      const statement = ast.statements[0] as StatementNode;
      const pipeChain = statement.expression;
      const postfixExpr = pipeChain.head;
      const dictNode = postfixExpr.primary as DictNode;

      expect(dictNode.type).toBe('Dict');
      expect(dictNode.entries).toHaveLength(1);
      expect(typeof dictNode.entries[0].key).toBe('number');
      expect(dictNode.entries[0].key).toBe(3.14);
    });

    it('parses dict with mixed key types', () => {
      const source = '[name: "alice", 1: "one", true: "yes"]';
      const ast = parse(source) as ScriptNode;

      const statement = ast.statements[0] as StatementNode;
      const pipeChain = statement.expression;
      const postfixExpr = pipeChain.head;
      const dictNode = postfixExpr.primary as DictNode;

      expect(dictNode.type).toBe('Dict');
      expect(dictNode.entries).toHaveLength(3);
      expect(dictNode.entries[0].key).toBe('name');
      expect(dictNode.entries[1].key).toBe(1);
      expect(dictNode.entries[2].key).toBe(true);
    });

    it('parses dict with negative number key', () => {
      // Negative numbers are now supported as dict keys
      const source = '[-1: "negative", 0: "zero", 1: "positive"]';
      const ast = parse(source);
      expect(ast.type).toBe('Script');
      const stmt = ast.statements[0];
      expect(stmt.type).toBe('Statement');
      const dictNode = stmt.expression.head.primary as DictNode;
      expect(dictNode.type).toBe('Dict');
      expect(dictNode.entries).toHaveLength(3);
      expect(dictNode.entries[0].key).toBe(-1);
      expect(dictNode.entries[1].key).toBe(0);
      expect(dictNode.entries[2].key).toBe(1);
    });
  });

  describe('Dict literal key validation - Error Cases', () => {
    it('rejects dict as multi-key', () => {
      // EC-2: Multi-key must be a list, not a dict
      const source = '"x" -> [[a: "dict"]: "val"]';

      try {
        parse(source);
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const parseErr = err as ParseError;

        expect(parseErr.message).toContain(
          'Dict entry key must be identifier or list, not dict'
        );
      }
    });

    it('rejects nested dict as multi-key', () => {
      const source = '[[nested: [deep: "val"]]: "result"]';

      try {
        parse(source);
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const parseErr = err as ParseError;

        expect(parseErr.message).toContain(
          'Dict entry key must be identifier or list, not dict'
        );
      }
    });

    it('accepts list as multi-key', () => {
      // Valid: list literal as multi-key
      const source = '[["a", "b"]: "val"]';
      const ast = parse(source);
      expect(ast.type).toBe('Script');
    });

    it('accepts identifier as single key', () => {
      // Valid: identifier as single key
      const source = '[a: "val"]';
      const ast = parse(source);
      expect(ast.type).toBe('Script');
    });

    it('rejects invalid token at key position (EC-1)', () => {
      // EC-1: After a valid dict entry, subsequent entries must also be valid keys
      // Using a closure as a key should fail
      const source = '[a: 1, ||($): "val"]';

      try {
        parse(source);
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const parseErr = err as ParseError;

        expect(parseErr.message).toContain(
          'Dict key must be identifier, string, number, or boolean'
        );
      }
    });

    it('rejects missing colon after key (EC-3)', () => {
      // EC-3: Colon is required after dict key
      // First entry establishes this is a dict, second entry missing colon
      const source = '[a: 1, b "val"]';

      try {
        parse(source);
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const parseErr = err as ParseError;

        expect(parseErr.message).toContain('Expected :');
      }
    });
  });

  describe('Negation operator without operand', () => {
    it('rejects bare negation operator with helpful message', () => {
      const source = '"hello" -> !';

      try {
        parse(source);
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const parseErr = err as ParseError;

        expect(parseErr.message).toContain(
          'Negation operator requires an operand'
        );
        expect(parseErr.message).toContain(
          'Use prefix syntax: !expr or (!expr)'
        );
      }
    });

    it('rejects bare negation in grouping with helpful message', () => {
      const source = '($value -> !) @ { $ }';

      try {
        parse(source);
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const parseErr = err as ParseError;

        expect(parseErr.message).toContain(
          'Negation operator requires an operand'
        );
      }
    });

    it('accepts negation with operand', () => {
      // Valid: negation with operand
      const source1 = '!true';
      const ast1 = parse(source1);
      expect(ast1.type).toBe('Script');

      const source2 = '(!true)';
      const ast2 = parse(source2);
      expect(ast2.type).toBe('Script');

      const source3 = 'true -> !false';
      const ast3 = parse(source3);
      expect(ast3.type).toBe('Script');

      const source4 = 'true -> ! { $ }';
      const ast4 = parse(source4);
      expect(ast4.type).toBe('Script');
    });
  });
});
