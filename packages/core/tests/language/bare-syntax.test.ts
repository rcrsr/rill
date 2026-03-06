/**
 * Bare Syntax Tests
 * Tests for bare bracket syntax where `list[...]` → `[...]` and `dict[...]` → `[...]`.
 * Only covers behavior that differs from the explicit keyword form.
 */

import { describe, expect, it } from 'vitest';
import { parse, ParseError } from '@rcrsr/rill';

describe('Bare Syntax', () => {
  describe('list disambiguation', () => {
    it('[1] is a valid bare list (no EC-3 in bare form)', () => {
      const ast = parse('[1]');
      expect(ast).toBeDefined();
    });
  });

  describe('dict key position disambiguation', () => {
    it('rejects dict-like content as multi-key in bare form', () => {
      // In bare form, [a: "dict"] in key position is parsed as a list
      // and fails because a: is not a valid list element
      expect(() => parse('"x" -> [[a: "dict"]: "val"]')).toThrow(ParseError);
    });

    it('rejects nested dict-like content as multi-key in bare form', () => {
      expect(() => parse('[[nested: [deep: "val"]]: "result"]')).toThrow(
        ParseError
      );
    });
  });
});
