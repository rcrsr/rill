/**
 * Parser Span Tests
 * Verify that AST node spans correctly represent source code ranges
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../../src/index.js';

describe('Parser Spans', () => {
  describe('Block spans', () => {
    it('does not include capture operator after block', () => {
      const source = '{ 42 } => $x';
      const ast = parse(source);

      // Find the Block node
      function findBlock(node: unknown): unknown | null {
        if (!node || typeof node !== 'object') return null;
        if ('type' in node && node.type === 'Block') return node;
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) {
            for (const item of value) {
              const found = findBlock(item);
              if (found) return found;
            }
          } else {
            const found = findBlock(value);
            if (found) return found;
          }
        }
        return null;
      }

      const block = findBlock(ast);
      expect(block).toBeTruthy();
      expect(block).toHaveProperty('span');

      // Extract the block content using its span
      const span = (
        block as {
          span: { start: { offset: number }; end: { offset: number } };
        }
      ).span;
      const blockContent = source.substring(span.start.offset, span.end.offset);

      // Block should be exactly "{ 42 }", not including " => $x"
      expect(blockContent).toBe('{ 42 }');
    });

    it('does not include whitespace or operators after closing brace', () => {
      const source = '{ $x + 1 } => $result';
      const ast = parse(source);

      function findBlock(node: unknown): unknown | null {
        if (!node || typeof node !== 'object') return null;
        if ('type' in node && node.type === 'Block') return node;
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) {
            for (const item of value) {
              const found = findBlock(item);
              if (found) return found;
            }
          } else {
            const found = findBlock(value);
            if (found) return found;
          }
        }
        return null;
      }

      const block = findBlock(ast);
      expect(block).toBeTruthy();

      const span = (
        block as {
          span: { start: { offset: number }; end: { offset: number } };
        }
      ).span;
      const blockContent = source.substring(span.start.offset, span.end.offset);

      expect(blockContent).toBe('{ $x + 1 }');
    });
  });

  describe('Closure spans', () => {
    it('does not include capture operator after closure', () => {
      const source = '|x| { $x + 1 } => $fn';
      const ast = parse(source);

      function findClosure(node: unknown): unknown | null {
        if (!node || typeof node !== 'object') return null;
        if ('type' in node && node.type === 'Closure') return node;
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) {
            for (const item of value) {
              const found = findClosure(item);
              if (found) return found;
            }
          } else {
            const found = findClosure(value);
            if (found) return found;
          }
        }
        return null;
      }

      const closure = findClosure(ast);
      expect(closure).toBeTruthy();

      const span = (
        closure as {
          span: { start: { offset: number }; end: { offset: number } };
        }
      ).span;
      const closureContent = source.substring(
        span.start.offset,
        span.end.offset
      );

      // Closure should be exactly "|x| { $x + 1 }", not including " => $fn"
      expect(closureContent).toBe('|x| { $x + 1 }');
    });

    it('closure body span ends at closing brace', () => {
      const source = '|x| { $x } => $fn';
      const ast = parse(source);

      function findClosure(node: unknown): unknown | null {
        if (!node || typeof node !== 'object') return null;
        if ('type' in node && node.type === 'Closure') return node;
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) {
            for (const item of value) {
              const found = findClosure(item);
              if (found) return found;
            }
          } else {
            const found = findClosure(value);
            if (found) return found;
          }
        }
        return null;
      }

      const closure = findClosure(ast) as {
        body: { span: { start: { offset: number }; end: { offset: number } } };
      };
      expect(closure).toBeTruthy();
      expect(closure.body).toBeTruthy();

      const bodySpan = closure.body.span;
      const bodyContent = source.substring(
        bodySpan.start.offset,
        bodySpan.end.offset
      );

      // Body (which is a Block) should be "{ $x }"
      expect(bodyContent).toBe('{ $x }');
    });

    it('||{ } closure spans correctly', () => {
      const source = '||{ 42 } => $fn';
      const ast = parse(source);

      function findClosure(node: unknown): unknown | null {
        if (!node || typeof node !== 'object') return null;
        if ('type' in node && node.type === 'Closure') return node;
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) {
            for (const item of value) {
              const found = findClosure(item);
              if (found) return found;
            }
          } else {
            const found = findClosure(value);
            if (found) return found;
          }
        }
        return null;
      }

      const closure = findClosure(ast);
      expect(closure).toBeTruthy();

      const span = (
        closure as {
          span: { start: { offset: number }; end: { offset: number } };
        }
      ).span;
      const closureContent = source.substring(
        span.start.offset,
        span.end.offset
      );

      expect(closureContent).toBe('||{ 42 }');
    });
  });

  describe('Nested structures', () => {
    it('nested blocks have correct spans', () => {
      const source = '{ { 1 } => $x\n$x }';
      const ast = parse(source);

      function findAllBlocks(node: unknown): unknown[] {
        if (!node || typeof node !== 'object') return [];
        const blocks: unknown[] = [];
        if ('type' in node && node.type === 'Block') {
          blocks.push(node);
        }
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) {
            for (const item of value) {
              blocks.push(...findAllBlocks(item));
            }
          } else {
            blocks.push(...findAllBlocks(value));
          }
        }
        return blocks;
      }

      const blocks = findAllBlocks(ast);
      expect(blocks.length).toBe(2); // Outer and inner block

      // Outer block
      const outerSpan = (
        blocks[0] as {
          span: { start: { offset: number }; end: { offset: number } };
        }
      ).span;
      const outerContent = source.substring(
        outerSpan.start.offset,
        outerSpan.end.offset
      );
      expect(outerContent).toBe('{ { 1 } => $x\n$x }');

      // Inner block
      const innerSpan = (
        blocks[1] as {
          span: { start: { offset: number }; end: { offset: number } };
        }
      ).span;
      const innerContent = source.substring(
        innerSpan.start.offset,
        innerSpan.end.offset
      );
      expect(innerContent).toBe('{ 1 }');
    });
  });
});
