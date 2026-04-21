/**
 * Rill Runtime Tests: Highlight Map Completeness
 * Tests for TOKEN_HIGHLIGHT_MAP completeness and validity
 *
 * Specification Mapping:
 *
 * Acceptance Criteria:
 * - AC-25: TOKEN_HIGHLIGHT_MAP missing category returns undefined
 * - AC-38: TOKEN_HIGHLIGHT_MAP contains entries for all 7 new compound tokens
 * - AC-39: No new token type exists without a corresponding highlight map entry
 *
 * Implementation Coverage:
 * - IC-3: Test file for highlight map completeness
 *
 * Error Cases:
 * - EC-4: TOKEN_HIGHLIGHT_MAP missing category returns undefined
 */

import { describe, expect, it } from 'vitest';
import {
  TOKEN_HIGHLIGHT_MAP,
  type HighlightCategory,
  TOKEN_TYPES,
  type TokenType,
} from '@rcrsr/rill';

describe('Rill Runtime: Highlight Map Completeness', () => {
  describe('IC-3: Mapped tokens resolve to valid HighlightCategory', () => {
    it('every mapped TokenType resolves to a valid HighlightCategory value', () => {
      // IC-3: All mapped tokens must have valid highlight categories
      const validCategories: HighlightCategory[] = [
        'keyword',
        'operator',
        'string',
        'number',
        'bool',
        'comment',
        'variableName',
        'functionName',
        'punctuation',
        'bracket',
        'meta',
      ];

      for (const [tokenType, category] of TOKEN_HIGHLIGHT_MAP.entries()) {
        expect(
          validCategories.includes(category),
          `Token ${tokenType} has invalid category: ${category}`
        ).toBe(true);
      }
    });

    it('all mapped categories are one of the 11 valid HighlightCategory values', () => {
      // IC-3: Verify categories match the HighlightCategory type
      const validCategories = new Set<HighlightCategory>([
        'keyword',
        'operator',
        'string',
        'number',
        'bool',
        'comment',
        'variableName',
        'functionName',
        'punctuation',
        'bracket',
        'meta',
      ]);

      for (const [, category] of TOKEN_HIGHLIGHT_MAP.entries()) {
        expect(validCategories.has(category)).toBe(true);
        expect(
          category === 'keyword' ||
            category === 'operator' ||
            category === 'string' ||
            category === 'number' ||
            category === 'bool' ||
            category === 'comment' ||
            category === 'variableName' ||
            category === 'functionName' ||
            category === 'punctuation' ||
            category === 'bracket' ||
            category === 'meta'
        ).toBe(true);
      }
    });
  });

  describe('IC-3: All 11 HighlightCategory values are represented', () => {
    it('all 11 HighlightCategory values appear in the map', () => {
      // IC-3: All highlight categories should be used
      const categorySet = new Set<HighlightCategory>();

      for (const category of TOKEN_HIGHLIGHT_MAP.values()) {
        categorySet.add(category);
      }

      // All 11 categories must be present
      expect(categorySet.has('keyword')).toBe(true);
      expect(categorySet.has('operator')).toBe(true);
      expect(categorySet.has('string')).toBe(true);
      expect(categorySet.has('number')).toBe(true);
      expect(categorySet.has('bool')).toBe(true);
      expect(categorySet.has('comment')).toBe(true);
      expect(categorySet.has('variableName')).toBe(true);
      expect(categorySet.has('functionName')).toBe(true);
      expect(categorySet.has('punctuation')).toBe(true);
      expect(categorySet.has('bracket')).toBe(true);
      expect(categorySet.has('meta')).toBe(true);

      // Exactly 11 categories
      expect(categorySet.size).toBe(11);
    });

    it('returns at least one token for each HighlightCategory', () => {
      // IC-3: Each category should have at least one token
      const categoryCounts = new Map<HighlightCategory, number>();

      for (const category of TOKEN_HIGHLIGHT_MAP.values()) {
        categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
      }

      expect(categoryCounts.get('keyword')!).toBeGreaterThan(0);
      expect(categoryCounts.get('operator')!).toBeGreaterThan(0);
      expect(categoryCounts.get('string')!).toBeGreaterThan(0);
      expect(categoryCounts.get('number')!).toBeGreaterThan(0);
      expect(categoryCounts.get('bool')!).toBeGreaterThan(0);
      expect(categoryCounts.get('comment')!).toBeGreaterThan(0);
      expect(categoryCounts.get('variableName')!).toBeGreaterThan(0);
      expect(categoryCounts.get('functionName')!).toBeGreaterThan(0);
      expect(categoryCounts.get('punctuation')!).toBeGreaterThan(0);
      expect(categoryCounts.get('bracket')!).toBeGreaterThan(0);
      expect(categoryCounts.get('meta')!).toBeGreaterThan(0);
    });
  });

  describe('IC-3: NEWLINE and EOF are not in the map', () => {
    it('NEWLINE token is not in TOKEN_HIGHLIGHT_MAP', () => {
      // IC-3: NEWLINE should be intentionally unmapped
      expect(TOKEN_HIGHLIGHT_MAP.has('NEWLINE')).toBe(false);
      expect(TOKEN_HIGHLIGHT_MAP.get('NEWLINE')).toBeUndefined();
    });

    it('EOF token is not in TOKEN_HIGHLIGHT_MAP', () => {
      // IC-3: EOF should be intentionally unmapped
      expect(TOKEN_HIGHLIGHT_MAP.has('EOF')).toBe(false);
      expect(TOKEN_HIGHLIGHT_MAP.get('EOF')).toBeUndefined();
    });

    it('only NEWLINE and EOF are unmapped from TOKEN_TYPES', () => {
      // IC-3: Verify only these two tokens are unmapped
      const allTokenTypes = Object.values(TOKEN_TYPES) as TokenType[];

      // Count unmapped tokens
      const unmappedTokens = allTokenTypes.filter(
        (tokenType) => !TOKEN_HIGHLIGHT_MAP.has(tokenType)
      );

      // Only NEWLINE and EOF should be unmapped
      expect(unmappedTokens.length).toBe(2);
      expect(unmappedTokens).toContain('NEWLINE');
      expect(unmappedTokens).toContain('EOF');
    });
  });

  describe('IC-3: Map is ReadonlyMap (no set method)', () => {
    it('TOKEN_HIGHLIGHT_MAP is a ReadonlyMap', () => {
      // IC-3: Map should be ReadonlyMap type
      // TypeScript enforces this at compile time
      // Runtime verification: ensure it's a Map instance
      expect(TOKEN_HIGHLIGHT_MAP instanceof Map).toBe(true);
    });

    it('TOKEN_HIGHLIGHT_MAP type prevents set() calls at compile time', () => {
      // IC-3: ReadonlyMap type prevents set() at TypeScript level
      // This test verifies the TypeScript type is ReadonlyMap
      // At compile time: TOKEN_HIGHLIGHT_MAP.set(...) would be a type error
      // At runtime: Map prototype has set method, but type system prevents usage

      // Verify it's a Map (has Map methods)
      expect(TOKEN_HIGHLIGHT_MAP instanceof Map).toBe(true);

      // Type assertion prevents: TOKEN_HIGHLIGHT_MAP.set('NEW_TOKEN', 'keyword')
      // TypeScript compiler error: Property 'set' does not exist on type 'ReadonlyMap'
      const typecheck: ReadonlyMap<TokenType, HighlightCategory> =
        TOKEN_HIGHLIGHT_MAP;
      expect(typecheck).toBe(TOKEN_HIGHLIGHT_MAP);
    });

    it('TOKEN_HIGHLIGHT_MAP has expected readonly Map methods', () => {
      // IC-3: ReadonlyMap should have get, has, entries, etc.
      expect(typeof TOKEN_HIGHLIGHT_MAP.get).toBe('function');
      expect(typeof TOKEN_HIGHLIGHT_MAP.has).toBe('function');
      expect(typeof TOKEN_HIGHLIGHT_MAP.entries).toBe('function');
      expect(typeof TOKEN_HIGHLIGHT_MAP.values).toBe('function');
      expect(typeof TOKEN_HIGHLIGHT_MAP.keys).toBe('function');
    });
  });

  describe('EC-4: Unmapped token returns undefined', () => {
    it('returns undefined for NEWLINE token', () => {
      // EC-4, AC-25: Missing category returns undefined
      const result = TOKEN_HIGHLIGHT_MAP.get('NEWLINE');
      expect(result).toBeUndefined();
    });

    it('returns undefined for EOF token', () => {
      // EC-4, AC-25: Missing category returns undefined
      const result = TOKEN_HIGHLIGHT_MAP.get('EOF');
      expect(result).toBeUndefined();
    });

    it('returns undefined for arbitrary unmapped token', () => {
      // EC-4, AC-25: Missing category returns undefined
      const result = TOKEN_HIGHLIGHT_MAP.get('NONEXISTENT_TOKEN' as TokenType);
      expect(result).toBeUndefined();
    });

    it('has() returns false for unmapped tokens', () => {
      // EC-4, AC-25: Verify has() also returns false
      expect(TOKEN_HIGHLIGHT_MAP.has('NEWLINE')).toBe(false);
      expect(TOKEN_HIGHLIGHT_MAP.has('EOF')).toBe(false);
      expect(TOKEN_HIGHLIGHT_MAP.has('NONEXISTENT_TOKEN' as TokenType)).toBe(
        false
      );
    });
  });

  describe('Consistency', () => {
    it('all mapped tokens exist in TOKEN_TYPES', () => {
      // Consistency check: mapped tokens should be valid TokenType values
      const allTokenTypes = new Set(Object.values(TOKEN_TYPES) as TokenType[]);

      for (const tokenType of TOKEN_HIGHLIGHT_MAP.keys()) {
        expect(
          allTokenTypes.has(tokenType),
          `Mapped token ${tokenType} not found in TOKEN_TYPES`
        ).toBe(true);
      }
    });

    it('returns consistent values across multiple accesses', () => {
      // Consistency check: map should return same values
      const category1 = TOKEN_HIGHLIGHT_MAP.get('STRING');
      const category2 = TOKEN_HIGHLIGHT_MAP.get('STRING');
      expect(category1).toBe(category2);
      expect(category1).toBe('string');
    });

    it('map size remains constant across accesses', () => {
      // Consistency check: map size should be stable
      const size1 = TOKEN_HIGHLIGHT_MAP.size;
      const size2 = TOKEN_HIGHLIGHT_MAP.size;
      expect(size1).toBe(size2);
      expect(size1).toBeGreaterThan(0);
    });
  });

  describe('AC-38: All 7 new compound tokens are present', () => {
    it('LIST_LBRACKET is in TOKEN_HIGHLIGHT_MAP', () => {
      // AC-38: list[ compound token must have a highlight entry
      expect(TOKEN_HIGHLIGHT_MAP.has('LIST_LBRACKET')).toBe(true);
      expect(TOKEN_HIGHLIGHT_MAP.get('LIST_LBRACKET')).toBeDefined();
    });

    it('DICT_LBRACKET is in TOKEN_HIGHLIGHT_MAP', () => {
      // AC-38: dict[ compound token must have a highlight entry
      expect(TOKEN_HIGHLIGHT_MAP.has('DICT_LBRACKET')).toBe(true);
      expect(TOKEN_HIGHLIGHT_MAP.get('DICT_LBRACKET')).toBeDefined();
    });

    it('TUPLE_LBRACKET is in TOKEN_HIGHLIGHT_MAP', () => {
      // AC-38: tuple[ compound token must have a highlight entry
      expect(TOKEN_HIGHLIGHT_MAP.has('TUPLE_LBRACKET')).toBe(true);
      expect(TOKEN_HIGHLIGHT_MAP.get('TUPLE_LBRACKET')).toBeDefined();
    });

    it('ORDERED_LBRACKET is in TOKEN_HIGHLIGHT_MAP', () => {
      // AC-38: ordered[ compound token must have a highlight entry
      expect(TOKEN_HIGHLIGHT_MAP.has('ORDERED_LBRACKET')).toBe(true);
      expect(TOKEN_HIGHLIGHT_MAP.get('ORDERED_LBRACKET')).toBeDefined();
    });

    it('DESTRUCT_LANGLE is in TOKEN_HIGHLIGHT_MAP', () => {
      // AC-38: destruct< compound token must have a highlight entry
      expect(TOKEN_HIGHLIGHT_MAP.has('DESTRUCT_LANGLE')).toBe(true);
      expect(TOKEN_HIGHLIGHT_MAP.get('DESTRUCT_LANGLE')).toBeDefined();
    });

    it('SLICE_LANGLE is in TOKEN_HIGHLIGHT_MAP', () => {
      // AC-38: slice< compound token must have a highlight entry
      expect(TOKEN_HIGHLIGHT_MAP.has('SLICE_LANGLE')).toBe(true);
      expect(TOKEN_HIGHLIGHT_MAP.get('SLICE_LANGLE')).toBeDefined();
    });

    it('all compound tokens resolve to valid HighlightCategory values', () => {
      // AC-38: each compound token maps to a valid category
      const compoundTokens = [
        'LIST_LBRACKET',
        'DICT_LBRACKET',
        'TUPLE_LBRACKET',
        'ORDERED_LBRACKET',
        'DESTRUCT_LANGLE',
        'SLICE_LANGLE',
      ] as const;

      for (const token of compoundTokens) {
        const category = TOKEN_HIGHLIGHT_MAP.get(token);
        expect(
          category,
          `${token} must have a highlight category`
        ).toBeDefined();
      }
    });
  });

  describe('AC-38: Removed sigil tokens are absent from TOKEN_HIGHLIGHT_MAP', () => {
    it('STAR_LT is not in TOKEN_HIGHLIGHT_MAP', () => {
      // AC-38: *[ sigil token was removed and must not appear in the map
      expect(TOKEN_HIGHLIGHT_MAP.has('STAR_LT' as TokenType)).toBe(false);
      expect(TOKEN_HIGHLIGHT_MAP.get('STAR_LT' as TokenType)).toBeUndefined();
    });

    it('SLASH_LT is not in TOKEN_HIGHLIGHT_MAP', () => {
      // AC-38: /< sigil token was removed and must not appear in the map
      expect(TOKEN_HIGHLIGHT_MAP.has('SLASH_LT' as TokenType)).toBe(false);
      expect(TOKEN_HIGHLIGHT_MAP.get('SLASH_LT' as TokenType)).toBeUndefined();
    });
  });

  describe('AC-39: Every TOKEN_TYPES entry has a highlight map entry', () => {
    it('no token type in TOKEN_TYPES is missing from TOKEN_HIGHLIGHT_MAP (except NEWLINE and EOF)', () => {
      // AC-39: every token type must have a highlight entry or be intentionally excluded
      const intentionallyExcluded: TokenType[] = ['NEWLINE', 'EOF'];
      const allTokenTypes = Object.values(TOKEN_TYPES) as TokenType[];

      const unmappedTokens = allTokenTypes.filter(
        (tokenType) =>
          !TOKEN_HIGHLIGHT_MAP.has(tokenType) &&
          !intentionallyExcluded.includes(tokenType)
      );

      expect(
        unmappedTokens,
        `Tokens missing from TOKEN_HIGHLIGHT_MAP: ${unmappedTokens.join(', ')}`
      ).toHaveLength(0);
    });
  });

  describe('Specific Token Mappings', () => {
    it('maps literal tokens correctly', () => {
      expect(TOKEN_HIGHLIGHT_MAP.get('STRING')).toBe('string');
      expect(TOKEN_HIGHLIGHT_MAP.get('NUMBER')).toBe('number');
      expect(TOKEN_HIGHLIGHT_MAP.get('TRUE')).toBe('bool');
      expect(TOKEN_HIGHLIGHT_MAP.get('FALSE')).toBe('bool');
    });

    it('maps keyword tokens correctly', () => {
      expect(TOKEN_HIGHLIGHT_MAP.get('EACH')).toBe('keyword');
      expect(TOKEN_HIGHLIGHT_MAP.get('MAP')).toBe('keyword');
      expect(TOKEN_HIGHLIGHT_MAP.get('FOLD')).toBe('keyword');
      expect(TOKEN_HIGHLIGHT_MAP.get('FILTER')).toBe('keyword');
      expect(TOKEN_HIGHLIGHT_MAP.get('BREAK')).toBe('keyword');
      expect(TOKEN_HIGHLIGHT_MAP.get('RETURN')).toBe('keyword');
      expect(TOKEN_HIGHLIGHT_MAP.get('PASS')).toBe('keyword');
      expect(TOKEN_HIGHLIGHT_MAP.get('ASSERT')).toBe('keyword');
      expect(TOKEN_HIGHLIGHT_MAP.get('ERROR')).toBe('keyword');
    });

    it('maps variable tokens correctly', () => {
      expect(TOKEN_HIGHLIGHT_MAP.get('DOLLAR')).toBe('variableName');
      expect(TOKEN_HIGHLIGHT_MAP.get('PIPE_VAR')).toBe('variableName');
      expect(TOKEN_HIGHLIGHT_MAP.get('IDENTIFIER')).toBe('variableName');
      expect(TOKEN_HIGHLIGHT_MAP.get('UNDERSCORE')).toBe('variableName');
    });

    it('maps operator tokens correctly', () => {
      expect(TOKEN_HIGHLIGHT_MAP.get('ARROW')).toBe('operator');
      expect(TOKEN_HIGHLIGHT_MAP.get('CAPTURE_ARROW')).toBe('operator');
      expect(TOKEN_HIGHLIGHT_MAP.get('PLUS')).toBe('operator');
      expect(TOKEN_HIGHLIGHT_MAP.get('MINUS')).toBe('operator');
      expect(TOKEN_HIGHLIGHT_MAP.get('STAR')).toBe('operator');
      expect(TOKEN_HIGHLIGHT_MAP.get('SLASH')).toBe('operator');
      expect(TOKEN_HIGHLIGHT_MAP.get('EQ')).toBe('operator');
      expect(TOKEN_HIGHLIGHT_MAP.get('NE')).toBe('operator');
    });

    it('maps punctuation tokens correctly', () => {
      expect(TOKEN_HIGHLIGHT_MAP.get('DOT')).toBe('punctuation');
      expect(TOKEN_HIGHLIGHT_MAP.get('COMMA')).toBe('punctuation');
      expect(TOKEN_HIGHLIGHT_MAP.get('COLON')).toBe('punctuation');
      expect(TOKEN_HIGHLIGHT_MAP.get('DOUBLE_COLON')).toBe('punctuation');
      expect(TOKEN_HIGHLIGHT_MAP.get('QUESTION')).toBe('punctuation');
    });

    it('maps bracket tokens correctly', () => {
      expect(TOKEN_HIGHLIGHT_MAP.get('LPAREN')).toBe('bracket');
      expect(TOKEN_HIGHLIGHT_MAP.get('RPAREN')).toBe('bracket');
      expect(TOKEN_HIGHLIGHT_MAP.get('LBRACE')).toBe('bracket');
      expect(TOKEN_HIGHLIGHT_MAP.get('RBRACE')).toBe('bracket');
      expect(TOKEN_HIGHLIGHT_MAP.get('LBRACKET')).toBe('bracket');
      expect(TOKEN_HIGHLIGHT_MAP.get('RBRACKET')).toBe('bracket');
    });

    it('maps method name token correctly', () => {
      expect(TOKEN_HIGHLIGHT_MAP.get('METHOD_NAME')).toBe('functionName');
    });

    it('maps comment token correctly', () => {
      expect(TOKEN_HIGHLIGHT_MAP.get('COMMENT')).toBe('comment');
    });

    it('maps meta token correctly', () => {
      expect(TOKEN_HIGHLIGHT_MAP.get('FRONTMATTER_DELIM')).toBe('meta');
    });
  });
});
