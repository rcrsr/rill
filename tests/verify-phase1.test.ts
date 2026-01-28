/**
 * Phase 1 Verification: Error Statement Parsing
 * Verify that error statements parse correctly to ErrorNode
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../src/index.js';
import type {
  ErrorNode,
  ScriptNode,
  StatementNode,
  PipeChainNode,
} from '../src/types.js';

describe('Phase 1: Error Statement Parsing', () => {
  describe('error keyword form', () => {
    it('parses error with string literal', () => {
      const source = 'error "test"';
      const result = parse(source);

      expect(result.type).toBe('Script');
      const script = result as ScriptNode;
      expect(script.statements.length).toBe(1);

      const stmt = script.statements[0] as StatementNode;
      expect(stmt.type).toBe('Statement');

      const pipeChain = stmt.expression as PipeChainNode;
      expect(pipeChain.type).toBe('PipeChain');

      const postfix = pipeChain.head;
      expect(postfix.type).toBe('PostfixExpr');

      const errorNode = postfix.primary as ErrorNode;
      expect(errorNode.type).toBe('Error');
      expect(errorNode.message.type).toBe('StringLiteral');
      expect(errorNode.message.parts.length).toBe(1);
      expect(errorNode.message.parts[0]).toBe('test');
    });

    it('parses error with interpolated string', () => {
      const source = 'error "failed: {$reason}"';
      const result = parse(source);

      const script = result as ScriptNode;
      const stmt = script.statements[0] as StatementNode;
      const pipeChain = stmt.expression as PipeChainNode;
      const errorNode = pipeChain.head.primary as ErrorNode;

      expect(errorNode.type).toBe('Error');
      expect(errorNode.message.type).toBe('StringLiteral');
      expect(errorNode.message.parts.length).toBe(2);
    });
  });

  describe('multiline strings', () => {
    it('parses error with multiline string', () => {
      const source = `error """
multi
line
error
"""`;
      const result = parse(source);

      const script = result as ScriptNode;
      const stmt = script.statements[0] as StatementNode;
      const pipeChain = stmt.expression as PipeChainNode;
      const errorNode = pipeChain.head.primary as ErrorNode;

      expect(errorNode.type).toBe('Error');
      expect(errorNode.message.type).toBe('StringLiteral');
      expect(errorNode.message.isMultiline).toBe(true);
      const firstPart = errorNode.message.parts[0];
      expect(typeof firstPart).toBe('string');
      expect(firstPart).toContain('multi');
    });
  });

  describe('type check', () => {
    it('ErrorNode interface matches specification', () => {
      const source = 'error "test"';
      const result = parse(source) as ScriptNode;
      const stmt = result.statements[0] as StatementNode;
      const pipeChain = stmt.expression as PipeChainNode;
      const errorNode = pipeChain.head.primary as ErrorNode;

      // Verify ErrorNode structure matches IR-1 specification
      expect(errorNode).toHaveProperty('type');
      expect(errorNode).toHaveProperty('message');
      expect(errorNode).toHaveProperty('span');

      expect(errorNode.type).toBe('Error');
      expect(errorNode.message.type).toBe('StringLiteral');
    });
  });
});
