/**
 * Rill Language Tests: Pass Keyword Parsing Integration
 * Tests for parsing pass in various contexts (AC-10 through AC-18)
 */

import { describe, expect, it } from 'vitest';

import { parse } from '../../src/index.js';

describe('Rill Language: Pass Keyword Parsing', () => {
  describe('Pass in Dict Values', () => {
    it('parses pass as dict value (AC-10)', () => {
      const ast = parse('["done": pass]');
      expect(ast.type).toBe('Script');
      expect(ast.statements).toHaveLength(1);

      const stmt = ast.statements[0]!;
      expect(stmt.type).toBe('Statement');
      expect(stmt.expression.type).toBe('PipeChain');

      const head = stmt.expression.head;
      expect(head.type).toBe('PostfixExpr');
      expect(head.primary.type).toBe('Dict');

      const dict = head.primary;
      expect(dict.entries).toHaveLength(1);
      expect(dict.entries[0]!.key).toBe('done');
      expect(dict.entries[0]!.value.type).toBe('PipeChain');
      expect(dict.entries[0]!.value.head.type).toBe('PostfixExpr');
      expect(dict.entries[0]!.value.head.primary.type).toBe('Pass');
    });

    it('parses multiple pass values in dict (AC-16)', () => {
      const ast = parse('[a: pass, b: pass]');
      expect(ast.type).toBe('Script');

      const stmt = ast.statements[0]!;
      const dict = stmt.expression.head.primary;
      expect(dict.type).toBe('Dict');
      expect(dict.entries).toHaveLength(2);

      // First entry
      expect(dict.entries[0]!.key).toBe('a');
      expect(dict.entries[0]!.value.head.primary.type).toBe('Pass');

      // Second entry
      expect(dict.entries[1]!.key).toBe('b');
      expect(dict.entries[1]!.value.head.primary.type).toBe('Pass');
    });
  });

  describe('Pass in Conditionals', () => {
    it('parses pass in conditional then branch (AC-11)', () => {
      const ast = parse('true ? pass ! "fallback"');
      expect(ast.type).toBe('Script');

      const stmt = ast.statements[0]!;
      expect(stmt.expression.type).toBe('PipeChain');

      const head = stmt.expression.head;
      expect(head.type).toBe('PostfixExpr');
      expect(head.primary.type).toBe('Conditional');

      const conditional = head.primary;
      // thenBranch is a BodyNode (PostfixExpr in this case)
      expect(conditional.thenBranch.type).toBe('PostfixExpr');
      expect(conditional.thenBranch.primary.type).toBe('Pass');
    });

    it('parses pass in nested conditional (AC-17)', () => {
      const ast = parse('($ > 0) ? (($ < 10) ? pass ! 10) ! 0');
      expect(ast.type).toBe('Script');

      const stmt = ast.statements[0]!;
      const outerConditional = stmt.expression.head.primary;
      expect(outerConditional.type).toBe('Conditional');

      // thenBranch is a GroupedExpr containing inner conditional
      const thenBranch = outerConditional.thenBranch;
      expect(thenBranch.type).toBe('GroupedExpr');
      expect(thenBranch.expression.head.primary.type).toBe('Conditional');

      const innerConditional = thenBranch.expression.head.primary;
      expect(innerConditional.thenBranch.type).toBe('PostfixExpr');
      expect(innerConditional.thenBranch.primary.type).toBe('Pass');
    });
  });

  describe('Pass in Collection Operators', () => {
    it('parses pass in map body (AC-12)', () => {
      const ast = parse('$items -> map { ($ > 0) ? pass ! 0 }');
      expect(ast.type).toBe('Script');

      const stmt = ast.statements[0]!;
      expect(stmt.expression.type).toBe('PipeChain');
      expect(stmt.expression.pipes).toHaveLength(1);

      const mapExpr = stmt.expression.pipes[0]!;
      expect(mapExpr.type).toBe('MapExpr');

      const mapBody = mapExpr.body;
      expect(mapBody.type).toBe('Block');
      expect(mapBody.statements).toHaveLength(1);

      const conditional = mapBody.statements[0]!.expression.head.primary;
      expect(conditional.type).toBe('Conditional');
      expect(conditional.thenBranch.type).toBe('PostfixExpr');
      expect(conditional.thenBranch.primary.type).toBe('Pass');
    });
  });

  describe('Pass as Dispatch Value', () => {
    it('parses pass as only dispatch value (AC-18)', () => {
      const ast = parse('$x -> ["match": pass]');
      expect(ast.type).toBe('Script');

      const stmt = ast.statements[0]!;
      expect(stmt.expression.type).toBe('PipeChain');
      expect(stmt.expression.pipes).toHaveLength(1);

      const dict = stmt.expression.pipes[0]!;
      expect(dict.type).toBe('Dict');
      expect(dict.entries).toHaveLength(1);
      expect(dict.entries[0]!.value.head.primary.type).toBe('Pass');
    });
  });

  describe('Pass as Primary Expression', () => {
    it('parses standalone pass', () => {
      const ast = parse('pass');
      expect(ast.type).toBe('Script');

      const stmt = ast.statements[0]!;
      expect(stmt.expression.head.primary.type).toBe('Pass');
    });

    it('parses pass in list', () => {
      const ast = parse('[pass, pass]');
      expect(ast.type).toBe('Script');

      const stmt = ast.statements[0]!;
      const tuple = stmt.expression.head.primary;
      expect(tuple.type).toBe('Tuple');
      expect(tuple.elements).toHaveLength(2);
      expect(tuple.elements[0]!.head.primary.type).toBe('Pass');
      expect(tuple.elements[1]!.head.primary.type).toBe('Pass');
    });

    it('parses pass piped to method', () => {
      const ast = parse('pass -> .str');
      expect(ast.type).toBe('Script');

      const stmt = ast.statements[0]!;
      expect(stmt.expression.head.primary.type).toBe('Pass');
      expect(stmt.expression.pipes).toHaveLength(1);
      expect(stmt.expression.pipes[0]!.type).toBe('MethodCall');
    });
  });
});
