/**
 * Rill Parser Syntax Error Tests
 * Tests for parser-level syntax validation
 */

import { describe, expect, it } from 'vitest';
import { parse, ParseError } from '../../src/index.js';

describe('Parser Syntax Errors', () => {
  describe('Dict literal key validation', () => {
    it('rejects dict as multi-key', () => {
      // AC-31, EC-13: Multi-key must be a list, not a dict
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
  });
});
