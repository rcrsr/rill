/**
 * Rill Runtime Tests: Annotations
 * Tests for statement annotations with ^(key: value) syntax.
 */

import { describe, expect, it } from 'vitest';
import { parse } from '../src/index.js';
import { run } from './helpers/runtime.js';

describe('Rill Runtime: Annotations', () => {
  describe('Parsing', () => {
    it('parses basic annotation', () => {
      const ast = parse('^(limit: 10) "hello"');
      expect(ast.statements).toHaveLength(1);
      expect(ast.statements[0]?.type).toBe('AnnotatedStatement');
    });

    it('parses multiple annotation arguments', () => {
      const ast = parse('^(limit: 10, timeout: 30) "hello"');
      const stmt = ast.statements[0];
      expect(stmt?.type).toBe('AnnotatedStatement');
      if (stmt?.type === 'AnnotatedStatement') {
        expect(stmt.annotations).toHaveLength(2);
      }
    });

    it('parses annotation with expression value', () => {
      const ast = parse('^(limit: 5 + 5) "hello"');
      expect(ast.statements[0]?.type).toBe('AnnotatedStatement');
    });

    it('parses annotation with variable value', () => {
      const ast = parse('10 -> $n\n^(limit: $n) "hello"');
      expect(ast.statements[1]?.type).toBe('AnnotatedStatement');
    });

    it('parses spread annotation', () => {
      const ast = parse('[limit: 10] -> $opts\n^(*$opts) "hello"');
      const stmt = ast.statements[1];
      expect(stmt?.type).toBe('AnnotatedStatement');
      if (stmt?.type === 'AnnotatedStatement') {
        expect(stmt.annotations[0]?.type).toBe('SpreadArg');
      }
    });
  });

  describe('Execution', () => {
    it('executes annotated statement normally', async () => {
      const result = await run('^(limit: 10) "hello"');
      expect(result).toBe('hello');
    });

    it('evaluates annotation values', async () => {
      const result = await run('^(limit: 5 + 5) "hello"');
      expect(result).toBe('hello');
    });

    it('evaluates annotation variables', async () => {
      const result = await run('10 -> $n\n^(limit: $n) "hello"');
      expect(result).toBe('hello');
    });

    it('spreads dict as annotations', async () => {
      const result = await run('[limit: 10] -> $opts\n^(*$opts) "hello"');
      expect(result).toBe('hello');
    });

    it('ignores unknown annotations', async () => {
      const result = await run('^(unknown_annotation: 42) "hello"');
      expect(result).toBe('hello');
    });
  });

  describe('Limit Annotation', () => {
    it('allows loops within limit', async () => {
      // Uses $ as accumulator (block scoping: variables don't leak)
      const script = `
        ^(limit: 5) 0 -> ($ < 3) @ { $ + 1 }
      `;
      expect(await run(script)).toBe(3);
    });

    it('throws when while loop exceeds limit', async () => {
      // Uses $ as accumulator
      const script = `
        ^(limit: 3) 0 -> ($ < 100) @ { $ + 1 }
      `;
      await expect(run(script)).rejects.toThrow(/exceeded 3 iterations/);
    });

    it('uses default limit when not specified', async () => {
      // This should succeed because default is 10000
      // Uses $ as accumulator
      const script = `
        0 -> ($ < 100) @ { $ + 1 }
      `;
      expect(await run(script)).toBe(100);
    });

    it('allows for-each loops within limit', async () => {
      const script = `
        ^(limit: 10) [1, 2, 3] @ { $ }
      `;
      expect(await run(script)).toEqual([1, 2, 3]);
    });

    it('ignores non-positive limit values', async () => {
      // Should use default instead of 0 or negative
      // Uses $ as accumulator
      const script = `
        ^(limit: -5) 0 -> ($ < 100) @ { $ + 1 }
      `;
      expect(await run(script)).toBe(100);
    });

    it('floors fractional limit values', async () => {
      // Uses $ as accumulator
      const script = `
        ^(limit: 3.9) 0 -> ($ < 100) @ { $ + 1 }
      `;
      await expect(run(script)).rejects.toThrow(/exceeded 3 iterations/);
    });
  });

  describe('Annotation Inheritance', () => {
    it('inner annotations override outer', async () => {
      // Inner limit of 2 should take precedence
      // Uses $ as accumulator
      const script = `
        ^(limit: 100) {
          ^(limit: 2) 0 -> ($ < 10) @ { $ + 1 }
        }
      `;
      await expect(run(script)).rejects.toThrow(/exceeded 2 iterations/);
    });

    it('inner scope inherits outer annotations', async () => {
      // This test verifies that limit applies in nested scopes
      // Uses $ as accumulator
      const script = `
        ^(limit: 3) {
          0 -> ($ < 10) @ { $ + 1 }
        }
      `;
      await expect(run(script)).rejects.toThrow(/exceeded 3 iterations/);
    });

    it('annotations are scoped and do not leak', async () => {
      // After the annotated block, default limit should apply
      // Uses $ as accumulator
      const script = `
        ^(limit: 1000) {
          0 -> ($ < 5) @ { $ + 1 }
        }
        0 -> ($ < 100) @ { $ + 1 }
      `;
      // Should succeed - second loop uses default limit
      expect(await run(script)).toBe(100);
    });
  });

  describe('Annotations with Various Statements', () => {
    it('works with pipe chains', async () => {
      const script = `
        ^(limit: 5) [1, 2, 3] -> @ { $ } -> .len
      `;
      expect(await run(script)).toBe(3);
    });

    it('works with conditionals', async () => {
      const script = `
        ^(limit: 5) true ? "yes" ! "no"
      `;
      expect(await run(script)).toBe('yes');
    });

    it('works with blocks', async () => {
      const script = `
        ^(limit: 5) {
          1 -> $a
          2 -> $b
          $a + $b
        }
      `;
      expect(await run(script)).toBe(3);
    });
  });
});
