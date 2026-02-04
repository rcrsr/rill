/**
 * Parser Tests: PostfixExprNode defaultValue field
 * Tests that the parser correctly sets defaultValue when ?? follows postfix expressions
 */

import { describe, expect, it } from 'vitest';
import { parse } from '../src/index.js';
import type {
  PostfixExprNode,
  PipeChainNode,
  StatementNode,
} from '../src/types.js';

describe('Parser: PostfixExprNode defaultValue', () => {
  describe('Parsing ?? after postfix expressions', () => {
    it('parses get_data().status ?? "default"', () => {
      const ast = parse('get_data().status ?? "default"');
      const stmt = ast.statements[0] as StatementNode;
      const chain = stmt.expression as PipeChainNode;
      const postfix = chain.head as PostfixExprNode;

      expect(postfix.type).toBe('PostfixExpr');
      expect(postfix.defaultValue).not.toBeNull();
      expect(postfix.defaultValue?.type).toBe('PipeChain');
    });

    it('parses api().result.nested ?? 0', () => {
      const ast = parse('api().result.nested ?? 0');
      const stmt = ast.statements[0] as StatementNode;
      const chain = stmt.expression as PipeChainNode;
      const postfix = chain.head as PostfixExprNode;

      expect(postfix.defaultValue).not.toBeNull();
    });

    it('parses func().field ?? [a: 1]', () => {
      const ast = parse('func().field ?? [a: 1]');
      const stmt = ast.statements[0] as StatementNode;
      const chain = stmt.expression as PipeChainNode;
      const postfix = chain.head as PostfixExprNode;

      expect(postfix.defaultValue).not.toBeNull();
      expect(postfix.defaultValue?.type).toBe('PipeChain');
    });

    it('parses func().x ?? ""', () => {
      const ast = parse('func().x ?? ""');
      const stmt = ast.statements[0] as StatementNode;
      const chain = stmt.expression as PipeChainNode;
      const postfix = chain.head as PostfixExprNode;

      expect(postfix.defaultValue).not.toBeNull();
    });

    it('parses deeply nested: a().b().c().d ?? 0', () => {
      const ast = parse('a().b().c().d ?? 0');
      const stmt = ast.statements[0] as StatementNode;
      const chain = stmt.expression as PipeChainNode;
      const postfix = chain.head as PostfixExprNode;

      expect(postfix.defaultValue).not.toBeNull();
    });

    it('parses complex default expression: f().x ?? (1 + 2 * 3)', () => {
      const ast = parse('f().x ?? (1 + 2 * 3)');
      const stmt = ast.statements[0] as StatementNode;
      const chain = stmt.expression as PipeChainNode;
      const postfix = chain.head as PostfixExprNode;

      expect(postfix.defaultValue).not.toBeNull();
      expect(postfix.defaultValue?.type).toBe('PipeChain');
    });
  });

  describe('No defaultValue when ?? not present', () => {
    it('sets defaultValue to null when no ??', () => {
      const ast = parse('func().field');
      const stmt = ast.statements[0] as StatementNode;
      const chain = stmt.expression as PipeChainNode;
      const postfix = chain.head as PostfixExprNode;

      expect(postfix.defaultValue).toBeNull();
    });
  });

  describe('Error cases', () => {
    it('throws on ?? without left operand', () => {
      expect(() => parse('?? "orphan"')).toThrow();
    });
  });
});
